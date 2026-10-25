import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx, stripRich } from "@/lib/docxParser";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PIC = 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const V = 'xmlns:v="urn:schemas-microsoft-com:vml"';
const O = 'xmlns:o="urn:schemas-microsoft-com:office:office"';

const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;
const omml = (inner: string) => `<m:oMath>${inner}</m:oMath>`;
const drawing = (rid: string) =>
  `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

async function createDocxFile(paras: string[], extraFiles?: Record<string, string | Uint8Array>, images?: string[]) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W} ${M} ${R} ${A} ${PIC} ${WP} ${MC} ${V} ${O}><w:body>${paras.join("")}</w:body></w:document>`;
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

describe("Comprehensive DOCX recognition tests (Test A to Test I)", () => {
  // Test A: Đề chỉ có text
  it("Test A: Đề chỉ có text", async () => {
    const file = await createDocxFile([
      p(t("PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.")),
      p(t("Câu 1. Thủ đô của Việt Nam là gì?")),
      p(t("A. Hải Phòng")),
      p(t("*B. Hà Nội")),
      p(t("C. Đà Nẵng")),
      p(t("D. Cần Thơ")),
    ]);
    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].text).toBe("Thủ đô của Việt Nam là gì?");
    expect(parsed.partI[0].answer).toBe("B");
    expect(parsed.partI[0].options.map((o) => o.text)).toEqual(["Hải Phòng", "Hà Nội", "Đà Nẵng", "Cần Thơ"]);
  });

  // Test B: Đề có hình ảnh (inline, floating, vml)
  it("Test B: Đề có hình ảnh (inline, floating, vml)", async () => {
    const vmlImage = `<w:r><w:pict><v:shape id="_x0000_s1026"><v:imagedata r:id="rId1" o:title="vml-img"/></v:shape></w:pict></w:r>`;
    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Cho hình vẽ sau đây:")),
      p(drawing("rId0")),
      p(vmlImage),
      p(t("A. Đúng")),
      p(t("*B. Sai")),
      p(t("C. Không rõ")),
      p(t("D. Khác")),
    ], undefined, ["rId0", "rId1"]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].text).toContain("\u27E6IMG:");
    expect(parsed.partI[0].text.split("\u27E6IMG:").length - 1).toBe(2);
  });

  // Test C: Đề có công thức toán (phân số, căn, hệ phương trình)
  it("Test C: Đề có công thức toán (phân số, căn, hệ phương trình)", async () => {
    // Fraction: 1 / 2, Sqrt: \sqrt{x+1}, System: \begin{cases}
    const fracOMML = `<m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>`;
    const radOMML = `<m:rad><m:deg/><m:e><m:r><m:t>x+1</m:t></m:r></m:e></m:rad>`;
    const eqArrOMML = `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e><m:r><m:t>x+y=1</m:t></m:r></m:e><m:e><m:r><m:t>x-y=0</m:t></m:r></m:e></m:d>`;

    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Giải hệ phương trình ") + omml(eqArrOMML)),
      p(t("Biết phân số ") + omml(fracOMML) + t(" và căn ") + omml(radOMML)),
      p(t("A. x = 1")),
      p(t("*B. x = 2")),
      p(t("C. x = 3")),
      p(t("D. x = 4")),
    ]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    const stem = parsed.partI[0].text;
    expect(stem).toContain("\\begin{cases}");
    expect(stem).toContain("\\frac{1}{2}");
    expect(stem).toContain("\\sqrt{x+1}");
  });

  // Test D: Đề có MathType / Equation (OLE trong Choice / Fallback)
  it("Test D: Đề có MathType / Equation OLE và Fallback image", async () => {
    const fallbackWithOle = `
      <w:r>
        <mc:AlternateContent>
          <mc:Choice Requires="wps">
            <w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId0"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>
          </mc:Choice>
          <mc:Fallback>
            <w:object>
              <v:shape><v:imagedata r:id="rId0"/></v:shape>
              <o:OLEObject ProgID="Equation.3" r:id="oleObject1"/>
            </w:object>
          </mc:Fallback>
        </mc:AlternateContent>
      </w:r>`;

    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Cho biểu thức sau: ") + fallbackWithOle),
      p(t("A. 1")),
      p(t("*B. 2")),
      p(t("C. 3")),
      p(t("D. 4")),
    ], undefined, ["rId0"]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    // Since oleObject1 binary is not provided in extraFiles, it seamlessly falls back to the preview image rId0
    expect(parsed.partI[0].text).toContain("\u27E6IMG:");
  });

  // Test E: Công thức trong phương án
  it("Test E: Công thức trong phương án (nhiều lựa chọn trên 1 dòng & riêng dòng)", async () => {
    const frac = `<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>`;
    const sup = `<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>`;

    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Giá trị của biểu thức là:")),
      p(t("A. ") + omml(frac) + t("\t*B. ") + omml(sup) + t("\tC. 0\tD. 1")),
    ]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].options).toHaveLength(4);
    expect(parsed.partI[0].options[0].text).toContain("\\frac{a}{b}");
    expect(parsed.partI[0].options[1].text).toContain("{x}^{2}");
    expect(parsed.partI[0].answer).toBe("B");
  });

  // Test F: Hình ảnh trong phương án
  it("Test F: Hình ảnh trong phương án", async () => {
    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Đồ thị nào sau đây là hàm số bậc hai?")),
      p(t("A. ") + drawing("rId0")),
      p(t("*B. ") + drawing("rId1")),
      p(t("C. ") + drawing("rId2")),
      p(t("D. ") + drawing("rId3")),
    ], undefined, ["rId0", "rId1", "rId2", "rId3"]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].answer).toBe("B");
    for (let i = 0; i < 4; i++) {
      expect(parsed.partI[0].options[i].text).toContain("\u27E6IMG:");
    }
  });

  // Test G: Câu hỏi có cả hình ảnh và công thức, bảo toàn thứ tự
  it("Test G: Câu hỏi có cả hình ảnh và công thức, bảo toàn thứ tự", async () => {
    const eq1 = `<m:r><m:t>y = f(x)</m:t></m:r>`;

    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Cho hàm số ") + omml(eq1) + t(". Biết rằng:")),
      p(drawing("rId0")),
      p(t("Hãy chọn đáp án đúng.")),
      p(t("*A. Đúng")),
      p(t("B. Sai")),
      p(t("C. Chưa biết")),
      p(t("D. Không có")),
    ], undefined, ["rId0"]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    const stem = parsed.partI[0].text;

    // Check exact sequence: Text -> Math -> Text -> Img -> Text
    const mathIdx = stem.indexOf("\u27E6MATH:y = f(x)\u27E7");
    const imgIdx = stem.indexOf("\u27E6IMG:");
    const textBeforeMath = stem.indexOf("Cho hàm số");
    const textBetween = stem.indexOf("Biết rằng:");
    const textAfter = stem.indexOf("Hãy chọn đáp án đúng.");

    expect(textBeforeMath).toBeLessThan(mathIdx);
    expect(mathIdx).toBeLessThan(textBetween);
    expect(textBetween).toBeLessThan(imgIdx);
    expect(imgIdx).toBeLessThan(textAfter);
  });

  // Test H: Hình ảnh / công thức trong bảng
  it("Test H: Hình ảnh / công thức trong bảng", async () => {
    const tableXml = `
      <w:tbl>
        <w:tr>
          <w:tc><w:p>${t("Cột 1")}</w:p></w:tc>
          <w:tc><w:p>${t("Cột 2")}</w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p>${omml("<m:r><m:t>f(x)=x^2</m:t></m:r>")}</w:p></w:tc>
          <w:tc><w:p>${drawing("rId0")}</w:p></w:tc>
        </w:tr>
      </w:tbl>`;

    const file = await createDocxFile([
      p(t("PHẦN I")),
      p(t("Câu 1. Bảng số liệu sau:")),
      tableXml,
      p(t("*A. Đúng")),
      p(t("B. Sai")),
      p(t("C. Cả hai")),
      p(t("D. Không")),
    ], undefined, ["rId0"]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].text).toContain("\u27E6TBL:");
    expect(decodeURIComponent(parsed.partI[0].text)).toContain("f(x)=x^2");
    expect(decodeURIComponent(parsed.partI[0].text)).toContain("\u27E6IMG:");
  });

  // Test I: Đề có nhiều phần (Phần I, Phần II, Phần III)
  it("Test I: Đề có nhiều phần (Phần I, Phần II, Phần III)", async () => {
    const file = await createDocxFile([
      p(t("PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.")),
      p(t("Câu 1. Câu hỏi phần 1")),
      p(t("A. 1")),
      p(t("*B. 2")),
      p(t("C. 3")),
      p(t("D. 4")),
      p(t("PHẦN II. Câu trắc nghiệm đúng sai.")),
      p(t("Câu 1. Câu hỏi phần 2")),
      p(t("a) Ý 1")),
      p(t("*b) Ý 2")),
      p(t("c) Ý 3")),
      p(t("d) Ý 4")),
      p(t("PHẦN III. Câu trắc nghiệm trả lời ngắn.")),
      p(t("Câu 1. Câu hỏi phần 3")),
      p(t("Đáp án: 42")),
    ]);

    const parsed = await parseDocx(file);
    expect(parsed.partI).toHaveLength(1);
    expect(parsed.partI[0].answer).toBe("B");
    expect(parsed.partII).toHaveLength(1);
    expect(parsed.partII[0].items.map((i) => i.correct)).toEqual([false, true, false, false]);
    expect(parsed.partIII).toHaveLength(1);
    expect(parsed.partIII[0].answer).toBe("42");
  });
});
