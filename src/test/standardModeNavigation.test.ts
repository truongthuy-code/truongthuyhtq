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

  it("should preserve standard navigation buttons: ‹ Câu trước, Trả lời, Câu sau ›, Nộp bài", () => {
    // ‹ Câu trước
    expect(takeCode).toContain("‹ Câu trước");

    // Trả lời & Đã trả lời
    expect(takeCode).toContain("handleStandardAnswer(currentQ)");
    expect(takeCode).toContain("<span>Trả lời</span>");
    expect(takeCode).toContain("<span>Đã trả lời</span>");

    // Câu sau & Nộp bài
    expect(takeCode).toContain("<span>Câu sau ›</span>");
    expect(takeCode).toContain("<span>Nộp bài</span>");
  });

  it("should have balanced flex justify-between alignment for the 3 controls (Previous, Answer, Next/Submit)", () => {
    expect(takeCode).toContain("NÚT ĐIỀU HƯỚNG DƯỚI CÂU HỎI: ‹ Câu trước | Trả lời | Câu sau ›");
  });
});
