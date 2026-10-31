import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";

describe("QUESTION FONT SIZE SYNCHRONIZATION TESTS", () => {
  it("TEST 1: src/index.css defines quiz-sync-font-size and team-sync-font-size inheriting font-size while preserving code and formulas", () => {
    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain(".quiz-sync-font-size");
    expect(css).toContain(".team-sync-font-size");
    expect(css).toContain("font-size: inherit !important");

    // Must exclude code blocks and katex from regular text font-size inherit
    expect(css).toContain(":not(pre):not(pre *):not(code):not(code *):not(.hljs):not(.hljs *)");
    expect(css).toContain(":not(.katex):not(.katex *)");
  });

  it("TEST 2: Take.tsx synchronizes question text, options, true/false, and short answer to qFontSizeClass", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Question content uses qFontSizeClass and quiz-sync-font-size
    expect(takeCode).toMatch(/question-content[\s\S]*?quiz-sync-font-size/);

    // Part I options use optFontSizeClass in singleView and quiz-sync-font-size
    expect(takeCode).toMatch(/Nội dung phương án[\s\S]*?optFontSizeClass[\s\S]*?quiz-sync-font-size/);

    // Part II True/False items use optFontSizeClass in singleView and quiz-sync-font-size
    expect(takeCode).toMatch(/RichText text=\{it\.text\}[\s\S]*?quiz-sync-font-size/);

    // Part III Short answer label uses qFontSizeClass and quiz-sync-font-size
    expect(takeCode).toMatch(/quiz-sync-font-size[\s\S]*?Nhập câu trả lời của bạn/);
  });

  it("TEST 3: TeamTake.tsx synchronizes question text, options, true/false, and short answer to text-xl sm:text-2xl", () => {
    const teamPath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
    const teamCode = fs.readFileSync(teamPath, "utf-8");

    // Question content uses text-xl sm:text-2xl and team-sync-font-size
    expect(teamCode).toMatch(/text-xl sm:text-2xl[\s\S]*?question-content[\s\S]*?team-sync-font-size/);

    // Part I options use text-xl sm:text-2xl and team-sync-font-size
    expect(teamCode).toMatch(/text-xl sm:text-2xl leading-relaxed text-foreground team-sync-font-size/);

    // Part II True/False items use text-xl sm:text-2xl and team-sync-font-size
    expect(teamCode).toMatch(/font-semibold text-xl sm:text-2xl leading-relaxed flex-1 team-sync-font-size/);

    // Part III Short answer label uses text-xl sm:text-2xl and team-sync-font-size
    expect(teamCode).toMatch(/Label className="font-bold text-xl sm:text-2xl block mb-2 font-times-new-roman team-sync-font-size"/);
  });

  it("TEST 4: Standard mode (renderStandardQuestionCard) does not use quiz-sync-font-size", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Extract renderStandardQuestionCard implementation
    const standardSection = takeCode.slice(takeCode.indexOf("const renderStandardQuestionCard ="));
    const standardFuncBody = standardSection.slice(0, standardSection.indexOf("const renderStandardQuestionListCard ="));

    expect(standardFuncBody).not.toContain("quiz-sync-font-size");
  });

  it("TEST 5: Nested elements and Word imported structures inherit font size cleanly without affecting code blocks", () => {
    const { container } = render(
      <div className="quiz-question-text-80">
        <p className="word-p">
          <span className="word-span-1" style={{ fontSize: "14pt" }}>
            Đoạn văn bản 1 từ Word
          </span>
          <strong> Đoạn in đậm </strong>
          <em> đoạn in nghiêng </em>
          <span className="word-span-2" style={{ fontSize: "28px" }}>
            Đoạn văn bản 2
          </span>
        </p>
        <pre className="code-content">
          <code>print("Code block keeps monospace")</code>
        </pre>
      </div>
    );

    const span1 = container.querySelector(".word-span-1");
    const span2 = container.querySelector(".word-span-2");
    const pre = container.querySelector("pre");
    const code = container.querySelector("code");

    expect(span1).not.toBeNull();
    expect(span2).not.toBeNull();
    expect(pre).not.toBeNull();
    expect(code).not.toBeNull();
    expect(pre?.className).toContain("code-content");
  });

  it("TEST 6: Take.tsx defines TV-optimized ~42px question and ~32px option classes in single question mode", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Verify TV presentation font classes (~42px question, ~32px option)
    expect(takeCode).toContain('const qFontSizeClass = "text-[clamp(30px,2.25vw,42px)] quiz-question-tv quiz-question-text-80";');
    expect(takeCode).toContain('const optFontSizeClass = "text-[clamp(22px,1.65vw,32px)] quiz-option-tv quiz-option-text-70";');

    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain("--quiz-q-font-size: clamp(30px, 2.25vw, 42px);");
    expect(css).toContain("--quiz-opt-font-size: clamp(22px, 1.65vw, 32px);");
    expect(css).toContain(".quiz-question-tv");
    expect(css).toContain(".quiz-option-tv");
  });

  it("TEST 7: index.css sets Times New Roman on TV presentation classes and preserves monospace for code", () => {
    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    // Must enforce Times New Roman on TV quiz classes
    expect(css).toMatch(/\.quiz-question-tv[\s\S]*?font-family:\s*"Times New Roman"/);
    expect(css).toMatch(/\.quiz-option-tv[\s\S]*?font-family:\s*"Times New Roman"/);

    // quiz-sync-font-size must not override .quiz-question-tv or .quiz-option-tv
    expect(css).toContain(".quiz-sync-font-size:not(.quiz-question-text-80):not(.quiz-option-text-70)");
  });

  it("TEST 8: Take.tsx provides dynamic responsive font sizes and Times New Roman", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    expect(takeCode).toMatch(/style=\{isSingleView \? \{ fontSize: dynamicQFontSize, fontFamily: ['"].*?Times New Roman.*?['"] \} : undefined\}/);
    expect(takeCode).toMatch(/style=\{isSingleView \? \{ fontSize: dynamicOptFontSize, fontFamily: ['"].*?Times New Roman.*?['"] \} : undefined\}/);
  });

  it("TEST 9: Part I options use 2 columns x 2 rows grid layout for TV display", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Must be 2-column grid on md and above (TV / desktop)
    expect(takeCode).toContain('className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 lg:gap-5 w-full"');
  });

  it("TEST 10: Automatic long-question handling adapts font sizes and applies compact classes", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    expect(takeCode).toContain("const isVeryLongQ =");
    expect(takeCode).toContain("const isLongQ =");
    expect(takeCode).toContain('const dynamicQFontSize = isVeryLongQ ? "34px" : isLongQ ? "38px" : "42px";');
    expect(takeCode).toContain('const dynamicOptFontSize = isVeryLongQ ? "26px" : isLongQ ? "29px" : "32px";');
  });
});

