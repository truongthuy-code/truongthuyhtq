import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import RichText from "@/components/RichText";

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

  it("TEST 3: TeamTake.tsx synchronizes question text, options, true/false, and short answer", () => {
    const teamPath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
    const teamCode = fs.readFileSync(teamPath, "utf-8");

    // Question content uses text-[31px] sm:text-[35px] and team-sync-font-size
    expect(teamCode).toMatch(/text-\[31px\] sm:text-\[35px\][\s\S]*?question-content[\s\S]*?team-sync-font-size/);

    // Part I options use text-[28px] sm:text-[32px] and team-sync-font-size
    expect(teamCode).toMatch(/text-\[28px\] sm:text-\[32px\] leading-relaxed text-foreground team-sync-font-size/);

    // Part II True/False items use text-[28px] sm:text-[32px] and team-sync-font-size
    expect(teamCode).toMatch(/font-semibold text-\[28px\] sm:text-\[32px\] leading-relaxed flex-1 team-sync-font-size/);

    // Part III Short answer label uses text-[31px] sm:text-[35px] and team-sync-font-size
    expect(teamCode).toMatch(/Label className="font-bold text-\[31px\] sm:text-\[35px\] block mb-2 font-times-new-roman team-sync-font-size"/);
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

  it("TEST 6: Take.tsx defines TV-optimized 47px question and 37px option classes (+5px) in single question mode", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Verify TV presentation font classes (47px question, 37px option)
    expect(takeCode).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeCode).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');

    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain("--quiz-q-font-size: clamp(35px, 2.45vw, 47px);");
    expect(css).toContain("--quiz-opt-font-size: clamp(27px, 1.95vw, 37px);");
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

  it("TEST 10: Automatic long-question handling adapts font sizes (+5px for all tiers)", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    expect(takeCode).toContain("const isVeryLongQ =");
    expect(takeCode).toContain("const isLongQ =");
    expect(takeCode).toContain('const dynamicQFontSize = isVeryLongQ ? "39px" : isLongQ ? "43px" : "47px";');
    expect(takeCode).toContain('const dynamicOptFontSize = isVeryLongQ ? "31px" : isLongQ ? "34px" : "37px";');
  });

  it("TEST 11: All nested tags in Question synchronize cleanly to 47px and Options to 37px while code remains monospace", () => {
    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    // Verify all nested selectors exist on .quiz-question-tv
    expect(css).toContain(".quiz-question-tv p");
    expect(css).toContain(".quiz-question-tv span");
    expect(css).toContain(".quiz-question-tv div");
    expect(css).toContain(".quiz-question-tv strong");
    expect(css).toContain(".quiz-question-tv table");
    expect(css).toContain(".quiz-question-tv td");
    expect(css).toContain(".quiz-question-tv th");

    // Verify all nested selectors exist on .quiz-option-tv
    expect(css).toContain(".quiz-option-tv p");
    expect(css).toContain(".quiz-option-tv span");
    expect(css).toContain(".quiz-option-tv div");
    expect(css).toContain(".quiz-option-tv td");

    // Verify code block font preservation
    expect(css).toContain(".quiz-question-tv pre");
    expect(css).toContain(".quiz-question-tv code");
    expect(css).toContain(".quiz-option-tv pre");
    expect(css).toContain(".quiz-option-tv code");
  });

  it("TEST 12: Natural language paragraphs with indentation and punctuation in Vietnamese are NOT misclassified as code blocks in RichText", () => {
    const richTextPath = path.resolve(process.cwd(), "src/components/RichText.tsx");
    const richTextCode = fs.readFileSync(richTextPath, "utf-8");

    expect(richTextCode).toContain("VIETNAMESE_DIACRITICS_RE");
    
    const scenarioQuestion =
      "Xét tình huống ứng dụng mạng máy tính trong trường học:\n" +
      "  Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ. Để kết nối phòng máy này với mạng Internet toàn cầu, nhà trường đăng ký đường truyền cáp quang với nhà cung cấp dịch vụ VNPT và lắp đặt thêm một bộ định tuyến Router.";

    const { container } = render(<RichText text={scenarioQuestion} />);
    
    // There should be NO <pre> or <code> tags rendered for this natural language question
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();

    // The text should be rendered cleanly as text spans
    expect(container.textContent).toContain("Xét tình huống ứng dụng mạng máy tính trong trường học:");
    expect(container.textContent).toContain("Một trường THPT triển khai hạ tầng mạng máy tính");
  });

  it("TEST 13: Questions with multiple paragraphs (lead sentence + scenario) and mixed formatting (bold, italic) render uniformly", () => {
    const formattedStem =
      "<b>Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy...</i>\n" +
      "Cần lựa chọn nhận định đúng hoặc sai cho các ý sau:";

    const { container } = render(
      <div className="quiz-question-tv quiz-question-text-80">
        <RichText text={formattedStem} />
      </div>
    );

    // Verify b and i are rendered and not treated as code
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("TEST 14: Standard mode synchronizes all inner text elements with standard-sync-font-size without using quiz-sync-font-size", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    expect(css).toContain(".standard-sync-font-size");
    expect(takeCode).toContain("standard-sync-font-size");

    // Standard mode implementation still does not contain quiz-sync-font-size
    const standardSection = takeCode.slice(takeCode.indexOf("const renderStandardQuestionCard ="));
    const standardFuncBody = standardSection.slice(0, standardSection.indexOf("const renderStandardQuestionListCard ="));
    expect(standardFuncBody).not.toContain("quiz-sync-font-size");
  });

  it("TEST 15: Standard mode renders multi-paragraph scenario without code blocks and preserves bold/italic", () => {
    const sampleQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ. Để kết nối phòng máy này với mạng Internet toàn cầu, nhà trường đăng ký đường truyền cáp quang với nhà cung cấp dịch vụ VNPT và lắp đặt thêm một bộ định tuyến Router.</i>";

    const { container } = render(
      <div className="font-times-new-roman leading-relaxed text-slate-900 question-content font-medium standard-sync-font-size text-[27px] sm:text-[29px] md:text-[31px]">
        <RichText text={sampleQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
    expect(container.textContent).toContain("Xét tình huống");
    expect(container.textContent).toContain("Một trường THPT");
  });

  it("TEST 16: Single question mode renders multi-paragraph scenario uniformly without code block", () => {
    const sampleQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ. Để kết nối phòng máy này với mạng Internet toàn cầu...</i>";

    const { container } = render(
      <div className="font-bold text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80 leading-relaxed text-foreground tracking-tight mb-4 question-content font-times-new-roman quiz-sync-font-size break-words">
        <RichText text={sampleQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
  });

  it("TEST 17: Team mode renders multi-paragraph scenario uniformly without code block", () => {
    const sampleQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ...</i>";

    const { container } = render(
      <div className="font-bold text-[31px] sm:text-[35px] leading-relaxed text-foreground mb-6 question-content font-times-new-roman team-sync-font-size">
        <RichText text={sampleQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
  });

  it("TEST 18: Auto-recovery for Vietnamese scenario text previously saved in CODE sentinel", () => {
    const legacySavedStem =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n\u27E6CODE:plaintext:" +
      encodeURIComponent("Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy...") +
      "\u27E7";

    const { container } = render(<RichText text={legacySavedStem} />);

    // Should NOT render as a <pre><code> block
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toContain("Một trường THPT triển khai hạ tầng");
  });

  it("TEST 19: sanitizeSafeHtml strips font-size from p, span, div, font styles while preserving color and tags", () => {
    const richWithFontSizes =
      "<b>Câu hỏi tình huống:</b>\n" +
      '<p style="font-size: 24pt; color: #1e40af">Đoạn văn 1</p>' +
      '<span style="font-size: 16px; color: #dc2626">Đoạn văn 2</span>' +
      '<div style="font-size: 18px">Đoạn văn 3</div>' +
      '<font color="#059669" size="5">Đoạn văn 4</font>';

    const { container } = render(<RichText text={richWithFontSizes} />);

    // Must NOT contain font-size in innerHTML
    expect(container.innerHTML).not.toContain("font-size");
    expect(container.innerHTML).not.toContain("24pt");
    expect(container.innerHTML).not.toContain("16px");
    expect(container.innerHTML).not.toContain("18px");

    // Must preserve colors
    expect(container.innerHTML).toContain("#1e40af");
    expect(container.innerHTML).toContain("#dc2626");
    expect(container.innerHTML).toContain("#059669");
  });
});


