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
export const QUESTION_START_RE = /^\s*C[âa]u\s*(\d+)\s*(?:[(\[]\s*(NB|TH|VD|VDC)\s*[)\]])?\s*(?:[:.\-–)]|\s+|$)/i;
/** Same, but used to strip the prefix from a question stem. */
export const QUESTION_PREFIX_RE = /^\s*C[âa]u\s*\d+\s*(?:[(\[]\s*(?:NB|TH|VD|VDC)\s*[)\]])?\s*[:.\-–)]?\s*/i;

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
  items: {
    key: "a" | "b" | "c" | "d";
    text: string;
    correct: boolean;
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
        currentExplToks.push({ kind: "text", text: "\n", props: { red: false, underline: false, mono: false, bold: false } });
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
      // "a)" markers are accepted anywhere; "a." only at a paragraph start. Accept lowercase or uppercase.
      const { stem, options } = splitOptions(toks, "abcdABCD", ".)", true);
      let stemRich = tokensToRich(stem).trim().replace(QUESTION_PREFIX_RE, "");

      // Check if stem has a trailing [order, level] prefix meant for item a)
      let firstItemPrefix: { order: number; level: QuestionLevel } | null = null;
      const stemPrefixMatch = stemRich.match(/\[\s*(\d+)\s*,\s*(NB|TH|VD|VDC)\s*\]\s*$/i);
      if (stemPrefixMatch) {
        firstItemPrefix = {
          order: parseInt(stemPrefixMatch[1]),
          level: stemPrefixMatch[2].toUpperCase() as QuestionLevel,
        };
        stemRich = stemRich.slice(0, stemPrefixMatch.index).trim();
      }
      stemRich = stemRich.replace(/\[\s*\d+\s*,\s*(?:NB|TH|VD|VDC)\s*\]/gi, "").trim();

      type ExtractedItem = {
        key: "a" | "b" | "c" | "d";
        text: string;
        correct: boolean;
        level?: QuestionLevel | null;
        order?: number;
      };

      const rawItems: ExtractedItem[] = [];
      for (let i = 0; i < options.length; i++) {
        const o = options[i];
        let textRich = tokensToRich(o.toks).trim();
        let itemOrder: number | undefined;
        let itemLevel: QuestionLevel | null = null;

        if (i === 0 && firstItemPrefix) {
          itemOrder = firstItemPrefix.order;
          itemLevel = firstItemPrefix.level;
        }

        const leadingMatch = textRich.match(/^\s*\[\s*(\d+)\s*,\s*(NB|TH|VD|VDC)\s*\]\s*/i);
        if (leadingMatch) {
          itemOrder = parseInt(leadingMatch[1]);
          itemLevel = leadingMatch[2].toUpperCase() as QuestionLevel;
          textRich = textRich.slice(leadingMatch[0].length).trim();
        }

        rawItems.push({
          key: o.key.toLowerCase() as "a" | "b" | "c" | "d",
          text: textRich,
          correct: o.marked,
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

