import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Standard Mode Navigation UI - Skip Button Removal", () => {
  const takeFilePath = path.resolve(__dirname, "../pages/Take.tsx");
  const takeCode = fs.readFileSync(takeFilePath, "utf-8");

  it("should not contain the 'Bỏ qua' button or SkipForward icon in the Standard Mode navigation bar", () => {
    // Check that SkipForward is not imported or used
    expect(takeCode).not.toContain("SkipForward");

    // Check that there is no button with 'Bỏ qua'
    expect(takeCode).not.toContain("<span>Bỏ qua</span>");
    expect(takeCode).not.toContain("Bỏ qua câu này");
  });

  it("should preserve standard navigation buttons (‹ Câu trước, Trả lời, Câu sau ›) without duplicate Nộp bài beside Câu sau", () => {
    const controlsSection = takeCode.slice(
      takeCode.indexOf("const renderStandardControlsBar ="),
      takeCode.indexOf("// KHU VỰC BÊN PHẢI: DANH SÁCH CÂU")
    );
    const listCardSection = takeCode.slice(
      takeCode.indexOf("const renderStandardQuestionListCard ="),
      takeCode.indexOf("GIAO DIỆN CHÍNH")
    );

    // ‹ Câu trước
    expect(controlsSection).toContain("‹ Câu trước");

    // Trả lời & Đã trả lời
    expect(controlsSection).toContain("handleStandardAnswer(currentQ)");
    expect(controlsSection).toContain("<span>Trả lời</span>");
    expect(controlsSection).toContain("<span>Đã trả lời</span>");

    // Câu sau present, Nộp bài removed from controls bar beside Câu sau
    expect(controlsSection).toContain("<span>Câu sau ›</span>");
    expect(controlsSection).not.toContain("setConfirmOpen");
    expect(controlsSection).not.toMatch(/Nộp bài|NỘP BÀI/i);

    // NỘP BÀI preserved at the bottom of DANH SÁCH CÂU
    expect(listCardSection).toContain("NỘP BÀI");
    expect(listCardSection).toContain("setConfirmOpen(true)");
  });

  it("should have balanced flex justify-between alignment for the 3 controls (Previous, Answer, Next)", () => {
    expect(takeCode).toContain("NÚT ĐIỀU HƯỚNG DƯỚI CÂU HỎI: ‹ Câu trước | Trả lời | Câu sau ›");
  });
});
