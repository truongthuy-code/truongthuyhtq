/**
 * MathType / OLE detection + extraction for DOCX imports.
 *
 * Scans `word/embeddings/*.bin` (referenced from `word/document.xml` through
 * `word/_rels/document.xml.rels`), identifies which OLE objects are MathType
 * equations, and converts them to LaTeX via the MTEF decoder.
 *
 * Non-MathType OLE objects (Excel, Word, Visio, plain pictures…) are reported
 * as such so the caller keeps its existing image handling for them.
 */

import type JSZip from "jszip";
import { readCfbStreams } from "./cfb";
import { equationNativeToLatex } from "./mtefToLatex";

export type FormulaNode = {
  type: "formula";
  source: "MathType" | "OMML";
  version: string | null;
  latex: string | null;
  mathml?: string | null;
  imageFallback?: string | null;
  conversionStatus: "success" | "fallback";
};

export type OleEntry = {
  /** relationship id of the OLE object in document.xml */
  rId: string;
  /** e.g. word/embeddings/oleObject12.bin */
  path: string;
  progId: string;
  isMathType: boolean;
  formula: FormulaNode | null;
};

export type OleMap = Map<string, OleEntry>;

/**
 * ProgIDs used by MathType across versions:
 *  - "Equation.DSMT4"        → MathType 6.x
 *  - "Equation.DSMT6/7"      → MathType 6/7
 *  - "MathType 6.0 Equation" / "MathType 7.0 Equation"
 *  - "Equation.3" (Microsoft Equation 3.0) also stores MTEF → handled too
 */
const MATHTYPE_PROGID = /(^|\W)(mathtype\s*[0-9.]*\s*equation|equation\.dsmt\d*|dsmt\d+|equation\.3|equation)(\W|$)/i;

export function isMathTypeProgId(progId: string): boolean {
  if (!progId) return false;
  return MATHTYPE_PROGID.test(progId.trim());
}

function progIdVersion(progId: string, application: string | null, productVersion: string | null): string | null {
  const m = progId.match(/mathtype\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (m) return m[1];
  const dsmt = progId.match(/dsmt(\d+)/i);
  if (dsmt) {
    // DSMT4 == MathType 6, DSMT6/7 == MathType 6/7
    const n = Number(dsmt[1]);
    if (n === 4) return "6.0";
    return `${n}.0`;
  }
  if (application) {
    const a = application.match(/DSMT(\d+)/i);
    if (a) return `${a[1]}.0`;
  }
  return productVersion;
}

type Rel = { id: string; type: string; target: string };

function readRels(xml: string): Rel[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const nodes = doc.getElementsByTagName("Relationship");
  const out: Rel[] = [];
  for (let i = 0; i < nodes.length; i++) {
    out.push({
      id: nodes[i].getAttribute("Id") || "",
      type: nodes[i].getAttribute("Type") || "",
      target: nodes[i].getAttribute("Target") || "",
    });
  }
  return out;
}

function normalizeTarget(target: string): string {
  if (!target) return "";
  if (target.startsWith("/")) return target.replace(/^\//, "");
  return "word/" + target.replace(/^\.?\//, "");
}

const DEBUG_PREFIX = "[DOCX-PARSER]";

/**
 * Builds a map: relationship id → OLE entry (with LaTeX when it is MathType).
 * Reads every embedded OLE package once; safe for files with hundreds of
 * equations (pure in-memory binary parsing, no execution).
 */
export async function buildOleMathMap(
  zip: JSZip,
  progIdByRid: Map<string, string>,
  onProgress?: (done: number, total: number) => void,
): Promise<OleMap> {
  const map: OleMap = new Map();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return map;
  const rels = readRels(await relsFile.async("string"));
  const oleRels = rels.filter((r) => /\/oleObject$/i.test(r.type) || /embeddings\//i.test(r.target));

  let done = 0;
  let ok = 0;
  let failed = 0;

  for (const rel of oleRels) {
    const path = normalizeTarget(rel.target);
    const progId = progIdByRid.get(rel.id) || "";
    const mathType = isMathTypeProgId(progId);
    const entry: OleEntry = { rId: rel.id, path, progId, isMathType: mathType, formula: null };
    map.set(rel.id, entry);
    done++;
    onProgress?.(done, oleRels.length);

    if (!mathType) continue;
    const f = zip.file(path);
    if (!f) {
      failed++;
      console.warn(`${DEBUG_PREFIX} MathType OLE missing in package\nObject: ${path}\nConversion: failed`);
      entry.formula = { type: "formula", source: "MathType", version: progIdVersion(progId, null, null), latex: null, conversionStatus: "fallback" };
      continue;
    }
    try {
      const bytes = new Uint8Array(await f.async("uint8array"));
      const streams = readCfbStreams(bytes);
      const eqn = streams.get("Equation Native");
      if (!eqn) {
        failed++;
        console.warn(`${DEBUG_PREFIX}\nDetected OLE object\nType: ${progId}\nObject: ${path}\nConversion: failed\nFallback: image\nReason: no "Equation Native" stream`);
        entry.formula = { type: "formula", source: "MathType", version: progIdVersion(progId, null, null), latex: null, conversionStatus: "fallback" };
        continue;
      }
      const res = equationNativeToLatex(eqn);
      const version = progIdVersion(progId, res.application, res.productVersion);
      if (res.latex) {
        ok++;
        entry.formula = { type: "formula", source: "MathType", version, latex: res.latex, conversionStatus: "success" };
      } else {
        failed++;
        console.warn(`${DEBUG_PREFIX}\nDetected OLE object\nType: ${progId}\nObject: ${path}\nConversion: failed\nFallback: image\nReason: ${res.error ?? "unknown"}`);
        entry.formula = { type: "formula", source: "MathType", version, latex: null, conversionStatus: "fallback" };
      }
    } catch (e) {
      failed++;
      console.warn(`${DEBUG_PREFIX}\nDetected OLE object\nType: ${progId}\nObject: ${path}\nConversion: failed\nFallback: image\nReason: ${e instanceof Error ? e.message : String(e)}`);
      entry.formula = { type: "formula", source: "MathType", version: progIdVersion(progId, null, null), latex: null, conversionStatus: "fallback" };
    }
  }

  if (oleRels.length) {
    console.info(`${DEBUG_PREFIX} OLE objects: ${oleRels.length}, MathType converted: ${ok}, fallback: ${failed}`);
  }
  return map;
}
