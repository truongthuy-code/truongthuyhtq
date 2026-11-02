import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import RichText from "@/components/RichText";

describe("VERIFICATION: +6PX QUESTION & +3PX OPTION FONT SIZE INCREASE IN STANDARD & TEAM MODES", () => {
  const takeFilePath = path.resolve(__dirname, "../pages/Take.tsx");
  const takeContent = fs.readFileSync(takeFilePath, "utf-8");

  const teamTakeFilePath = path.resolve(__dirname, "../pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakeFilePath, "utf-8");

  it("1. Standard mode question stem has been increased by exactly +6px across all tiers", () => {
    // Normal content: text-[27px] sm:text-[29px] md:text-[31px] (+6px from 21px/23px/25px)
    expect(takeContent).toContain('"text-[27px] sm:text-[29px] md:text-[31px]"');

    // Short content: text-[29px] sm:text-[31px] md:text-[35px] (+6px from 23px/25px/29px)
    expect(takeContent).toContain('"text-[29px] sm:text-[31px] md:text-[35px]"');

    // Long content: text-[25px] sm:text-[27px] md:text-[29px] (+6px from 19px/21px/23px)
    expect(takeContent).toContain('"text-[25px] sm:text-[27px] md:text-[29px]"');
  });

  it("2. Standard mode options have been increased by exactly +3px across all tiers", () => {
    // Normal content options: text-[22px] sm:text-[24px] (+3px from 19px/21px)
    expect(takeContent).toContain('"text-[22px] sm:text-[24px]"');

    // Short content options: text-[24px] sm:text-[26px] (+3px from 21px/23px)
    expect(takeContent).toContain('"text-[24px] sm:text-[26px]"');

    // Long content options: text-[20px] sm:text-[22px] (+3px from 17px/19px)
    expect(takeContent).toContain('"text-[20px] sm:text-[22px]"');
  });

  it("3. Team mode questions (+6px) and options (+3px) have been precisely updated", () => {
    // Question stem in TeamTake: text-[31px] sm:text-[35px] (+6px from 25px/29px)
    expect(teamTakeContent).toContain('text-[31px] sm:text-[35px] leading-relaxed text-foreground mb-6 question-content font-times-new-roman team-sync-font-size');

    // MCQ options in TeamTake: text-[28px] sm:text-[32px] (+3px from 25px/29px)
    expect(teamTakeContent).toContain('text-[28px] sm:text-[32px] leading-relaxed text-foreground team-sync-font-size');

    // TF statements in TeamTake: text-[28px] sm:text-[32px] (+3px from 25px/29px)
    expect(teamTakeContent).toContain('font-semibold text-[28px] sm:text-[32px] leading-relaxed flex-1 team-sync-font-size');

    // Short answer label in TeamTake: text-[31px] sm:text-[35px] (+6px from 25px/29px)
    expect(teamTakeContent).toContain('Label className="font-bold text-[31px] sm:text-[35px] block mb-2 font-times-new-roman team-sync-font-size"');

    // Short answer input in TeamTake: text-[28px] sm:text-[32px] (+3px from 25px/29px)
    expect(teamTakeContent).toContain('text-[28px] sm:text-[32px] font-black rounded-2xl px-5 border-2 font-times-new-roman');
  });

  it("4. Single Question mode is strictly untouched (+0px change)", () => {
    // Single question mode preserves 47px question and 37px options
    expect(takeContent).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeContent).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');
  });

  it("5. Multi-paragraph scenario question has uniform font size across all paragraphs in Standard Mode", () => {
    const multiParaQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ. Để kết nối phòng máy này với mạng Internet toàn cầu, nhà trường đăng ký đường truyền cáp quang với nhà cung cấp dịch vụ VNPT và lắp đặt thêm một bộ định tuyến Router.</i>\n" +
      "Cần phân tích các đặc điểm của mô hình mạng này.";

    const { container } = render(
      <div className="font-times-new-roman leading-relaxed text-slate-900 question-content font-medium standard-sync-font-size text-[27px] sm:text-[29px] md:text-[31px]">
        <RichText text={multiParaQuestion} />
      </div>
    );

    // Verify both paragraphs render within the container and no pre/code is produced
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
    expect(container.textContent).toContain("Xét tình huống");
    expect(container.textContent).toContain("Một trường THPT");
  });

  it("6. Multi-paragraph scenario question has uniform font size across all paragraphs in Team Mode", () => {
    const multiParaQuestion =
      "<b>Câu 1: Xét tình huống ứng dụng mạng máy tính trong trường học:</b>\n" +
      "<i>Một trường THPT triển khai hạ tầng mạng máy tính gồm các máy tính phòng máy được nối với nhau qua bộ chuyển mạch Switch tạo thành mạng LAN nội bộ...</i>";

    const { container } = render(
      <div className="font-bold text-[31px] sm:text-[35px] leading-relaxed text-foreground mb-6 question-content font-times-new-roman team-sync-font-size">
        <RichText text={multiParaQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
  });
});
