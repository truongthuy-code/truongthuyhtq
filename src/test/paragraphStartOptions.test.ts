import { describe, it, expect } from "vitest";
import {
  detectOptionMarkerAtParaStart,
  parseDocx,
  stripRich,
} from "../lib/docxParser";
import { parseTextExam } from "../lib/textExamParser";
import JSZip from "jszip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const p = (inner: string) => `<w:p>${inner}</w:p>`;
const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const tRed = (text: string) =>
  `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const tUnderline = (text: string) =>
  `<w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

async function buildDocxFile(paras: string[]): Promise<File> {
  const xml = `<?xml version="1.0"?><w:document ${W} ${M} ${R}><w:body>${paras.join("")}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return { arrayBuffer: async () => blob } as unknown as File;
}

describe("Nhận dạng phương án chỉ ở ĐẦU ĐOẠN (paragraph)", () => {
  describe("detectOptionMarkerAtParaStart", () => {
    it("nhận dạng chính xác các ký hiệu A. B. C. D. ở đầu đoạn", () => {
      const pA = {
        toks: [{ kind: "text" as const, text: "A. Nội dung phương án A", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "A. Nội dung phương án A",
        rich: "A. Nội dung phương án A",
        hasAnyMark: false,
      };
      const resA = detectOptionMarkerAtParaStart(pA);
      expect(resA).not.toBeNull();
      expect(resA?.key).toBe("A");
      expect(resA?.delim).toBe(".");
      expect(resA?.isMarked).toBe(false);

      const pB = {
        toks: [{ kind: "text" as const, text: "B. Phương án B", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "B. Phương án B",
        rich: "B. Phương án B",
        hasAnyMark: false,
      };
      const resB = detectOptionMarkerAtParaStart(pB);
      expect(resB?.key).toBe("B");
      expect(resB?.delim).toBe(".");
    });

    it("nhận dạng chính xác các ký hiệu a) b) c) d) ở đầu đoạn", () => {
      const pa = {
        toks: [{ kind: "text" as const, text: "a) Nội dung phương án A", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "a) Nội dung phương án A",
        rich: "a) Nội dung phương án A",
        hasAnyMark: false,
      };
      const resa = detectOptionMarkerAtParaStart(pa);
      expect(resa).not.toBeNull();
      expect(resa?.key).toBe("a");
      expect(resa?.delim).toBe(")");
      expect(resa?.isMarked).toBe(false);

      const pb = {
        toks: [{ kind: "text" as const, text: "b) Nội dung phương án B", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "b) Nội dung phương án B",
        rich: "b) Nội dung phương án B",
        hasAnyMark: false,
      };
      const resb = detectOptionMarkerAtParaStart(pb);
      expect(resb?.key).toBe("b");
      expect(resb?.delim).toBe(")");
    });

    it("nhận dạng đúng đáp án được đánh dấu bằng '*', chữ màu đỏ hoặc gạch chân", () => {
      // Dấu *
      const pStar = {
        toks: [{ kind: "text" as const, text: "*A. Phương án đúng", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "*A. Phương án đúng",
        rich: "*A. Phương án đúng",
        hasAnyMark: false,
      };
      const resStar = detectOptionMarkerAtParaStart(pStar);
      expect(resStar?.key).toBe("A");
      expect(resStar?.isMarked).toBe(true);

      // Chữ màu đỏ
      const pRed = {
        toks: [{ kind: "text" as const, text: "b) Phương án đỏ", props: { red: true, underline: false, mono: false, bold: false } }],
        plain: "b) Phương án đỏ",
        rich: "b) Phương án đỏ",
        hasAnyMark: true,
      };
      const resRed = detectOptionMarkerAtParaStart(pRed);
      expect(resRed?.key).toBe("b");
      expect(resRed?.isMarked).toBe(true);

      // Gạch chân
      const pUnderline = {
        toks: [{ kind: "text" as const, text: "C. Phương án gạch chân", props: { red: false, underline: true, mono: false, bold: false } }],
        plain: "C. Phương án gạch chân",
        rich: "C. Phương án gạch chân",
        hasAnyMark: true,
      };
      const resUnderline = detectOptionMarkerAtParaStart(pUnderline);
      expect(resUnderline?.key).toBe("C");
      expect(resUnderline?.isMarked).toBe(true);
    });

    it("KHÔNG nhận dạng khi a), b), c), d), A., B., C., D. nằm ở GIỮA nội dung đoạn", () => {
      // a) và b) ở giữa câu
      const pMid1 = {
        toks: [{
          kind: "text" as const,
          text: "Cho hàm số f(x) thỏa mãn: a) liên tục trên R và b) đồng biến trên khoảng (0, 1).",
          props: { red: false, underline: false, mono: false, bold: false },
        }],
        plain: "Cho hàm số f(x) thỏa mãn: a) liên tục trên R và b) đồng biến trên khoảng (0, 1).",
        rich: "Cho hàm số f(x) thỏa mãn: a) liên tục trên R và b) đồng biến trên khoảng (0, 1).",
        hasAnyMark: false,
      };
      expect(detectOptionMarkerAtParaStart(pMid1)).toBeNull();

      // A. và B. ở giữa câu
      const pMid2 = {
        toks: [{
          kind: "text" as const,
          text: "Xét tam giác ABC có đỉnh A. nằm trên trục tung và đỉnh B. nằm trên trục hoành.",
          props: { red: false, underline: false, mono: false, bold: false },
        }],
        plain: "Xét tam giác ABC có đỉnh A. nằm trên trục tung và đỉnh B. nằm trên trục hoành.",
        rich: "Xét tam giác ABC có đỉnh A. nằm trên trục tung và đỉnh B. nằm trên trục hoành.",
        hasAnyMark: false,
      };
      expect(detectOptionMarkerAtParaStart(pMid2)).toBeNull();

      // Từ ngữ thông thường bắt đầu bằng A, B, C, D
      const pWord = {
        toks: [{ kind: "text" as const, text: "Anh ấy đi học vào buổi sáng.", props: { red: false, underline: false, mono: false, bold: false } }],
        plain: "Anh ấy đi học vào buổi sáng.",
        rich: "Anh ấy đi học vào buổi sáng.",
        hasAnyMark: false,
      };
      expect(detectOptionMarkerAtParaStart(pWord)).toBeNull();
    });
  });

  describe("parseDocx với các đoạn Word thực tế", () => {
    it("nhận dạng đề 4 phương án A. B. C. D. ở đầu mỗi paragraph", async () => {
      const file = await buildDocxFile([
        p(t("PHẦN I")),
        p(t("Câu 1. Cho hàm số y = f(x) liên tục trên R.")),
        p(t("A. Phương án A")),
        p(t("B. Phương án B")),
        p(t("*C. Phương án C")),
        p(t("D. Phương án D")),
      ]);
      const exam = await parseDocx(file);
      expect(exam.partI).toHaveLength(1);
      const q = exam.partI[0];
      expect(stripRich(q.text)).toBe("Cho hàm số y = f(x) liên tục trên R.");
      expect(q.options).toHaveLength(4);
      expect(q.options[0].text).toBe("Phương án A");
      expect(q.options[1].text).toBe("Phương án B");
      expect(q.options[2].text).toBe("Phương án C");
      expect(q.options[3].text).toBe("Phương án D");
      expect(q.answer).toBe("C");
    });

    it("nhận dạng đề 4 phương án a) b) c) d) ở đầu mỗi paragraph", async () => {
      const file = await buildDocxFile([
        p(t("PHẦN I")),
        p(t("Câu 1. Nguyên hàm của hàm số f(x) = 2x là:")),
        p(t("a) x^2 + C")),
        p(t("*b) 2x^2 + C")),
        p(t("c) x^2")),
        p(t("d) 2 + C")),
      ]);
      const exam = await parseDocx(file);
      expect(exam.partI).toHaveLength(1);
      const q = exam.partI[0];
      expect(q.options).toHaveLength(4);
      expect(q.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
      expect(q.options[0].text).toBe("x^2 + C");
      expect(q.options[1].text).toBe("2x^2 + C");
      expect(q.answer).toBe("B");
    });

    it("giữ nguyên văn bản khi a), b), c), d), A., B. xuất hiện ở giữa đoạn thân câu hỏi", async () => {
      const file = await buildDocxFile([
        p(t("PHẦN I")),
        p(t("Câu 1. Cho hàm số f(x) có tính chất: a) f(1) = 2 và b) f(2) = 5. Biết điểm A. thuộc đồ thị và B. là điểm cực trị. Giá trị nhỏ nhất là:")),
        p(t("A. 1")),
        p(t("B. 2")),
        p(t("C. 3")),
        p(t("*D. 4")),
      ]);
      const exam = await parseDocx(file);
      expect(exam.partI).toHaveLength(1);
      const q = exam.partI[0];
      // Kiểm tra toàn bộ đoạn văn bản ở thân câu hỏi không bị cắt xén
      expect(stripRich(q.text)).toContain("a) f(1) = 2");
      expect(stripRich(q.text)).toContain("b) f(2) = 5");
      expect(stripRich(q.text)).toContain("điểm A. thuộc đồ thị");
      expect(stripRich(q.text)).toContain("và B. là điểm cực trị");
      // 4 phương án vẫn chính xác
      expect(q.options).toHaveLength(4);
      expect(q.options.map((o) => o.text)).toEqual(["1", "2", "3", "4"]);
      expect(q.answer).toBe("D");
    });

    it("giữ nguyên nội dung phương án khi có chữ A., B., a), b) ở giữa nội dung phương án", async () => {
      const file = await buildDocxFile([
        p(t("PHẦN I")),
        p(t("Câu 1. Khẳng định nào sau đây là đúng?")),
        p(t("A. Điểm A. có tọa độ (1; 2) và thỏa mãn điều kiện a) nhỏ hơn 0")),
        p(t("*B. Điểm B. có tọa độ (3; 4) và thỏa mãn điều kiện b) lớn hơn 0")),
        p(t("C. Cả hai điểm A. và B. đều nằm ngoài đường tròn")),
        p(t("D. Không có điểm nào thỏa mãn")),
      ]);
      const exam = await parseDocx(file);
      expect(exam.partI).toHaveLength(1);
      const q = exam.partI[0];
      expect(q.options).toHaveLength(4);
      expect(q.options[0].text).toBe("Điểm A. có tọa độ (1; 2) và thỏa mãn điều kiện a) nhỏ hơn 0");
      expect(q.options[1].text).toBe("Điểm B. có tọa độ (3; 4) và thỏa mãn điều kiện b) lớn hơn 0");
      expect(q.options[2].text).toBe("Cả hai điểm A. và B. đều nằm ngoài đường tròn");
      expect(q.options[3].text).toBe("Không có điểm nào thỏa mãn");
      expect(q.answer).toBe("B");
    });

    it("nhận dạng Phần II Đúng/Sai với các ý a) b) c) d) ở đầu đoạn", async () => {
      const file = await buildDocxFile([
        p(t("PHẦN II")),
        p(t("Câu 1. Cho hàm số bậc ba y = f(x).")),
        p(t("a) Hàm số đồng biến trên R")),
        p(tRed("b) Điểm uốn của đồ thị có tọa độ (0; 1)")),
        p(tUnderline("c) Đồ thị cắt trục tung tại điểm có tung độ bằng 1")),
        p(t("d) Hàm số có hai điểm cực trị")),
      ]);
      const exam = await parseDocx(file);
      expect(exam.partII).toHaveLength(1);
      const q = exam.partII[0];
      expect(q.items).toHaveLength(4);
      expect(q.items.map((i) => i.key)).toEqual(["a", "b", "c", "d"]);
      expect(q.items[0].correct).toBe(false);
      expect(q.items[1].correct).toBe(true); // đỏ
      expect(q.items[2].correct).toBe(true); // gạch chân
      expect(q.items[3].correct).toBe(false);
    });
  });

  describe("parseTextExam", () => {
    it("nhận dạng chính xác dạng text với A. B. C. D. và a) b) c) d) ở đầu dòng", () => {
      const raw = `PHẦN I
Câu 1. Thân câu hỏi có chứa a) và b) ở giữa văn bản cũng như điểm A. và B.
A. Phương án 1
*B. Phương án 2
C. Phương án 3
D. Phương án 4

Câu 2. Câu hỏi thứ hai dùng marker a) b) c) d)
a) Lựa chọn 1
b) Lựa chọn 2
*c) Lựa chọn 3
d) Lựa chọn 4`;

      const exam = parseTextExam(raw);
      expect(exam.partI).toHaveLength(2);
      expect(exam.partI[0].text).toContain("chứa a) và b) ở giữa văn bản cũng như điểm A. và B.");
      expect(exam.partI[0].options.map((o) => o.text)).toEqual([
        "Phương án 1",
        "Phương án 2",
        "Phương án 3",
        "Phương án 4",
      ]);
      expect(exam.partI[0].answer).toBe("B");

      expect(exam.partI[1].options.map((o) => o.text)).toEqual([
        "Lựa chọn 1",
        "Lựa chọn 2",
        "Lựa chọn 3",
        "Lựa chọn 4",
      ]);
      expect(exam.partI[1].answer).toBe("C");
    });
  });
});
