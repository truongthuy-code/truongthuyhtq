import {
  Document, Packer, Paragraph, TextRun, PageBreak, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, Footer, PageNumber, TabStopType,
  ShadingType, HeightRule, VerticalAlign, Math as DMath, MathRun, ImageRun,
  UnderlineType,
} from "docx";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import type { ParsedExam } from "./docxParser";
import { stripRich } from "./docxParser";

export type ExamMeta = {
  agency: string;      // SỞ GD&ĐT ...
  unit: string;        // TRƯỜNG THPT ...
  session: string;     // KIỂM TRA ...
  subject: string;     // MÔN ...
  duration: string;    // phút
  questionPrefix: string;
};

export type ExportOptions = {
  renumberPerPart: boolean;
  singleFile: boolean;
  answersAsTable: boolean;
};

// ---------- Page / typography constants ----------
const FONT = "Times New Roman";
const SIZE = 24;              // 12pt (docx uses half-points)
const BLACK = "000000";
// A4
const PAGE_W = 11906;
const PAGE_H = 16838;
// Margins (inches -> DXA, 1in = 1440)
const M_TOP = 446;      // 0.31"
const M_BOTTOM = 446;   // 0.31"
const M_LEFT = 576;     // 0.40"
const M_RIGHT = 562;    // 0.39"
const CONTENT_W = PAGE_W - M_LEFT - M_RIGHT; // 10206 DXA

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function plain(s: string): string { return stripRich(s || ""); }

function T(text: string, opts: { bold?: boolean; italics?: boolean; allCaps?: boolean } = {}) {
  return new TextRun({ text, bold: opts.bold, italics: opts.italics, allCaps: opts.allCaps, font: FONT, size: SIZE, color: BLACK });
}

function P(children: any[], opts: { alignment?: any; tabStops?: any[]; spacingBefore?: number; spacingAfter?: number } = {}) {
  return new Paragraph({
    alignment: opts.alignment,
    tabStops: opts.tabStops,
    spacing: { before: opts.spacingBefore ?? 0, after: opts.spacingAfter ?? 0, line: 240, lineRule: "auto" as any },
    children,
  });
}

function parseDataUrl(dataUrl: string): { data: Uint8Array; type: "png" | "jpg" | "gif" | "svg" } | null {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return null;
  const match = dataUrl.match(/^data:image\/(png|jpe?g|gif|svg\+xml);base64,(.+)$/i);
  if (!match) return null;
  const rawType = match[1].toLowerCase();
  const type = rawType.includes("jp") ? "jpg" : rawType.includes("png") ? "png" : rawType.includes("gif") ? "gif" : "png";
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { data: bytes, type };
  } catch {
    return null;
  }
}

const SENT_OPEN = "\u27E6";
const SENT_CLOSE = "\u27E7";

type RichTok =
  | { kind: "text"; text: string }
  | { kind: "math"; latex: string }
  | { kind: "img"; src: string }
  | { kind: "tbl"; rows: string[][] }
  | { kind: "code"; content: string };

function tokenizeRich(s: string): RichTok[] {
  const out: RichTok[] = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf(SENT_OPEN, i);
    if (open === -1) {
      if (i < s.length) out.push({ kind: "text", text: s.slice(i) });
      break;
    }
    if (open > i) out.push({ kind: "text", text: s.slice(i, open) });
    const close = s.indexOf(SENT_CLOSE, open);
    if (close === -1) {
      out.push({ kind: "text", text: s.slice(open) });
      break;
    }
    const payload = s.slice(open + 1, close);
    if (payload.startsWith("MATH:")) {
      out.push({ kind: "math", latex: payload.slice(5) });
    } else if (payload.startsWith("IMG:")) {
      out.push({ kind: "img", src: decodeURIComponent(payload.slice(4)) });
    } else if (payload.startsWith("TBL:")) {
      try {
        out.push({ kind: "tbl", rows: JSON.parse(decodeURIComponent(payload.slice(4))) });
      } catch {
        out.push({ kind: "text", text: "" });
      }
    } else if (payload.startsWith("CODE:")) {
      const rest = payload.slice(5);
      const sep = rest.indexOf(":");
      out.push({ kind: "code", content: sep === -1 ? "" : decodeURIComponent(rest.slice(sep + 1)) });
    } else {
      out.push({ kind: "text", text: s.slice(open, close + 1) });
    }
    i = close + 1;
  }
  return out;
}

function parseHtmlTextRuns(text: string, baseOpts: { bold?: boolean; italics?: boolean } = {}): any[] {
  if (!text) return [];
  const tagRe = /<\/?([a-zA-Z0-9]+)(?:\s+style=["']color:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)["'])?[^>]*>/g;
  if (!tagRe.test(text)) {
    const clean = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    return [T(clean, baseOpts)];
  }

  tagRe.lastIndex = 0;
  const runs: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  let bold = !!baseOpts.bold;
  let italics = !!baseOpts.italics;
  let underline = false;
  let strike = false;
  let subScript = false;
  let superScript = false;
  let color = BLACK;
  let highlight: string | undefined;

  const pushSegment = (seg: string) => {
    if (!seg) return;
    const clean = seg
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    runs.push(
      new TextRun({
        text: clean,
        bold,
        italics,
        strike,
        subScript,
        superScript,
        underline: underline ? { type: UnderlineType.SINGLE } : undefined,
        color,
        highlight,
        font: FONT,
        size: SIZE,
      })
    );
  };

  while ((m = tagRe.exec(text)) !== null) {
    if (m.index > last) {
      pushSegment(text.slice(last, m.index));
    }
    const isClose = m[0].startsWith("</");
    const tag = m[1].toLowerCase();
    if (tag === "b" || tag === "strong") bold = !isClose;
    else if (tag === "i" || tag === "em") italics = !isClose;
    else if (tag === "u") underline = !isClose;
    else if (tag === "s" || tag === "strike" || tag === "del") strike = !isClose;
    else if (tag === "sub") subScript = !isClose;
    else if (tag === "sup") superScript = !isClose;
    else if (tag === "mark") highlight = isClose ? undefined : "yellow";
    else if (tag === "span") {
      if (isClose) color = BLACK;
      else if (m[2]) {
        color = m[2].replace("#", "");
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    pushSegment(text.slice(last));
  }
  return runs;
}

function parseRichRuns(s: string, baseOpts: { bold?: boolean; italics?: boolean } = {}): any[] {
  const toks = tokenizeRich(s || "");
  const runs: any[] = [];

  for (const tok of toks) {
    if (tok.kind === "text") {
      const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\\w])\$([^\$\n]+?)\$(?![\w])/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(tok.text)) !== null) {
        if (m.index > last) {
          runs.push(...parseHtmlTextRuns(tok.text.slice(last, m.index), baseOpts));
        }
        const latex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
        if (latex) {
          runs.push(new DMath({ children: [new MathRun(latex)] }));
        }
        last = m.index + m[0].length;
      }
      if (last < tok.text.length) {
        runs.push(...parseHtmlTextRuns(tok.text.slice(last), baseOpts));
      }
    } else if (tok.kind === "math") {
      runs.push(new DMath({ children: [new MathRun(tok.latex)] }));
    } else if (tok.kind === "img") {
      const parsed = parseDataUrl(tok.src);
      if (parsed) {
        runs.push(new ImageRun({
          data: parsed.data,
          transformation: { width: 280, height: 180 },
          type: parsed.type,
        }));
      }
    } else if (tok.kind === "code") {
      runs.push(new TextRun({ text: tok.content, font: "Consolas", size: 20, color: "1E293B" }));
    }
  }
  return runs;
}

function renderCellToChildren(cell: string, colW: number): (Paragraph | Table)[] {
  if (!cell || !cell.trim()) {
    return [P([])];
  }
  const toks = tokenizeRich(cell);
  const out: (Paragraph | Table)[] = [];
  let currentRuns: any[] = [];

  const flushRuns = () => {
    if (currentRuns.length > 0) {
      out.push(P(currentRuns, { spacingBefore: 40, spacingAfter: 40 }));
      currentRuns = [];
    }
  };

  for (const tok of toks) {
    if (tok.kind === "tbl") {
      flushRuns();
      if (tok.rows && tok.rows.length > 0) {
        const nCols = Math.max(...tok.rows.map((r) => r.length), 1);
        const subW = Math.floor(Math.max(colW - 160, 400) / nCols);
        const border = { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" };
        const borders = { top: border, bottom: border, left: border, right: border };
        const subTable = new Table({
          width: { size: Math.max(colW - 160, 400), type: WidthType.DXA },
          columnWidths: Array(nCols).fill(subW),
          rows: tok.rows.map((r) =>
            new TableRow({
              children: r.map((c) =>
                new TableCell({
                  borders,
                  margins: { top: 40, bottom: 40, left: 60, right: 60 },
                  width: { size: subW, type: WidthType.DXA },
                  children: renderCellToChildren(c, subW),
                })
              ),
            })
          ),
        });
        out.push(subTable);
      }
    } else if (tok.kind === "code") {
      flushRuns();
      const codeLines = tok.content.split("\n");
      for (const line of codeLines) {
        out.push(
          P([new TextRun({ text: line, font: "Consolas", size: 19, color: "1E293B" })], {
            spacingBefore: 20,
            spacingAfter: 20,
          })
        );
      }
    } else if (tok.kind === "img") {
      const parsed = parseDataUrl(tok.src);
      if (parsed) {
        flushRuns();
        out.push(
          P([new ImageRun({
            data: parsed.data,
            transformation: { width: Math.min(240, Math.max(80, Math.floor(colW / 25))), height: 140 },
            type: parsed.type,
          })], { alignment: AlignmentType.CENTER, spacingBefore: 60, spacingAfter: 60 })
        );
      }
    } else if (tok.kind === "math") {
      currentRuns.push(new DMath({ children: [new MathRun(tok.latex)] }));
    } else if (tok.kind === "text") {
      const lines = tok.text.split("\n");
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        if (lIdx > 0) flushRuns();
        const line = lines[lIdx];
        if (line) {
          const runs = parseRichRuns(line);
          currentRuns.push(...runs);
        }
      }
    }
  }

  flushRuns();
  if (out.length === 0) {
    out.push(P([]));
  }
  return out;
}

function renderRichBlock(prefixRuns: any[], richText: string): (Paragraph | Table)[] {
  const toks = tokenizeRich(richText || "");
  const out: (Paragraph | Table)[] = [];
  let currentRuns: any[] = [...prefixRuns];

  const flushRuns = () => {
    if (currentRuns.length > 0) {
      out.push(P(currentRuns));
      currentRuns = [];
    }
  };

  for (const tok of toks) {
    if (tok.kind === "tbl") {
      flushRuns();
      if (tok.rows && tok.rows.length > 0) {
        const numCols = Math.max(...tok.rows.map((r) => r.length), 1);
        const colW = Math.floor(CONTENT_W / numCols);
        const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
        const borders = { top: border, bottom: border, left: border, right: border };
        const table = new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: Array(numCols).fill(colW),
          rows: tok.rows.map((row) =>
            new TableRow({
              children: row.map((cell) =>
                new TableCell({
                  borders,
                  margins: { top: 60, bottom: 60, left: 80, right: 80 },
                  width: { size: colW, type: WidthType.DXA },
                  children: renderCellToChildren(cell, colW),
                })
              ),
            })
          ),
        });
        out.push(table);
      }
    } else if (tok.kind === "img") {
      const parsed = parseDataUrl(tok.src);
      if (parsed) {
        flushRuns();
        out.push(P([new ImageRun({
          data: parsed.data,
          transformation: { width: 320, height: 200 },
          type: parsed.type,
        })], { alignment: AlignmentType.CENTER, spacingBefore: 120, spacingAfter: 120 }));
      }
    } else if (tok.kind === "math") {
      currentRuns.push(new DMath({ children: [new MathRun(tok.latex)] }));
    } else if (tok.kind === "code") {
      currentRuns.push(new TextRun({ text: tok.content, font: "Consolas", size: 20, color: "1E293B" }));
    } else if (tok.kind === "text") {
      const lines = tok.text.split("\n");
      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        if (lIdx > 0) flushRuns();
        const line = lines[lIdx];
        if (line) {
          const runs = parseRichRuns(line);
          currentRuns.push(...runs);
        }
      }
    }
  }

  flushRuns();
  return out;
}

// ---------- Header (two columns) ----------
function buildHeader(meta: ExamMeta, pageCount: number): Table {
  const leftCellChildren: Paragraph[] = [
    P([T(meta.agency || "", { bold: true })], { alignment: AlignmentType.CENTER }),
    P([T(meta.unit || "", { bold: true })], { alignment: AlignmentType.CENTER }),
    P([T("")], {}),
    P([T("ĐỀ CHÍNH THỨC", { bold: true })], { alignment: AlignmentType.CENTER }),
    P([T(`(Đề có ${pageCount} trang)`, { italics: true })], { alignment: AlignmentType.CENTER }),
  ];
  const rightCellChildren: Paragraph[] = [
    P([T((meta.session || "").toUpperCase(), { bold: true })], { alignment: AlignmentType.CENTER }),
    P([T("")], {}),
    P([T(`MÔN ${(meta.subject || "").toUpperCase()}`, { bold: true })], { alignment: AlignmentType.CENTER }),
    P([T("")], {}),
    P([T(`Thời gian làm bài: ${meta.duration || ""} phút`)], { alignment: AlignmentType.CENTER }),
  ];

  const halfW = Math.floor(CONTENT_W / 2);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [halfW, CONTENT_W - halfW],
    borders: NO_BORDERS as any,
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: halfW, type: WidthType.DXA }, borders: NO_BORDERS as any, verticalAlign: VerticalAlign.CENTER, children: leftCellChildren }),
          new TableCell({ width: { size: CONTENT_W - halfW, type: WidthType.DXA }, borders: NO_BORDERS as any, verticalAlign: VerticalAlign.CENTER, children: rightCellChildren }),
        ],
      }),
    ],
  });
}

// ---------- Options layout ----------
function decideOptionLayout(options: { key: string; text: string }[]): 4 | 2 | 1 {
  const hasComplex = options.some((o) =>
    /[\u27E6](IMG|TBL|CODE):/.test(o.text) || o.text.includes("\n")
  );
  if (hasComplex) return 1;

  const lens = options.map((o) => plain(o.text).length + 3); // "A. " prefix
  const max = Math.max(...lens);
  const total = lens.reduce((a, b) => a + b, 0);
  if (max <= 20 && total <= 82) return 4;
  if (max <= 44) return 2;
  return 1;
}

function optionParagraphs(options: { key: string; text: string }[]): (Paragraph | Table)[] {
  const layout = decideOptionLayout(options);
  const rows: (Paragraph | Table)[] = [];
  if (layout === 4) {
    const step = Math.floor(CONTENT_W / 4);
    const tabStops = [
      { type: TabStopType.LEFT, position: step },
      { type: TabStopType.LEFT, position: step * 2 },
      { type: TabStopType.LEFT, position: step * 3 },
    ];
    const runs: any[] = [];
    options.forEach((o, i) => {
      if (i > 0) runs.push(T("\t"));
      runs.push(T(`${o.key}. `, { bold: true }));
      runs.push(...parseRichRuns(o.text));
    });
    rows.push(P(runs, { tabStops }));
  } else if (layout === 2) {
    const step = Math.floor(CONTENT_W / 2);
    const tabStops = [{ type: TabStopType.LEFT, position: step }];
    for (let i = 0; i < options.length; i += 2) {
      const runs: any[] = [T(`${options[i].key}. `, { bold: true }), ...parseRichRuns(options[i].text)];
      if (options[i + 1]) {
        runs.push(T("\t"));
        runs.push(T(`${options[i + 1].key}. `, { bold: true }));
        runs.push(...parseRichRuns(options[i + 1].text));
      }
      rows.push(P(runs, { tabStops }));
    }
  } else {
    options.forEach((o) => {
      const blocks = renderRichBlock([T(`${o.key}. `, { bold: true })], o.text);
      blocks.forEach((b) => rows.push(b));
    });
  }
  return rows;
}

// ---------- Exam body ----------
function buildExamChildren(variant: ParsedExam, code: string, meta: ExamMeta, opts: ExportOptions, pageCount: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  out.push(buildHeader(meta, pageCount));
  out.push(P([T("")], {}));

  // Student info line
  const nameTabStops = [{ type: TabStopType.RIGHT, position: CONTENT_W }];
  out.push(P(
    [
      T("Họ tên thí sinh: ......................................................................"),
      T("\t"),
      T("Số báo danh: ......................"),
    ],
    { tabStops: nameTabStops }
  ));
  out.push(P([T(`Mã đề thi ${code}`, { bold: true })], { alignment: AlignmentType.RIGHT }));
  out.push(P([T("")], {}));

  let n = 0;

  if (variant.partI.length) {
    out.push(P([T("PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partI.forEach((q) => {
      n++;
      const qBlocks = renderRichBlock([T(`${meta.questionPrefix || "Câu"} ${n}: `, { bold: true })], q.text);
      qBlocks.forEach((b) => out.push(b));
      optionParagraphs(q.options).forEach((p) => out.push(p));
    });
  }

  if (variant.partII.length) {
    out.push(P([T("")], {}));
    out.push(P([T("PHẦN II. Câu trắc nghiệm đúng sai.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partII.forEach((q) => {
      n++;
      const qBlocks = renderRichBlock([T(`${meta.questionPrefix || "Câu"} ${n}: `, { bold: true })], q.text);
      qBlocks.forEach((b) => out.push(b));
      q.items.forEach((it) => {
        const itBlocks = renderRichBlock([T(`${it.key}) `, { bold: true })], it.text);
        itBlocks.forEach((b) => out.push(b));
      });
    });
  }

  if (variant.partIII.length) {
    out.push(P([T("")], {}));
    out.push(P([T("PHẦN III. TỰ LUẬN / TRẢ LỜI NGẮN.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partIII.forEach((q) => {
      n++;
      const qBlocks = renderRichBlock([T(`${meta.questionPrefix || "Câu"} ${n}: `, { bold: true })], q.text);
      qBlocks.forEach((b) => out.push(b));
    });
  }

  out.push(P([T("")], {}));
  out.push(P([T("-------------- HẾT ---------------", { bold: true })], { alignment: AlignmentType.CENTER }));

  return out;
}

// ---------- Section per variant ----------
function sectionFor(variant: ParsedExam, code: string, meta: ExamMeta, opts: ExportOptions) {
  const pageCount = 1; // parser doesn't know real page count; kept as placeholder
  const children = buildExamChildren(variant, code, meta, opts, pageCount);

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 0 },
        children: [
          T(`Mã đề thi ${code} - Trang `),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE, color: BLACK }),
          new TextRun({ text: "/", font: FONT, size: SIZE, color: BLACK }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SIZE, color: BLACK }),
        ],
      }),
    ],
  });

  return {
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: M_TOP, right: M_RIGHT, bottom: M_BOTTOM, left: M_LEFT },
      },
    },
    footers: { default: footer },
    children,
  };
}

async function buildDoc(sections: any[]): Promise<Blob> {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: SIZE, color: BLACK } } },
    },
    sections,
  });
  return await Packer.toBlob(doc);
}

export async function exportExams(variants: ParsedExam[], codes: string[], meta: ExamMeta, opts: ExportOptions, baseName: string) {
  if (opts.singleFile) {
    const sections = variants.map((v, i) => sectionFor(v, codes[i], meta, opts));
    const blob = await buildDoc(sections);
    saveAs(blob, `${baseName}_all.docx`);
  } else {
    const zip = new JSZip();
    for (let i = 0; i < variants.length; i++) {
      const blob = await buildDoc([sectionFor(variants[i], codes[i], meta, opts)]);
      zip.file(`${codes[i]}.docx`, blob);
    }
    const zblob = await zip.generateAsync({ type: "blob" });
    saveAs(zblob, `${baseName}_variants.zip`);
  }
}

// ---------- Answer key ----------
function tfCodeString(q: any): string {
  return q.items.map((it: any) => (it.correct === true ? "Đ" : it.correct === false ? "S" : "-")).join("");
}

export async function buildAnswerKeyBlob(variants: ParsedExam[], codes: string[]): Promise<Blob> {
  const nP1 = variants[0]?.partI.length || 0;
  const nP2 = variants[0]?.partII.length || 0;
  const nP3 = variants[0]?.partIII.length || 0;

  const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, bold = false) =>
    new TableCell({
      borders,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      width: { size: 1500, type: WidthType.DXA },
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [T(text, { bold })] })],
    });

  const rows: TableRow[] = [];
  rows.push(new TableRow({ children: [cell("Câu", true), ...codes.map((c) => cell(c, true))] }));

  const total = nP1 + nP2 + nP3;
  for (let i = 0; i < total; i++) {
    const cells = [cell(String(i + 1), true)];
    variants.forEach((v) => {
      if (i < nP1) cells.push(cell(v.partI[i].answer || "-"));
      else if (i < nP1 + nP2) cells.push(cell(tfCodeString(v.partII[i - nP1])));
      else cells.push(cell(plain(v.partIII[i - nP1 - nP2].answer || "-")));
    });
    rows.push(new TableRow({ children: cells }));
  }

  const table = new Table({
    width: { size: 1500 * (codes.length + 1), type: WidthType.DXA },
    columnWidths: Array(codes.length + 1).fill(1500),
    rows,
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE, color: BLACK } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: M_TOP, right: M_RIGHT, bottom: M_BOTTOM, left: M_LEFT } } },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [T("BẢNG ĐÁP ÁN", { bold: true })] }),
        table,
      ],
    }],
  });
  return await Packer.toBlob(doc);
}

export async function exportAnswerKey(variants: ParsedExam[], codes: string[], baseName: string) {
  const blob = await buildAnswerKeyBlob(variants, codes);
  saveAs(blob, `${baseName}_dap_an.docx`);
}

/**
 * Gộp chức năng xuất đề và xuất đáp án thành một lệnh duy nhất.
 * Tạo file ZIP chứa toàn bộ đề thi đã sinh và bảng đáp án tương ứng chính xác.
 */
export async function exportExamsAndKey(
  variants: ParsedExam[],
  codes: string[],
  meta: ExamMeta,
  opts: ExportOptions,
  baseName: string
) {
  const zip = new JSZip();

  // 1. Xuất file đề thi
  if (variants.length === 1) {
    const singleDocBlob = await buildDoc([sectionFor(variants[0], codes[0], meta, opts)]);
    zip.file(`${baseName}_De_${codes[0]}.docx`, singleDocBlob);
  } else if (opts.singleFile) {
    const sections = variants.map((v, i) => sectionFor(v, codes[i], meta, opts));
    const allDocBlob = await buildDoc(sections);
    zip.file(`${baseName}_De_tat_ca_ma_de.docx`, allDocBlob);
  } else {
    for (let i = 0; i < variants.length; i++) {
      const vDocBlob = await buildDoc([sectionFor(variants[i], codes[i], meta, opts)]);
      zip.file(`De_Ma_${codes[i]}.docx`, vDocBlob);
    }
  }

  // 2. Xuất bảng đáp án chính xác tương ứng từng mã đề
  const keyBlob = await buildAnswerKeyBlob(variants, codes);
  const keyFileName = variants.length === 1
    ? `${baseName}_Dap_an_Ma_${codes[0]}.docx`
    : `${baseName}_Bang_dap_an.docx`;
  zip.file(keyFileName, keyBlob);

  // 3. Tải về file ZIP chứa trọn bộ đề và đáp án trong 1 lần click
  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, `${baseName}_de_va_dap_an.zip`);
}

export function plainForExport(s: string) { return plain(s); }
