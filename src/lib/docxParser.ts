import JSZip from "jszip";
import { ommlElementToLatex } from "./ommlToLatex";
import { buildOleMathMap, type OleMap } from "./mathtypeOle";


export const QUESTION_LEVELS = ["NB", "TH", "VD", "VDC"] as const;
export type QuestionLevel = (typeof QUESTION_LEVELS)[number];
export const LEVEL_LABELS: Record<QuestionLevel, string> = {
  NB: "Nhận biết",
  TH: "Thông hiểu",
  VD: "Vận dụng",
  VDC: "Vận dụng cao",
};
/** Matches the start of a question: "Câu 1." / "Câu 1:" / "Câu 1 (NB)." etc. */
export const QUESTION_START_RE = /^\s*C[âa]u\s*(\d+)\s*(?:[(\[]\s*(NB|TH|VD|VDC)\s*[)\]])?\s*[:.\)]/i;
/** Same, but used to strip the prefix from a question stem. */
export const QUESTION_PREFIX_RE = /^\s*C[âa]u\s*\d+\s*(?:[(\[]\s*(?:NB|TH|VD|VDC)\s*[)\]])?\s*[:.\)]?\s*/i;

export type MCQuestion = {
  type: "mc";
  id: string;
  text: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  answer: "A" | "B" | "C" | "D";
  explanation?: string | null;
  level?: QuestionLevel | null;
};

export type TFQuestion = {
  type: "tf";
  id: string;
  text: string;
  items: { key: "a" | "b" | "c" | "d"; text: string; correct: boolean }[];
  explanation?: string | null;
  level?: QuestionLevel | null;
};

export type SAQuestion = {
  type: "sa";
  id: string;
  text: string;
  answer: string;
  explanation?: string | null;
  level?: QuestionLevel | null;
};


export type ParsedQuestion = MCQuestion | TFQuestion | SAQuestion;

export type ParsedExam = {
  partI: MCQuestion[];
  partII: TFQuestion[];
  partIII: SAQuestion[];
};

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

const SENT_OPEN = "\u27E6";
const SENT_CLOSE = "\u27E7";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const encMath = (latex: string) =>
  `${SENT_OPEN}MATH:${latex.replace(/[\u27E6\u27E7]/g, "")}${SENT_CLOSE}`;
const encCode = (lang: string, content: string) =>
  `${SENT_OPEN}CODE:${lang}:${encodeURIComponent(content)}${SENT_CLOSE}`;
const encImg = (src: string) =>
  `${SENT_OPEN}IMG:${encodeURIComponent(src)}${SENT_CLOSE}`;
const encTbl = (rows: string[][]) =>
  `${SENT_OPEN}TBL:${encodeURIComponent(JSON.stringify(rows))}${SENT_CLOSE}`;

export function stripRich(s: string): string {
  return s
    .replace(new RegExp(`${SENT_OPEN}[^${SENT_CLOSE}]*${SENT_CLOSE}`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns true if the rich text has any visible content (text, image, table, math, code). */
export function hasRichContent(s: string): boolean {
  if (!s) return false;
  if (stripRich(s)) return true;
  return /[\u27E6](IMG|TBL|MATH|CODE):/.test(s);
}

const COLOR_RED = (hex: string) => {
  if (!hex) return false;
  const h = hex.replace("#", "").toUpperCase();
  if (h === "FF0000" || h === "C00000" || h === "ED0000") return true;
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return r > 150 && g < 90 && b < 90;
  }
  return false;
};

const MONO_FONTS = ["consolas", "courier new", "courier", "menlo", "monaco", "lucida console", "source code pro", "fira code", "jetbrains mono"];
const isMonoFont = (n: string) => !!n && MONO_FONTS.some((f) => n.toLowerCase().includes(f));

function detectLang(code: string): string {
  const t = code.toLowerCase();
  if (/<\/?[a-z][a-z0-9]*[\s>]/.test(t)) return "html";
  if (/\bselect\b.*\bfrom\b|\binsert into\b|\bupdate\b.*\bset\b|\bcreate table\b/i.test(code)) return "sql";
  if (/\b(def|import|print|class|elif|self|lambda)\b/.test(code)) return "python";
  if (/\b(function|const|let|var|=>)\b/.test(code)) return "javascript";
  return "plaintext";
}

type RunProps = { red: boolean; underline: boolean; mono: boolean; bold: boolean };

function readRunProps(rPr: Element | undefined): RunProps {
  let red = false, underline = false, mono = false, bold = false;
  if (!rPr) return { red, underline, mono, bold };
  const colorEl = rPr.getElementsByTagNameNS(W_NS, "color")[0];
  if (colorEl) {
    const v = colorEl.getAttributeNS(W_NS, "val") || colorEl.getAttribute("w:val") || "";
    if (COLOR_RED(v)) red = true;
  }
  const uEl = rPr.getElementsByTagNameNS(W_NS, "u")[0];
  if (uEl) {
    const v = uEl.getAttributeNS(W_NS, "val") || uEl.getAttribute("w:val") || "single";
    if (v && v !== "none") underline = true;
  }
  const fontsEl = rPr.getElementsByTagNameNS(W_NS, "rFonts")[0];
  if (fontsEl) {
    const ascii = fontsEl.getAttributeNS(W_NS, "ascii") || fontsEl.getAttribute("w:ascii") || "";
    const hAnsi = fontsEl.getAttributeNS(W_NS, "hAnsi") || fontsEl.getAttribute("w:hAnsi") || "";
    if (isMonoFont(ascii) || isMonoFont(hAnsi)) mono = true;
  }
  const bEl = rPr.getElementsByTagNameNS(W_NS, "b")[0];
  if (bEl) {
    const v = bEl.getAttributeNS(W_NS, "val") || bEl.getAttribute("w:val");
    if (v === null || v === undefined || (v !== "0" && v !== "false")) bold = true;
  }
  return { red, underline, mono, bold };
}

function runText(r: Element): string {
  let text = "";
  for (let i = 0; i < r.childNodes.length; i++) {
    const c = r.childNodes[i];
    if (c.nodeType !== 1) continue;
    const el = c as Element;
    const ln = el.localName || el.nodeName.replace(/^.*:/, "");
    if (ln === "t") text += el.textContent || "";
    else if (ln === "tab") text += "\t";
    else if (ln === "br") text += "\n";
  }
  return text;
}

// A token represents an ordered piece of a paragraph.
type TextTok = { kind: "text"; text: string; props: RunProps };
type MathTok = { kind: "math"; latex: string };
type CodeTok = { kind: "code"; lang: string; content: string };
type ObjTok = { kind: "obj" }; // OLE math/object — placeholder
type ImgTok = { kind: "img"; src: string };
type TblTok = { kind: "tbl"; rows: string[][] };
/** Paragraph boundary marker (keeps document structure inside a question). */
type PbrkTok = { kind: "pbrk" };
type Tok = TextTok | MathTok | CodeTok | ObjTok | ImgTok | TblTok | PbrkTok;

const PBRK: PbrkTok = { kind: "pbrk" };

type Para = {
  toks: Tok[];
  plain: string; // concatenated plain text (no sentinels)
  rich: string;  // concatenated rich text (with sentinels)
  hasAnyMark: boolean;
};

function tokensToRich(toks: Tok[]): string {
  // Group consecutive mono text into a single code block.
  let out = "";
  let codeBuf = "";
  const flushCode = () => {
    if (!codeBuf) return;
    out += encCode(detectLang(codeBuf), codeBuf);
    codeBuf = "";
  };
  for (const t of toks) {
    if (t.kind === "text") {
      if (t.props.mono) codeBuf += t.text;
      else { flushCode(); out += t.text; }
    } else if (t.kind === "math") {
      flushCode();
      out += encMath(t.latex);
    } else if (t.kind === "code") {
      flushCode();
      out += encCode(t.lang, t.content);
    } else if (t.kind === "img") {
      flushCode();
      out += encImg(t.src);
    } else if (t.kind === "tbl") {
      flushCode();
      out += encTbl(t.rows);
    } else if (t.kind === "pbrk") {
      flushCode();
      out += " ";
    } else if (t.kind === "obj") {
      flushCode();
      out += encMath("\\boxed{\\text{ct}}");
    }
  }
  flushCode();
  return out;
}

function tokensToPlain(toks: Tok[]): string {
  let s = "";
  for (const t of toks) {
    if (t.kind === "text") s += t.text;
    else s += " "; // math/img/tbl/obj/code/pbrk → space placeholder for plain matching
  }
  return s;
}


type ImageMap = Map<string, string>; // rId -> data URL

function mimeFromExt(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function loadImageMap(zip: JSZip): Promise<ImageMap> {
  const map: ImageMap = new Map();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return map;
  const relsXml = await relsFile.async("string");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const rels = relsDoc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    const type = rel.getAttribute("Type") || "";
    if (!/\/image$/.test(type)) continue;
    const id = rel.getAttribute("Id") || "";
    let target = rel.getAttribute("Target") || "";
    if (!target) continue;
    if (!target.startsWith("/")) target = "word/" + target.replace(/^\.?\//, "");
    else target = target.replace(/^\//, "");
    const f = zip.file(target);
    if (!f) continue;
    try {
      const b64 = await f.async("base64");
      map.set(id, `data:${mimeFromExt(target)};base64,${b64}`);
    } catch {/* ignore */}
  }
  return map;
}

function extractImageRefs(el: Element, images: ImageMap): string[] {
  // Walk the subtree in document order so images keep their original order.
  // Rules:
  //  - inside <mc:AlternateContent>, only <mc:Choice> is read (the
  //    <mc:Fallback> VML copy would duplicate the very same picture);
  //  - inside a blipFill, only the first <a:blip> is read (an SVG picture
  //    carries both the raster blip and an <asvg:svgBlip> of the same image);
  //  - VML <v:imagedata> is read when no drawing covered it already.
  const out: string[] = [];
  const pushRef = (id: string) => {
    if (!id) return;
    const src = images.get(id);
    if (src) out.push(src);
  };
  const firstBlipRef = (node: Element): string => {
    const blips = node.getElementsByTagNameNS(A_NS, "blip");
    if (!blips.length) return "";
    return blips[0].getAttributeNS(R_NS, "embed") || blips[0].getAttribute("r:embed") || "";
  };
  const walk = (node: Element) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1) continue;
      const child = c as Element;
      const ln = child.localName || child.nodeName.replace(/^.*:/, "");
      if (ln === "AlternateContent") {
        const choices = child.getElementsByTagName("*");
        let choice: Element | null = null;
        for (let k = 0; k < choices.length; k++) {
          const n = choices[k];
          const nl = n.localName || n.nodeName.replace(/^.*:/, "");
          if (nl === "Choice") { choice = n as Element; break; }
        }
        if (choice) walk(choice);
        else walk(child); // only a Fallback exists
        continue;
      }
      if (ln === "blipFill") {
        pushRef(firstBlipRef(child));
        continue;
      }
      if (ln === "imagedata") {
        pushRef(child.getAttributeNS(R_NS, "id") || child.getAttribute("r:id") || "");
        continue;
      }
      if (ln === "blip") {
        // A blip not wrapped in a blipFill (rare) — still keep the image.
        pushRef(child.getAttributeNS(R_NS, "embed") || child.getAttribute("r:embed") || "");
        continue;
      }
      walk(child);
    }
  };
  walk(el);
  return out;
}


function oleRefOf(el: Element): { rId: string; progId: string } | null {
  const objs = el.getElementsByTagNameNS(W_NS, "object");
  if (!objs.length) return null;
  const all = objs[0].getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    const ln = n.localName || n.nodeName.replace(/^.*:/, "");
    if (ln !== "OLEObject") continue;
    const rId = n.getAttributeNS(R_NS, "id") || n.getAttribute("r:id") || "";
    const progId = n.getAttribute("ProgID") || n.getAttribute("progid") || "";
    return { rId, progId };
  }
  return { rId: "", progId: "" };
}

function parseParagraph(p: Element, images: ImageMap, ole?: OleMap): Para {
  const toks: Tok[] = [];
  let hasAnyMark = false;
  const walk = (parent: Element) => {
    for (let j = 0; j < parent.childNodes.length; j++) {
      const node = parent.childNodes[j];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const ln = el.localName || el.nodeName.replace(/^.*:/, "");
      const ns = el.namespaceURI;
      if (ns === W_NS && ln === "r") {
        const rPr = el.getElementsByTagNameNS(W_NS, "rPr")[0];
        const props = readRunProps(rPr);
        const t = runText(el);
        const oleRef = oleRefOf(el);
        const imgs = extractImageRefs(el, images);
        if (oleRef) {
          // MathType 6/7 (and Equation 3.0) OLE → structured LaTeX, in place.
          const entry = oleRef.rId ? ole?.get(oleRef.rId) : undefined;
          const latex = entry?.formula?.latex || null;
          if (latex) {
            toks.push({ kind: "math", latex });
          } else if (imgs.length) {
            for (const src of imgs) toks.push({ kind: "img", src });
          } else {
            toks.push({ kind: "obj" });
          }
        } else {
          for (const src of imgs) toks.push({ kind: "img", src });
        }
        if (t) {
          toks.push({ kind: "text", text: t, props });
          if (props.red || props.underline) hasAnyMark = true;
        }
      } else if (ns === M_NS && (ln === "oMath" || ln === "oMathPara")) {
        const maths = ln === "oMathPara"
          ? Array.from(el.getElementsByTagNameNS(M_NS, "oMath"))
          : [el];
        for (const m of maths) {
          const latex = ommlElementToLatex(m as Element);
          if (latex) toks.push({ kind: "math", latex });
        }
      } else if (ln === "drawing" || ln === "pict" || ln === "AlternateContent" || ln === "object") {
        // Picture placed directly inside the paragraph (not wrapped in a run).
        for (const src of extractImageRefs(el, images)) toks.push({ kind: "img", src });
      } else if (ns === W_NS && (ln === "hyperlink" || ln === "smartTag" || ln === "sdt" || ln === "sdtContent" || ln === "ins")) {

        walk(el);
      }
    }
  };
  walk(p);
  return { toks, plain: tokensToPlain(toks), rich: tokensToRich(toks), hasAnyMark };
}


function parseTable(tbl: Element, images: ImageMap, ole?: OleMap): Para {
  const rows: string[][] = [];
  const trs = Array.from(tbl.childNodes).filter(
    (n) => n.nodeType === 1 && (n as Element).namespaceURI === W_NS && ((n as Element).localName === "tr"),
  ) as Element[];
  for (const tr of trs) {
    const cells: string[] = [];
    const tcs = Array.from(tr.childNodes).filter(
      (n) => n.nodeType === 1 && (n as Element).namespaceURI === W_NS && ((n as Element).localName === "tc"),
    ) as Element[];
    for (const tc of tcs) {
      const ps = Array.from(tc.childNodes).filter(
        (n) => n.nodeType === 1 && (n as Element).namespaceURI === W_NS && ((n as Element).localName === "p"),
      ) as Element[];
      const cellRich = ps.map((p) => parseParagraph(p, images, ole).rich.trim()).filter(Boolean).join("\n");
      cells.push(cellRich);
    }
    rows.push(cells);
  }
  const tok: TblTok = { kind: "tbl", rows };
  return { toks: [tok], plain: " ", rich: encTbl(rows), hasAnyMark: false };
}

/** Collects ProgID for each OLE relationship id referenced in document.xml. */
function collectProgIds(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    const ln = n.localName || n.nodeName.replace(/^.*:/, "");
    if (ln !== "OLEObject") continue;
    const rId = n.getAttributeNS(R_NS, "id") || n.getAttribute("r:id") || "";
    if (!rId) continue;
    map.set(rId, n.getAttribute("ProgID") || n.getAttribute("progid") || "");
  }
  return map;
}

async function extractParagraphs(file: File): Promise<Para[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const images = await loadImageMap(zip);
  const ole = await buildOleMathMap(zip, collectProgIds(doc));

  const paras: Para[] = [];
  const body = doc.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) return paras;

  // Walk only direct children to avoid pulling paragraphs out of tables.
  for (let j = 0; j < body.childNodes.length; j++) {
    const node = body.childNodes[j];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    if (el.namespaceURI !== W_NS) continue;
    const ln = el.localName;
    if (ln === "p") paras.push(parseParagraph(el, images, ole));
    else if (ln === "tbl") paras.push(parseTable(el, images, ole));
  }
  return paras;
}


function detectPart(line: string): 1 | 2 | 3 | 0 {
  const t = line.toLowerCase();
  if (t.includes("<g3>")) return 1;
  if (t.includes("<g2>")) return 2;
  if (t.includes("<g1>")) return 3;
  const u = line.toUpperCase().replace(/\s+/g, " ").trim();
  if (/PH[ẦA]N\s*(III|3)\b/.test(u)) return 3;
  if (/PH[ẦA]N\s*(II|2)\b/.test(u)) return 2;
  if (/PH[ẦA]N\s*(I|1)\b/.test(u)) return 1;
  return 0;
}

function stripMarkers(s: string): string {
  return s.replace(/<g[123]>/gi, "").trim();
}

/**
 * Given an ordered token stream, split it into option segments based on letter
 * delimiters like "A.", "B.", … (or "a)", "b)" …).
 *
 * Returns the stem (everything before the first option) plus options with rich
 * text and a `marked` flag (true if the letter character was inside an
 * underlined or red run).
 */
function splitOptions(
  toks: Tok[],
  letters: string,
  allowedDelims: string = ".)",
  dotNeedsParaStart = false,
): { stem: Tok[]; options: { key: string; toks: Tok[]; marked: boolean }[] } {
  // Flatten the token stream into per-character entries so option markers
  // can span run boundaries (e.g. underlined "C" then "." in next run).
  type Atom =
    | { kind: "ch"; ch: string; marked: boolean }
    | { kind: "non"; tok: Tok };
  const atoms: Atom[] = [];
  for (const tok of toks) {
    if (tok.kind === "text") {
      const marked = tok.props.red || tok.props.underline;
      for (const ch of tok.text) atoms.push({ kind: "ch", ch, marked });
    } else {
      atoms.push({ kind: "non", tok });
    }
  }

  const isLetter = (c: string) => letters.indexOf(c) >= 0;
  const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);
  const isDelim = (c: string) => allowedDelims.indexOf(c) >= 0;
  const isSpace = (c: string) => c === " " || c === "\u00A0" || c === "\t" || c === "\n";
  /** True when nothing but whitespace/'*' separates this atom from a paragraph break. */
  const atParaStart = (i: number): boolean => {
    for (let j = i - 1; j >= 0; j--) {
      const a = atoms[j];
      if (a.kind === "ch") {
        if (isSpace(a.ch) || a.ch === "*") continue;
        return false;
      }
      return a.tok.kind === "pbrk";
    }
    return true;
  };

  // Locate option boundaries: positions in `atoms` where a letter+delim starts.
  type Boundary = { start: number; end: number; key: string; marked: boolean };
  const bounds: Boundary[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.kind !== "ch") continue;
    if (!isLetter(a.ch)) continue;
    if (seen.has(a.ch)) continue;
    // previous visible char must not be alphanumeric
    let prev: Atom | undefined;
    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (atoms[j].kind === "ch") { prev = atoms[j]; prevIdx = j; break; }
      break; // a non-text token (math/image/paragraph break) separates it

    }
    if (prev && prev.kind === "ch" && isAlnum(prev.ch)) continue;
    // next non-space char must be an allowed delim
    let nextIdx = -1;
    for (let j = i + 1; j < atoms.length; j++) {
      const b = atoms[j];
      if (b.kind !== "ch") continue;
      if (b.ch === " " || b.ch === "\u00A0" || b.ch === "\t") continue;
      nextIdx = j; break;
    }
    if (nextIdx < 0) continue;
    const nb = atoms[nextIdx];
    if (nb.kind !== "ch" || !isDelim(nb.ch)) continue;
    // "a." style markers are ambiguous with ordinary prose — only accept them
    // when they open a paragraph.
    if (nb.ch === "." && dotNeedsParaStart && !atParaStart(i)) continue;

    // Star-marker: nearest non-space char before letter is '*' → correct answer.
    let starMarked = false;
    if (prev && prev.kind === "ch" && prev.ch === "*") {
      let pp: Atom | undefined;
      for (let j = prevIdx - 1; j >= 0; j--) {
        const aj = atoms[j];
        if (aj.kind === "ch") { pp = aj; break; }
        // A picture / equation / paragraph break ends the lookback.
        break;
      }

      if (!pp || (pp.kind === "ch" && !isAlnum(pp.ch))) {
        starMarked = true;
        // Neutralize the '*' atom so it doesn't leak into stem/prev option text.
        atoms[prevIdx] = { kind: "ch", ch: " ", marked: false };
      }
    }
    bounds.push({ start: i, end: nextIdx, key: a.ch, marked: a.marked || starMarked });
    seen.add(a.ch);
  }

  const sliceToToks = (lo: number, hi: number): Tok[] => {
    // Rebuild tokens from atom range [lo, hi). Merge adjacent text atoms
    // sharing the same `marked` flag isn't strictly necessary — we drop the
    // mark from re-assembled text since rich rendering doesn't need it.
    const out: Tok[] = [];
    let buf = "";
    const flush = () => {
      if (buf) {
        out.push({
          kind: "text",
          text: buf,
          props: { red: false, underline: false, mono: false, bold: false },
        });
        buf = "";
      }
    };
    for (let i = lo; i < hi; i++) {
      const a = atoms[i];
      if (a.kind === "ch") buf += a.ch;
      else { flush(); out.push(a.tok); }
    }
    flush();
    return out;
  };

  const stem = bounds.length > 0 ? sliceToToks(0, bounds[0].start) : sliceToToks(0, atoms.length);
  const options: { key: string; toks: Tok[]; marked: boolean }[] = [];
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i];
    const next = i + 1 < bounds.length ? bounds[i + 1].start : atoms.length;
    const toksOpt = sliceToToks(b.end + 1, next);
    // strip leading whitespace
    if (toksOpt.length && toksOpt[0].kind === "text") {
      const t = toksOpt[0] as TextTok;
      toksOpt[0] = { ...t, text: t.text.replace(/^[\s\u00A0]+/, "") };
    }
    options.push({ key: b.key, toks: toksOpt, marked: b.marked });
  }
  return { stem, options };
}

export async function parseDocx(file: File): Promise<ParsedExam> {
  const paras = await extractParagraphs(file);

  const partI: MCQuestion[] = [];
  const partII: TFQuestion[] = [];
  const partIII: SAQuestion[] = [];

  let currentPart: 1 | 2 | 3 = 1;
  // We accumulate tokens for the current question across multiple paragraphs.
  let qBuf: { part: 1 | 2 | 3; idx: number; toks: Tok[]; explToks: Tok[]; ansToks: Tok[]; inExpl: boolean; inAns: boolean; level: QuestionLevel | null } | null = null;
  let qIdx = 0;

  const explRich = (): string | null => {
    if (!qBuf || !qBuf.explToks.length) return null;
    const s = tokensToRich(qBuf.explToks).replace(/^\s+|\s+$/g, "");
    return s || null;
  };

  const flush = () => {
    if (!qBuf) return;
    const { part, idx, toks, level, ansToks } = qBuf;
    const explanation = explRich();
    qBuf = null;

    if (part === 1) {
      const { stem, options } = splitOptions(toks, "ABCD");
      const stemRich = tokensToRich(stem).trim();
      // Strip leading "Câu N:" from the stem
      const stemCleaned = stemRich.replace(QUESTION_PREFIX_RE, "");
      let answer: "A" | "B" | "C" | "D" | "" = "";
      const opts = options.map((o) => {
        if (o.marked && !answer) answer = o.key as any;
        return { key: o.key as "A" | "B" | "C" | "D", text: tokensToRich(o.toks).trim() };
      });
      if (opts.length === 4 && answer) {
        partI.push({ type: "mc", id: `q${idx}`, text: stemCleaned, options: opts, answer, explanation, level });
      } else if (opts.length === 4) {
        partI.push({ type: "mc", id: `q${idx}`, text: stemCleaned, options: opts, answer: "A", explanation, level });
      }
    } else if (part === 2) {
      // "a)" markers are accepted anywhere; "a." only at a paragraph start.
      const { stem, options } = splitOptions(toks, "abcd", ".)", true);
      const stemRich = tokensToRich(stem).trim().replace(QUESTION_PREFIX_RE, "");
      const items = options.map((o) => ({
        key: o.key.toLowerCase() as "a" | "b" | "c" | "d",
        text: tokensToRich(o.toks).trim(),
        correct: o.marked,
      }));
      if (items.length > 0) {
        partII.push({ type: "tf", id: `q${idx}`, text: stemRich, items, explanation, level });
      }
    } else {
      // Part III: stem until "Đáp án:"
      const rich = tokensToRich(toks);
      const plain = tokensToPlain(toks);
      const m = plain.match(/Đáp\s*án\s*[:.]?\s*(.+)$/i);
      let stemRich = rich.replace(QUESTION_PREFIX_RE, "");
      let answer = "";
      if (ansToks.length) {
        // "Đáp án:" was on its own paragraph — the answer content (text,
        // equation, MathType/OLE object or image) follows it.
        answer = tokensToRich(ansToks).replace(/\s+/g, " ").trim();
      } else if (m) {
        const ansIdx = plain.search(/Đáp\s*án\s*[:.]?/i);
        if (ansIdx >= 0) {
          let plainCount = 0, i = 0;
          while (i < rich.length && plainCount < ansIdx) {
            if (rich[i] === SENT_OPEN) {
              const end = rich.indexOf(SENT_CLOSE, i);
              if (end === -1) break;
              i = end + 1;
            } else { plainCount++; i++; }
          }
          stemRich = rich.slice(0, i).replace(QUESTION_PREFIX_RE, "").trim();
          answer = m[1].trim();
        }
      }
      partIII.push({ type: "sa", id: `q${idx}`, text: stemRich.trim(), answer, explanation, level });
    }

  };

  // Detects "Lời giải:" or "Đáp án:" at the start of a paragraph plain-text.
  // For "Đáp án:", we only treat as explanation-marker when the payload is NOT
  // a simple answer letter (Part I) or a short single-line answer (Part III).
  type Marker = { markerLen: number; mode: "expl" | "answer" };
  const detectExplStart = (rawPlain: string, part: 1 | 2 | 3, hasNonText: boolean): Marker | null => {
    const mLoi = rawPlain.match(/^\s*L[ờo]i\s*gi[ảa]i\s*[:.]\s*/i);
    if (mLoi) return { markerLen: mLoi[0].length, mode: "expl" };
    const mDap = rawPlain.match(/^\s*Đ[áa]p\s*[áa]n\s*[:.]\s*/i);
    if (mDap) {
      const rest = rawPlain.slice(mDap[0].length).trim();
      if (part === 1) {
        // "Đáp án: B" (single letter) → keep as answer (existing behavior)
        if (/^[A-D]\.?$/i.test(rest)) return null;
        return { markerLen: mDap[0].length, mode: "expl" };
      }
      if (part === 3) {
        // Short single-line = inline answer → leave in the stem (old behavior).
        if (rest.length > 0 && rest.length <= 60 && !/[.!?…]\s+\S/.test(rest)) return null;
        // Empty payload → the answer lives in what follows (text, equation,
        // MathType/OLE object or image), until "Lời giải:".
        if (!rest) return { markerLen: mDap[0].length, mode: "answer" };
        return { markerLen: mDap[0].length, mode: "expl" };
      }
      // Part II never used "Đáp án:" for anything → explanation
      return { markerLen: mDap[0].length, mode: "expl" };
    }
    return null;
  };

  // Strip the first `n` plain characters from a token array (leaves inline
  // objects like images/math intact).
  const stripLeadingPlain = (toks: Tok[], n: number): Tok[] => {
    const out: Tok[] = [];
    let remaining = n;
    for (const t of toks) {
      if (remaining <= 0) { out.push(t); continue; }
      if (t.kind === "text") {
        if (t.text.length <= remaining) { remaining -= t.text.length; continue; }
        out.push({ ...t, text: t.text.slice(remaining) });
        remaining = 0;
      } else {
        // non-text counts as 1 plain char in tokensToPlain
        remaining -= 1;
        // skip it
      }
    }
    return out;
  };

  for (const p of paras) {
    const rawPlain = stripMarkers(p.plain).trim();
    const hasNonText = p.toks.some((t) => t.kind !== "text");
    if (!rawPlain && !hasNonText) continue;

    // Detect part header — these paragraphs should not become questions.
    const part = detectPart(p.plain.trim());
    if (part) {
      flush();
      currentPart = part;
      continue;
    }

    // Strip <g..> markers from the token stream by editing text tokens in place.
    const toks: Tok[] = p.toks.map((t) =>
      t.kind === "text" ? { ...t, text: t.text.replace(/<g[123]>/gi, "") } : t,
    );

    // Does this paragraph start a new question?
    const qStart = rawPlain.match(QUESTION_START_RE);
    const startsNewQ = !!qStart;
    if (startsNewQ) {
      flush();
      qIdx++;
      qBuf = { part: currentPart, idx: qIdx, toks: [...toks], explToks: [], ansToks: [], inExpl: false, inAns: false, level: (qStart![2]?.toUpperCase() as any) ?? null };
      continue;
    }

    if (!qBuf) continue;

    // Check for explanation / answer-block start marker on this paragraph.
    if (!qBuf.inExpl) {
      const em = detectExplStart(stripMarkers(p.plain), qBuf.part, hasNonText);
      if (em) {
        const stripped = stripLeadingPlain(toks, em.markerLen);
        if (em.mode === "answer") {
          qBuf.inAns = true;
          if (stripped.length) qBuf.ansToks.push(...stripped);
        } else {
          qBuf.inExpl = true;
          qBuf.inAns = false;
          if (stripped.length) qBuf.explToks.push(...stripped);
        }
        continue;
      }
    }

    if (qBuf.inExpl) {
      qBuf.explToks.push({ kind: "text", text: "\n", props: { red: false, underline: false, mono: false, bold: false } });
      qBuf.explToks.push(...toks);
    } else if (qBuf.inAns) {
      if (qBuf.ansToks.length) qBuf.ansToks.push({ ...PBRK });
      qBuf.ansToks.push(...toks);
    } else {
      qBuf.toks.push({ ...PBRK });
      qBuf.toks.push(...toks);
    }
  }

  flush();

  return { partI, partII, partIII };
}

