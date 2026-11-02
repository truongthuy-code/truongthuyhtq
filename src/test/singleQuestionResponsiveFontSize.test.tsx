import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import RichText from "@/components/RichText";

describe("RESPONSIVE FONT SIZE VERIFICATION IN SINGLE QUESTION MODE", () => {
  const cssPath = path.resolve(process.cwd(), "src/index.css");
  const css = fs.readFileSync(cssPath, "utf-8");

  const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
  const takeCode = fs.readFileSync(takePath, "utf-8");

  it("1. Mobile breakpoint (<640px) configures Question=30px and Options=22px", () => {
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?--quiz-q-font-size:\s*30px/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?--quiz-opt-font-size:\s*22px/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?\.quiz-question-tv[\s\S]*?font-size:\s*30px\s*!important/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?\.quiz-option-tv[\s\S]*?font-size:\s*22px\s*!important/);
  });

  it("2. Tablet breakpoint (640px to <1024px) configures Question=32px and Options=24px", () => {
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?--quiz-q-font-size:\s*32px/);
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?--quiz-opt-font-size:\s*24px/);
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?\.quiz-question-tv[\s\S]*?font-size:\s*32px\s*!important/);
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?\.quiz-option-tv[\s\S]*?font-size:\s*24px\s*!important/);
  });

  it("3. Desktop (>=1024px) retains 100% of the TV projection styles without modification", () => {
    // Root base variables for desktop
    expect(css).toContain("--quiz-q-font-size: clamp(35px, 2.45vw, 47px);");
    expect(css).toContain("--quiz-opt-font-size: clamp(27px, 1.95vw, 37px);");

    // TV class definitions
    expect(css).toContain(".quiz-question-tv,");
    expect(css).toContain(".quiz-option-tv,");
    expect(css).toContain("font-size: var(--quiz-q-font-size, 47px) !important;");
    expect(css).toContain("font-size: var(--quiz-opt-font-size, 37px) !important;");
  });

  it("4. Take.tsx components in Single Question mode bind quiz-question-tv and quiz-option-tv across Parts I, II, III", () => {
    // Part I: Question uses qFontSizeClass (.quiz-question-tv) and Options use optFontSizeClass (.quiz-option-tv)
    expect(takeCode).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeCode).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');

    // Part II: True/False prompt uses qFontSizeClass and options use optFontSizeClass
    expect(takeCode).toMatch(/data-mode="single-question"[\s\S]*?qFontSizeClass[\s\S]*?optFontSizeClass/);

    // Part III: Short answer label uses qFontSizeClass and Input uses optFontSizeClass
    expect(takeCode).toMatch(/currentQ\.type === "sa"[\s\S]*?qFontSizeClass[\s\S]*?optFontSizeClass/);
  });

  it("5. Code blocks (pre, code, .code-content, .hljs) and formulas (katex) are strictly excluded from overrides", () => {
    // Media query mobile excludes code
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?:not\(pre\):not\(pre \*\):not\(code\):not\(code \*\):not\(\.hljs\):not\(\.hljs \*\):not\(\.code-content\):not\(\.code-content \*\):not\(\.katex\):not\(\.katex \*\)/);

    // Media query tablet excludes code
    expect(css).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?:not\(pre\):not\(pre \*\):not\(code\):not\(code \*\):not\(\.hljs\):not\(\.hljs \*\):not\(\.code-content\):not\(\.code-content \*\):not\(\.katex\):not\(\.katex \*\)/);
  });

  it("6. Multi-paragraph scenario questions in Single Question mode render cleanly without code blocks", () => {
    const multiParaQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ. Để kết nối phòng máy này với mạng Internet toàn cầu, nhà trường đăng ký đường truyền cáp quang với nhà cung cấp dịch vụ VNPT và lắp đặt thêm một bộ định tuyến Router.</i>";

    const { container } = render(
      <div className="font-bold text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80 leading-relaxed text-foreground tracking-tight mb-4 question-content font-times-new-roman quiz-sync-font-size break-words">
        <RichText text={multiParaQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
    expect(container.textContent).toContain("Xét tình huống");
    expect(container.textContent).toContain("Một trường THPT triển khai");
  });

  it("7. Standard mode and Team mode are completely unaffected", () => {
    // Standard mode classes are intact
    expect(css).toContain(".standard-question-stem {");
    expect(css).toContain(".standard-option-text {");
    expect(takeCode).toContain("standard-question-stem");
    expect(takeCode).toContain("standard-option-text");

    // Team mode classes are intact
    expect(css).toContain(".team-question-stem {");
    expect(css).toContain(".team-option-text {");
  });
});
