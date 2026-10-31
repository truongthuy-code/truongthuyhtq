import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";

describe("TIMES NEW ROMAN FONT SCOPE & PRESERVATION TESTS", () => {
  it("TEST 1: src/index.css defines Times New Roman for .font-times-new-roman and preserves monospace code", () => {
    const cssPath = path.resolve(process.cwd(), "src/index.css");
    const css = fs.readFileSync(cssPath, "utf-8");

    // Must define Times New Roman
    expect(css).toContain('"Times New Roman", Times, serif');
    expect(css).toContain(".font-times-new-roman");

    // Must preserve monospace for code
    expect(css).toMatch(/\.font-times-new-roman\s+pre/);
    expect(css).toMatch(/\.font-times-new-roman\s+code/);
    expect(css).toMatch(/\.font-times-new-roman\s+\.hljs/);
    expect(css).toMatch(/\.font-times-new-roman\s+\.code-content/);
    expect(css).toContain("Consolas, \"Courier New\", monospace !important");
  });

  it("TEST 2: Take.tsx applies font-times-new-roman to quizizz mode (Chế độ từng câu hỏi)", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Verify isQuiz conditional application
    expect(takeCode).toContain('${isQuiz ? "font-times-new-roman" : ""}');
    // Verify renderQuestionCard has font-times-new-roman
    expect(takeCode).toMatch(/renderQuestionCard[\s\S]*?font-times-new-roman/);
    // Verify questionNavDrawer has font-times-new-roman when isQuiz
    expect(takeCode).toMatch(/questionNavDrawer[\s\S]*?isQuiz\s*\?\s*"font-times-new-roman"/);
    // Verify submitDialog has font-times-new-roman when isQuiz
    expect(takeCode).toMatch(/submitDialog[\s\S]*?isQuiz\s*\?\s*"font-times-new-roman"/);
  });

  it("TEST 3: TeamTake.tsx applies font-times-new-roman to team mode (Chế độ đội nhóm)", () => {
    const teamPath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
    const teamCode = fs.readFileSync(teamPath, "utf-8");

    // Verify font-times-new-roman on lobby screen
    expect(teamCode).toMatch(/Chế độ thi đấu Đội \/ Nhóm[\s\S]*?font-times-new-roman/);
    // Verify font-times-new-roman on finished screen
    expect(teamCode).toMatch(/Màn hình kết thúc nhóm[\s\S]*?font-times-new-roman/);
    // Verify font-times-new-roman on active exam layout & question card
    expect(teamCode).toMatch(/Khu vực câu hỏi thi đấu nhóm[\s\S]*?font-times-new-roman/);
    // Verify font-times-new-roman on header
    expect(teamCode).toMatch(/header className="border-b bg-card\/95 backdrop-blur sticky top-0 z-30 shadow-sm font-times-new-roman"/);
  });

  it("TEST 4: Standard mode in Take.tsx preserves standard layout and does not apply isQuiz container styles", () => {
    const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
    const takeCode = fs.readFileSync(takePath, "utf-8");

    // Standard mode main container does not force isQuiz styling
    expect(takeCode).toContain("CHẾ ĐỘ TIÊU CHUẨN (STANDARD MODE: 2 KHU VỰC BÊN TRÁI VÀ BÊN PHẢI)");
    expect(takeCode).toContain("renderStandardQuestionCard");
    expect(takeCode).toContain("renderStandardQuestionListCard");
  });

  it("TEST 5: Monospace code block class rules remain intact within .font-times-new-roman DOM", () => {
    const { container } = render(
      <div className="font-times-new-roman">
        <p className="normal-text">Văn bản câu hỏi thông thường</p>
        <pre className="code-content">
          <code>print("Hello, world!")</code>
        </pre>
      </div>
    );

    const normalP = container.querySelector(".normal-text");
    const preEl = container.querySelector("pre");
    const codeEl = container.querySelector("code");

    expect(normalP).not.toBeNull();
    expect(preEl).not.toBeNull();
    expect(codeEl).not.toBeNull();
    expect(preEl?.className).toContain("code-content");
  });
});
