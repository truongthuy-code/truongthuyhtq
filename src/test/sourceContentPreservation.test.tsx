import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import JSZip from "jszip";
import RichText from "@/components/RichText";
import { parseDocx, stripRich } from "@/lib/docxParser";
import { buildExamDocxBlob } from "@/lib/examExporter";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const t = (s: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(s)}</w:t></w:r>`;
const eq = (s: string) => `<m:oMath><m:r><m:t>${s}</m:t></m:r></m:oMath>`;
const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;

async function createDocx(bodyXml: string): Promise<File> {
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

describe("UNIVERSAL SOURCE CONTENT PRESERVATION PRINCIPLES", () => {
  describe("1. HTML, CSS, JavaScript preservation in Stem and Options", () => {
    it("preserves nested HTML tags and attributes in question stem without swallowing tags or executing them", async () => {
      const docx = await createDocx(`
        <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
        <w:p>${t("Câu 1. Cho đoạn mã sau: <div><p class=\"lead\">Xin chào</p><a href=\"https://edu.vn\">Link</a></div>. Thẻ <p> có thuộc tính gì?")}</w:p>
        <w:p>${t("*A. class=\"lead\"")}</w:p>
        <w:p>${t("B. href=\"https://edu.vn\"")}</w:p>
        <w:p>${t("C. id=\"main\"")}</w:p>
        <w:p>${t("D. style=\"color:red\"")}</w:p>
      `);

      const parsed = await parseDocx(docx);
      expect(parsed.partI).toHaveLength(1);
      const q = parsed.partI[0];

      // Stored text preserves all tags
      expect(q.text).toContain("<div><p class=\"lead\">Xin chào</p><a href=\"https://edu.vn\">Link</a></div>");
      expect(q.text).toContain("Thẻ <p>");

      // Rendered in UI: tags are clearly visible to student as readable text
      const { container } = render(<RichText text={q.text} />);
      expect(container.textContent).toContain("<div>");
      expect(container.textContent).toContain("<p class=\"lead\">");
      expect(container.textContent).toContain("Xin chào");
      expect(container.textContent).toContain("</p>");
      expect(container.textContent).toContain("<a href=\"https://edu.vn\">");
      expect(container.textContent).toContain("Link");
      expect(container.textContent).toContain("</a>");
      expect(container.textContent).toContain("</div>");
      expect(container.textContent).toContain("Thẻ <p>");

      // No active script or dangerous tag injected
      expect(container.querySelector("script")).toBeNull();
    });

    it("preserves HTML tags in options: A. <p>, B. <b>, C. <i>, D. <table border=\"1\">", async () => {
      const docx = await createDocx(`
        <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
        <w:p>${t("Câu 2. Thẻ nào sau đây dùng để tạo đoạn văn bản trong HTML?")}</w:p>
        <w:p>${t("*A. <p>")}</w:p>
        <w:p>${t("B. <b>")}</w:p>
        <w:p>${t("C. <i>")}</w:p>
        <w:p>${t("D. <table border=\"1\">")}</w:p>
      `);

      const parsed = await parseDocx(docx);
      expect(parsed.partI).toHaveLength(1);
      const q = parsed.partI[0];

      expect(decodeURIComponent(q.options[0].text)).toContain("<p>");
      expect(decodeURIComponent(q.options[1].text)).toContain("<b>");
      expect(decodeURIComponent(q.options[2].text)).toContain("<i>");
      expect(decodeURIComponent(q.options[3].text)).toContain("<table border=\"1\">");

      // Verify each option renders the literal tag text in RichText
      const r0 = render(<RichText text={q.options[0].text} />).container;
      expect(r0.textContent).toContain("<p>");
      const r1 = render(<RichText text={q.options[1].text} />).container;
      expect(r1.textContent).toContain("<b>");
      const r2 = render(<RichText text={q.options[2].text} />).container;
      expect(r2.textContent).toContain("<i>");
      const r3 = render(<RichText text={q.options[3].text} />).container;
      expect(r3.textContent).toContain("<table border=\"1\">");
    });

    it("prevents XSS: <img src=\"x\" onerror=\"alert(1)\"> displays as text and does not execute", () => {
      const text = "Kiểm tra XSS: <img src=\"x\" onerror=\"alert(1)\"> và <script>alert(2)</script>";
      const { container } = render(<RichText text={text} />);

      // Tags are rendered as readable text
      expect(container.textContent).toContain("<img src=\"x\" onerror=\"alert(1)\">");
      expect(container.textContent).toContain("<script>alert(2)</script>");

      // No executable img onerror or script element created
      const img = container.querySelector("img");
      expect(img).toBeNull();
      const script = container.querySelector("script");
      expect(script).toBeNull();
    });
  });

  describe("2. Python Code and Indentation Preservation", () => {
    it("preserves multi-line Python with 4-space and 8-space indentations, colons, and operators", async () => {
      const docx = await createDocx(`
        <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
        <w:p>${t("Câu 1. Cho đoạn mã sau:")}</w:p>
        <w:p>${t("def check_number(n):")}</w:p>
        <w:p>${t("    if n > 0:")}</w:p>
        <w:p>${t("        if n % 2 == 0:")}</w:p>
        <w:p>${t("            return n // 2")}</w:p>
        <w:p>${t("        else:")}</w:p>
        <w:p>${t("            return n ** 2")}</w:p>
        <w:p>${t("    return -1")}</w:p>
        <w:p>${t("*A. Đúng")}</w:p>
        <w:p>${t("B. Sai")}</w:p>
      `);

      const parsed = await parseDocx(docx);
      expect(parsed.partI).toHaveLength(1);
      const q = parsed.partI[0];

      // Render with RichText
      const { container } = render(<RichText text={q.text} />);
      const pre = container.querySelector("pre.code-content");
      expect(pre).not.toBeNull();

      expect(pre?.textContent).toContain("def check_number(n):");
      expect(pre?.textContent).toContain("    if n > 0:");
      expect(pre?.textContent).toContain("        if n % 2 == 0:");
      expect(pre?.textContent).toContain("            return n // 2");
      expect(pre?.textContent).toContain("        else:");
      expect(pre?.textContent).toContain("            return n ** 2");
      expect(pre?.textContent).toContain("    return -1");
    });
  });

  describe("3. SQL Statement Preservation", () => {
    it("preserves SQL query with WHERE clauses, quotes, and operators in options and stem", async () => {
      const docx = await createDocx(`
        <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
        <w:p>${t("Câu 1. Câu lệnh nào lấy danh sách học sinh có điểm >= 8.5?")}</w:p>
        <w:p>${t("*A. SELECT id, name FROM Students WHERE score >= 8.5 AND status = 'pass' ORDER BY score DESC;")}</w:p>
        <w:p>${t("B. UPDATE Students SET score = 8.5 WHERE score < 8.5;")}</w:p>
        <w:p>${t("C. DELETE FROM Students WHERE score < 5.0;")}</w:p>
        <w:p>${t("D. INSERT INTO Students (name, score) VALUES ('Nam', 9.0);")}</w:p>
      `);

      const parsed = await parseDocx(docx);
      expect(parsed.partI).toHaveLength(1);
      const q = parsed.partI[0];

      expect(decodeURIComponent(q.options[0].text)).toContain("SELECT id, name FROM Students WHERE score >= 8.5 AND status = 'pass' ORDER BY score DESC;");
      expect(decodeURIComponent(q.options[1].text)).toContain("UPDATE Students SET score = 8.5 WHERE score < 8.5;");
      expect(decodeURIComponent(q.options[2].text)).toContain("DELETE FROM Students WHERE score < 5.0;");
      expect(decodeURIComponent(q.options[3].text)).toContain("INSERT INTO Students (name, score) VALUES ('Nam', 9.0);");

      // Verify RichText renders SQL properly without losing quotes or comparison operators
      const { container } = render(<RichText text={q.options[0].text} />);
      expect(container.textContent).toContain("SELECT id, name FROM Students WHERE score >= 8.5 AND status = 'pass' ORDER BY score DESC;");
    });
  });

  describe("4. Math, Formulas, and Scientific Symbols Preservation", () => {
    it("preserves percent %, LaTeX backslashes, fractions, powers, and scientific symbols", async () => {
      const docx = await createDocx(`
        <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
        <w:p>${t("Câu 1. Lò đốt chứa ") + eq("0.34%") + t(" thể tích khí với sai số ") + eq("50 \\pm 2%") + t(". Tính tỉ lệ ") + eq("\\frac{1}{2}%") + t(".")}</w:p>
        <w:p>${t("*A. ") + eq("25%")}</w:p>
        <w:p>${t("B. ") + eq("12.5%")}</w:p>
        <w:p>${t("C. ") + eq("100%")}</w:p>
        <w:p>${t("D. ") + eq("10^3 \\cdot 5%")}</w:p>
      `);

      const parsed = await parseDocx(docx);
      expect(parsed.partI).toHaveLength(1);
      const q = parsed.partI[0];

      // Verify all % are escaped and preserved
      expect(q.text).toContain("0.34\\%");
      expect(q.text).toContain("50 \\pm 2\\%");
      expect(q.text).toContain("\\frac{1}{2}\\%");

      expect(q.options[0].text).toContain("25\\%");
      expect(q.options[1].text).toContain("12.5\\%");
      expect(q.options[2].text).toContain("100\\%");
      expect(q.options[3].text).toContain("10^3 \\cdot 5\\%");

      // Render in RichText and verify % is present in rendered text
      const { container } = render(<RichText text={q.text} />);
      expect(container.textContent).toContain("0.34%");
      expect(container.textContent).toContain("50");
      expect(container.textContent).toContain("2%");
    });
  });

  describe("5. stripRich Preserves Inequalities and Code", () => {
    it("does not delete x < y and a > b when stripRich is called", () => {
      const s = "Cho tam giác có các góc thỏa mãn x < y and a > b.";
      const stripped = stripRich(s);
      expect(stripped).toContain("x < y");
      expect(stripped).toContain("a > b");
      expect(stripped).toBe("Cho tam giác có các góc thỏa mãn x < y and a > b.");
    });

    it("does not delete HTML tags in code when stripRich is called", () => {
      const s = "Thẻ <p> dùng để tạo đoạn văn.";
      const stripped = stripRich(s);
      expect(stripped).toContain("<p>");
    });
  });

  describe("6. Word DOCX Export Preserves HTML Tags and Formats", () => {
    it("does not swallow <p>, <div>, <img>, or <table> when exporting exam to Word DOCX", async () => {
      const variant = {
        partI: [
          {
            id: "q1",
            type: "mc" as const,
            text: "Thẻ <p> và <div> có công dụng gì trong HTML?",
            options: [
              { key: "A" as const, text: "Thẻ <p> tạo đoạn văn, <div> tạo khối" },
              { key: "B" as const, text: "Cả hai đều dùng thẻ <img src=\"pic.png\">" },
              { key: "C" as const, text: "Dùng để tạo bảng <table border=\"1\">" },
              { key: "D" as const, text: "Cú pháp: <a href=\"link\">" },
            ],
            answer: "A" as const,
          },
        ],
        partII: [],
        partIII: [],
      };

      // Export to DOCX blob using buildExamDocxBlob
      const blob = await buildExamDocxBlob(
        variant,
        "101",
        { title: "Đề kiểm tra Tin học" } as any,
        { singleFile: true } as any
      );
      expect(blob).toBeTruthy();
      expect(blob.size).toBeGreaterThan(0);

      // Read back exported docx and verify XML contains the exact tags
      const zip = await JSZip.loadAsync(blob);
      const docXml = await zip.file("word/document.xml")!.async("string");

      expect(docXml).toContain("&lt;p&gt;");
      expect(docXml).toContain("&lt;div&gt;");
      expect(docXml).toContain("&lt;img src=");
      expect(docXml).toContain("pic.png");
      expect(docXml).toContain("&lt;table border=");
      expect(docXml).toContain("&lt;a href=");
    });
  });
});
