/**
 * MathType MTEF (v5) → LaTeX converter.
 *
 * MathType 6.x / 7.x (ProgIDs `Equation.DSMT4`, `MathType 6.0 Equation`,
 * `MathType 7.0 Equation`, `Equation.DSMT6/7`) store the *structured* equation
 * data in an OLE stream named "Equation Native" inside the embedded OLE file.
 * This module decodes that binary stream into an AST and emits LaTeX so the
 * formula can be rendered with KaTeX (never as a bitmap).
 *
 * Port of the record/AST/LaTeX logic of https://github.com/zhexiao/mtef-go
 * (MIT) with additional templates and defensive parsing for the browser.
 *
 * SECURITY: pure binary reading — nothing is executed.
 */

import { MTEF_CHARS, SPECIAL_CHAR } from "./mtefChars";

/* ---------------------------------- types --------------------------------- */

const END = 0, LINE = 1, CHAR = 2, TMPL = 3, PILE = 4, MATRIX = 5, EMBELL = 6,
  RULER = 7, FONT_STYLE_DEF = 8, SIZE = 9, FULL = 10, SUB = 11, SUB2 = 12,
  SYM = 13, SUBSYM = 14, COLOR = 15, COLOR_DEF = 16, FONT_DEF = 17,
  EQN_PREFS = 18, ENCODING_DEF = 19, FUTURE = 100, ROOT = 255;

const OPT_NUDGE = 0x08;
const OPT_CHAR_EMBELL = 0x01;
const OPT_CHAR_ENC_CHAR_8 = 0x04;
const OPT_CHAR_ENC_CHAR_16 = 0x10;
const OPT_CHAR_ENC_NO_MTCODE = 0x20;
const OPT_LINE_NULL = 0x01;
const OPT_LP_RULER = 0x02;
const OPT_LINE_LSPACE = 0x04;
const OPT_COLOR_CMYK = 0x01;
const OPT_COLOR_NAME = 0x04;

// typefaces (value - 128)
const fnTEXT = 1, fnMTEXTRA = 11, fnSPACE = 24;

// template selectors
const tmANGLE = 0, tmPAREN = 1, tmBRACE = 2, tmBRACK = 3, tmBAR = 4,
  tmDBAR = 5, tmFLOOR = 6, tmCEILING = 7, tmOBRACK = 8, tmINTERVAL = 9,
  tmROOT = 10, tmFRACT = 11, tmUBAR = 12, tmOBAR = 13, tmARROW = 14,
  tmINTEG = 15, tmSUM = 16, tmPROD = 17, tmCOPROD = 18, tmUNION = 19,
  tmINTER = 20, tmINTOP = 21, tmSUMOP = 22, tmLIM = 23, tmHBRACE = 24,
  tmHBRACK = 25, tmLDIV = 26, tmSUB = 27, tmSUP = 28, tmSUBSUP = 29,
  tmDIRAC = 30, tmVEC = 31, tmTILDE = 32, tmHAT = 33, tmARC = 34,
  tmJSTATUS = 35, tmSTRIKE = 36;

type MtChar = { typeface: number; mtcode: number };
type MtTmpl = { selector: number; variation: number; options: number };
type MtMatrix = { rows: number; cols: number };
type MtLineV = { isNull: boolean };
type MtEmbellV = { embellType: number };

type Node = {
  tag: number;
  value?: MtChar | MtTmpl | MtMatrix | MtLineV | MtEmbellV;
  children: Node[];
};

export type MtefResult = {
  latex: string | null;
  mtefVersion: number | null;
  productVersion: string | null;
  application: string | null;
  error?: string;
};

/* --------------------------------- reader --------------------------------- */

class Reader {
  private p = 0;
  constructor(private b: Uint8Array) {}
  get eof() { return this.p >= this.b.length; }
  u8(): number { return this.p < this.b.length ? this.b[this.p++] : 0; }
  u16(): number { const v = this.u8(); return v | (this.u8() << 8); }
  skip(n: number) { this.p += n; }
  str(): string {
    let s = "";
    while (this.p < this.b.length) {
      const c = this.b[this.p++];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

/* ------------------------------ record parsing ----------------------------- */

function readNudge(r: Reader) {
  const b1 = r.u8(), b2 = r.u8();
  if (b1 === 128 || b2 === 128) { r.u16(); r.u16(); }
}

/**
 * Dimension arrays are nibble streams; each value ends with the 0x0f nibble.
 * We only need to skip `size` values.
 */
function readDimensionArrays(r: Reader, size: number) {
  let count = 0;
  let guard = 0;
  while (count < size && !r.eof && guard++ < 4096) {
    const ch = r.u8();
    if (((ch & 0xf0) >> 4) === 0x0f) count++;
    if (count >= size) break;
    if ((ch & 0x0f) === 0x0f) count++;
  }
}


/** Parses the MTEF byte stream into a flat node list. */
function readRecords(body: Uint8Array) {
  const r = new Reader(body);
  const mtefVer = r.u8();
  const platform = r.u8();
  const product = r.u8();
  const version = r.u8();
  const versionSub = r.u8();
  const application = r.str();
  r.u8(); // inline flag
  void platform; void product;

  const nodes: Node[] = [];
  let valid = true;
  let guard = 0;

  while (!r.eof && guard++ < 200000) {
    const rec = r.u8();
    if (rec >= FUTURE) { r.skip(r.u8()); continue; }
    switch (rec) {
      case END:
        nodes.push({ tag: END, children: [] });
        break;
      case LINE: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        if (options & OPT_LINE_LSPACE) r.u8();
        if (options & OPT_LP_RULER) {
          const n = r.u8();
          for (let i = 0; i < n; i++) { r.u8(); r.u16(); }
        }
        nodes.push({ tag: LINE, value: { isNull: !!(options & OPT_LINE_NULL) }, children: [] });
        break;
      }
      case CHAR: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        const typeface = r.u8();
        let mtcode = 0;
        if (!(options & OPT_CHAR_ENC_NO_MTCODE)) mtcode = r.u16();
        if (options & OPT_CHAR_ENC_CHAR_8) r.u8();
        if (options & OPT_CHAR_ENC_CHAR_16) r.u16();
        void OPT_CHAR_EMBELL;
        nodes.push({ tag: CHAR, value: { typeface, mtcode }, children: [] });
        break;
      }
      case TMPL: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        const selector = r.u8();
        const b1 = r.u8();
        let variation: number;
        if (b1 & 0x80) variation = (b1 & 0x7f) | (r.u8() << 8);
        else variation = b1;
        const tOptions = r.u8();
        nodes.push({ tag: TMPL, value: { selector, variation, options: tOptions }, children: [] });
        break;
      }
      case PILE: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        r.u8(); r.u8(); // halign, valign
        nodes.push({ tag: PILE, children: [] });
        break;
      }
      case MATRIX: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        r.u8(); r.u8(); r.u8(); // valign, h_just, v_just
        const rows = r.u8();
        const cols = r.u8();
        nodes.push({ tag: MATRIX, value: { rows, cols }, children: [] });
        // row/col partition bytes behave like two extra (empty) lines
        nodes.push({ tag: LINE, value: { isNull: false }, children: [] });
        nodes.push({ tag: LINE, value: { isNull: false }, children: [] });
        break;
      }
      case EMBELL: {
        const options = r.u8();
        if (options & OPT_NUDGE) readNudge(r);
        const embellType = r.u8();
        nodes.push({ tag: EMBELL, value: { embellType }, children: [] });
        break;
      }
      case FONT_STYLE_DEF:
        r.u8(); r.str();
        break;
      case SIZE:
        r.u8(); r.u8();
        break;
      case SUB: case SUB2: case SYM: case SUBSYM: case FULL:
        nodes.push({ tag: rec, children: [] });
        break;
      case FONT_DEF:
        r.u8(); r.str();
        break;
      case COLOR:
        r.u8();
        break;
      case COLOR_DEF: {
        const options = r.u8();
        const n = options & OPT_COLOR_CMYK ? 4 : 3;
        for (let i = 0; i < n; i++) r.u16();
        if (options & OPT_COLOR_NAME) r.str();
        break;
      }
      case EQN_PREFS: {
        r.u8(); // options
        readDimensionArrays(r, r.u8()); // sizes
        readDimensionArrays(r, r.u8()); // spaces
        const styleCount = r.u8();
        for (let i = 0; i < styleCount; i++) {
          const c = r.u8();
          if (c !== 0) r.u8();
        }
        break;
      }
      case ENCODING_DEF:
        r.str();
        break;
      case RULER: {
        const n = r.u8();
        for (let i = 0; i < n; i++) { r.u8(); r.u16(); }
        break;
      }
      default:
        valid = false;
        break;
    }
    if (!valid) break;
  }

  return {
    nodes,
    valid,
    mtefVer,
    application,
    productVersion: `${version}.${versionSub}`,
  };
}

/* --------------------------------- AST build ------------------------------- */

const EMB_PRE = new Set([2 /*1DOT*/, 9 /*HAT*/, 17 /*OBAR*/, 3 /*2DOT*/, 8 /*TILDE*/, 11, 12]);

function makeAst(nodes: Node[]): Node {
  const root: Node = { tag: ROOT, children: [] };
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1];

  for (const node of nodes) {
    switch (node.tag) {
      case LINE:
        top()?.children.push(node);
        if (!(node.value as MtLineV)?.isNull) stack.push(node);
        break;
      case TMPL:
      case PILE:
      case MATRIX:
        top()?.children.push(node);
        stack.push(node);
        break;
      case CHAR:
        top()?.children.push(node);
        break;
      case EMBELL: {
        const parent = top();
        parent?.children.push(node);
        const t = (node.value as MtEmbellV).embellType;
        if (EMB_PRE.has(t) && parent && parent.children.length >= 2) {
          const emb = parent.children.pop()!;
          const ch = parent.children.pop()!;
          parent.children.push(emb, ch);
        }
        stack.push(node);
        break;
      }
      case END:
        if (stack.length > 1) stack.pop();
        break;
      default:
        break;
    }
  }
  return root;
}

/* -------------------------------- LaTeX gen -------------------------------- */

const EMBELL_LATEX: Record<number, string> = {
  2: " \\dot ",
  3: " \\ddot ",
  4: " \\dddot ",
  5: "'",
  6: "''",
  8: " \\tilde ",
  9: " \\hat ",
  10: " \\not ",
  11: " \\vec ",
  12: " \\overleftarrow ",
  17: " \\bar ",
  18: "'''",
  16: " \\bar ",
  19: " \\frown ",
  20: " \\smile ",
  29: " \\underline ",
};

function charToLatex(c: MtChar): string {
  const { mtcode, typeface } = c;
  let out = mtcode ? String.fromCharCode(mtcode) : "";
  let hexExtend = "";
  let wrap: ((s: string) => string) | null = null;
  switch ((typeface - 128) & 0xff) {
    case fnMTEXTRA:
    case fnSPACE:
      hexExtend = "/mathmode";
      break;
    case fnTEXT:
      wrap = (s) => `{ \\rm{ ${s} } }`;
      break;
    default:
      break;
  }
  const hexKey = `char/0x${mtcode.toString(16).padStart(4, "0")}${hexExtend}`;
  const mapped = MTEF_CHARS[hexKey];
  if (mapped !== undefined) out = mapped;
  else if (SPECIAL_CHAR[out] !== undefined) out = SPECIAL_CHAR[out];
  return wrap ? wrap(out) : out;
}

function bigOp(op: string) {
  return (slots: string[], operator: string) => {
    const [main = "", lower = "", upper = ""] = slots;
    const o = operator || op;
    let s = o;
    if (lower) s += `\\limits_{ ${lower} }`;
    if (upper) s += `^{ ${upper} }`;
    if (main) s += `{ ${main} }`;
    return s;
  };
}

function makeLatex(ast: Node): string {
  switch (ast.tag) {
    case ROOT:
    case LINE:
      return ast.children.map(makeLatex).join("");
    case CHAR:
      return charToLatex(ast.value as MtChar);
    case EMBELL: {
      const t = (ast.value as MtEmbellV).embellType;
      return EMBELL_LATEX[t] ?? "";
    }
    case PILE:
      return ast.children.map(makeLatex).join(" \\\\ ");
    case MATRIX: {
      const cols = Math.max(1, (ast.value as MtMatrix).cols || 1);
      const cells = ast.children.slice(1).map(makeLatex);
      const rows: string[] = [];
      for (let i = 0; i < cells.length; i += cols) {
        rows.push(cells.slice(i, i + cols).join(" & "));
      }
      return ` \\begin{array}{${"c".repeat(cols)}} ${rows.join(" \\\\ ")} \\end{array} `;
    }
    case TMPL:
      return tmplLatex(ast);
    default:
      return ast.children.map(makeLatex).join("");
  }
}

function fence(ast: Node, dl: string, dr: string): string {
  const kids = ast.children.filter((c) => !(c.tag === LINE && (c.value as MtLineV)?.isNull));
  const slot = (i: number) => (kids[i] ? makeLatex(kids[i]) : "");
  const main = slot(0) || "\\;";
  const left = slot(1) || dl;
  const right = slot(2) || dr;
  return `\\left${left} { ${main} } \\right${right}`;
}


function tmplLatex(ast: Node): string {
  const tmpl = ast.value as MtTmpl;
  // Empty ("null") slots are placeholders (e.g. the base of a superscript that
  // is written before the template) — drop them so slot indexes line up.
  const kids = ast.children.filter((c) => !(c.tag === LINE && (c.value as MtLineV)?.isNull));
  const slot = (i: number) => (kids[i] ? makeLatex(kids[i]) : "");
  const v = tmpl.variation;


  switch (tmpl.selector) {
    case tmANGLE: return fence(ast, "\\langle", "\\rangle");
    case tmPAREN: return fence(ast, "(", ")");
    case tmBRACK: return fence(ast, "[", "]");
    case tmBAR: return fence(ast, "|", "|");
    case tmDBAR: return fence(ast, "\\|", "\\|");
    case tmFLOOR: return fence(ast, "\\lfloor", "\\rfloor");
    case tmCEILING: return fence(ast, "\\lceil", "\\rceil");
    case tmOBRACK: return fence(ast, "[", "]");
    case tmINTERVAL: return fence(ast, "(", ")");
    case tmBRACE: {
      const main = slot(0);
      const left = slot(1) || "\\{";
      const right = slot(2) || ".";
      return `\\left${left} \\begin{array}{l} ${main} \\end{array} \\right${right}`;
    }
    case tmROOT: {
      const main = slot(0);
      const idx = slot(1);
      return idx ? `\\sqrt[ ${idx} ]{ ${main} }` : `\\sqrt{ ${main} }`;
    }
    case tmFRACT: {
      const num = slot(0), den = slot(1);
      if (v & 0x0002) return `{ ${num} } / { ${den} }`;
      return `\\frac{ ${num} }{ ${den} }`;
    }
    case tmUBAR: return `\\underline{ ${slot(0)} }`;
    case tmOBAR: return `\\overline{ ${slot(0)} }`;
    case tmARROW: {
      const top = slot(0), bottom = slot(1);
      let cmd = v & 0x0001 ? "\\xLeftrightarrow" : "\\xrightarrow";
      if (!(v & 0x0001)) cmd = v & 0x0010 ? "\\xleftarrow" : "\\xrightarrow";
      const below = bottom ? `[ ${bottom} ]` : "";
      return `${cmd}${below}{ ${top} }`;
    }
    case tmINTEG: {
      let op = "\\int";
      const n = v & 0x0003;
      if (n === 2) op = "\\iint";
      else if (n === 3) op = "\\iiint";
      if (v & 0x0004) op = "\\oint";
      return bigOp(op)([slot(0), slot(1), slot(2)], "");
    }
    case tmSUM: return bigOp("\\sum")([slot(0), slot(1), slot(2)], "");
    case tmPROD: return bigOp("\\prod")([slot(0), slot(1), slot(2)], "");
    case tmCOPROD: return bigOp("\\coprod")([slot(0), slot(1), slot(2)], "");
    case tmUNION: return bigOp("\\bigcup")([slot(0), slot(1), slot(2)], "");
    case tmINTER: return bigOp("\\bigcap")([slot(0), slot(1), slot(2)], "");
    case tmINTOP:
    case tmSUMOP: return bigOp("")([slot(0), slot(1), slot(2)], slot(3));
    case tmLIM: {
      const main = slot(0), lower = slot(1);
      let s = main ? `\\mathop{ ${main} }` : "";
      if (lower) s += `\\limits_{ ${lower} }`;
      return s;
    }
    case tmHBRACE: {
      const main = slot(0), extra = slot(1);
      const cmd = v & 0x0001 ? "\\overbrace" : "\\underbrace";
      const pos = v & 0x0001 ? "^" : "_";
      return extra ? `${cmd}{ ${main} }${pos}{ ${extra} }` : `${cmd}{ ${main} }`;
    }
    case tmHBRACK: {
      const main = slot(0);
      return v & 0x0001 ? `\\overbrace{ ${main} }` : `\\underbrace{ ${main} }`;
    }
    case tmLDIV: return `${slot(1)} \\overline{ ) ${slot(0)} }`;
    case tmSUB: {
      const sub = slot(0);
      return sub ? `_{ ${sub} }` : "";
    }
    case tmSUP: {
      const sup = slot(0);
      return sup ? `^{ ${sup} }` : "";
    }
    case tmSUBSUP: {
      const sub = slot(0), sup = slot(1);
      return `${sub ? `_{ ${sub} }` : ""}${sup ? `^{ ${sup} }` : ""}`;
    }
    case tmDIRAC: {
      const l = slot(0), r = slot(1);
      if (l && r) return `\\left\\langle ${l} \\middle| ${r} \\right\\rangle`;
      if (l) return `\\left\\langle ${l} \\right|`;
      return `\\left| ${r} \\right\\rangle`;
    }
    case tmVEC: {
      const main = slot(0);
      if (v & 0x0004) return `\\underset{\\leftrightarrow}{ ${main} }`;
      if (v & 0x0001 && !(v & 0x0002)) return `\\overleftarrow{ ${main} }`;
      if (v & 0x0001 && v & 0x0002) return `\\overleftrightarrow{ ${main} }`;
      return `\\overrightarrow{ ${main} }`;
    }
    case tmTILDE: return `\\widetilde{ ${slot(0)} }`;
    case tmHAT: return `\\widehat{ ${slot(0)} }`;
    case tmARC: return `\\overparen{ ${slot(0)} }`;
    case tmJSTATUS: return `\\overline{ ${slot(0)} }`;
    case tmSTRIKE: return `\\cancel{ ${slot(0)} }`;
    default:
      // Unknown template: keep the content so no text is lost.
      return ast.children.map(makeLatex).join(" ");
  }
}

const FUNC_NAMES = ["arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lim", "exp", "max", "min", "gcd", "det"];

/** Cosmetic clean-up so the LaTeX is idiomatic and KaTeX-friendly. */
function tidy(s: string): string {
  let out = s;
  // merge split scripts: ^{a}^{b} → ^{a b}
  for (let i = 0; i < 4; i++) {
    out = out
      .replace(/\^\{\s*([^{}]*?)\s*\}\s*\^\{\s*([^{}]*?)\s*\}/g, "^{ $1$2 }")
      .replace(/_\{\s*([^{}]*?)\s*\}\s*_\{\s*([^{}]*?)\s*\}/g, "_{ $1$2 }");
  }
  // operator names
  for (const f of FUNC_NAMES) {
    out = out.replace(new RegExp(`(^|[^\\\\A-Za-z])${f}`, "g"), `$1\\${f} `);
  }
  return out.replace(/\s+/g, " ").trim();
}

/* ---------------------------------- public --------------------------------- */


/** Strips the 28-byte EQNOLEFILEHDR from an "Equation Native" stream. */
export function stripEqnOleHeader(stream: Uint8Array): Uint8Array | null {
  if (stream.length < 28) return null;
  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const cbHdr = dv.getUint16(0, true);
  if (cbHdr !== 28) return null;
  const cbSize = dv.getUint32(8, true);
  const end = Math.min(stream.length, 28 + cbSize);
  return stream.subarray(28, end);
}

/** Converts an "Equation Native" stream (with header) into LaTeX. */
export function equationNativeToLatex(stream: Uint8Array): MtefResult {
  const body = stripEqnOleHeader(stream);
  if (!body || body.length === 0) {
    return { latex: null, mtefVersion: null, productVersion: null, application: null, error: "invalid EQNOLEFILEHDR" };
  }
  try {
    const parsed = readRecords(body);
    if (parsed.mtefVer !== 5) {
      return {
        latex: null,
        mtefVersion: parsed.mtefVer,
        productVersion: parsed.productVersion,
        application: parsed.application,
        error: `unsupported MTEF version ${parsed.mtefVer}`,
      };
    }
    const ast = makeAst(parsed.nodes);
    const latex = tidy(makeLatex(ast).replace(/\s+/g, " ").trim());
    if (!latex) {
      return {
        latex: null,
        mtefVersion: parsed.mtefVer,
        productVersion: parsed.productVersion,
        application: parsed.application,
        error: "empty conversion result",
      };
    }
    return {
      latex,
      mtefVersion: parsed.mtefVer,
      productVersion: parsed.productVersion,
      application: parsed.application,
      error: parsed.valid ? undefined : "partial parse (unknown record)",
    };
  } catch (e) {
    return {
      latex: null,
      mtefVersion: null,
      productVersion: null,
      application: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
