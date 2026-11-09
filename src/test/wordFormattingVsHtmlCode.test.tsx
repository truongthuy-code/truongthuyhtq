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

describe("WORD FORMATTING (BOLD/ITALIC) VS DIRECT HTML CODE INPUT", () => {
  it("Test 1: Word formatting (bold/italic) does NOT insert <b> or <i> into text, but displays styled", async () => {
    // Word document with bold and italic words formatted via Word tools (<w:b/> and <w:i/>)
    const docx = await createDocx(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>
        ${t("Câu 12: Mối quan hệ lồng nhau giữa các phần tử trong sơ đồ cây HTML thể hiện")}
      </w:p>
      <w:p>
        ${t("A. quan hệ độc lập, các phần tử không được phép chứa phần tử khác.")}
      </w:p>
      <w:p>
        ${t("B. quan hệ liên kết ngoài, tự động kết nối đến tệp trên máy chủ khác.")}
      </w:p>
      <w:p>
        ${t("C. quan hệ kích thước, phần tử viết trước luôn lớn hơn phần tử sau.")}
      </w:p>
      <w:p>
        ${t("*D. quan hệ ")}
        ${t("cha - con", "<w:b/>")}
        ${t(", phần tử bao ngoài là cha của phần tử bên trong.")}
      </w:p>
      <w:p>
        ${t("Lời giải: Sự lồng nhau của các thẻ HTML biểu diễn quan hệ ")}
        ${t("cha - con", "<w:b/>")}
        ${t(" trên sơ đồ cây thông tin, trong đó phần tử bao quanh là ")}
        ${t("cha", "<w:i/>")}
        ${t(" và phần tử bên trong là ")}
        ${t("con", "<w:i/>")}
        ${t(".")}
      </w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI).toHaveLength(1);
    const q = parsed.partI[0];

    // 1. Text of option D must NOT contain raw <b>, </b>, <i>, </i> tags!
    const optDText = decodeURIComponent(q.options[3].text);
    expect(optDText).not.toContain("<b>");
    expect(optDText).not.toContain("</b>");
    expect(optDText).not.toContain("<i>");
    expect(optDText).not.toContain("</i>");

    // 2. Explanation must NOT contain raw <b>, </b>, <i>, </i> tags!
    expect(q.explanation).toBeTruthy();
    expect(q.explanation).not.toContain("<b>");
    expect(q.explanation).not.toContain("</b>");
    expect(q.explanation).not.toContain("<i>");
    expect(q.explanation).not.toContain("</i>");

    // 3. stripRich retains the text
    expect(stripRich(optDText)).toBe("quan hệ cha - con, phần tử bao ngoài là cha của phần tử bên trong.");
    expect(stripRich(q.explanation || "")).toContain("quan hệ cha - con trên sơ đồ cây thông tin");

    // 4. In RichText UI: Option D displays "cha - con" in bold (with font-bold class)
    const { container: optContainer } = render(<RichText text={q.options[3].text} />);
    const boldEl = optContainer.querySelector(".font-bold");
    expect(boldEl).not.toBeNull();
    expect(boldEl?.textContent).toBe("cha - con");

    // 5. In UI: Explanation displays "cha - con" in bold and "cha", "con" in italic
    const { container: explContainer } = render(<RichText text={q.explanation || ""} />);
    const explBolds = explContainer.querySelectorAll(".font-bold");
    expect(explBolds.length).toBeGreaterThanOrEqual(1);
    expect(explBolds[0].textContent).toBe("cha - con");

    const explItalics = explContainer.querySelectorAll(".italic");
    expect(explItalics.length).toBeGreaterThanOrEqual(2);
    expect(explItalics[0].textContent).toBe("cha");
    expect(explItalics[1].textContent).toBe("con");

    // NO visible <b>, </b>, <i>, </i> text appeared on screen for Word formatting!
    expect(optContainer.textContent).not.toContain("<b>");
    expect(optContainer.textContent).not.toContain("</b>");
    expect(explContainer.textContent).not.toContain("<b>");
    expect(explContainer.textContent).not.toContain("</b>");
  });

  it("Test 2: Direct HTML code input retains all tags verbatim without Markdown conversion or deletion", async () => {
    const docx = await createDocx(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>${t("Câu 20: Cho đoạn mã: <p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>. Mối quan hệ giữa các phần tử là")}</w:p>
      <w:p>${t("*A. <p> là cha của <b> và <i>")}</w:p>
      <w:p>${t("B. <b> là cha của <p>")}</w:p>
      <w:p>${t("C. <i> là cha của <p>")}</w:p>
      <w:p>${t("D. Không có quan hệ lồng nhau")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI).toHaveLength(1);
    const q = parsed.partI[0];

    // Question stem preserves all literal HTML tags verbatim
    expect(q.text).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");

    // Rendered in UI: all tags are visible verbatim to the user as code/text
    const { container } = render(<RichText text={q.text} />);
    expect(container.textContent).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");

    // Not converted to Markdown (* or **)
    expect(container.textContent).not.toContain("*nghiêng*");
    expect(container.textContent).not.toContain("**đậm**");

    // Option A also preserves tags
    const optAText = decodeURIComponent(q.options[0].text);
    expect(optAText).toContain("<p> là cha của <b> và <i>");
    const { container: optAContainer } = render(<RichText text={q.options[0].text} />);
    expect(optAContainer.textContent).toContain("<p> là cha của <b> và <i>");
  });

  it("Test 3: Combined in the same question: Word bold/italic + Direct HTML code input work independently", async () => {
    // A single question having:
    // - Word Bold tool applied to "Chú ý:"
    // - Direct HTML code input: `<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>`
    // - Word Italic tool applied to "rất quan trọng."
    const docx = await createDocx(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>
        ${t("Câu 1. ")}
        ${t("Chú ý:", "<w:b/>")}
        ${t(" Cho đoạn mã HTML: <p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p> có ý nghĩa ")}
        ${t("rất quan trọng.", "<w:i/>")}
      </w:p>
      <w:p>${t("*A. Đúng")}</w:p>
      <w:p>${t("B. Sai")}</w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI).toHaveLength(1);
    const q = parsed.partI[0];

    // Word bold tool must NOT insert <b>Chú ý:</b> into the string
    expect(q.text).not.toContain("<b>Chú ý:</b>");
    // Word italic tool must NOT insert <i>rất quan trọng.</i> into the string
    expect(q.text).not.toContain("<i>rất quan trọng.</i>");
    // But direct HTML code input MUST retain its <p>, <b>, <i> tags!
    expect(q.text).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");

    // Render in UI
    const { container } = render(<RichText text={q.text} />);

    // 1. "Chú ý:" is rendered as bold
    const boldEl = container.querySelector(".font-bold");
    expect(boldEl).not.toBeNull();
    expect(boldEl?.textContent).toBe("Chú ý:");

    // 2. "rất quan trọng." is rendered as italic
    const italicEl = container.querySelector(".italic");
    expect(italicEl).not.toBeNull();
    expect(italicEl?.textContent).toBe("rất quan trọng.");

    // 3. The HTML code snippet displays its exact literal tags!
    expect(container.textContent).toContain("<p>Thông tin này in <b>đậm</b> và <i>nghiêng</i>.</p>");

    // 4. "Chú ý:" and "rất quan trọng." do NOT have literal tags visible around them!
    expect(container.textContent).not.toContain("<b>Chú ý:</b>");
    expect(container.textContent).not.toContain("<i>rất quan trọng.</i>");
  });

  it("Test 4: Full exam coverage across stems, options, true/false items, short answer, and export", async () => {
    const docx = await createDocx(`
      <w:p>${t("PHẦN I. Câu trắc nghiệm")}</w:p>
      <w:p>
        ${t("Câu 1. ")}
        ${t("Khái niệm cơ bản:", "<w:b/>")}
        ${t(" Thẻ nào tạo đoạn văn?")}
      </w:p>
      <w:p>${t("*A. <p>")}</w:p>
      <w:p>${t("B. <b>")}</w:p>
      <w:p>${t("C. <i>")}</w:p>
      <w:p>${t("D. <div>")}</w:p>
      
      <w:p>${t("PHẦN II. Câu trắc nghiệm đúng sai")}</w:p>
      <w:p>
        ${t("Câu 1. Xét đoạn mã HTML: ")}
        ${t("<div class=\"box\"><b>Tiêu đề</b></div>")}
      </w:p>
      <w:p>
        ${t("*a) ")}
        ${t("Thẻ <div> là thẻ khối.", "<w:b/>")}
      </w:p>
      <w:p>
        ${t("b) ")}
        ${t("Thẻ <b> là thẻ nội dòng.", "<w:i/>")}
      </w:p>
      <w:p>
        ${t("c) Class có giá trị là ")}
        ${t("box", "<w:b/>")}
      </w:p>
      <w:p>
        ${t("d) Thẻ <b> là cha của <div>")}
      </w:p>

      <w:p>${t("PHẦN III. Câu trắc nghiệm trả lời ngắn")}</w:p>
      <w:p>
        ${t("Câu 1. Đoạn mã: ")}
        ${t("def add(x, y): return x + y")}
        ${t(" có bao nhiêu tham số? Đáp án: ")}
        ${t("2", "<w:b/>")}
      </w:p>
    `);

    const parsed = await parseDocx(docx);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partII).toHaveLength(1);
    expect(parsed.partIII).toHaveLength(1);

    // Part I: No <b> in stem from Word bold
    expect(parsed.partI[0].text).not.toContain("<b>Khái niệm");
    expect(decodeURIComponent(parsed.partI[0].options[0].text)).toContain("<p>");

    // Part II: No <b> or <i> in items from Word bold/italic
    expect(parsed.partII[0].items[0].text).not.toContain("<b>Thẻ");
    expect(parsed.partII[0].items[1].text).not.toContain("<i>Thẻ");

    // Part II: HTML in stem is preserved
    expect(parsed.partII[0].text).toContain('<div class="box"><b>Tiêu đề</b></div>');

    // Part III: Answer
    expect(parsed.partIII[0].answer).toBe("2");

    // Export to DOCX
    const blob = await buildExamDocxBlob(
      parsed,
      "101",
      { title: "Đề kiểm tra Tin học" } as any,
      { singleFile: true, answersAsTable: true, renumberPerPart: false } as any
    );
    expect(blob).toBeTruthy();
    expect(blob.size).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(blob);
    const docXml = await zip.file("word/document.xml")!.async("string");

    // Word bold words are exported as real bold runs
    expect(docXml).toContain("Khái niệm cơ bản:");
    // HTML tags are exported verbatim
    expect(docXml).toContain("&lt;p&gt;");
    expect(docXml).toContain("&lt;div class=");
  });
});
