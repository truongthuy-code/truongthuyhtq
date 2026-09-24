import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx, stripRich } from "@/lib/docxParser";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const eq = (s: string) => `<m:oMath><m:r><m:t>${s}</m:t></m:r></m:oMath>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;

async function parse(paras: string[]) {
  const xml = `<?xml version="1.0"?><w:document ${W} ${M}><w:body>${paras.join("")}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  const file = {
    arrayBuffer: async () => blob,
  } as unknown as File;
  return parseDocx(file);
}

const MATH = /\u27E6MATH:/;

describe("docx parser – equations & objects", () => {
  it("Test A: Part I with equations in stem and all options", async () => {
    const r = await parse([
      p(t("PHẦN I")),
      p(t("Câu 12 (NB). Cho hàm số ") + eq("y=x^2")),
      p(t("A. ") + eq("1")),
      p(t("B. ") + eq("2")),
      p(t("C. ") + eq("3")),
      p(t("*D. ") + eq("4")),
    ]);
    expect(r.partI).toHaveLength(1);
    const q = r.partI[0];
    expect(q.level).toBe("NB");
    expect(q.text).toMatch(MATH);
    expect(q.options).toHaveLength(4);
    expect(q.answer).toBe("D");
    for (const o of q.options) expect(o.text).toMatch(MATH);
  });

  it("Test B: Part II with a./b./c./d. and equations", async () => {
    const r = await parse([
      p(t("PHẦN II")),
      p(t("Câu 1 (TH). Cho hàm số ") + eq("y=x^3")),
      p(t("và có đồ thị như hình bên dưới")),
      p(t("a. Hàm số đồng biến ") + eq("a1")),
      p(t("*b. Hàm số đạt cực đại ") + eq("b1")),
      p(t("*c. Đồ thị hàm số ") + eq("c1")),
      p(t("d. Trục đối xứng ") + eq("d1")),
    ]);
    expect(r.partII).toHaveLength(1);
    const q = r.partII[0];
    expect(q.items.map((i) => i.key)).toEqual(["a", "b", "c", "d"]);
    expect(q.items.map((i) => i.correct)).toEqual([false, true, true, false]);
    for (const i of q.items) expect(i.text).toMatch(MATH);
    expect(q.text).toMatch(MATH);
  });

  it("Test C: Part II, only d. correct", async () => {
    const r = await parse([
      p(t("PHẦN II")),
      p(t("Câu 4 (TH). Cho ") + eq("f(x)")),
      p(t("a. ") + eq("a1")),
      p(t("b. ") + eq("b1")),
      p(t("c. ") + eq("c1")),
      p(t("*d. ") + eq("d1")),
    ]);
    expect(r.partII[0].items).toHaveLength(4);
    expect(r.partII[0].items.map((i) => i.correct)).toEqual([false, false, false, true]);
  });

  it("Test D: Part III answer inside an equation after 'Đáp án:'", async () => {
    const r = await parse([
      p(t("PHẦN III")),
      p(t("Câu 2 (VD).")),
      p(t("Nội dung câu hỏi...")),
      p(t("Đáp án:")),
      p(eq("12,5")),
      p(t("Lời giải:")),
      p(t("giải thích ở đây")),
    ]);
    expect(r.partIII).toHaveLength(1);
    const q = r.partIII[0];
    expect(q.answer).not.toBe("");
    expect(q.answer).toMatch(MATH);
    expect(q.explanation).toContain("giải thích");
  });

  it("Test D2: 'Đáp án:' followed by a plain-text paragraph", async () => {
    const r = await parse([
      p(t("PHẦN III")),
      p(t("Câu 3. Nội dung")),
      p(t("Đáp án:")),
      p(t("0,67")),
      p(t("Lời giải:")),
      p(t("abc")),
    ]);
    expect(r.partIII[0].answer).toBe("0,67");
  });

  it("Test E: no regression on plain formats", async () => {
    const r = await parse([
      p(t("PHẦN I")),
      p(t("Câu 1. Nội dung")),
      p(t("A. a1 B. b1 *C. c1 D. d1")),
      p(t("PHẦN II")),
      p(t("Câu 2. ND2")),
      p(t("a) x *b) y c) z d) w")),
      p(t("PHẦN III")),
      p(t("Câu 3. ND3")),
      p(t("Đáp án: 14,5")),
      p(t("Lời giải:")),
      p(t("vì vậy")),
    ]);
    expect(r.partI[0].answer).toBe("C");
    expect(r.partI[0].options.map((o) => o.text)).toEqual(["a1", "b1", "c1", "d1"]);
    expect(r.partII[0].items.map((i) => i.correct)).toEqual([false, true, false, false]);
    expect(r.partIII[0].answer).toBe("14,5");
    expect(stripRich(r.partIII[0].text)).toContain("ND3");
    expect(r.partIII[0].explanation).toContain("vì vậy");
  });
});
