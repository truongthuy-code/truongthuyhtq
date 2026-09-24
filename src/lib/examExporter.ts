import {
  Document, Packer, Paragraph, TextRun, PageBreak, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, Footer, PageNumber, TabStopType,
  ShadingType, HeightRule, VerticalAlign,
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
  // Approx: 12pt TNR ~ 110 DXA per char. Content width 10206 DXA ~ 92 chars per row.
  const lens = options.map((o) => plain(o.text).length + 3); // "A. " prefix
  const max = Math.max(...lens);
  const total = lens.reduce((a, b) => a + b, 0);
  // 4/row: each cell width ≈ 22 chars; require max ≤ 20 and total ≤ 82
  if (max <= 20 && total <= 82) return 4;
  // 2/row: each cell ≈ 45 chars
  if (max <= 44) return 2;
  return 1;
}

function optionParagraphs(options: { key: string; text: string }[]): Paragraph[] {
  const layout = decideOptionLayout(options);
  const rows: Paragraph[] = [];
  if (layout === 4) {
    const step = Math.floor(CONTENT_W / 4);
    const tabStops = [
      { type: TabStopType.LEFT, position: step },
      { type: TabStopType.LEFT, position: step * 2 },
      { type: TabStopType.LEFT, position: step * 3 },
    ];
    const runs: TextRun[] = [];
    options.forEach((o, i) => {
      if (i > 0) runs.push(T("\t"));
      runs.push(T(`${o.key}. ${plain(o.text)}`));
    });
    rows.push(P(runs, { tabStops }));
  } else if (layout === 2) {
    const step = Math.floor(CONTENT_W / 2);
    const tabStops = [{ type: TabStopType.LEFT, position: step }];
    for (let i = 0; i < options.length; i += 2) {
      const runs: TextRun[] = [T(`${options[i].key}. ${plain(options[i].text)}`)];
      if (options[i + 1]) {
        runs.push(T("\t"));
        runs.push(T(`${options[i + 1].key}. ${plain(options[i + 1].text)}`));
      }
      rows.push(P(runs, { tabStops }));
    }
  } else {
    options.forEach((o) => {
      rows.push(P([T(`${o.key}. ${plain(o.text)}`)]));
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
  const emitQuestionHead = (num: number, text: string) =>
    P([T(`${meta.questionPrefix || "Câu"} ${num}: `, { bold: true }), T(plain(text))]);

  if (variant.partI.length) {
    out.push(P([T("PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partI.forEach((q) => {
      n++;
      out.push(emitQuestionHead(n, q.text));
      optionParagraphs(q.options).forEach((p) => out.push(p));
    });
  }

  if (variant.partII.length) {
    out.push(P([T("")], {}));
    out.push(P([T("PHẦN II. Câu trắc nghiệm đúng sai.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partII.forEach((q) => {
      n++;
      out.push(emitQuestionHead(n, q.text));
      q.items.forEach((it) => {
        out.push(P([T(`${it.key}) ${plain(it.text)}`)]));
      });
    });
  }

  if (variant.partIII.length) {
    out.push(P([T("")], {}));
    out.push(P([T("PHẦN III. TỰ LUẬN.", { bold: true })]));
    if (opts.renumberPerPart) n = 0;
    variant.partIII.forEach((q) => {
      n++;
      out.push(emitQuestionHead(n, q.text));
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
  return q.items.map((it: any) => (it.correct ? "Đ" : "S")).join("");
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
      if (i < nP1) cells.push(cell(v.partI[i].answer));
      else if (i < nP1 + nP2) cells.push(cell(tfCodeString(v.partII[i - nP1])));
      else cells.push(cell(plain(v.partIII[i - nP1 - nP2].answer)));
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
