import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import JSZip from "jszip";
import RichText from "@/components/RichText";
import { escapeLatexPercent, ommlElementToLatex } from "@/lib/ommlToLatex";
import { encMath, parseDocx } from "@/lib/docxParser";
import katex from "katex";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

const t = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
const eq = (s: string) => `<m:oMath><m:r><m:t>${s}</m:t></m:r></m:oMath>`;
const p = (inner: string) => `<w:p>${inner}</w:p>`;

async function parseParas(paras: string[]) {
  const xml = `<?xml version="1.0"?><w:document ${W} ${M}><w:body>${paras.join("")}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  const file = {
    arrayBuffer: async () => blob,
  } as unknown as File;
  return parseDocx(file);
}

describe("Formula % recognition and preservation", () => {
  describe("escapeLatexPercent helper", () => {
    it("escapes unescaped percent signs across all required cases", () => {
      expect(escapeLatexPercent("0.34%")).toBe("0.34\\%");
      expect(escapeLatexPercent("25%")).toBe("25\\%");
      expect(escapeLatexPercent("12.5%")).toBe("12.5\\%");
      expect(escapeLatexPercent("100%")).toBe("100\\%");
      expect(escapeLatexPercent("0.34\\%")).toBe("0.34\\%");
      expect(escapeLatexPercent("50 \\pm 2%")).toBe("50 \\pm 2\\%");
      expect(escapeLatexPercent("Tỉ lệ = 25%")).toBe("Tỉ lệ = 25\\%");
      expect(escapeLatexPercent("\\frac{1}{2}%")).toBe("\\frac{1}{2}\\%");
      expect(escapeLatexPercent("10^3 \\cdot 5%")).toBe("10^3 \\cdot 5\\%");
      expect(escapeLatexPercent("100%%")).toBe("100\\%\\%");
    });
  });

  describe("KaTeX rendering preserves % with escapeLatexPercent", () => {
    const requiredCases = [
      "0.34%",
      "25%",
      "12.5%",
      "100%",
      "0.34\\%",
      "50 \\pm 2%",
      "\\text{Tỉ lệ} = 25%",
      "\\frac{1}{2}%",
      "10^3 \\cdot 5%",
    ];

    for (const testCase of requiredCases) {
      it(`renders % in HTML for formula: ${testCase}`, () => {
        const safe = escapeLatexPercent(testCase);
        const html = katex.renderToString(safe, { throwOnError: false });
        expect(html).toContain("%");
      });
    }
  });

  describe("Word DOCX equation (OMML) containing %", () => {
    it("converts OMML <m:t>0.34%</m:t> into 0.34\\%", () => {
      const xmlDoc = new DOMParser().parseFromString(
        `<m:oMath ${M}><m:r><m:t>0.34%</m:t></m:r></m:oMath>`,
        "application/xml"
      );
      const latex = ommlElementToLatex(xmlDoc.documentElement);
      expect(latex).toBe("0.34\\%");
    });

    it("parses DOCX with equation containing 0.34% and preserves % in question", async () => {
      const r = await parseParas([
        p(t("PHẦN I")),
        p(t("Câu 1. Lò đốt chứa ") + eq("0.34%") + t(" thể tích khí.")),
        p(t("*A. ") + eq("25%")),
        p(t("B. ") + eq("12.5%")),
        p(t("C. ") + eq("100%")),
        p(t("D. ") + eq("50 \\pm 2%")),
      ]);

      expect(r.partI).toHaveLength(1);
      const q = r.partI[0];
      expect(q.text).toContain("%");
      expect(q.text).toContain("0.34\\%");
      expect(q.options[0].text).toContain("25\\%");
      expect(q.options[1].text).toContain("12.5\\%");
      expect(q.options[2].text).toContain("100\\%");
      expect(q.options[3].text).toContain("50 \\pm 2\\%");
    });

    it("preserves % in plain text without math tags", async () => {
      const r = await parseParas([
        p(t("PHẦN I")),
        p(t("Câu 1. Lò đốt chứa 0.34% thể tích khí.")),
        p(t("*A. 25%")),
        p(t("B. 12.5%")),
        p(t("C. 100%")),
        p(t("D. 50%")),
      ]);

      expect(r.partI).toHaveLength(1);
      const q = r.partI[0];
      expect(q.text).toContain("0.34%");
      expect(q.options[0].text).toContain("25%");
      expect(q.options[1].text).toContain("12.5%");
      expect(q.options[2].text).toContain("100%");
      expect(q.options[3].text).toContain("50%");
    });
  });

  describe("RichText component renders % properly", () => {
    it("renders inline math $0.34%$ with % symbol", () => {
      const { container } = render(<RichText text="Lò đốt chứa $0.34%$ thể tích khí." />);
      expect(container.textContent).toContain("0.34%");
      expect(container.textContent).toContain("Lò đốt chứa");
      expect(container.textContent).toContain("thể tích khí.");
    });

    it("renders encoded MATH token ⟦MATH:0.34%⟧ with % symbol", () => {
      const encoded = `Lò đốt chứa ${encMath("0.34%")} thể tích khí.`;
      const { container } = render(<RichText text={encoded} />);
      expect(container.textContent).toContain("0.34%");
    });

    it("renders encoded MATH token ⟦MATH:0.34\\%⟧ with % symbol", () => {
      const encoded = `Lò đốt chứa ${encMath("0.34\\%")} thể tích khí.`;
      const { container } = render(<RichText text={encoded} />);
      expect(container.textContent).toContain("0.34%");
    });

    it("renders fractions and exponents with %: $\\frac{1}{2}%$ and $10^3 \\cdot 5%$", () => {
      const { container } = render(
        <RichText text="Biểu thức 1: $\\frac{1}{2}%$ và biểu thức 2: $10^3 \\cdot 5%$" />
      );
      expect(container.textContent).toContain("%");
    });
  });
});
