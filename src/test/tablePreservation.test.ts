import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx, stripRich } from "@/lib/docxParser";
import { buildVariant } from "@/lib/shuffleEngine";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const t = (s: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

async function createDocxFile(bodyXml: string, extraFiles?: Record<string, string | Uint8Array>, images?: string[]) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W} ${M} ${R}><w:body>${bodyXml}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);

  const imgRels = (images || []).map((id, i) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${i}.png"/>`
  );

  const extraRels: string[] = [];
  if (extraFiles) {
    for (const [path, content] of Object.entries(extraFiles)) {
      zip.file(path, content);
      if (path.startsWith("word/embeddings/")) {
        const id = path.replace(/^.*\/([^.]+)\..*$/, "$1");
        extraRels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="${path.replace(/^word\//, "")}"/>`);
      }
    }
  }

  const relsContent = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...imgRels, ...extraRels].join("")}</Relationships>`;
  zip.file("word/_rels/document.xml.rels", relsContent);

  (images || []).forEach((_, i) => zip.file(`word/media/img${i}.png`, `FAKE-PNG-${i}`));

  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return {
    arrayBuffer: async () => blob,
  } as unknown as File;
}

describe("Table content and formatting preservation in DOCX", () => {
  it("preserves Python code indentation and blank lines in a table cell", async () => {
    const monoPr = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>${t("Chương trình Python", "<w:b/>")}</w:p>
          </w:tc>
          <w:tc>
            <w:p>${t("Kết quả in ra", "<w:b/>")}</w:p>
          </w:tc>
        </w:tr>
        <w:tr>
          <w:tc>
            <w:p>${t("def tinh_tong(n):", monoPr)}</w:p>
            <w:p>${t("    s = 0", monoPr)}</w:p>
            <w:p>${t("    for i in range(1, n + 1):", monoPr)}</w:p>
            <w:p>${t("        s += i", monoPr)}</w:p>
            <w:p></w:p>
            <w:p>${t("    return s", monoPr)}</w:p>
            <w:p>${t("print(tinh_tong(3))", monoPr)}</w:p>
          </w:tc>
          <w:tc>
            <w:p>${t("In ra số 6")}</w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Cho bảng sau:")}</w:p>
      ${tableXml}
      <w:p>${t("A. 3")}</w:p>
      <w:p>${t("*B. 6")}</w:p>
      <w:p>${t("C. 9")}</w:p>
      <w:p>${t("D. 12")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    expect(q.text).toContain("\u27E6TBL:");

    // Decode table payload
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    expect(match).toBeTruthy();
    const rows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toContain("<b>Chương trình Python</b>");

    // The code cell in row 1, col 0 must preserve indentation
    const codeCell = rows[1][0];
    expect(codeCell).toContain("\u27E6CODE:python:");
    const codeDecoded = decodeURIComponent(codeCell.replace(/^[^\u27E6]*\u27E6CODE:python:/, "").replace(/\u27E7.*$/, ""));
    expect(codeDecoded).toContain("    s = 0");
    expect(codeDecoded).toContain("        s += i");
    expect(codeDecoded).toContain("    return s");
  });

  it("preserves paragraph indentation defined via w:ind in table cells", async () => {
    // 720 twips = 4 spaces, 1440 twips = 8 spaces
    const ind4 = '<w:ind w:left="720"/>';
    const ind8 = '<w:ind w:left="1440"/>';
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>${t("if x > 0:")}</w:p>
            ${p(t("y = x * 2"), ind4)}
            ${p(t("print(y)"), ind8)}
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Cho đoạn mã:")}</w:p>
      ${tableXml}
      <w:p>${t("*A. Đúng")}</w:p>
      <w:p>${t("B. Sai")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    const rows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    const cell = rows[0][0];

    // Indentation of 4 spaces and 8 spaces was injected and preserved
    const decodedCell = decodeURIComponent(cell);
    expect(decodedCell).toMatch(/[ ]{4}y = x \* 2/);
    expect(decodedCell).toMatch(/[ ]{8}print\(y\)/);
  });

  it("preserves text formatting (bold, italic, underline, strike, sub, sup, color) in cells", async () => {
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>
              ${t("Văn bản ", "")}
              ${t("in đậm", "<w:b/>")}
              ${t(" và ", "")}
              ${t("in nghiêng", "<w:i/>")}
              ${t(" và ", "")}
              ${t("gạch chân", '<w:u w:val="single"/>')}
              ${t(" và ", "")}
              ${t("gạch xóa", "<w:strike/>")}
              ${t(" và chỉ số ", "")}
              ${t("2", '<w:vertAlign w:val="subscript"/>')}
              ${t(" và lũy thừa ", "")}
              ${t("3", '<w:vertAlign w:val="superscript"/>')}
              ${t(" và ", "")}
              ${t("chữ xanh", '<w:color w:val="0000FF"/>')}
            </w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Kiểm tra định dạng trong bảng:")}</w:p>
      ${tableXml}
      <w:p>${t("*A. Đầy đủ")}</w:p>
      <w:p>${t("B. Thiếu")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    const rows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    const cell = rows[0][0];

    expect(cell).toContain("<b>in đậm</b>");
    expect(cell).toContain("<i>in nghiêng</i>");
    expect(cell).toContain("<u>gạch chân</u>");
    expect(cell).toContain("<s>gạch xóa</s>");
    expect(cell).toContain("<sub>2</sub>");
    expect(cell).toContain("<sup>3</sup>");
    expect(cell).toContain('<span style="color:#0000FF">chữ xanh</span>');

    // stripRich correctly strips tags
    const stripped = stripRich(cell);
    expect(stripped).toContain("in đậm");
    expect(stripped).toContain("in nghiêng");
    expect(stripped).not.toContain("<b>");
  });

  it("preserves math formulas and equations in table cells", async () => {
    const ommlXml = `
      <m:oMath>
        <m:f>
          <m:fPr><m:type m:val="bar"/></m:fPr>
          <m:num><m:r><m:t>1</m:t></m:r></m:num>
          <m:den><m:r><m:t>2</m:t></m:r></m:den>
        </m:f>
      </m:oMath>
    `;
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>
              ${t("Biểu thức toán: ")}
              ${ommlXml}
            </w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Tính toán:")}</w:p>
      ${tableXml}
      <w:p>${t("*A. Đúng")}</w:p>
      <w:p>${t("B. Sai")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    const rows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    const cell = rows[0][0];

    expect(cell).toContain("\u27E6MATH:");
    expect(cell).toContain("\\frac{1}{2}");
  });

  it("preserves nested tables inside table cells", async () => {
    const nestedTableXml = `
      <w:tbl>
        <w:tr>
          <w:tc><w:p>${t("Ô lồng 1")}</w:p></w:tc>
          <w:tc><w:p>${t("Ô lồng 2")}</w:p></w:tc>
        </w:tr>
      </w:tbl>
    `;
    const outerTableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>${t("Bảng cha bên ngoài:")}</w:p>
            ${nestedTableXml}
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Cấu trúc lồng:")}</w:p>
      ${outerTableXml}
      <w:p>${t("*A. A")}</w:p>
      <w:p>${t("B. B")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    const outerRows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    const outerCell = outerRows[0][0];

    expect(outerCell).toContain("Bảng cha bên ngoài:");
    // Contains nested table sentinel
    expect(outerCell).toContain("\u27E6TBL:");

    const nestedMatch = outerCell.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    expect(nestedMatch).toBeTruthy();
    const nestedRows: string[][] = JSON.parse(decodeURIComponent(nestedMatch![1]));
    expect(nestedRows[0][0]).toBe("Ô lồng 1");
    expect(nestedRows[0][1]).toBe("Ô lồng 2");
  });

  it("preserves blank lines and multiple paragraphs without flattening or trimming", async () => {
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>${t("Đoạn 1")}</w:p>
            <w:p></w:p>
            <w:p>${t("   Đoạn 2 thụt đầu dòng 3 khoảng trắng")}</w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Văn bản nhiều dòng:")}</w:p>
      ${tableXml}
      <w:p>${t("*A. 1")}</w:p>
      <w:p>${t("B. 2")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    const match = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    const rows: string[][] = JSON.parse(decodeURIComponent(match![1]));
    const cell = rows[0][0];

    // Blank line between Đoạn 1 and Đoạn 2 is preserved
    expect(cell).toContain("Đoạn 1\n\n   Đoạn 2 thụt đầu dòng 3 khoảng trắng");
  });

  it("shuffles questions with tables intact and maintains correct answers", async () => {
    const monoPr = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>';
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Bảng 1")}</w:p>
      <w:tbl>
        <w:tr><w:tc><w:p>${t("x = 10", monoPr)}</w:p></w:tc></w:tr>
      </w:tbl>
      <w:p>${t("A. 5")}</w:p>
      <w:p>${t("*B. 10")}</w:p>
      <w:p>${t("C. 15")}</w:p>
      <w:p>${t("D. 20")}</w:p>
      <w:p>${t("Câu 2. Bảng 2")}</w:p>
      <w:tbl>
        <w:tr><w:tc><w:p>${t("y = 20", monoPr)}</w:p></w:tc></w:tr>
      </w:tbl>
      <w:p>${t("*A. 20")}</w:p>
      <w:p>${t("B. 25")}</w:p>
      <w:p>${t("C. 30")}</w:p>
      <w:p>${t("D. 35")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(2);

    const shuffled = buildVariant(parsed, {
      shuffleQuestions: true,
      shuffleAnswers: true,
    });

    expect(shuffled.partI.length).toBe(2);
    for (const q of shuffled.partI) {
      expect(q.text).toContain("\u27E6TBL:");
      // Correct answer is mapped to one of the 4 options
      expect(["A", "B", "C", "D"]).toContain(q.answer);
      // Selected answer corresponds to original correct value
      const correctOpt = q.options.find((o) => o.key === q.answer);
      expect(correctOpt).toBeTruthy();
    }
  });
});
