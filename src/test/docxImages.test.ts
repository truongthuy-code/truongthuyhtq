import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocx, hasRichContent, stripRich } from "@/lib/docxParser";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const PIC = 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const WP = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const V = 'xmlns:v="urn:schemas-microsoft-com:vml"';

const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;

/** Inline drawing referencing an image relationship. */
const drawing = (rid: string) =>
  `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** Drawing with an SVG companion blip (must not double-count). */
const svgDrawing = (rid: string, svgRid: string) =>
  `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"><a:extLst><a:ext><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgRid}"/></a:ext></a:extLst></a:blip></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/** AlternateContent: modern drawing + VML fallback of the SAME picture. */
const altDrawing = (rid: string) =>
  `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:imagedata r:id="${rid}"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;

const RIDS = ["rId1", "rId2", "rId3", "rId4", "rId5", "rId6"];

async function parse(paras: string[]) {
  const xml = `<?xml version="1.0"?><w:document ${W} ${M} ${R} ${A} ${PIC} ${WP} ${MC} ${V}><w:body>${paras.join("")}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const rels = RIDS.map(
    (id, i) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${i}.png"/>`,
  ).join("");
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  RIDS.forEach((_, i) => zip.file(`word/media/img${i}.png`, `PNG-${i}`));
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  const file = { arrayBuffer: async () => blob } as unknown as File;
  return parseDocx(file);
}

const imgCount = (s: string) => (s.match(/\u27E6IMG:/g) || []).length;

describe("docx parser – images", () => {
  it("keeps the question picture in the stem and option pictures in options", async () => {
    const r = await parse([
      p(t("PHẦN I")),
      p(t("Câu 1. Quan sát hình vẽ sau:")),
      p(drawing("rId1")),
      p(t("A. ") + drawing("rId2")),
      p(t("B. ") + drawing("rId3")),
      p(drawing("rId4") + t(" C. sau hình")),
      p(t("*D. ") + drawing("rId5") + t(" kèm chữ")),
    ]);
    expect(r.partI).toHaveLength(1);
    const q = r.partI[0];
    expect(imgCount(q.text)).toBe(1);
    expect(q.options).toHaveLength(4);
    expect(q.answer).toBe("D");
    expect(imgCount(q.options[0].text)).toBe(1);
    expect(stripRich(q.options[0].text)).toBe("");
    // Image-only option still counts as real content
    for (const o of q.options) expect(hasRichContent(o.text)).toBe(true);
    // Picture placed before the "C." marker belongs to option B's block
    expect(imgCount(q.options[1].text)).toBe(1 + 1);
    expect(imgCount(q.options[3].text)).toBe(1);
    expect(stripRich(q.options[3].text)).toContain("kèm chữ");
  });

  it("does not duplicate AlternateContent or SVG companion pictures", async () => {
    const r = await parse([
      p(t("PHẦN I")),
      p(t("Câu 1. ") + altDrawing("rId1") + svgDrawing("rId2", "rId3")),
      p(t("A. a")),
      p(t("*B. b")),
      p(t("C. c")),
      p(t("D. d")),
    ]);
    expect(imgCount(r.partI[0].text)).toBe(2);
  });

  it("keeps pictures inside Đúng/Sai items", async () => {
    const r = await parse([
      p(t("PHẦN II")),
      p(t("Câu 1. Cho hình vẽ") ),
      p(drawing("rId1")),
      p(t("a) ") + drawing("rId2")),
      p(t("*b) ") + drawing("rId3")),
      p(t("c) đúng")),
      p(t("d) sai")),
    ]);
    const q = r.partII[0];
    expect(imgCount(q.text)).toBe(1);
    expect(imgCount(q.items[0].text)).toBe(1);
    expect(hasRichContent(q.items[0].text)).toBe(true);
    expect(q.items[1].correct).toBe(true);
  });
});
