import JSZip from "jszip";
import { ommlElementToLatex } from "./ommlToLatex";
import { buildOleMathMap, type OleMap } from "./mathtypeOle";
import { convertMetafileToDisplayable } from "./metafileToImage";


export const QUESTION_LEVELS = ["NB", "TH", "VD", "VDC"] as const;
export type QuestionLevel = (typeof QUESTION_LEVELS)[number];
export const LEVEL_LABELS: Record<QuestionLevel, string> = {
  NB: "Nhận biết",
  TH: "Thông hiểu",
  VD: "Vận dụng",
  VDC: "Vận dụng cao",
};
/** Matches the start of a question: "Câu 1." / "Câu 1:" / "Câu 1 (NB)." etc. */
export const QUESTION_START_RE = /^\s*C[âa]u\s*(\d+)\s*(?:[(\[]\s*(NB|TH|VD|VDC)\s*[)\]])?\s*(?:[:.\-–)]|\s+|$)/i;
/** Same, but used to strip the prefix from a question stem. */
export const QUESTION_PREFIX_RE = /^\s*C[âa]u\s*\d+\s*(?:[(\[]\s*(?:NB|TH|VD|VDC)\s*[)\]])?\s*[:.\-–)]?\s*/i;

export type MCQuestion = {
  type: "mc";
  id: string;
  text: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  answer: "A" | "B" | "C" | "D" | null;
  explanation?: string | null;
  level?: QuestionLevel | null;
};

export type TFQuestion = {
  type: "tf";
  id: string;
  text: string;
  items: {
    key: "a" | "b" | "c" | "d";
    text: string;
    correct: boolean | null;
    level?: QuestionLevel | null;
    order?: number;
  }[];
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

export function isQuestionMissingAnswer(q: MCQuestion | TFQuestion | SAQuestion): boolean {
  if (q.type === "mc") {
    return !q.answer || !["A", "B", "C", "D"].includes(q.answer);
  }
  if (q.type === "tf") {
    return !q.items || q.items.length === 0 || q.items.some((it) => it.correct === null || it.correct === undefined);
  }
  if (q.type === "sa") {
    return !q.answer || !q.answer.trim();
  }
  return false;
}

export type MissingAnswerIssue = {
  part: "I" | "II" | "III";
  idx: number;
  id: string;
  label: string;
};

export function getMissingAnswerQuestions(exam: ParsedExam): MissingAnswerIssue[] {
  const missing: MissingAnswerIssue[] = [];
  (exam.partI || []).forEach((q, i) => {
    if (isQuestionMissingAnswer(q)) {
      missing.push({ part: "I", idx: i, id: q.id, label: `Câu ${i + 1} – Phần I` });
    }
  });
  (exam.partII || []).forEach((q, i) => {
    if (isQuestionMissingAnswer(q)) {
      missing.push({ part: "II", idx: i, id: q.id, label: `Câu ${i + 1} – Phần II` });
    }
  });
  (exam.partIII || []).forEach((q, i) => {
    if (isQuestionMissingAnswer(q)) {
      missing.push({ part: "III", idx: i, id: q.id, label: `Câu ${i + 1} – Phần III` });
    }
  });
  return missing;
}


export type ParsedQuestion = MCQuestion | TFQuestion | SAQuestion;

export type DocxObjectAudit = {
  index: number;
  type: "DrawingML" | "VML" | "OLE" | "OMML" | "Shape" | "Table" | "External";
  rId?: string;
  target?: string;
  format?: string;
  status: "DETECTED" | "CONVERTED" | "FALLBACK" | "NOT_DETECTED";
  location?: string;
  reason?: string;
};

export type ParsedExam = {
  partI: MCQuestion[];
  partII: TFQuestion[];
  partIII: SAQuestion[];
  auditLog?: DocxObjectAudit[];
};

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

const SENT_OPEN = "\u27E6";
const SENT_CLOSE = "\u27E7";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const encMath = (latex: string) =>
  `${SENT_OPEN}MATH:${latex.replace(/[\u27E6\u27E7]/g, "")}${SENT_CLOSE}`;
export const encCode = (lang: string, content: string) =>
  `${SENT_OPEN}CODE:${lang}:${encodeURIComponent(content)}${SENT_CLOSE}`;
const encImg = (src: string) =>
  `${SENT_OPEN}IMG:${encodeURIComponent(src)}${SENT_CLOSE}`;
const encTbl = (rows: string[][]) =>
  `${SENT_OPEN}TBL:${encodeURIComponent(JSON.stringify(rows))}${SENT_CLOSE}`;

export function stripRich(s: string): string {
  return s
    .replace(new RegExp(`${SENT_OPEN}[^${SENT_CLOSE}]*${SENT_CLOSE}`, "g"), " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
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

const MONO_FONTS = [
  "consolas", "courier new", "courier", "menlo", "monaco", "lucida console",
  "source code pro", "fira code", "jetbrains mono", "sf mono", "roboto mono",
  "inconsolata", "dejavu sans mono", "cascadia code", "cascadia mono", "ubuntu mono",
  "oxygen mono", "liberation mono",
];
const isMonoFont = (n: string) => !!n && MONO_FONTS.some((f) => n.toLowerCase().includes(f));

export function isParaCodeText(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  // Indented line with code punctuation or code keywords
  if (/^[ \t]{2,}/.test(s)) {
    if (/[:;=+\-*/><()[\]{}#&|!~,"'%\\]/.test(s)) return true;
    if (/^[ \t]{2,}(?:else:|finally:|try:|except\b|return\b|break\b|continue\b|pass\b|yield\b|AND\b|OR\b)/i.test(s)) return true;
  }
  // Control structure / statement start without indentation
  if (
    /^\s*(?:def\s+\w+|class\s+\w+|import\s+\w+|from\s+\w+|return\b|if\s+.*:|elif\s+.*:|else:|while\s+.*:|for\s+.*:|try:|except\b|finally:|with\s+.*:|#include\s*<|SELECT\b|FROM\b|WHERE\b|ORDER\s+BY\b|GROUP\s+BY\b|INSERT\s+INTO|UPDATE\b|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|<!DOCTYPE|<\/?(?:html|head|body|div|span|p|a|table|tr|td|h[1-6]|ul|ol|li)[>\s/]|program\s+\w+|begin\s*$|end[.;]\s*$)/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

export function detectLang(code: string): string {
  const t = code.toLowerCase();
  // 1. HTML / XML: Check for HTML tags or DOCTYPE
  if (
    /(?:<!doctype\s+html|<\/?(?:html|head|body|div|span|p|a|table|thead|tbody|tr|th|td|script|style|ul|ol|li|h[1-6]|form|input|button|label|select|option|textarea|header|footer|nav|section|article|main|aside|img|link|meta|title)[>\s/])/i.test(
      t
    )
  ) {
    return "html";
  }
  // 2. SQL: Check for SQL queries across lines using [\s\S]
  if (
    /\b(?:select\b[\s\S]*?\bfrom|insert\s+into|update\b[\s\S]*?\bset|create\s+table|delete\s+from|alter\s+table|drop\s+table|where\b[\s\S]*?\b(?:and|or|order\s+by|group\s+by)|order\s+by\b|group\s+by\b)\b/i.test(
      t
    ) ||
    /(?:^|\n)\s*(?:select\b|from\b|where\b|order\s+by\b|group\s+by\b|insert\s+into|update\b|delete\s+from|create\s+table)/i.test(
      t
    )
  ) {
    return "sql";
  }
  // 3. C / C++
  if (/#include\s*<|\b(?:int\s+main|std::|cout\s*<<|cin\s*>>|printf\s*\(|scanf\s*\()/i.test(code)) {
    return "cpp";
  }
  // 4. Pascal
  if (/\b(?:program\s+\w+|begin\b[\s\S]*?\bend[.;]|writeln\s*\(|readln\s*\()\b/i.test(t)) {
    return "pascal";
  }
  // 5. Python
  if (
    /\b(?:def\s+\w+|class\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(|elif\b|self\b|lambda\b|range\s*\(|len\s*\(|__init__|input\s*\(|int\s*\(|float\s*\(|str\s*\(|append\s*\(|pop\s*\(|keys\s*\(|values\s*\(|items\s*\()\b/i.test(
      code
    ) ||
    /(?:^|\n)\s*(?:if|for|while|elif|else|def|class|try|except|finally|with)\b.*:\s*(?:\n|$)/i.test(
      code
    ) ||
    /(?:^|\n)[ \t]{2,}(?:print|return|pass|break|continue|yield)\b/i.test(code)
  ) {
    return "python";
  }
  // 6. JavaScript / TypeScript
  if (/\b(?:console\.log|function\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|=>|document\.getElementById)\b/i.test(code)) {
    return "javascript";
  }
  return "plaintext";
}

type RunProps = {
  red: boolean;
  underline: boolean;
  mono: boolean;
  bold: boolean;
  italic?: boolean;
  strike?: boolean;
  sub?: boolean;
  sup?: boolean;
  color?: string;
  highlight?: string;
};

function readRunProps(rPr: Element | undefined): RunProps {
  let red = false, underline = false, mono = false, bold = false;
  let italic = false, strike = false, sub = false, sup = false;
  let color: string | undefined;
  let highlight: string | undefined;

  if (!rPr) return { red, underline, mono, bold, italic, strike, sub, sup };

  // Color
  const colorEl = rPr.getElementsByTagNameNS(W_NS, "color")[0];
  if (colorEl) {
    const v = colorEl.getAttributeNS(W_NS, "val") || colorEl.getAttribute("w:val") || "";
    if (COLOR_RED(v)) {
      red = true;
    } else if (v && v.toLowerCase() !== "auto") {
      color = v.startsWith("#") ? v : `#${v}`;
    }
  }

  // Underline
  const uEl = rPr.getElementsByTagNameNS(W_NS, "u")[0];
  if (uEl) {
    const v = uEl.getAttributeNS(W_NS, "val") || uEl.getAttribute("w:val") || "single";
    if (v && v !== "none") underline = true;
  }

  // Monospace font
  const fontsEl = rPr.getElementsByTagNameNS(W_NS, "rFonts")[0];
  if (fontsEl) {
    const ascii = fontsEl.getAttributeNS(W_NS, "ascii") || fontsEl.getAttribute("w:ascii") || "";
    const hAnsi = fontsEl.getAttributeNS(W_NS, "hAnsi") || fontsEl.getAttribute("w:hAnsi") || "";
    if (isMonoFont(ascii) || isMonoFont(hAnsi)) mono = true;
  }

  // Bold
  const bEl = rPr.getElementsByTagNameNS(W_NS, "b")[0] || rPr.getElementsByTagNameNS(W_NS, "bCs")[0];
  if (bEl) {
    const v = bEl.getAttributeNS(W_NS, "val") || bEl.getAttribute("w:val");
    if (v === null || v === undefined || (v !== "0" && v !== "false")) bold = true;
  }

  // Italic
  const iEl = rPr.getElementsByTagNameNS(W_NS, "i")[0] || rPr.getElementsByTagNameNS(W_NS, "iCs")[0];
  if (iEl) {
    const v = iEl.getAttributeNS(W_NS, "val") || iEl.getAttribute("w:val");
    if (v === null || v === undefined || (v !== "0" && v !== "false")) italic = true;
  }

  // Strike
  const sEl = rPr.getElementsByTagNameNS(W_NS, "strike")[0] || rPr.getElementsByTagNameNS(W_NS, "dstrike")[0];
  if (sEl) {
    const v = sEl.getAttributeNS(W_NS, "val") || sEl.getAttribute("w:val");
    if (v === null || v === undefined || (v !== "0" && v !== "false")) strike = true;
  }

  // Subscript / Superscript
  const vertEl = rPr.getElementsByTagNameNS(W_NS, "vertAlign")[0];
  if (vertEl) {
    const v = (vertEl.getAttributeNS(W_NS, "val") || vertEl.getAttribute("w:val") || "").toLowerCase();
    if (v === "subscript") sub = true;
    else if (v === "superscript") sup = true;
  }

  // Highlight
  const hlEl = rPr.getElementsByTagNameNS(W_NS, "highlight")[0];
  if (hlEl) {
    const v = hlEl.getAttributeNS(W_NS, "val") || hlEl.getAttribute("w:val") || "";
    if (v && v.toLowerCase() !== "none") highlight = v;
  }

  return { red, underline, mono, bold, italic, strike, sub, sup, color, highlight };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTextWithProps(text: string, props: RunProps): string {
  if (!text) return "";
  let res = escapeHtml(text);
  if (props.sub) res = `<sub>${res}</sub>`;
  if (props.sup) res = `<sup>${res}</sup>`;
  if (props.bold) res = `<b>${res}</b>`;
  if (props.italic) res = `<i>${res}</i>`;
  if (props.underline) res = `<u>${res}</u>`;
  if (props.strike) res = `<s>${res}</s>`;
  if (props.highlight) res = `<mark>${res}</mark>`;
  if (props.color) res = `<span style="color:${props.color}">${res}</span>`;
  return res;
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

export function groupCodeTokens(toks: Tok[]): Tok[] {
  // Split tokens by pbrk into paragraph chunks
  const paras: Tok[][] = [];
  let current: Tok[] = [];
  for (const t of toks) {
    if (t.kind === "pbrk") {
      paras.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  paras.push(current);

  const paraIsCode = paras.map((p) => {
    if (p.some((t) => t.kind === "code" || (t.kind === "text" && t.props.mono && t.text.trim().length > 0))) {
      return true;
    }
    let plain = "";
    for (const t of p) {
      if (t.kind === "text") plain += t.text;
      else if (t.kind === "math") plain += t.latex;
    }
    return isParaCodeText(plain);
  });

  const out: Tok[] = [];
  let codeGroup: Tok[][] = [];

  const flushGroup = () => {
    if (codeGroup.length === 0) return;
    const lines = codeGroup.map((p) => {
      let l = "";
      for (const t of p) {
        if (t.kind === "text") l += t.text;
        else if (t.kind === "math") l += t.latex;
        else if (t.kind === "code") l += t.content;
      }
      return l.replace(/[\r\n]+$/, "");
    });
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    const fullCode = lines.join("\n");
    const lang = detectLang(fullCode);
    out.push({ kind: "code", lang, content: fullCode });
    codeGroup = [];
  };

  for (let i = 0; i < paras.length; i++) {
    const isBlank = paras[i].length === 0 || paras[i].every((t) => t.kind === "text" && t.text.trim() === "");
    const nextCodeOffset = paras.slice(i + 1).findIndex((_p, idx) => paraIsCode[i + 1 + idx]);
    const nextNonBlankOffset = paras.slice(i + 1).findIndex((p) => p.some((t) => t.kind !== "text" || t.text.trim() !== ""));
    const isBlankInsideCode = isBlank && codeGroup.length > 0 && nextCodeOffset !== -1 && nextCodeOffset === nextNonBlankOffset;

    if (paraIsCode[i] || isBlankInsideCode) {
      codeGroup.push(paras[i]);
    } else {
      flushGroup();
      if (out.length > 0 && paras[i].length > 0) out.push({ kind: "pbrk" });
      out.push(...paras[i]);
    }
  }
  flushGroup();

  return out;
}

function tokensToRich(toks: Tok[]): string {
  const grouped = groupCodeTokens(toks);
  // Group consecutive mono text into a single code block.
  let out = "";
  let codeBuf = "";
  const flushCode = () => {
    if (!codeBuf) return;
    out += encCode(detectLang(codeBuf), codeBuf);
    codeBuf = "";
  };
  for (const t of grouped) {
    if (t.kind === "text") {
      if (t.props.mono) {
        codeBuf += t.text;
      } else {
        flushCode();
        const hasStyle =
          t.props.bold ||
          t.props.italic ||
          t.props.underline ||
          t.props.strike ||
          t.props.sub ||
          t.props.sup ||
          t.props.color ||
          t.props.highlight;
        if (hasStyle) {
          out += formatTextWithProps(t.text, t.props);
        } else {
          out += t.text;
        }
      }
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
      out += "\n";
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
  if (ext === "wmf") return "image/wmf";
  if (ext === "emf") return "image/emf";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  return "application/octet-stream";
}

/**
 * Resolves a relationship Target to an actual file inside the DOCX zip.
 * Handles:
 * - Direct paths: "media/image1.png", "/word/media/image1.png"
 * - Relative paths with "..": "../media/image1.png"
 * - Percent-encoded URIs: "media/image%201.png", "media/h%C3%ACnh%201.jpg"
 * - Case-insensitive and basename lookups in word/media/
 */
function resolveZipFile(zip: JSZip, target: string): { file: JSZip.JSZipObject | null; path: string } {
  const cleanTarget = target.trim();
  const decodedTarget = decodeURIComponent(cleanTarget);

  const candidates: string[] = [
    cleanTarget,
    cleanTarget.replace(/^\//, ""),
    "word/" + cleanTarget.replace(/^\.?\//, ""),
    cleanTarget.replace(/^\.\.\//, ""),
    "word/" + cleanTarget.replace(/^\.\.\//, ""),
    "word/media/" + cleanTarget.split("/").pop(),
    decodedTarget,
    decodedTarget.replace(/^\//, ""),
    "word/" + decodedTarget.replace(/^\.?\//, ""),
    decodedTarget.replace(/^\.\.\//, ""),
    "word/" + decodedTarget.replace(/^\.\.\//, ""),
    "word/media/" + decodedTarget.split("/").pop(),
  ];

  for (const c of candidates) {
    const f = zip.file(c);
    if (f) return { file: f, path: c };
  }

  // Search by exact basename in all zip entries
  const base = decodedTarget.split("/").pop()?.toLowerCase();
  if (base) {
    for (const zipPath of Object.keys(zip.files)) {
      const lower = zipPath.toLowerCase();
      if (lower.endsWith("/" + base) || lower === base) {
        const f = zip.file(zipPath);
        if (f) return { file: f, path: zipPath };
      }
    }
  }

  return { file: null, path: cleanTarget };
}

async function loadImageMap(zip: JSZip, auditLog?: DocxObjectAudit[]): Promise<ImageMap> {
  const map: ImageMap = new Map();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return map;
  const relsXml = await relsFile.async("string");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const rels = relsDoc.getElementsByTagName("Relationship");

  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    const type = (rel.getAttribute("Type") || "").trim();
    const target = (rel.getAttribute("Target") || "").trim();
    const id = rel.getAttribute("Id") || "";
    if (!id || !target) continue;

    const isImageRel = /\/(image|picture|hdphoto)$/i.test(type) || /media\//i.test(target);
    if (!isImageRel) continue;

    // 1. External images
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("data:")) {
      map.set(id, target);
      auditLog?.push({
        index: i,
        type: "External",
        rId: id,
        target,
        status: "DETECTED",
      });
      continue;
    }

    // 2. Embedded package media
    const resolved = resolveZipFile(zip, target);
    if (!resolved.file) {
      auditLog?.push({
        index: i,
        type: "DrawingML",
        rId: id,
        target,
        status: "NOT_DETECTED",
        reason: "File not found in DOCX package: " + target,
      });
      continue;
    }

    try {
      const ext = resolved.path.toLowerCase().split(".").pop() || "";
      // Handle vector EMF / WMF
      if (ext === "emf" || ext === "wmf") {
        const u8 = new Uint8Array(await resolved.file.async("uint8array"));
        const displayable = convertMetafileToDisplayable(u8, resolved.path);
        if (displayable) {
          map.set(id, displayable);
          auditLog?.push({
            index: i,
            type: "DrawingML",
            rId: id,
            target,
            format: ext,
            status: "CONVERTED",
            reason: "Converted vector metafile to displayable image/SVG",
          });
          continue;
        }
      }

      const b64 = await resolved.file.async("base64");
      const mime = mimeFromExt(resolved.path);
      map.set(id, `data:${mime};base64,${b64}`);
      auditLog?.push({
        index: i,
        type: "DrawingML",
        rId: id,
        target,
        format: ext,
        status: "DETECTED",
      });
    } catch (e) {
      auditLog?.push({
        index: i,
        type: "DrawingML",
        rId: id,
        target,
        status: "NOT_DETECTED",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return map;
}

function extractImageRefs(el: Element, images: ImageMap): string[] {
  // Walk the subtree in document order so images keep their original order.
  const out: string[] = [];
  const pushRef = (id: string) => {
    if (!id) return;
    const src = images.get(id);
    if (src && !out.includes(src)) out.push(src);
  };

  const getBlipId = (node: Element): string => {
    return (
      node.getAttributeNS(R_NS, "embed") ||
      node.getAttribute("r:embed") ||
      node.getAttribute("embed") ||
      node.getAttributeNS(R_NS, "link") ||
      node.getAttribute("r:link") ||
      node.getAttribute("link") ||
      node.getAttribute("id") ||
      node.getAttributeNS(R_NS, "id") ||
      ""
    );
  };

  const walk = (node: Element) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType !== 1) continue;
      const child = c as Element;
      const ln = child.localName || child.nodeName.replace(/^.*:/, "");

      if (ln === "AlternateContent") {
        const allChildren = Array.from(child.childNodes).filter((n) => n.nodeType === 1) as Element[];
        const choice = allChildren.find(
          (n) => (n.localName || n.nodeName.replace(/^.*:/, "")) === "Choice",
        );
        const fallback = allChildren.find(
          (n) => (n.localName || n.nodeName.replace(/^.*:/, "")) === "Fallback",
        );
        let found = false;
        if (choice) {
          const before = out.length;
          walk(choice);
          if (out.length > before) found = true;
        }
        if (!found && fallback) {
          walk(fallback);
        }
        continue;
      }

      if (ln === "blip" || ln === "svgBlip") {
        pushRef(getBlipId(child));
        continue;
      }

      if (ln === "imagedata") {
        const id =
          child.getAttributeNS(R_NS, "id") ||
          child.getAttribute("r:id") ||
          child.getAttribute("o:relid") ||
          child.getAttribute("r:href") ||
          child.getAttribute("o:href") ||
          child.getAttribute("id") ||
          child.getAttribute("src") ||
          "";
        pushRef(id);
        continue;
      }

      if (ln === "fill") {
        const id =
          child.getAttributeNS(R_NS, "id") ||
          child.getAttribute("r:id") ||
          child.getAttribute("o:relid") ||
          child.getAttribute("r:href") ||
          child.getAttribute("id") ||
          "";
        if (id) pushRef(id);
      }

      walk(child);
    }
  };

  walk(el);
  return out;
}

function oleRefOf(el: Element): { rId: string; progId: string } | null {
  const lnEl = el.localName || el.nodeName.replace(/^.*:/, "");
  let objEl: Element | null = null;
  if (lnEl === "object") {
    objEl = el;
  } else {
    const objs = el.getElementsByTagNameNS(W_NS, "object");
    if (objs.length > 0) {
      objEl = objs[0];
    } else {
      const all = el.getElementsByTagName("*");
      for (let i = 0; i < all.length; i++) {
        const ln = all[i].localName || all[i].nodeName.replace(/^.*:/, "");
        if (ln === "object") {
          objEl = all[i];
          break;
        }
      }
    }
  }
  if (!objEl) return null;

  const all = [objEl, ...Array.from(objEl.getElementsByTagName("*"))];
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    const ln = n.localName || n.nodeName.replace(/^.*:/, "");
    if (ln === "OLEObject" || ln === "oleObject") {
      const rId = n.getAttributeNS(R_NS, "id") || n.getAttribute("r:id") || n.getAttribute("id") || "";
      const progId = n.getAttribute("ProgID") || n.getAttribute("progid") || "";
      if (rId || progId) return { rId, progId };
    }
  }
  return null;
}

function parseParagraph(p: Element, images: ImageMap, ole?: OleMap): Para {
  const toks: Tok[] = [];
  let hasAnyMark = false;

  const handleOle = (node: Element): boolean => {
    const oleRef = oleRefOf(node);
    if (!oleRef) return false;
    const imgs = extractImageRefs(node, images);
    const entry = oleRef.rId ? ole?.get(oleRef.rId) : undefined;
    const latex = entry?.formula?.latex || null;
    if (latex) {
      toks.push({ kind: "math", latex });
      return true;
    }
    if (imgs.length > 0) {
      for (const src of imgs) toks.push({ kind: "img", src });
      return true;
    }
    if (entry?.isMathType) {
      toks.push({ kind: "obj" });
      return true;
    }
    return false;
  };

  const processAlternateContent = (acNode: Element, props?: RunProps) => {
    const allChildren = Array.from(acNode.childNodes).filter((n) => n.nodeType === 1) as Element[];
    const choice = allChildren.find(
      (n) => (n.localName || n.nodeName.replace(/^.*:/, "")) === "Choice",
    );
    const fallback = allChildren.find(
      (n) => (n.localName || n.nodeName.replace(/^.*:/, "")) === "Fallback",
    );

    // 1. MathType OLE in Choice or Fallback
    if (choice && handleOle(choice)) return;
    if (fallback && handleOle(fallback)) return;

    // 2. OMML in Choice or Fallback
    const checkOMML = (target: Element): boolean => {
      const maths = Array.from(target.getElementsByTagNameNS(M_NS, "oMath"));
      if (maths.length > 0) {
        for (const m of maths) {
          const latex = ommlElementToLatex(m);
          if (latex) toks.push({ kind: "math", latex });
        }
        return true;
      }
      return false;
    };
    if (choice && checkOMML(choice)) return;
    if (fallback && checkOMML(fallback)) return;

    // 3. Images (Choice first, then Fallback)
    if (choice) {
      const imgs = extractImageRefs(choice, images);
      if (imgs.length > 0) {
        for (const src of imgs) toks.push({ kind: "img", src });
        return;
      }
    }
    if (fallback) {
      const imgs = extractImageRefs(fallback, images);
      if (imgs.length > 0) {
        for (const src of imgs) toks.push({ kind: "img", src });
        return;
      }
    }

    // 4. Default walk Choice if available, else Fallback
    if (choice) walk(choice, props);
    else if (fallback) walk(fallback, props);
  };

  const walk = (parent: Element, parentProps?: RunProps) => {
    for (let j = 0; j < parent.childNodes.length; j++) {
      const node = parent.childNodes[j];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const ln = el.localName || el.nodeName.replace(/^.*:/, "");
      const ns = el.namespaceURI;

      if (ns === W_NS && ln === "r") {
        const rPr = el.getElementsByTagNameNS(W_NS, "rPr")[0];
        const props = readRunProps(rPr);
        if (props.red || props.underline) hasAnyMark = true;

        // Traverse children of run in exact document order
        for (let k = 0; k < el.childNodes.length; k++) {
          const rc = el.childNodes[k];
          if (rc.nodeType !== 1) continue;
          const rEl = rc as Element;
          const rLn = rEl.localName || rEl.nodeName.replace(/^.*:/, "");
          const rNs = rEl.namespaceURI;

          if (rLn === "t") {
            const txt = rEl.textContent || "";
            if (txt) toks.push({ kind: "text", text: txt, props });
          } else if (rLn === "tab") {
            toks.push({ kind: "text", text: "\t", props });
          } else if (rLn === "br") {
            toks.push({ kind: "text", text: "\n", props });
          } else if (rLn === "drawing" || rLn === "pict") {
            const imgs = extractImageRefs(rEl, images);
            for (const src of imgs) toks.push({ kind: "img", src });
          } else if (rLn === "object") {
            if (!handleOle(rEl)) {
              const imgs = extractImageRefs(rEl, images);
              for (const src of imgs) toks.push({ kind: "img", src });
            }
          } else if (rLn === "AlternateContent") {
            processAlternateContent(rEl, props);
          } else if (rNs === M_NS && (rLn === "oMath" || rLn === "oMathPara")) {
            const maths = rLn === "oMathPara"
              ? Array.from(rEl.getElementsByTagNameNS(M_NS, "oMath"))
              : [rEl];
            for (const m of maths) {
              const latex = ommlElementToLatex(m as Element);
              if (latex) toks.push({ kind: "math", latex });
            }
          }
        }
      } else if (ns === M_NS && (ln === "oMath" || ln === "oMathPara")) {
        const maths = ln === "oMathPara"
          ? Array.from(el.getElementsByTagNameNS(M_NS, "oMath"))
          : [el];
        for (const m of maths) {
          const latex = ommlElementToLatex(m as Element);
          if (latex) toks.push({ kind: "math", latex });
        }
      } else if (ln === "object") {
        if (!handleOle(el)) {
          const imgs = extractImageRefs(el, images);
          for (const src of imgs) toks.push({ kind: "img", src });
        }
      } else if (ln === "drawing" || ln === "pict") {
        for (const src of extractImageRefs(el, images)) {
          toks.push({ kind: "img", src });
        }
      } else if (ln === "AlternateContent") {
        processAlternateContent(el, parentProps);
      } else if (
        ns === W_NS &&
        (ln === "hyperlink" ||
          ln === "smartTag" ||
          ln === "sdt" ||
          ln === "sdtContent" ||
          ln === "ins" ||
          ln === "fldSimple")
      ) {
        walk(el, parentProps);
      } else if (el.childNodes.length > 0 && ns === W_NS) {
        walk(el, parentProps);
      }
    }
  };

  walk(p);
  const indentSpaces = getParagraphIndentSpaces(p);
  if (indentSpaces > 0) {
    const firstTextTok = toks.find((t) => t.kind === "text") as TextTok | undefined;
    if (firstTextTok) {
      if (!firstTextTok.text.startsWith(" ") && !firstTextTok.text.startsWith("\t")) {
        firstTextTok.text = " ".repeat(indentSpaces) + firstTextTok.text;
      }
    } else if (toks.length > 0) {
      toks.unshift({ kind: "text", text: " ".repeat(indentSpaces), props: { red: false, underline: false, mono: false, bold: false } });
    }
  }
  return { toks, plain: tokensToPlain(toks), rich: tokensToRich(toks), hasAnyMark };
}

function getParagraphIndentSpaces(p: Element): number {
  const pPr = Array.from(p.childNodes).find((n) => {
    if (n.nodeType !== 1) return false;
    const ln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
    return ln === "pPr";
  }) as Element | undefined;
  if (!pPr) return 0;

  const ind = Array.from(pPr.childNodes).find((n) => {
    if (n.nodeType !== 1) return false;
    const ln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
    return ln === "ind";
  }) as Element | undefined;
  if (!ind) return 0;

  // 1. Check character-based indentation (e.g. leftChars="400" = 4 characters)
  const leftCharsStr =
    ind.getAttributeNS(W_NS, "leftChars") ||
    ind.getAttribute("w:leftChars") ||
    ind.getAttributeNS(W_NS, "startChars") ||
    ind.getAttribute("w:startChars") ||
    "0";
  const firstLineCharsStr =
    ind.getAttributeNS(W_NS, "firstLineChars") ||
    ind.getAttribute("w:firstLineChars") ||
    "0";
  const leftChars = parseInt(leftCharsStr, 10) || 0;
  const firstLineChars = parseInt(firstLineCharsStr, 10) || 0;
  if (leftChars > 0 || firstLineChars > 0) {
    return Math.max(1, Math.round((leftChars + firstLineChars) / 100));
  }

  // 2. Check twips/dxa indentation (720 twips = 0.5 inch = 4 spaces)
  const leftStr =
    ind.getAttributeNS(W_NS, "left") ||
    ind.getAttribute("w:left") ||
    ind.getAttributeNS(W_NS, "start") ||
    ind.getAttribute("w:start") ||
    "0";
  const firstLineStr =
    ind.getAttributeNS(W_NS, "firstLine") ||
    ind.getAttribute("w:firstLine") ||
    "0";
  const hangingStr =
    ind.getAttributeNS(W_NS, "hanging") ||
    ind.getAttribute("w:hanging") ||
    "0";

  const left = parseInt(leftStr, 10) || 0;
  const firstLine = parseInt(firstLineStr, 10) || 0;
  const hanging = parseInt(hangingStr, 10) || 0;
  const totalTwips = Math.max(0, left + firstLine - hanging);
  if (totalTwips <= 0) return 0;

  return Math.max(1, Math.round(totalTwips / 180));
}

function extractCellBlocks(container: Element): Element[] {
  const blocks: Element[] = [];
  for (let i = 0; i < container.childNodes.length; i++) {
    const c = container.childNodes[i];
    if (c.nodeType !== 1) continue;
    const el = c as Element;
    const ln = el.localName || el.nodeName.replace(/^.*:/, "");
    if (ln === "p" || ln === "tbl") {
      blocks.push(el);
    } else if (ln === "sdt") {
      const sdtContent = Array.from(el.childNodes).find((n) => {
        if (n.nodeType !== 1) return false;
        const cln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
        return cln === "sdtContent";
      }) as Element | undefined;
      if (sdtContent) {
        blocks.push(...extractCellBlocks(sdtContent));
      }
    }
  }
  return blocks;
}

function isParaCode(p: Para): boolean {
  if (p.plain.trim().length === 0) return false;
  // Monospace font in runs
  const hasMono = p.toks.some(
    (t) => t.kind === "text" && t.props.mono && t.text.trim().length > 0
  );
  if (hasMono) return true;
  return isParaCodeText(p.plain);
}

function isCellCodeBlock(paras: Para[]): boolean {
  const nonEmpty = paras.filter((p) => p.plain.trim().length > 0);
  if (nonEmpty.length === 0) return false;

  let totalTextChars = 0;
  let monoTextChars = 0;
  for (const p of nonEmpty) {
    for (const t of p.toks) {
      if (t.kind === "text") {
        totalTextChars += t.text.length;
        if (t.props.mono) monoTextChars += t.text.length;
      }
    }
  }
  if (totalTextChars > 0 && monoTextChars / totalTextChars >= 0.4) {
    return true;
  }

  const lines = nonEmpty.map((p) => p.plain);
  const codeContent = lines.join("\n");
  const lang = detectLang(codeContent);
  if (lang !== "plaintext") {
    return true;
  }

  const codeParasCount = nonEmpty.filter((p) => isParaCode(p)).length;
  if (codeParasCount >= Math.ceil(nonEmpty.length * 0.5)) {
    return true;
  }

  return false;
}

function parseCell(tc: Element, images: ImageMap, ole?: OleMap): string {
  const blocks = extractCellBlocks(tc);
  if (blocks.length === 0) return "";

  const parsedItems: ({ kind: "tbl"; rich: string } | { kind: "para"; para: Para })[] = [];
  for (const block of blocks) {
    const ln = block.localName || block.nodeName.replace(/^.*:/, "");
    if (ln === "tbl") {
      parsedItems.push({ kind: "tbl", rich: parseTable(block, images, ole).rich });
    } else {
      parsedItems.push({ kind: "para", para: parseParagraph(block, images, ole) });
    }
  }

  // If ALL items are paragraphs and the cell is detected as a code block:
  const allParas = parsedItems
    .filter((it): it is { kind: "para"; para: Para } => it.kind === "para")
    .map((it) => it.para);
  const hasOnlyParas = allParas.length === parsedItems.length;

  if (hasOnlyParas && isCellCodeBlock(allParas)) {
    const lines: string[] = [];
    for (const p of allParas) {
      let line = "";
      for (const t of p.toks) {
        if (t.kind === "text") line += t.text;
        else if (t.kind === "math") line += t.latex;
      }
      lines.push(line.replace(/[\r\n]+$/, ""));
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }
    const fullCode = lines.join("\n");
    const lang = detectLang(fullCode);
    return encCode(lang, fullCode);
  }

  // General cell content: preserve paragraphs without stripping leading spaces,
  // preserve blank lines, formulas, images, nested tables, and merge any contiguous code paragraphs.
  const outParts: string[] = [];
  let codeGroup: Para[] = [];

  const flushCodeGroup = () => {
    if (codeGroup.length === 0) return;
    if (codeGroup.length === 1 && !isParaCode(codeGroup[0])) {
      outParts.push(codeGroup[0].rich.replace(/[\r\n]+$/, ""));
    } else {
      const lines = codeGroup.map((p) => {
        let line = "";
        for (const t of p.toks) {
          if (t.kind === "text") line += t.text;
          else if (t.kind === "math") line += t.latex;
        }
        return line.replace(/[\r\n]+$/, "");
      });
      const fullCode = lines.join("\n");
      const lang = detectLang(fullCode);
      outParts.push(encCode(lang, fullCode));
    }
    codeGroup = [];
  };

  for (const item of parsedItems) {
    if (item.kind === "tbl") {
      flushCodeGroup();
      outParts.push(item.rich);
    } else {
      const p = item.para;
      if (isParaCode(p)) {
        codeGroup.push(p);
      } else {
        flushCodeGroup();
        outParts.push(p.rich.replace(/[\r\n]+$/, ""));
      }
    }
  }
  flushCodeGroup();

  return outParts.join("\n").trimEnd();
}

function parseTable(tbl: Element, images: ImageMap, ole?: OleMap): Para {
  const rows: string[][] = [];
  const trs = Array.from(tbl.childNodes).filter((n) => {
    if (n.nodeType !== 1) return false;
    const ln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
    return ln === "tr";
  }) as Element[];

  for (const tr of trs) {
    const cells: string[] = [];
    const tcs = Array.from(tr.childNodes).filter((n) => {
      if (n.nodeType !== 1) return false;
      const ln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
      return ln === "tc";
    }) as Element[];

    for (const tc of tcs) {
      cells.push(parseCell(tc, images, ole));
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

function extractBodyBlocks(container: Element): Element[] {
  const blocks: Element[] = [];
  for (let j = 0; j < container.childNodes.length; j++) {
    const node = container.childNodes[j];
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const ln = el.localName || el.nodeName.replace(/^.*:/, "");
    if (ln === "p" || ln === "tbl") {
      blocks.push(el);
    } else if (ln === "sdt") {
      const sdtContent = Array.from(el.childNodes).find((n) => {
        if (n.nodeType !== 1) return false;
        const cln = (n as Element).localName || (n as Element).nodeName.replace(/^.*:/, "");
        return cln === "sdtContent";
      }) as Element | undefined;
      if (sdtContent) {
        blocks.push(...extractBodyBlocks(sdtContent));
      }
    }
  }
  return blocks;
}

async function extractParagraphs(file: File): Promise<Para[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")!.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const images = await loadImageMap(zip);
  const ole = await buildOleMathMap(zip, collectProgIds(doc));

  const paras: Para[] = [];
  const body =
    doc.getElementsByTagNameNS(W_NS, "body")[0] ||
    doc.getElementsByTagName("w:body")[0];
  if (!body) return paras;

  // Walk direct blocks (supporting sdt wrapping)
  const blocks = extractBodyBlocks(body);
  for (const el of blocks) {
    const ln = el.localName || el.nodeName.replace(/^.*:/, "");
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
  // If line begins with "Câu \d+", it is a question stem, not a section header!
  if (/^\s*C[âa]u\s*\d+/i.test(line)) return 0;
  const u = line.toUpperCase().replace(/\s+/g, " ").trim();
  if (/PH[ẦA]N\s*(III|3)\b/.test(u)) return 3;
  if (/PH[ẦA]N\s*(II|2)\b/.test(u)) return 2;
  if (/PH[ẦA]N\s*(I|1)\b/.test(u)) return 1;
  return 0;
}

function stripMarkers(s: string): string {
  return s.replace(/<g[123]>/gi, "").trim();
}

export type OptionMarkerMatch = {
  key: string;       // "A"|"B"|"C"|"D" or "a"|"b"|"c"|"d"
  delim: string;     // "." or ")"
  isMarked: boolean; // red, underline, or *
  precedingTokens: Tok[]; // any tokens (like images) that appeared before this option marker in the paragraph
  remainingTokens: Tok[]; // the tokens belonging to this option after stripping the marker prefix
  order?: number;
  level?: QuestionLevel;
};

/**
 * Checks if a paragraph begins with a valid option marker.
 * Strictly adheres to the rule:
 * - Only recognizes markers at the very BEGINNING of a new paragraph.
 * - Valid markers:
 *     a)  b)  c)  d)
 *     A.  B.  C.  D.
 *   (as well as A) or a. at paragraph start).
 * - NEVER recognizes a), b), c), d), A., B., C., D. appearing in the middle of a paragraph.
 * - Detects correct answer marking via red color, underline, or leading '*'.
 */
export function detectOptionMarkerAtParaStart(p: Para): OptionMarkerMatch | null {
  // If paragraph contains a table, it is not an option line
  if (p.toks.some((t) => t.kind === "tbl")) {
    return null;
  }

  // Find first text token in paragraph
  let firstTextIdx = -1;
  const precedingTokens: Tok[] = [];
  for (let i = 0; i < p.toks.length; i++) {
    if (p.toks[i].kind === "text") {
      firstTextIdx = i;
      break;
    } else {
      precedingTokens.push(p.toks[i]);
    }
  }

  if (firstTextIdx === -1) {
    return null;
  }

  // Plain text from firstTextIdx onwards:
  const textFromFirst = tokensToPlain(p.toks.slice(firstTextIdx));

  // Match strictly at the start of textFromFirst:
  // - Optional leading spaces / tabs / NBSP
  // - Optional [order, level] tag e.g. [1, NB]
  // - Optional asterisk '*'
  // - Optional spaces
  // - Optional [order, level] tag
  // - Letter: A-D or a-d
  // - Delimiter: '.' or ')'
  // - Followed by whitespace, NBSP, end-of-string, or non-word character (e.g. $, \(, etc.)
  const match = textFromFirst.match(
    /^[ \t\u00A0]*(?:\[\s*(\d+)?\s*,?\s*(NB|TH|VD|VDC)?\s*\][ \t\u00A0]*)?(\*?)[ \t\u00A0]*(?:\[\s*(\d+)?\s*,?\s*(NB|TH|VD|VDC)?\s*\][ \t\u00A0]*)?([A-Da-d])([.)])(?=[ \t\u00A0\n\r]|$|[^\w\d\p{L}])/u
  );

  if (!match) return null;

  const orderStr = match[1] || match[4];
  const levelStr = match[2] || match[5];
  const hasStar = match[3] === "*";
  const letter = match[6];
  const delim = match[7];
  const matchLen = match[0].length;

  // Strip the marker prefix from text tokens ONLY:
  let isRunMarked = false;
  let remainingCharsToStrip = matchLen;
  let finishedPrefix = false;
  const remainingTokens: Tok[] = [];

  for (let j = firstTextIdx; j < p.toks.length; j++) {
    const tok = p.toks[j];
    if (!finishedPrefix) {
      if (tok.kind === "text") {
        if (tok.props.red || tok.props.underline) {
          isRunMarked = true;
        }
        if (remainingCharsToStrip > 0) {
          if (tok.text.length <= remainingCharsToStrip) {
            remainingCharsToStrip -= tok.text.length;
            continue;
          } else {
            // Marker ends inside this text token
            const afterMarker = tok.text.slice(remainingCharsToStrip);
            remainingCharsToStrip = 0;
            finishedPrefix = true;
            // Strip any leading spaces immediately after delimiter:
            const trimmed = afterMarker.replace(/^[ \t\u00A0]+/, "");
            if (trimmed) {
              remainingTokens.push({ ...tok, text: trimmed });
            }
            continue;
          }
        } else {
          // remainingCharsToStrip === 0, strip leading spaces:
          finishedPrefix = true;
          const trimmed = tok.text.replace(/^[ \t\u00A0]+/, "");
          if (trimmed) {
            remainingTokens.push({ ...tok, text: trimmed });
          }
          continue;
        }
      } else {
        // Non-text token: marker is finished, never strip non-text!
        finishedPrefix = true;
        remainingTokens.push(tok);
        continue;
      }
    } else {
      remainingTokens.push(tok);
    }
  }

  const isMarked = hasStar || isRunMarked;
  const order = orderStr ? parseInt(orderStr, 10) : undefined;
  const level = levelStr ? (levelStr.toUpperCase() as QuestionLevel) : undefined;

  return {
    key: letter,
    delim,
    isMarked,
    precedingTokens,
    remainingTokens,
    order,
    level,
  };
}

export type SplittedOption = {
  key: string;
  toks: Tok[];
  marked: boolean;
};

/**
 * Splits sequential options if multiple options are formatted in a single paragraph
 * (e.g. "A. x=1 \t B. x=2 \t C. x=3 \t D. x=4" or 2 options per line).
 * Preserves all math tokens, images, tables, and formats intact for each option.
 */
export function splitOptionTokens(firstKey: string, initialToks: Tok[], isPartI: boolean): SplittedOption[] {
  const options: SplittedOption[] = [{ key: firstKey, toks: [], marked: false }];
  const keys = isPartI ? ["A", "B", "C", "D"] : ["a", "b", "c", "d"];
  const startIdx = keys.findIndex((k) => k.toLowerCase() === firstKey.toLowerCase());
  let expectedNextIdx = startIdx >= 0 ? startIdx + 1 : -1;

  if (expectedNextIdx < 0 || expectedNextIdx >= keys.length) {
    options[0].toks = [...initialToks];
    return options;
  }

  const toks = [...initialToks];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.kind === "text" && expectedNextIdx < keys.length) {
      const nextKey = keys[expectedNextIdx];
      // Marker must be preceded by tab, newline, or 2+ spaces (or start of text token, or following a math/img token)
      const isAfterNonText = i > 0 && toks[i - 1].kind !== "text";
      const prefixPattern = isAfterNonText ? "(?:[\\t\\u00A0]|[ ]*|^)" : "(?:[\\t\\u00A0]|[ ]{2,}|^)";
      const re = new RegExp(prefixPattern + "[ \\t\\u00A0]*(\\*?)[ \\t\\u00A0]*(?:\\[[^\\]]*\\][ \\t\\u00A0]*)?(" + nextKey + ")[.)](?=[ \\t\\u00A0]|$|[^\\w\\d\\p{L}])", "u");
      const m = tok.text.match(re);
      if (m && m.index !== undefined) {
        const beforeText = tok.text.slice(0, m.index);
        if (beforeText) {
          options[options.length - 1].toks.push({ ...tok, text: beforeText });
        }
        const markerLen = m[0].length;
        const afterText = tok.text.slice(m.index + markerLen).replace(/^[ \t\u00A0]+/, "");
        const isMarked = m[1] === "*" || tok.props.red || tok.props.underline;
        options.push({ key: nextKey, toks: [], marked: !!isMarked });
        expectedNextIdx++;
        if (afterText) {
          toks.splice(i + 1, 0, { ...tok, text: afterText });
        }
        continue;
      }
    }
    options[options.length - 1].toks.push(tok);
  }
  return options;
}

// Strip the first `n` plain characters from a token array (leaves inline
// objects like images/math intact).
export const stripLeadingPlain = (toks: Tok[], n: number): Tok[] => {
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

export function isHetLine(plain: string): boolean {
  const s = plain.trim();
  if (!s) return false;
  // Strip decorative chars: -, –, —, −, =, _, *, ., ~, +, spaces, tabs, NBSP, zero-width spaces
  const stripped = s.replace(/[-–—−=_*.~+\s\t\u00A0\u200B]/g, "").toUpperCase();
  if (stripped === "HẾT" || stripped === "HET") return true;
  if (/[-–—−=_*.~+]{2,}\s*H[ẾE]T\s*[-–—−=_*.~+]{2,}/i.test(s)) return true;
  if (/^\s*[-–—−=_*.~+]*\s*H[ẾE]T\s*[-–—−=_*.~+]*\.?\s*$/i.test(s)) return true;
  // If line starts with HẾT and optional notes like "(Thí sinh...", " - Cán bộ...", " (Cán bộ...")
  if (/^\s*[-–—−=_*.~+]*\s*H[ẾE]T\s*[-–—−=_*.~+]*(?:\s*[-–—:.(]|\s+(?:Thí sinh|Cán bộ|Giám thị))/i.test(s)) return true;
  if (/[-–—−=_*.~+]{2,}\s*H[ẾE]T\s*[-–—−=_*.~+]{2,}.*$/i.test(s)) return true;
  return false;
}

export function isAnswerSectionHeader(plain: string): boolean {
  const s = stripRich(plain).trim().replace(/^[-–—=*_#\s]+|[-–—=*_#\s]+$/g, "").toUpperCase();
  if (!s) return false;
  // If it's just "ĐÁP ÁN:" followed by answer value or empty colon, it's a question answer line, NOT a section header
  if (/^Đ[ÁA]P\s*[ÁA]N\s*[:.]/i.test(s)) return false;
  return /^(?:BẢNG\s*ĐÁP\s*ÁN|HƯỚNG\s*DẪN\s*CHẤM|THANG\s*ĐIỂM|ĐÁP\s*ÁN\s*VÀ\s*(?:THANG\s*ĐIỂM|HƯỚNG\s*DẪN|LỜI\s*GIẢI)|BIỂU\s*ĐIỂM|PHẦN\s*ĐÁP\s*ÁN|BẢNG\s*TRA\s*ĐÁP\s*ÁN)/i.test(s);
}

export function isExplHeader(plain: string): boolean {
  const s = stripRich(plain).trim().replace(/^[-–—=*_#\s]+|[-–—=*_#\s]+$/g, "").toUpperCase();
  if (!s) return false;
  // Explicitly NOT an explanation header if it mentions CHẤM, BẢNG ĐÁP ÁN, THANG ĐIỂM, BIỂU ĐIỂM
  if (/(?:CHẤM|BẢNG\s*ĐÁP\s*ÁN|THANG\s*ĐIỂM|BIỂU\s*ĐIỂM)/i.test(s)) return false;
  if (/^(?:L[ỜO]I\s*GI[ẢA]I|GIẢI\s*CHI\s*TIẾT|HƯỚNG\s*DẪN\s*GIẢI\b|ĐÁP\s*ÁN\s*VÀ\s*LỜI\s*GIẢI)/i.test(s)) return true;
  return false;
}

export function parseTFVal(cellStr: string): boolean | null {
  const s = cellStr.trim();
  if (!s) return null;
  // Strip item prefix: "a)", "a.", "a:", "(a)", "Ý a:", "Lệnh a:"
  const clean = s.replace(/^(?:\(?[a-d][.) :]?|Ý\s*[a-d][:.]?|L[ệe]nh\s*[a-d][:.]?)\s*/i, "").trim();
  if (/^[Đđ](?:[úu]ng)?$/i.test(clean) || clean === "Đ" || clean === "đ") return true;
  if (/^[Ss](?:ai)?$/i.test(clean) || clean === "S" || clean === "s") return false;
  if (/^[Tt](?:rue)?$/i.test(clean)) return true;
  if (/^[Ff](?:alse)?$/i.test(clean)) return false;
  if (/^[Dd]$/i.test(clean)) return true; // D for Đúng
  if (/[Đđ]/i.test(clean)) return true;
  if (/\b(?:[Đđ][úu]ng|[Tt]rue)\b/i.test(clean)) return true;
  if (/\b(?:[Ss]ai|[Ff]alse)\b/i.test(clean)) return false;
  if (/[Ss]/i.test(clean)) return false;
  return null;
}

export function findPartIIRowIndices(grid: string[][]): { rowA: number; rowB: number; rowC: number; rowD: number; headerRow: number | null } | null {
  const isRowForLetter = (row: string[], letter: string): boolean => {
    const first = row[0]?.trim().toLowerCase() || "";
    // Label cell in col 0: "a", "a)", "a.", "(a)", "Ý a", "Ý a:", "Lệnh a"
    const labelRe = new RegExp(`^(?:\\(?${letter}[.) :]?|ý\\s*${letter}[:.]?|lệnh\\s*${letter}[:.]?)$`, "i");
    if (labelRe.test(first)) return true;

    // Any cell in row starts with this letter prefix and has TF value
    const cellPrefixRe = new RegExp(`^(?:\\(?${letter}[.) :]?|ý\\s*${letter}[:.]?)\\s*(?:[đsđstdtruefal]|đúng|sai)`, "i");
    const count = row.filter((c) => cellPrefixRe.test(c.trim())).length;
    if (count >= 1) return true;

    return false;
  };

  let rowA = -1, rowB = -1, rowC = -1, rowD = -1;
  for (let r = 0; r < grid.length; r++) {
    if (rowA === -1 && isRowForLetter(grid[r], "a")) rowA = r;
    else if (rowB === -1 && isRowForLetter(grid[r], "b")) rowB = r;
    else if (rowC === -1 && isRowForLetter(grid[r], "c")) rowC = r;
    else if (rowD === -1 && isRowForLetter(grid[r], "d")) rowD = r;
  }

  // Fallback: 4 consecutive rows where cells contain TF values
  if (rowA === -1 || rowB === -1 || rowC === -1 || rowD === -1) {
    for (let r = 0; r <= grid.length - 4; r++) {
      const isTFRow = (rowIdx: number) => grid[rowIdx].some((c) => parseTFVal(c) !== null);
      if (isTFRow(r) && isTFRow(r + 1) && isTFRow(r + 2) && isTFRow(r + 3)) {
        rowA = r; rowB = r + 1; rowC = r + 2; rowD = r + 3;
        break;
      }
    }
  }

  if (rowA !== -1 && rowB !== -1 && rowC !== -1 && rowD !== -1) {
    const minRow = Math.min(rowA, rowB, rowC, rowD);
    const headerRow = minRow > 0 ? minRow - 1 : null;
    return { rowA, rowB, rowC, rowD, headerRow };
  }
  return null;
}

export function tryParseTransposedPartII(grid: string[][], partII: TFQuestion[]): boolean {
  let matchedAny = false;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (row.length < 5) continue;
    // Check if row[0] has question number
    const m = row[0].match(/(?:C[âa]u\s*)?(\d+)/i);
    if (!m) continue;
    let qNum = parseInt(m[1]);
    if (qNum > partII.length && qNum >= 13 && qNum <= 16) {
      qNum = qNum - 12;
    }
    if (qNum < 1 || qNum > partII.length) continue;

    const valA = parseTFVal(row[1]);
    const valB = parseTFVal(row[2]);
    const valC = parseTFVal(row[3]);
    const valD = parseTFVal(row[4]);
    if (valA !== null && valB !== null && valC !== null && valD !== null) {
      const q = partII[qNum - 1];
      const itA = q.items.find((x) => x.key === "a"); if (itA) itA.correct = valA;
      const itB = q.items.find((x) => x.key === "b"); if (itB) itB.correct = valB;
      const itC = q.items.find((x) => x.key === "c"); if (itC) itC.correct = valC;
      const itD = q.items.find((x) => x.key === "d"); if (itD) itD.correct = valD;
      matchedAny = true;
    }
  }
  return matchedAny;
}

export function parseAnswerKeySection(
  ansParas: Para[],
  partI: MCQuestion[],
  partII: TFQuestion[],
  partIII: SAQuestion[],
) {
  let currentPart: 1 | 2 | 3 = 1;

  for (const p of ansParas) {
    const pPart = detectPart(p.plain);
    if (pPart) {
      currentPart = pPart;
    }

    // 1. Process Tables
    const tblToks = p.toks.filter((t): t is TblTok => t.kind === "tbl");
    for (const tbl of tblToks) {
      const grid = tbl.rows.map((row) => row.map((cell) => stripRich(cell).trim()));
      if (!grid.length) continue;

      // Check if table contains a part header in any cell
      const tableText = grid.map((r) => r.join(" ")).join(" ");
      const tblPart = detectPart(tableText);
      if (tblPart) {
        currentPart = tblPart;
      }

      // Check Part II table (strictly column-based: Col 1 -> Câu 1, Col 2 -> Câu 2...)
      const tfIndices = findPartIIRowIndices(grid);
      if (tfIndices) {
        const { rowA, rowB, rowC, rowD, headerRow } = tfIndices;
        const numCols = Math.max(
          grid[rowA].length,
          grid[rowB].length,
          grid[rowC].length,
          grid[rowD].length,
        );
        const isLabelCol = (c: number) => {
          // If the cell contains an answer value (e.g. "a) Đ" or "Đ" or "S"), it is an ANSWER column, not a label column
          if (parseTFVal(grid[rowA][c] || "") !== null) return false;
          return (
            /^\s*a(?:\)|\.|\s*$)/i.test(grid[rowA][c] || "") ||
            /^\s*(?:C[âa]u|Ý|L[ệe]nh)\b/i.test(grid[headerRow ?? rowA]?.[c] || "")
          );
        };
        const startCol = isLabelCol(0) ? 1 : 0;

        for (let c = startCol; c < numCols; c++) {
          let qNum: number | null = null;
          if (headerRow !== null && grid[headerRow] && grid[headerRow][c]) {
            const m = grid[headerRow][c].match(/\d+/);
            if (m) qNum = parseInt(m[0]);
          }
          if (qNum === null) {
            qNum = c - startCol + 1;
          }
          let targetIdx = qNum - 1;
          if (qNum > partII.length && qNum >= 13 && qNum <= 16) {
            targetIdx = qNum - 13;
          } else if (qNum > partII.length && qNum > partI.length && (qNum - partI.length) <= partII.length) {
            targetIdx = qNum - partI.length - 1;
          }
          if (targetIdx >= 0 && targetIdx < partII.length) {
            const q = partII[targetIdx];
            const valA = parseTFVal(grid[rowA][c] || "");
            const valB = parseTFVal(grid[rowB][c] || "");
            const valC = parseTFVal(grid[rowC][c] || "");
            const valD = parseTFVal(grid[rowD][c] || "");
            if (valA !== null) { const it = q.items.find((x) => x.key === "a"); if (it) it.correct = valA; }
            if (valB !== null) { const it = q.items.find((x) => x.key === "b"); if (it) it.correct = valB; }
            if (valC !== null) { const it = q.items.find((x) => x.key === "c"); if (it) it.correct = valC; }
            if (valD !== null) { const it = q.items.find((x) => x.key === "d"); if (it) it.correct = valD; }
          }
        }
        currentPart = 2;
        continue;
      }

      // Check transposed Part II table (row-based)
      if (tryParseTransposedPartII(grid, partII)) {
        currentPart = 2;
        continue;
      }

      // Check vertical 2-column Part III table (e.g. Câu 1 | 10, Câu 2 | 31...)
      if (grid.length >= 2 && grid[0].length === 2) {
        let isVerticalPart3 = currentPart === 3;
        const verticalPairs: { qNum: number; ans: string }[] = [];
        for (let r = 0; r < grid.length; r++) {
          const m = grid[r][0].match(/(?:C[âa]u\s*)?(\d+)/i);
          const ans = grid[r][1]?.trim();
          if (m && ans) {
            verticalPairs.push({ qNum: parseInt(m[1]), ans });
            if (!/^[A-D]\.?$/i.test(ans)) isVerticalPart3 = true;
          }
        }
        if (isVerticalPart3 && verticalPairs.length > 0) {
          for (const { qNum, ans } of verticalPairs) {
            let targetIdx = qNum - 1;
            if (qNum > partIII.length && qNum >= 17) targetIdx = qNum - 17;
            else if (qNum > partIII.length && qNum > (partI.length + partII.length)) targetIdx = qNum - (partI.length + partII.length) - 1;
            if (targetIdx >= 0 && targetIdx < partIII.length) {
              const cleanAns = ans.replace(/^(?:Ch[ọo]n|Đ[áa]p\s*[áa]n|K[ếe]t\s*qu[ảa])\s*[:.]?\s*/i, "").trim();
              if (cleanAns) partIII[targetIdx].answer = cleanAns;
            }
          }
          currentPart = 3;
          continue;
        }
      }

      // Check Part I / Part III tables (row pairs: Row 1 = Câu 1 2 3..., Row 2 = Chọn D A B C... or Chọn 10 31...)
      for (let r = 0; r < grid.length - 1; r++) {
        const rowNumbers: { col: number; qNum: number }[] = [];
        for (let c = 0; c < grid[r].length; c++) {
          const cell = grid[r][c].trim();
          // Skip header labels like "Câu", "Phần", "Bảng" that don't have question numbers
          if (/^(?:C[âa]u|Ph[ầa]n|B[ảa]ng)\b/i.test(cell) && !/\d+/.test(cell.replace(/^(?:C[âa]u|Ph[ầa]n|B[ảa]ng)\s*/i, ""))) {
            continue;
          }
          const m = cell.match(/(?:C[âa]u\s*)?(\d+)/i);
          if (m) {
            rowNumbers.push({ col: c, qNum: parseInt(m[1]) });
          }
        }

        if (rowNumbers.length >= 1) {
          const nextRow = grid[r + 1];
          // Check if values in nextRow look like short answers (numbers, decimals, text) vs MC single letters A-D
          const nextRowCells = rowNumbers.map(({ col }) => nextRow[col]?.trim() || "").filter(Boolean);
          const hasNonMC = nextRowCells.some((val) => {
            const clean = val.replace(/^(?:Ch[ọo]n|Đ[áa]p\s*[áa]n|K[ếe]t\s*qu[ảa])\s*[:.]?\s*/i, "").trim();
            return !/^[A-D]\.?$/i.test(clean);
          });
          const isPart3Table = currentPart === 3 || hasNonMC;

          for (const { col, qNum } of rowNumbers) {
            if (col < nextRow.length) {
              const ansRaw = nextRow[col].trim();
              if (!ansRaw) continue;
              const cleanVal = ansRaw.replace(/^(?:Ch[ọo]n|Đ[áa]p\s*[áa]n|K[ếe]t\s*qu[ảa])\s*[:.]?\s*/i, "").trim();
              if (!cleanVal) continue;

              if (isPart3Table) {
                let targetIdx = qNum - 1;
                if (qNum > partIII.length && qNum >= 17) {
                  targetIdx = qNum - 17;
                } else if (qNum > partIII.length && qNum > (partI.length + partII.length)) {
                  targetIdx = qNum - (partI.length + partII.length) - 1;
                }
                if (targetIdx >= 0 && targetIdx < partIII.length) {
                  partIII[targetIdx].answer = cleanVal;
                }
              } else {
                const mcMatch = cleanVal.match(/^([A-D])\.?$/i);
                if (mcMatch) {
                  let targetIdx = qNum - 1;
                  if (targetIdx >= 0 && targetIdx < partI.length) {
                    partI[targetIdx].answer = mcMatch[1].toUpperCase() as any;
                  }
                }
              }
            }
          }
          if (isPart3Table) currentPart = 3;
          else currentPart = 1;
        }
      }
    }
  }

  // 2. Process Text Paragraphs
  const textLines = ansParas
    .filter((p) => !p.toks.some((t) => t.kind === "tbl"))
    .map((p) => stripRich(p.plain).trim())
    .filter(Boolean);

  // 2a. Part II in text paragraphs (columns):
  // 1 2 3 4
  // a) Đ  a) Đ  a) Đ  a) Đ
  // b) S  b) S  b) S  b) S
  // c) S  c) S  c) Đ  c) S
  // d) Đ  d) S  d) Đ  d) S
  for (let i = 0; i <= textLines.length - 4; i++) {
    const lineA = textLines[i];
    const lineB = textLines[i + 1];
    const lineC = textLines[i + 2];
    const lineD = textLines[i + 3];

    const isLineA = /^\s*a(?:\)|\.)/i.test(lineA);
    const isLineB = /^\s*b(?:\)|\.)/i.test(lineB);
    const isLineC = /^\s*c(?:\)|\.)/i.test(lineC);
    const isLineD = /^\s*d(?:\)|\.)/i.test(lineD);

    if (isLineA && isLineB && isLineC && isLineD) {
      let qNums: number[] = [];
      if (i > 0) {
        const prevLine = textLines[i - 1];
        const nums = prevLine.match(/\b\d+\b/g);
        if (nums && nums.length >= 2) {
          qNums = nums.map((n) => parseInt(n));
        }
      }

      const extractTFMatches = (line: string): boolean[] => {
        const matches = Array.from(line.matchAll(/(?:[a-d][.)]\s*)?([ĐSđsTt])(?=\s|$|[a-d][.)])/gi));
        if (matches.length > 0) {
          return matches.map((m) => parseTFVal(m[1]) ?? false);
        }
        const tokens = line.split(/\s+/).map((s) => s.trim()).filter(Boolean);
        const vals: boolean[] = [];
        for (const tok of tokens) {
          const v = parseTFVal(tok);
          if (v !== null) vals.push(v);
        }
        return vals;
      };

      const valsA = extractTFMatches(lineA);
      const valsB = extractTFMatches(lineB);
      const valsC = extractTFMatches(lineC);
      const valsD = extractTFMatches(lineD);

      const maxCols = Math.max(valsA.length, valsB.length, valsC.length, valsD.length);
      for (let c = 0; c < maxCols; c++) {
        const qNum = qNums[c] ?? (c + 1);
        if (qNum >= 1 && qNum <= partII.length) {
          const q = partII[qNum - 1];
          if (valsA[c] !== undefined) { const it = q.items.find((x) => x.key === "a"); if (it) it.correct = valsA[c]; }
          if (valsB[c] !== undefined) { const it = q.items.find((x) => x.key === "b"); if (it) it.correct = valsB[c]; }
          if (valsC[c] !== undefined) { const it = q.items.find((x) => x.key === "c"); if (it) it.correct = valsC[c]; }
          if (valsD[c] !== undefined) { const it = q.items.find((x) => x.key === "d"); if (it) it.correct = valsD[c]; }
        }
      }
    }
  }

  // 2b. Two-line pattern:
  // Part I:
  // Câu 1 2 3 4...
  // Chọn D A B C...
  // Part III:
  // Câu 1 2 3...
  // Chọn 10 31...
  let activeTextSection: 1 | 2 | 3 = 1;
  for (let i = 0; i < textLines.length; i++) {
    const p = detectPart(textLines[i]);
    if (p) {
      activeTextSection = p;
      continue;
    }

    if (i < textLines.length - 1) {
      const line1 = textLines[i];
      const line2 = textLines[i + 1];
      if (/^\s*(?:C[âa]u\s*[:.]?\s*)?\d+/i.test(line1) && /^\s*(?:Ch[ọo]n|Đ[áa]p\s*[áa]n)\s*[:.]?\s*/i.test(line2)) {
        const nums = line1.match(/\b\d+\b/g)?.map((n) => parseInt(n)) || [];
        const rest2 = line2.replace(/^\s*(?:Ch[ọo]n|Đ[áa]p\s*[áa]n)\s*[:.]?\s*/i, "").trim();
        const tokens = rest2.split(/\s+/).filter(Boolean);
        if (nums.length > 0 && tokens.length > 0) {
          for (let k = 0; k < Math.min(nums.length, tokens.length); k++) {
            const qNum = nums[k];
            const tok = tokens[k].trim();
            if (activeTextSection === 3 || (!/^[A-D]$/i.test(tok) && qNum <= partIII.length)) {
              if (qNum <= partIII.length) {
                partIII[qNum - 1].answer = tok;
              }
            } else if (/^[A-D]$/i.test(tok) && qNum <= partI.length) {
              partI[qNum - 1].answer = tok.toUpperCase() as any;
            }
          }
        }
      }
    }
  }

  // 2c. Inline patterns: 1. D, 2. A, Câu 1: D or Part III: Câu 1: 10
  let detectedTextPart: 1 | 2 | 3 = 1;
  for (const line of textLines) {
    const p = detectPart(line);
    if (p) {
      detectedTextPart = p;
      continue;
    }

    if (detectedTextPart === 1) {
      const mcRegex = /(?:C[âa]u\s*)?(\d+)\s*[:.\-–]?\s*([A-D])\b/gi;
      let m: RegExpExecArray | null;
      while ((m = mcRegex.exec(line)) !== null) {
        const qNum = parseInt(m[1]);
        const ans = m[2].toUpperCase();
        if (qNum >= 1 && qNum <= partI.length) {
          partI[qNum - 1].answer = ans as any;
        }
      }
    } else if (detectedTextPart === 3) {
      const saRegex = /(?:C[âa]u\s*)?(\d+)\s*[:.\-–]\s*([^\s,;]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = saRegex.exec(line)) !== null) {
        const qNum = parseInt(m[1]);
        const ans = m[2].trim();
        if (qNum >= 1 && qNum <= partIII.length) {
          partIII[qNum - 1].answer = ans;
        }
      }
    }
  }
}

export function parseExplSection(
  explParas: Para[],
  partI: MCQuestion[],
  partII: TFQuestion[],
  partIII: SAQuestion[],
) {
  let currentExplPart: 1 | 2 | 3 | 0 = 0;
  let currentExplQNum: number | null = null;
  let currentExplToks: Tok[] = [];

  const flushExpl = () => {
    if (currentExplQNum === null || !currentExplToks.length) {
      currentExplToks = [];
      currentExplQNum = null;
      return;
    }
    const explRich = tokensToRich(currentExplToks).trim();
    if (explRich) {
      let targetQ: { explanation?: string | null } | undefined;
      if (currentExplPart === 1 && currentExplQNum <= partI.length) {
        targetQ = partI[currentExplQNum - 1];
      } else if (currentExplPart === 2 && currentExplQNum <= partII.length) {
        targetQ = partII[currentExplQNum - 1];
      } else if (currentExplPart === 3 && currentExplQNum <= partIII.length) {
        targetQ = partIII[currentExplQNum - 1];
      } else if (currentExplPart === 0) {
        if (currentExplQNum <= partI.length) {
          targetQ = partI[currentExplQNum - 1];
        } else if (currentExplQNum <= partI.length + partII.length) {
          targetQ = partII[currentExplQNum - partI.length - 1];
        } else if (currentExplQNum <= partI.length + partII.length + partIII.length) {
          targetQ = partIII[currentExplQNum - partI.length - partII.length - 1];
        }
      }
      if (targetQ) {
        targetQ.explanation = explRich;
      }
    }
    currentExplToks = [];
    currentExplQNum = null;
  };

  for (const p of explParas) {
    const rawPlain = stripMarkers(p.plain).trim();
    const hasNonText = p.toks.some((t) => t.kind !== "text");
    if (!rawPlain && !hasNonText) continue;

    // Skip standalone explanation header like "LỜI GIẢI CHI TIẾT"
    if (isExplHeader(p.plain) && !/C[âa]u\s*\d+/i.test(p.plain)) {
      continue;
    }

    // Check Part header
    const pPart = detectPart(p.plain.trim());
    if (pPart) {
      flushExpl();
      currentExplPart = pPart;
      continue;
    }

    // Strip leading "Lời giải:" if combined on the same line as Câu N
    let cleanedToks = [...p.toks];
    let cleanedPlain = rawPlain;
    const loiGiaiLead = cleanedPlain.match(/^\s*(?:L[ờo]i\s*gi[ảa]i|HƯỚNG\s*DẪN\s*GIẢI|GIẢI\s*CHI\s*TIẾT)\s*[:.\-–]?\s*/i);
    if (loiGiaiLead) {
      cleanedPlain = cleanedPlain.slice(loiGiaiLead[0].length).trim();
      cleanedToks = stripLeadingPlain(cleanedToks, loiGiaiLead[0].length);
    }

    const qStart = cleanedPlain.match(QUESTION_START_RE);
    if (qStart) {
      flushExpl();
      currentExplQNum = parseInt(qStart[1]);
      const strippedToks = stripLeadingPlain(cleanedToks, qStart[0].length);
      currentExplToks = [...strippedToks];
      continue;
    }

    if (currentExplQNum !== null) {
      if (currentExplToks.length) {
        currentExplToks.push({ ...PBRK });
      }
      currentExplToks.push(...cleanedToks);
    }
  }

  flushExpl();
}

export function parsePostHetSection(
  postHetParas: Para[],
  partI: MCQuestion[],
  partII: TFQuestion[],
  partIII: SAQuestion[],
) {
  let explStartIdx = -1;
  for (let i = 0; i < postHetParas.length; i++) {
    if (isExplHeader(postHetParas[i].plain)) {
      explStartIdx = i;
      break;
    }
  }

  const ansParas = explStartIdx >= 0 ? postHetParas.slice(0, explStartIdx) : postHetParas;
  const explParas = explStartIdx >= 0 ? postHetParas.slice(explStartIdx) : [];

  if (ansParas.length > 0) {
    parseAnswerKeySection(ansParas, partI, partII, partIII);
  }
  if (explParas.length > 0) {
    const explTableParas = explParas.filter((p) => p.toks.some((t) => t.kind === "tbl"));
    if (explTableParas.length > 0) {
      parseAnswerKeySection(explTableParas, partI, partII, partIII);
    }
    parseExplSection(explParas, partI, partII, partIII);
  }
}

export async function parseDocx(file: File): Promise<ParsedExam> {
  const paras = await extractParagraphs(file);

  // Divide into exam content (before HẾT) and answer/explanation content (after HẾT)
  let examParas: Para[] = [];
  let postHetParas: Para[] = [];

  const hetIdx = paras.findIndex((p) => isHetLine(p.plain));
  if (hetIdx >= 0) {
    examParas = paras.slice(0, hetIdx);
    postHetParas = paras.slice(hetIdx + 1);
  } else {
    const ansHeaderIdx = paras.findIndex((p) => isAnswerSectionHeader(p.plain));
    if (ansHeaderIdx >= 0) {
      examParas = paras.slice(0, ansHeaderIdx);
      postHetParas = paras.slice(ansHeaderIdx);
    } else {
      // Check if an answer table appears in paras
      let ansTblIdx = -1;
      for (let i = 1; i < paras.length; i++) {
        const tblTok = paras[i].toks.find((t): t is TblTok => t.kind === "tbl");
        if (tblTok) {
          const grid = tblTok.rows.map((r) => r.map((c) => stripRich(c).trim()));
          if (findPartIIRowIndices(grid) || tryParseTransposedPartII(grid, [])) {
            ansTblIdx = i;
            if (ansTblIdx > 0 && detectPart(paras[ansTblIdx - 1].plain) > 0) {
              ansTblIdx--;
            }
            break;
          }
        }
      }
      if (ansTblIdx >= 0) {
        examParas = paras.slice(0, ansTblIdx);
        postHetParas = paras.slice(ansTblIdx);
      } else {
        examParas = paras;
        postHetParas = [];
      }
    }
  }

  const partI: MCQuestion[] = [];
  const partII: TFQuestion[] = [];
  const partIII: SAQuestion[] = [];

  let currentPart: 1 | 2 | 3 = 1;
  let qIdx = 0;

  type TempOption = {
    key: string;
    toks: Tok[];
    marked: boolean;
    level?: QuestionLevel | null;
    order?: number;
  };

  type QuestionBuffer = {
    part: 1 | 2 | 3;
    idx: number;
    level: QuestionLevel | null;
    stemToks: Tok[];
    options: TempOption[];
    explToks: Tok[];
    ansToks: Tok[];
    mode: "stem" | "options" | "expl" | "ans";
  };

  let qBuf: QuestionBuffer | null = null;

  const flush = () => {
    if (!qBuf) return;
    const { part, idx, level, stemToks, options, explToks, ansToks } = qBuf;
    qBuf = null;

    const stemRich = tokensToRich(stemToks).trim();
    const explanation = explToks.length ? tokensToRich(explToks).trim() : null;

    if (part === 1) {
      let answer: "A" | "B" | "C" | "D" | "" = "";
      const formattedOpts: { key: "A" | "B" | "C" | "D"; text: string }[] = [];

      for (const o of options) {
        const keyUpper = o.key.toUpperCase() as "A" | "B" | "C" | "D";
        if (o.marked && !answer) {
          answer = keyUpper;
        }
        formattedOpts.push({
          key: keyUpper,
          text: tokensToRich(o.toks).trim(),
        });
      }

      if (!answer && ansToks.length) {
        const ansPlain = tokensToPlain(ansToks);
        const m = ansPlain.match(/([A-D])\b/i);
        if (m) answer = m[1].toUpperCase() as any;
      }

      partI.push({
        type: "mc",
        id: `q${idx}`,
        text: stemRich,
        options: formattedOpts,
        answer: (answer ? (answer as "A" | "B" | "C" | "D") : null),
        explanation,
        level,
      });
    } else if (part === 2) {
      type ExtractedItem = {
        key: "a" | "b" | "c" | "d";
        text: string;
        correct: boolean | null;
        level?: QuestionLevel | null;
        order?: number;
      };

      const rawItems: ExtractedItem[] = [];
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        let textRich = tokensToRich(o.toks).trim();
        let itemOrder = o.order;
        let itemLevel = o.level ?? null;

        const leadingMatch = textRich.match(/^\s*\[\s*(\d+)\s*,\s*(NB|TH|VD|VDC)\s*\]\s*/i);
        if (leadingMatch) {
          itemOrder = parseInt(leadingMatch[1]);
          itemLevel = leadingMatch[2].toUpperCase() as QuestionLevel;
          textRich = textRich.slice(leadingMatch[0].length).trim();
        }

        let itemCorrect: boolean | null = null;
        const tfMatch = textRich.match(/(?:^|[(\[\s:\-])(Đúng|Sai|True|False)(?:[)\]\s.]*$)/i);
        if (tfMatch) {
          itemCorrect = /^(?:Đúng|True)$/i.test(tfMatch[1]);
        } else if (o.marked) {
          itemCorrect = true;
        } else if (options.some((opt) => opt.marked)) {
          itemCorrect = false;
        } else {
          itemCorrect = null;
        }

        rawItems.push({
          key: o.key.toLowerCase() as "a" | "b" | "c" | "d",
          text: textRich,
          correct: itemCorrect,
          level: itemLevel,
          order: itemOrder,
        });
      }

      // Check if item i ends with a prefix meant for item i + 1
      for (let i = 0; i < rawItems.length - 1; i++) {
        const trailingMatch = rawItems[i].text.match(/\[\s*(\d+)\s*,\s*(NB|TH|VD|VDC)\s*\]\s*$/i);
        if (trailingMatch) {
          if (rawItems[i + 1].order === undefined) {
            rawItems[i + 1].order = parseInt(trailingMatch[1]);
            rawItems[i + 1].level = trailingMatch[2].toUpperCase() as QuestionLevel;
          }
          rawItems[i].text = rawItems[i].text.slice(0, trailingMatch.index).trim();
        }
      }

      const items = rawItems.map((it) => ({
        ...it,
        text: it.text.replace(/\[\s*\d+\s*,\s*(?:NB|TH|VD|VDC)\s*\]/gi, "").trim(),
      }));

      partII.push({
        type: "tf",
        id: `q${idx}`,
        text: stemRich,
        items,
        explanation,
        level,
      });
    } else {
      // Part III: Short Answer
      let answer = "";
      let stemCleaned = stemRich;
      if (ansToks.length) {
        answer = tokensToRich(ansToks).replace(/\s+/g, " ").trim();
      } else {
        const m = stemRich.match(/Đáp\s*án\s*[:.]?\s*(.+)$/i);
        if (m) {
          answer = m[1].trim();
          stemCleaned = stemRich.replace(/Đáp\s*án\s*[:.]?\s*.+$/i, "").trim();
        }
      }
      partIII.push({
        type: "sa",
        id: `q${idx}`,
        text: stemCleaned,
        answer,
        explanation,
        level,
      });
    }
  };

  // Detects "Lời giải:" or "Đáp án:" at the start of a paragraph plain-text.
  type Marker = { markerLen: number; mode: "expl" | "answer" };
  const detectExplStart = (rawPlain: string, part: 1 | 2 | 3, hasNonText: boolean): Marker | null => {
    const mLoi = rawPlain.match(/^\s*L[ờo]i\s*gi[ảa]i\s*[:.]\s*/i);
    if (mLoi) return { markerLen: mLoi[0].length, mode: "expl" };
    const mDap = rawPlain.match(/^\s*Đ[áa]p\s*[áa]n\s*[:.]\s*/i);
    if (mDap) {
      const rest = rawPlain.slice(mDap[0].length).trim();
      if (part === 1) {
        if (/^[A-D]\.?$/i.test(rest)) return null;
        return { markerLen: mDap[0].length, mode: "expl" };
      }
      if (part === 3) {
        if (rest.length > 0 && rest.length <= 60 && !/[.!?…]\s+\S/.test(rest)) return null;
        if (!rest) return { markerLen: mDap[0].length, mode: "answer" };
        return { markerLen: mDap[0].length, mode: "expl" };
      }
      return { markerLen: mDap[0].length, mode: "expl" };
    }
    return null;
  };

  for (const p of examParas) {
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
      // Strip "Câu N:" prefix from this initial paragraph
      const strippedToks = stripLeadingPlain(toks, qStart[0].length);
      qBuf = {
        part: currentPart,
        idx: qIdx,
        level: (qStart[2]?.toUpperCase() as any) ?? null,
        stemToks: [...strippedToks],
        options: [],
        explToks: [],
        ansToks: [],
        mode: "stem",
      };
      continue;
    }

    if (!qBuf) continue;

    // Check for explanation / answer-block start marker on this paragraph.
    if (qBuf.mode !== "expl") {
      const em = detectExplStart(stripMarkers(p.plain), qBuf.part, hasNonText);
      if (em) {
        const stripped = stripLeadingPlain(toks, em.markerLen);
        if (em.mode === "answer") {
          qBuf.mode = "ans";
          if (stripped.length) qBuf.ansToks.push(...stripped);
        } else {
          qBuf.mode = "expl";
          if (stripped.length) qBuf.explToks.push(...stripped);
        }
        continue;
      }
    }

    if (qBuf.mode === "expl") {
      if (qBuf.explToks.length) qBuf.explToks.push({ ...PBRK });
      qBuf.explToks.push(...toks);
      continue;
    }

    if (qBuf.mode === "ans") {
      if (qBuf.ansToks.length) qBuf.ansToks.push({ ...PBRK });
      qBuf.ansToks.push(...toks);
      continue;
    }

    // Question body mode: check if this paragraph STARTS with an option marker
    const optMatch = qBuf.part !== 3 ? detectOptionMarkerAtParaStart(p) : null;
    if (optMatch) {
      // If there were preceding tokens (e.g. image before the marker):
      if (optMatch.precedingTokens.length > 0) {
        if (qBuf.mode === "options" && qBuf.options.length > 0) {
          qBuf.options[qBuf.options.length - 1].toks.push(...optMatch.precedingTokens);
        } else {
          qBuf.stemToks.push(...optMatch.precedingTokens);
        }
      }
      qBuf.mode = "options";
      const splitted = splitOptionTokens(optMatch.key, optMatch.remainingTokens, qBuf.part === 1);
      for (let sIdx = 0; sIdx < splitted.length; sIdx++) {
        const item = splitted[sIdx];
        qBuf.options.push({
          key: item.key,
          toks: item.toks,
          marked: sIdx === 0 ? optMatch.isMarked : item.marked,
          level: sIdx === 0 ? optMatch.level : undefined,
          order: sIdx === 0 ? optMatch.order : undefined,
        });
      }
    } else {
      // Paragraph does not start with an option marker
      if (qBuf.mode === "options" && qBuf.options.length > 0) {
        // Continuation paragraph of the current option
        qBuf.options[qBuf.options.length - 1].toks.push({ ...PBRK });
        qBuf.options[qBuf.options.length - 1].toks.push(...toks);
      } else {
        // Continuation paragraph of the question stem
        qBuf.stemToks.push({ ...PBRK });
        qBuf.stemToks.push(...toks);
      }
    }
  }

  flush();

  // If there is content after HẾT, parse answers and explanations
  if (postHetParas.length > 0) {
    parsePostHetSection(postHetParas, partI, partII, partIII);
  } else {
    // Fallback: check if there are any answer key tables that might have been included in examParas
    const tableParas = examParas.filter((p) => p.toks.some((t) => t.kind === "tbl"));
    if (tableParas.length > 0) {
      parseAnswerKeySection(tableParas, partI, partII, partIII);
    }
  }

  return { partI, partII, partIII };
}

