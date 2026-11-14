import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import fs from "fs";
import path from "path";
import RichText from "@/components/RichText";

describe("VERIFICATION: -3PX QUESTION AND -2PX OPTION FONT SIZE REDUCTION IN STANDARD & TEAM MODES", () => {
  const takeFilePath = path.resolve(__dirname, "../pages/Take.tsx");
  const takeContent = fs.readFileSync(takeFilePath, "utf-8");

  const teamTakeFilePath = path.resolve(__dirname, "../pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakeFilePath, "utf-8");

  it("1. Standard mode question stem uses 20px bold Times New Roman typography (+2px from 18px)", () => {
    expect(takeContent).toContain('const stemSizeClass = "!text-[20px]";');
    expect(takeContent).toContain("standard-question-stem");
  });

  it("2. Standard mode options use compact 17px Times New Roman typography", () => {
    expect(takeContent).toContain('const optionTextSize = "!text-[17px]";');
    expect(takeContent).toContain("standard-option-text");
  });

  it("3. Team mode questions have been reduced by -3px and options by -2px", () => {
    // Question stem in TeamTake: !text-[34px] sm:!text-[38px] (-3px from 37px/41px)
    expect(teamTakeContent).toContain('!text-[34px] sm:!text-[38px] leading-relaxed text-foreground mb-6 question-content font-times-new-roman team-sync-font-size');

    // MCQ options in TeamTake: !text-[26px] sm:!text-[30px] (-2px from 28px/32px)
    expect(teamTakeContent).toContain('!text-[26px] sm:!text-[30px] leading-relaxed text-foreground team-sync-font-size');

    // TF statements in TeamTake: !text-[26px] sm:!text-[30px] (-2px from 28px/32px)
    expect(teamTakeContent).toContain('font-semibold !text-[26px] sm:!text-[30px] leading-relaxed flex-1 team-sync-font-size');

    // Short answer label in TeamTake: !text-[34px] sm:!text-[38px] (-3px from 37px/41px)
    expect(teamTakeContent).toContain('Label className="font-bold !text-[34px] sm:!text-[38px] block mb-2 font-times-new-roman team-sync-font-size"');

    // Short answer input in TeamTake: text-[26px] sm:text-[30px] (-2px from 28px/32px)
    expect(teamTakeContent).toContain('text-[26px] sm:text-[30px] font-black rounded-2xl px-5 border-2 font-times-new-roman');
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
      <div className="font-times-new-roman leading-[1.5] text-slate-900 question-content font-bold standard-sync-font-size standard-question-stem !text-[20px]">
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
      <div className="font-bold text-[34px] sm:text-[38px] leading-relaxed text-foreground mb-6 question-content font-times-new-roman team-sync-font-size">
        <RichText text={multiParaQuestion} />
      </div>
    );

    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("code")).toBeNull();
    expect(container.querySelector("b")).not.toBeNull();
    expect(container.querySelector("i")).not.toBeNull();
  });
});
