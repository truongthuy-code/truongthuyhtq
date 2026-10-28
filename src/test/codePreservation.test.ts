import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx } from "@/lib/docxParser";
import { parseTextExam } from "@/lib/textExamParser";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const t = (s: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(s)}</w:t></w:r>`;
const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

async function createDocxFile(bodyXml: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W} ${M} ${R}><w:body>${bodyXml}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const relsContent = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file("word/_rels/document.xml.rels", relsContent);

  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return {
    arrayBuffer: async () => blob,
  } as unknown as File;
}

function extractCodeFromRich(text: string): { lang: string; content: string } | null {
  const m = text.match(/\u27E6CODE:([^:]+):([^\u27E7]+)\u27E7/);
  if (!m) return null;
  return {
    lang: m[1],
    content: decodeURIComponent(m[2]),
  };
}

describe("Comprehensive Code Preservation Pipeline (Python, HTML, SQL)", () => {
  // Test 1: Python đơn giản
  it("Test 1 - Preserves simple Python code with newline and indentation in stem", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 1. Cho đoạn mã Python sau:")}</w:p>
      <w:p>${t("for i in range(5):")}</w:p>
      <w:p>${t("    print(i)")}</w:p>
      <w:p>${t("Đoạn chương trình trên in ra bao nhiêu số?")}</w:p>
      <w:p>${t("*A. 5")}</w:p>
      <w:p>${t("B. 4")}</w:p>
      <w:p>${t("C. 6")}</w:p>
      <w:p>${t("D. Vô hạn")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const codeData = extractCodeFromRich(q.text);
    expect(codeData).not.toBeNull();
    expect(codeData!.lang).toBe("python");
    expect(codeData!.content).toBe("for i in range(5):\n    print(i)");
    expect(codeData!.content).toContain("    print(i)");
  });

  // Test 2: Python lồng nhiều cấp
  it("Test 2 - Preserves deeply nested Python code with if/else indentation", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 2. Cho đoạn mã sau:")}</w:p>
      <w:p>${t("for i in range(n):")}</w:p>
      <w:p>${t("    if A[i] > 0:")}</w:p>
      <w:p>${t("        if A[i] % 2 == 0:")}</w:p>
      <w:p>${t("            print(A[i])")}</w:p>
      <w:p>${t("        else:")}</w:p>
      <w:p>${t("            print(\"Lẻ\")")}</w:p>
      <w:p>${t("A. Đếm số")}</w:p>
      <w:p>${t("*B. In số chẵn")}</w:p>
      <w:p>${t("C. In số lẻ")}</w:p>
      <w:p>${t("D. Lỗi cú pháp")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const codeData = extractCodeFromRich(q.text);
    expect(codeData).not.toBeNull();
    expect(codeData!.lang).toBe("python");
    expect(codeData!.content).toContain("for i in range(n):");
    expect(codeData!.content).toContain("    if A[i] > 0:");
    expect(codeData!.content).toContain("        if A[i] % 2 == 0:");
    expect(codeData!.content).toContain("            print(A[i])");
    expect(codeData!.content).toContain("        else:");
    expect(codeData!.content).toContain("            print(\"Lẻ\")");
  });

  // Test 3: HTML
  it("Test 3 - Preserves HTML structure without stripping or merging tags", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 3. Cho đoạn mã HTML sau:")}</w:p>
      <w:p>${t("<html>")}</w:p>
      <w:p>${t("    <body>")}</w:p>
      <w:p>${t("        <h1>Hello</h1>")}</w:p>
      <w:p>${t("        <p>Xin chào</p>")}</w:p>
      <w:p>${t("    </body>")}</w:p>
      <w:p>${t("</html>")}</w:p>
      <w:p>${t("A. Thẻ p")}</w:p>
      <w:p>${t("*B. Thẻ h1")}</w:p>
      <w:p>${t("C. Thẻ div")}</w:p>
      <w:p>${t("D. Thẻ span")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const codeData = extractCodeFromRich(q.text);
    expect(codeData).not.toBeNull();
    expect(codeData!.lang).toBe("html");
    expect(codeData!.content).toContain("<html>");
    expect(codeData!.content).toContain("    <body>");
    expect(codeData!.content).toContain("        <h1>Hello</h1>");
    expect(codeData!.content).toContain("        <p>Xin chào</p>");
    expect(codeData!.content).toContain("    </body>");
    expect(codeData!.content).toContain("</html>");
  });

  // Test 4: SQL
  it("Test 4 - Preserves multi-line SQL structure with query clauses", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 4. Cho truy vấn SQL sau:")}</w:p>
      <w:p>${t("SELECT *")}</w:p>
      <w:p>${t("FROM Students")}</w:p>
      <w:p>${t("WHERE Score >= 8")}</w:p>
      <w:p>${t("    AND Class = '12A1'")}</w:p>
      <w:p>${t("ORDER BY Score DESC;")}</w:p>
      <w:p>${t("*A. Lấy học sinh lớp 12A1 điểm từ 8")}</w:p>
      <w:p>${t("B. Lấy tất cả học sinh")}</w:p>
      <w:p>${t("C. Sắp xếp tăng dần")}</w:p>
      <w:p>${t("D. Lỗi cú pháp")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const codeData = extractCodeFromRich(q.text);
    expect(codeData).not.toBeNull();
    expect(codeData!.lang).toBe("sql");
    expect(codeData!.content).toContain("SELECT *");
    expect(codeData!.content).toContain("FROM Students");
    expect(codeData!.content).toContain("WHERE Score >= 8");
    expect(codeData!.content).toContain("    AND Class = '12A1'");
    expect(codeData!.content).toContain("ORDER BY Score DESC;");
  });

  // Test 5: Code nằm trong bảng Word
  it("Test 5 - Preserves Python, HTML, and SQL in Word table cells with indentation", async () => {
    const ind4 = '<w:ind w:left="720"/>';
    const ind8 = '<w:ind w:left="1440"/>';
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>${t("for i in range(n):")}</w:p>
            ${p(t("if A[i] > 0:"), ind4)}
            ${p(t("print(A[i])"), ind8)}
          </w:tc>
          <w:tc>
            <w:p>${t("SELECT *")}</w:p>
            <w:p>${t("FROM Students")}</w:p>
            <w:p>${t("WHERE Class = '12A1'")}</w:p>
            <w:p>${t("    AND Score >= 8")}</w:p>
            <w:p>${t("ORDER BY Score DESC;")}</w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
    `;

    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 5. Quan sát bảng chứa các đoạn mã:")}</w:p>
      ${tableXml}
      <w:p>${t("*A. Đúng")}</w:p>
      <w:p>${t("B. Sai")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    expect(q.text).toContain("\u27E6TBL:");

    const m = q.text.match(/\u27E6TBL:([^\u27E7]+)\u27E7/);
    expect(m).toBeTruthy();
    const rows: string[][] = JSON.parse(decodeURIComponent(m![1]));
    expect(rows.length).toBe(1);
    expect(rows[0].length).toBe(2);

    // Cell 1: Python
    const cellPy = rows[0][0];
    expect(cellPy).toContain("\u27E6CODE:python:");
    const pyDecoded = decodeURIComponent(cellPy.replace(/^[^\u27E6]*\u27E6CODE:python:/, "").replace(/\u27E7.*$/, ""));
    expect(pyDecoded).toContain("for i in range(n):");
    expect(pyDecoded).toContain("    if A[i] > 0:");
    expect(pyDecoded).toContain("        print(A[i])");

    // Cell 2: SQL
    const cellSql = rows[0][1];
    expect(cellSql).toContain("\u27E6CODE:sql:");
    const sqlDecoded = decodeURIComponent(cellSql.replace(/^[^\u27E6]*\u27E6CODE:sql:/, "").replace(/\u27E7.*$/, ""));
    expect(sqlDecoded).toContain("SELECT *");
    expect(sqlDecoded).toContain("FROM Students");
    expect(sqlDecoded).toContain("WHERE Class = '12A1'");
    expect(sqlDecoded).toContain("    AND Score >= 8");
    expect(sqlDecoded).toContain("ORDER BY Score DESC;");
  });

  // Test 6: Code trong phương án trả lời (A/B/C/D)
  it("Test 6 - Preserves code in options A, B, C, D without stripping spaces", async () => {
    const rawExam = `PHẦN I
Câu 6: Câu lệnh nào dùng để in số chẵn trong Python?
A. for i in range(10):
       if i % 2 == 0:
           print(i)
B. for i in range(10):
       print(i)
C. print("10")
D. while True: pass
Đáp án: A
`;
    const parsed = parseTextExam(rawExam);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const optA = q.options[0];
    expect(optA.text).toContain("for i in range(10):");
    expect(optA.text).toContain("    if i % 2 == 0:");
    expect(optA.text).toContain("        print(i)");
  });

  // Test 7: Code trong câu hỏi
  it("Test 7 - Preserves code in question stem with tabs and spaces", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 7. Xét đoạn mã:")}</w:p>
      <w:p>${t("def check(n):")}</w:p>
      <w:p><w:r><w:tab/><w:t xml:space="preserve">return n % 2 == 0</w:t></w:r></w:p>
      <w:p>${t("Hàm trên trả về gì?")}</w:p>
      <w:p>${t("*A. True nếu n chẵn")}</w:p>
      <w:p>${t("B. False nếu n chẵn")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    const codeData = extractCodeFromRich(q.text);
    expect(codeData).not.toBeNull();
    expect(codeData!.content).toContain("def check(n):");
    expect(codeData!.content).toContain("\treturn n % 2 == 0");
  });

  // Test 8: Code trong phần giải thích
  it("Test 8 - Preserves code inside explanation section", async () => {
    const docx = await createDocxFile(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 8. Viết lệnh in ra các số từ 0 đến 4.")}</w:p>
      <w:p>${t("*A. for i in range(5): print(i)")}</w:p>
      <w:p>${t("B. for i in range(4): print(i)")}</w:p>
      <w:p>${t("Lời giải:")}</w:p>
      <w:p>${t("Giải thích chi tiết:")}</w:p>
      <w:p>${t("for i in range(5):")}</w:p>
      <w:p>${t("    print(i)")}</w:p>
      <w:p>${t("Vì range(5) sinh ra dãy 0, 1, 2, 3, 4.")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI.length).toBe(1);
    const q = parsed.partI[0];
    expect(q.explanation).not.toBeNull();
    const codeData = extractCodeFromRich(q.explanation!);
    expect(codeData).not.toBeNull();
    expect(codeData!.content).toContain("for i in range(5):");
    expect(codeData!.content).toContain("    print(i)");
    expect(q.explanation).toContain("Vì range(5) sinh ra dãy 0, 1, 2, 3, 4.");
  });
});
