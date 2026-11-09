import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import JSZip from "jszip";
import RichText from "@/components/RichText";
import { parseDocx, isHtmlCodeText } from "@/lib/docxParser";
import { buildExamDocxBlob } from "@/lib/examExporter";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const t = (s: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(s)}</w:t></w:r>`;

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

describe("VERBATIM HTML CODE PRESERVATION (NO MARKDOWN CONVERSION)", () => {
  it("Test 1: preserves <p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p> without deleting <b>, <i> or converting to *", async () => {
    const rawQuestion =
      'Câu 20: Cho đoạn mã: <p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>. Mối quan hệ giữa các phần tử là';

    const docx = await createDocx(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t(rawQuestion)}</w:p>
      <w:p>${t("*A. <p> là phần tử cha của <b> và <i>")}</w:p>
      <w:p>${t("B. <b> là phần tử cha của <p>")}</w:p>
      <w:p>${t("C. <i> là phần tử cha của <p>")}</w:p>
      <w:p>${t("D. Không có mối quan hệ")}</w:p>
    `);

    // 1. Phân tích file Word (nhận dạng đề thi)
    const parsed = await parseDocx(docx);
    expect(parsed.partI).toHaveLength(1);
    const q = parsed.partI[0];

    // Nội dung sau nhận dạng phải chứa chính xác các thẻ HTML
    expect(q.text).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");
    expect(q.text).not.toContain("*nghiêng*");
    expect(q.text).not.toContain("**đậm**");

    // 2. Nội dung đọc từ Supabase / lưu trữ
    const serialized = JSON.stringify(q);
    const loaded = JSON.parse(serialized);
    expect(loaded.text).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");

    // 3. Hiển thị trên giao diện học sinh / giáo viên
    const { container } = render(<RichText text={q.text} />);

    // Thẻ <b>, </b>, <i>, </i>, <p>, </p> PHẢI ĐƯỢC BẢO TOÀN TRONG TEXTCONTENT
    expect(container.textContent).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");
    expect(container.textContent).not.toContain("*nghiêng*");

    // Trình duyệt KHÔNG được tự ý tạo thẻ DOM <b> hay <i> để nuốt mất mã HTML
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
  });

  it("Test 2: preserves <strong>Nội dung in đậm</strong> verbatim without stripping or converting to **", async () => {
    const rawQuestion = "Câu 1. Thẻ nào có tác dụng tương tự: <strong>Nội dung in đậm</strong>?";
    const docx = await createDocx(`
      <w:p>${t("PHẦN I")}</w:p>
      <w:p>${t(rawQuestion)}</w:p>
      <w:p>${t("*A. <b>Nội dung in đậm</b>")}</w:p>
      <w:p>${t("B. <i>Nội dung in đậm</i>")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    expect(q.text).toContain("<strong>Nội dung in đậm</strong>");

    const { container } = render(<RichText text={q.text} />);
    expect(container.textContent).toContain("<strong>Nội dung in đậm</strong>");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("Test 3: preserves <em>Nội dung in nghiêng</em> verbatim without stripping or converting to *", async () => {
    const rawQuestion = "Câu 2. Xét đoạn mã: <em>Nội dung in nghiêng</em>.";
    const docx = await createDocx(`
      <w:p>${t("PHẦN I")}</w:p>
      <w:p>${t(rawQuestion)}</w:p>
      <w:p>${t("*A. Đúng")}</w:p>
      <w:p>${t("B. Sai")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    expect(q.text).toContain("<em>Nội dung in nghiêng</em>");

    const { container } = render(<RichText text={q.text} />);
    expect(container.textContent).toContain("<em>Nội dung in nghiêng</em>");
    expect(container.querySelector("em")).toBeNull();
  });

  it("Test 4: preserves <div><p>Nội dung <span>văn bản</span></p></div> verbatim", async () => {
    const rawQuestion = "Câu 3. Cho cấu trúc: <div><p>Nội dung <span>văn bản</span></p></div>.";
    const docx = await createDocx(`
      <w:p>${t("PHẦN I")}</w:p>
      <w:p>${t(rawQuestion)}</w:p>
      <w:p>${t("*A. 3 cấp")}</w:p>
      <w:p>${t("B. 2 cấp")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    expect(q.text).toContain("<div><p>Nội dung <span>văn bản</span></p></div>");

    const { container } = render(<RichText text={q.text} />);
    expect(container.textContent).toContain("<div><p>Nội dung <span>văn bản</span></p></div>");
  });

  it("Test 5: preserves <p>Giá trị là 25% và kết quả x >= 10.</p> with percent and comparison", async () => {
    const rawQuestion = "Câu 4. Cho đoạn văn: <p>Giá trị là 25% và kết quả x >= 10.</p>";
    const docx = await createDocx(`
      <w:p>${t("PHẦN I")}</w:p>
      <w:p>${t(rawQuestion)}</w:p>
      <w:p>${t("*A. Hợp lệ")}</w:p>
      <w:p>${t("B. Lỗi")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];
    expect(q.text).toContain("<p>Giá trị là 25% và kết quả x >= 10.</p>");

    const { container } = render(<RichText text={q.text} />);
    expect(container.textContent).toContain("<p>Giá trị là 25% và kết quả x >= 10.</p>");
    expect(container.textContent).toContain("25%");
    expect(container.textContent).toContain(">=");
  });

  it("Test 6: preserves nested HTML tags in options A, B, C, D", async () => {
    const docx = await createDocx(`
      <w:p>${t("PHẦN I")}</w:p>
      <w:p>${t("Câu 5. Đoạn mã nào hợp lệ trong HTML5?")}</w:p>
      <w:p>${t("*A. <p>Đoạn văn <b>chữ đậm</b> và <i>chữ nghiêng</i></p>")}</w:p>
      <w:p>${t("B. <div><span>Phần tử con</span><a href=\"#\">Link</a></div>")}</w:p>
      <w:p>${t("C. <strong>Tiêu đề <em>nhấn mạnh</em></strong>")}</w:p>
      <w:p>${t("D. <table border=\"1\"><tr><td>Ô 1</td><td>Ô 2</td></tr></table>")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    const q = parsed.partI[0];

    // Phương án A
    expect(decodeURIComponent(q.options[0].text)).toContain("<p>Đoạn văn <b>chữ đậm</b> và <i>chữ nghiêng</i></p>");
    const rA = render(<RichText text={q.options[0].text} />);
    expect(rA.container.textContent).toContain("<p>Đoạn văn <b>chữ đậm</b> và <i>chữ nghiêng</i></p>");

    // Phương án B
    expect(decodeURIComponent(q.options[1].text)).toContain("<div><span>Phần tử con</span><a href=\"#\">Link</a></div>");
    const rB = render(<RichText text={q.options[1].text} />);
    expect(rB.container.textContent).toContain("<div><span>Phần tử con</span><a href=\"#\">Link</a></div>");

    // Phương án C
    expect(decodeURIComponent(q.options[2].text)).toContain("<strong>Tiêu đề <em>nhấn mạnh</em></strong>");
    const rC = render(<RichText text={q.options[2].text} />);
    expect(rC.container.textContent).toContain("<strong>Tiêu đề <em>nhấn mạnh</em></strong>");

    // Phương án D
    expect(decodeURIComponent(q.options[3].text)).toContain("<table border=\"1\"><tr><td>Ô 1</td><td>Ô 2</td></tr></table>");
    const rD = render(<RichText text={q.options[3].text} />);
    expect(rD.container.textContent).toContain("<table border=\"1\"><tr><td>Ô 1</td><td>Ô 2</td></tr></table>");
  });

  it("Test 7: Word DOCX export preserves all HTML tags in <p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>", async () => {
    const rawQuestion =
      '<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>';
    const sampleExam = {
      type: "mc" as const,
      id: "q1",
      text: rawQuestion,
      options: [
        { key: "A" as const, text: "<b>Phương án A</b>" },
        { key: "B" as const, text: "<i>Phương án B</i>" },
      ],
      answer: "A" as const,
      explanation: null,
      level: null,
    };

    const variant = {
      code: "101",
      partI: [sampleExam],
      partII: [],
      partIII: [],
    };

    const blob = await buildExamDocxBlob(
      variant,
      "101",
      {
        agency: "SỞ GD&ĐT",
        unit: "TRƯỜNG THPT",
        session: "KIỂM TRA",
        subject: "TIN HỌC",
        duration: "45",
        questionPrefix: "Câu",
      },
      {
        renumberPerPart: false,
        singleFile: true,
        answersAsTable: true,
      }
    );

    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file("word/document.xml")!.async("string");

    // The exported Word XML MUST contain literal <p>, <b>, <i> tags in <w:t> runs
    expect(xml).toContain("&lt;p&gt;");
    expect(xml).toContain("&lt;b&gt;");
    expect(xml).toContain("&lt;/b&gt;");
    expect(xml).toContain("&lt;i&gt;");
    expect(xml).toContain("&lt;/i&gt;");
    expect(xml).toContain("&lt;/p&gt;");
  });

  it("Test 8: Distinguishes Word presentation formatting (Trường hợp B) from HTML code (Trường hợp A)", () => {
    // Trường hợp B: Word presentation bold heading and italic scenario (natural text)
    expect(isHtmlCodeText("<b>Xét tình huống ứng dụng mạng máy tính trong trường học:</b>")).toBe(false);
    expect(isHtmlCodeText("<i>Một trường THPT triển khai hạ tầng mạng máy tính...</i>")).toBe(false);
    expect(isHtmlCodeText('<span style="color:#1e40af">Đoạn văn 1</span>')).toBe(false);

    // Trường hợp A: HTML code
    expect(isHtmlCodeText("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>")).toBe(true);
    expect(isHtmlCodeText("<strong>Nội dung in đậm</strong>")).toBe(true);
    expect(isHtmlCodeText("<em>Nội dung in nghiêng</em>")).toBe(true);
    expect(isHtmlCodeText("<div><p>Nội dung <span>văn bản</span></p></div>")).toBe(true);
    expect(isHtmlCodeText("<p>Giá trị là 25% và kết quả x >= 10.</p>")).toBe(true);
    expect(isHtmlCodeText("Cho đoạn mã: <b>đậm</b> và <i>nghiêng</i>.")).toBe(true);
  });
});
