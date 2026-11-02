import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Single Question Mode - Part 2 True/False Layout Verification", () => {
  const takeFilePath = path.resolve(__dirname, "../pages/Take.tsx");
  const takeContent = fs.readFileSync(takeFilePath, "utf-8");

  const teamTakeFilePath = path.resolve(__dirname, "../pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakeFilePath, "utf-8");

  it("should format Part 2 True/False in Single Question Mode so that each option (a, b, c, d) occupies its own separate line", () => {
    // Check that the container is a flex-col vertical list, NOT a 2-column grid
    expect(takeContent).toContain('data-mode="single-question"');
    expect(takeContent).toContain('data-section="part-2"');
    expect(takeContent).toContain('data-type="true-false"');
    expect(takeContent).toContain('single-question-tf-list');

    // Ensure it does NOT use grid-cols-2 in Part 2 of Single Question mode
    const tfSectionMatch = takeContent.match(
      /data-section="part-2"[\s\S]*?single-question-tf-list[\s\S]*?<\/RadioGroup>|data-section="part-2"[\s\S]*?single-question-tf-list[\s\S]*?câu hỏi trả lời ngắn/i
    );
    expect(tfSectionMatch).not.toBeNull();
    const tfSectionCode = tfSectionMatch![0];

    expect(tfSectionCode).toContain("flex flex-col");
    expect(tfSectionCode).not.toContain("xl:grid-cols-2");
    expect(tfSectionCode).not.toContain("md:grid-cols-2");
    expect(tfSectionCode).not.toContain("sm:grid-cols-2");

    // Each option item is a full-width block (w-full) on its own row
    expect(tfSectionCode).toContain("single-question-tf-item w-full");
    expect(tfSectionCode).toContain('data-tf-item={label}');
    expect(tfSectionCode).toContain("flex-col md:flex-row items-start md:items-center justify-between");
  });

  it("should preserve Part 1 MCQ 2x2 grid in Single Question Mode without changes", () => {
    // Verify Part 1 (MCQ) still uses the 2-column grid layout
    expect(takeContent).toContain('grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 lg:gap-5 w-full');
  });

  it("should preserve Standard Mode TF layout without modifications", () => {
    // In Standard mode, buttons are on the left and unchanged
    expect(takeContent).toContain("{/* PHẦN II: Trắc nghiệm Đúng / Sai (Nút Đúng/Sai bên TRÁI, nhận định bên PHẢI) */}");
    expect(takeContent).toContain("border-teal-600 bg-teal-600 text-white");
  });

  it("should preserve Team Mode without modifications", () => {
    // In TeamTake.tsx, team layout remains completely untouched
    expect(teamTakeContent).toContain("LeaderboardBoard");
    expect(teamTakeContent).toContain("team-sync-font-size");
  });
});
