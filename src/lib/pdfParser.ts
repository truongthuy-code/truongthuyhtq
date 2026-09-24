import * as pdfjsLib from "pdfjs-dist";
// Use the bundled worker via Vite ?url import
// @ts-ignore - vite worker URL
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseTextExam } from "./textExamParser";
import type { ParsedExam } from "./docxParser";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl;

const SENT_OPEN = "\u27E6";
const SENT_CLOSE = "\u27E7";
const encImg = (src: string) => `${SENT_OPEN}IMG:${encodeURIComponent(src)}${SENT_CLOSE}`;

type Mat = [number, number, number, number, number, number];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** Turn a pdf.js image object into a PNG data URL (null when not renderable). */
function imageToDataUrl(img: any): string | null {
  try {
    if (!img) return null;
    const width = img.width || img.bitmap?.width || 0;
    const height = img.height || img.bitmap?.height || 0;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White backdrop so transparent scans stay readable.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    if (img.bitmap) {
      ctx.drawImage(img.bitmap, 0, 0, width, height);
    } else if (img.data) {
      const src: Uint8Array | Uint8ClampedArray = img.data;
      const out = ctx.createImageData(width, height);
      const dst = out.data;
      const px = width * height;
      if (src.length >= px * 4) {
        dst.set(src.subarray(0, px * 4));
      } else if (src.length >= px * 3) {
        for (let i = 0, j = 0; i < px; i++, j += 4) {
          dst[j] = src[i * 3];
          dst[j + 1] = src[i * 3 + 1];
          dst[j + 2] = src[i * 3 + 2];
          dst[j + 3] = 255;
        }
      } else if (src.length >= px) {
        for (let i = 0, j = 0; i < px; i++, j += 4) {
          dst[j] = dst[j + 1] = dst[j + 2] = src[i];
          dst[j + 3] = 255;
        }
      } else {
        return null;
      }
      ctx.putImageData(out, 0, 0);
    } else {
      return null;
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function getPageObj(page: any, name: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      if (page.objs.has?.(name)) return resolve(page.objs.get(name));
      page.objs.get(name, resolve);
      // Safety net: never block the import on a missing object.
      setTimeout(() => resolve(null), 3000);
    } catch {
      resolve(null);
    }
  });
}

/** Extracts embedded images of one page together with their position. */
async function extractPageImages(page: any): Promise<{ x: number; y: number; src: string }[]> {
  const out: { x: number; y: number; src: string }[] = [];
  const OPS = (pdfjsLib as any).OPS;
  let opList: any;
  try {
    opList = await page.getOperatorList();
  } catch {
    return out;
  }
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const stack: Mat[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) {
      stack.push([...ctm] as Mat);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() || ([1, 0, 0, 1, 0, 0] as Mat);
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args as Mat);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintJpegXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject
    ) {
      const img =
        fn === OPS.paintInlineImageXObject ? args[0] : await getPageObj(page, args[0]);
      const src = imageToDataUrl(img);
      if (src) out.push({ x: ctm[4], y: ctm[5], src });
    }
  }
  return out;
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Reconstruct lines using y-coordinate clustering
    type Item = { str: string; x: number; y: number; img?: boolean };
    const items: Item[] = (content.items as any[])
      .filter((it) => typeof it.str === "string")
      .map((it) => ({ str: it.str, x: it.transform[4], y: Math.round(it.transform[5]) }));
    // Embedded pictures join the same stream so they keep their place in the
    // reading order (a picture belongs to the question/option it sits under).
    let pics: { x: number; y: number; src: string }[] = [];
    try {
      pics = await extractPageImages(page);
    } catch {/* keep text even if images fail */}
    for (const pic of pics) {
      items.push({ str: encImg(pic.src), x: pic.x, y: Math.round(pic.y), img: true });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let curY: number | null = null;
    let line = "";
    for (const it of items) {
      if (curY === null || Math.abs(it.y - curY) > 2) {
        if (line) out.push(line);
        line = it.str;
        curY = it.y;
      } else {
        line += (line && !line.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str;
      }
    }
    if (line) out.push(line);
    out.push(""); // page break
  }
  return out.join("\n");
}

export async function parsePdfExam(file: File): Promise<ParsedExam> {
  const text = await extractPdfText(file);
  return parseTextExam(text);
}
