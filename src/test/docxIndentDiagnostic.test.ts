import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx } from "@/lib/docxParser";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function createDocx(bodyXml: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W} ${M} ${R}><w:body>${bodyXml}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return { arrayBuffer: async () => blob } as unknown as File;
}

function extractCode(text: string) {
  const m = text.match(/\u27E6CODE:([^:]+):([^\u27E7]+)\u27E7/);
  if (!m) return null;
  return decodeURIComponent(m[2]);
}

describe("Diagnostic of Indentation Loss Across Word Formatting Styles", () => {
  it("Case A: Tabs (<w:tab/>)", async () => {
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p><w:r><w:t>for i in range(n):</w:t></w:r></w:p>
      <w:p><w:r><w:tab/><w:t>if A[i] &gt; 0:</w:t></w:r></w:p>
      <w:p><w:r><w:tab/><w:tab/><w:t>print(A[i])</w:t></w:r></w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const code = extractCode(res.partI[0].text);
    console.log("CASE A RESULT:", JSON.stringify(code));
  });

  it("Case B: Paragraph Indents (<w:ind w:left=\"...\">)", async () => {
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p><w:r><w:t>for i in range(n):</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>if A[i] &gt; 0:</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>print(A[i])</w:t></w:r></w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const code = extractCode(res.partI[0].text);
    console.log("CASE B RESULT:", JSON.stringify(code));
  });

  it("Case C: Spaces in run WITHOUT xml:space=\"preserve\"", async () => {
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p><w:r><w:t>for i in range(n):</w:t></w:r></w:p>
      <w:p><w:r><w:t>    if A[i] &gt; 0:</w:t></w:r></w:p>
      <w:p><w:r><w:t>        print(A[i])</w:t></w:r></w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const code = extractCode(res.partI[0].text);
    console.log("CASE C RESULT:", JSON.stringify(code));
  });

  it("Case D: Separate run for indentation (<w:t>    </w:t><w:t>if...</w:t>)", async () => {
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p><w:r><w:t>for i in range(n):</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">    </w:t></w:r><w:r><w:t>if A[i] &gt; 0:</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">        </w:t></w:r><w:r><w:t>print(A[i])</w:t></w:r></w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const code = extractCode(res.partI[0].text);
    console.log("CASE D RESULT:", JSON.stringify(code));
  });

  it("Case E: Shift+Enter (<w:br/>) within a single paragraph", async () => {
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p>
        <w:r><w:t>for i in range(n):</w:t><w:br/><w:t xml:space="preserve">    if A[i] &gt; 0:</w:t><w:br/><w:t xml:space="preserve">        print(A[i])</w:t></w:r>
      </w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const code = extractCode(res.partI[0].text);
    console.log("CASE E RESULT:", JSON.stringify(code));
  });

  it("Test DOM Rendering with RichText", async () => {
    const { render } = await import("@testing-library/react");
    const RichText = (await import("@/components/RichText")).default;
    const docx = await createDocx(`
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho đoạn mã:</w:t></w:r></w:p>
      <w:p><w:r><w:t>for i in range(n):</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>if A[i] &gt; 0:</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>if A[i] % 2 == 0:</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="2160"/></w:pPr><w:r><w:t>print(A[i])</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="1440"/></w:pPr><w:r><w:t>else:</w:t></w:r></w:p>
      <w:p><w:pPr><w:ind w:left="2160"/></w:pPr><w:r><w:t>print("Lẻ")</w:t></w:r></w:p>
      <w:p><w:r><w:t>*A. Đúng</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Sai</w:t></w:r></w:p>
    `);
    const res = await parseDocx(docx);
    const q = res.partI[0];
    const React = (await import("react")).default;
    const { container } = render(React.createElement(RichText, { text: q.text }));
    const pre = container.querySelector("pre.code-content");
    console.log("DOM PRE textContent:", JSON.stringify(pre?.textContent));
    console.log("DOM PRE innerHTML:", pre?.innerHTML);
  });
});
