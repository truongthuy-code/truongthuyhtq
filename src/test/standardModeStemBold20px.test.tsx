import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fs from "fs";
import path from "path";
import Take from "@/pages/Take";
import { setCurrentStudent } from "@/lib/studentStorage";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "mocked-offline" } }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

const TABLE_MARKER =
  "\u27E6TBL:" +
  encodeURIComponent(
    JSON.stringify([
      ["STT", "Tên bảng", "Giá trị"],
      ["1", "Bản ghi A", "100"],
    ])
  ) +
  "\u27E7";

const IMG_MARKER = "\u27E6IMG:" + encodeURIComponent("https://example.com/topology.png") + "\u27E7";

function buildComprehensiveStandardExam() {
  const partI = [
    {
      id: "stem_p1_1",
      text:
        "Đoạn văn thứ nhất giới thiệu bài toán mạng máy tính trong trường học.\n" +
        "Đoạn văn thứ hai nêu công thức băng thông $B = 2^8 + 25\\%$ và đoạn mã Python:\n" +
        "```python\ndef tinh(ds):\n    tong = 0\n    for x in ds:\n        tong += x\n    return tong\n```\n" +
        TABLE_MARKER +
        "\n" +
        IMG_MARKER,
      options: [
        { key: "A", text: "Phương án A không tự động in đậm" },
        { key: "B", text: "Phương án B giữ nguyên 17px" },
        { key: "C", text: "Phương án C với <i>nghiêng</i>" },
        { key: "D", text: "Phương án D" },
      ],
      answer: "A",
    },
  ];

  const partII = [
    {
      id: "stem_p2_1",
      text:
        "Xét đoạn mã HTML và truy vấn SQL dưới đây:\n" +
        "```html\n<div class=\"box\">\n    <p>Xin chào</p>\n</div>\n```\n" +
        "```sql\nSELECT MaHS, HoTen\nFROM HocSinh\nWHERE Lop = '12A1';\n```",
      items: [
        { key: "a", text: "Nhận định a giữ nguyên cỡ chữ 17px và không in đậm.", correct: true },
        { key: "b", text: "Nhận định b giữ nguyên định dạng bình thường.", correct: false },
        { key: "c", text: "Nhận định c không bị ảnh hưởng.", correct: true },
        { key: "d", text: "Nhận định d chính xác.", correct: true },
      ],
    },
  ];

  const partIII = [
    {
      id: "stem_p3_1",
      text: "Câu hỏi trả lời ngắn nhiều dòng:\nDòng 1: Cho công thức $S = 3^2 + 4^2$.\nDòng 2: Hãy tính giá trị của $S$.",
      answer: "25",
    },
  ];

  return {
    id: "std-stem-bold-20px",
    code: "STEM20",
    title: "Đề kiểm tra cỡ chữ câu hỏi 20px in đậm",
    duration_minutes: 45,
    display_mode: "standard",
    shuffle_questions: false,
    shuffle_options: false,
    instant_feedback: false,
    questions: { partI, partII, partIII },
  };
}

function renderStandardExam(exam: any) {
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: `/take/${exam.id}`, state: { exam } }]}>
      <Routes>
        <Route path="/take/:id" element={<Take />} />
      </Routes>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));
  return utils;
}

describe("STANDARD MODE QUESTION STEM: +2PX SIZE (20PX) & BOLD (700) VERIFICATION", () => {
  const indexCssPath = path.resolve(process.cwd(), "src/index.css");
  const indexCss = fs.readFileSync(indexCssPath, "utf-8");
  const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
  const takeContent = fs.readFileSync(takePath, "utf-8");
  const teamTakePath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakePath, "utf-8");

  beforeEach(() => {
    localStorage.clear();
    setCurrentStudent({
      id: "stu_stem_20",
      fullName: "Phạm Gia Huy",
      className: "12A4",
      account: "huy.pham@test.local",
      passwordHash: "00000000",
      createdAt: new Date().toISOString(),
    });
  });

  it("1. Applies 20px (+2px) and font-weight: 700 strictly to .standard-question-stem while protecting special elements", () => {
    expect(indexCss).toMatch(/\.standard-question-stem\s*\{[\s\S]*?font-size:\s*20px\s*!important;[\s\S]*?font-weight:\s*700\s*!important;/);
    expect(indexCss).toMatch(/\.standard-question-stem\.is-short,\s*\.standard-question-stem\.is-long\s*\{[\s\S]*?font-size:\s*20px\s*!important;[\s\S]*?font-weight:\s*700\s*!important;/);
    expect(indexCss).toMatch(/\.standard-question-stem \.code-content,[\s\S]*?font-weight:\s*400;/);
    expect(indexCss).toMatch(/\.standard-question-stem \.katex\s*\{[\s\S]*?font-weight:\s*400\s*!important;/);
    expect(indexCss).toMatch(/\.standard-question-stem \.rich-table\s*\{[\s\S]*?font-weight:\s*400;/);

    // Part title (18px), options (17px), and secondary text (14px) stay unchanged
    expect(indexCss).toMatch(/\.standard-part-title\s*\{[\s\S]*?font-size:\s*18px\s*!important;/);
    expect(indexCss).toMatch(/\.standard-option-text\s*\{[\s\S]*?font-size:\s*17px\s*!important;/);
    expect(indexCss).toMatch(/\.standard-secondary-text\s*\{[\s\S]*?font-size:\s*14px\s*!important;/);
  });

  it("2. Renders 20px bold Times New Roman stem across Part I, Part II, Part III with multi-paragraph, code, math, table, and image preserved", () => {
    const exam = buildComprehensiveStandardExam();
    const { container } = renderStandardExam(exam);

    // --- PART I (MC) ---
    const p1Stem = container.querySelector(".standard-question-stem") as HTMLElement;
    expect(p1Stem).not.toBeNull();
    expect(p1Stem.className).toContain("!text-[20px]");
    expect(p1Stem.className).toContain("font-bold");
    expect(p1Stem.className).toContain("font-times-new-roman");
    expect(p1Stem.className).toContain("break-words");

    // Multi-paragraph text, KaTeX, Python indentation, table, and image all preserved inside stem
    expect(p1Stem.textContent).toContain("Đoạn văn thứ nhất");
    expect(p1Stem.textContent).toContain("Đoạn văn thứ hai");
    expect(p1Stem.querySelector(".katex")).not.toBeNull();
    const pyPre = p1Stem.querySelector("pre.code-content");
    expect(pyPre).not.toBeNull();
    expect(pyPre?.textContent).toContain("    tong = 0");
    expect(pyPre?.textContent).toContain("        tong += x");
    expect(p1Stem.querySelector("table.rich-table")).not.toBeNull();
    expect(p1Stem.querySelector("img")).not.toBeNull();

    // Part I options stay 17px and NOT bold
    const mcOpts = container.querySelectorAll(".standard-option-text");
    expect(mcOpts.length).toBe(4);
    mcOpts.forEach((opt) => {
      expect(opt.className).toContain("!text-[17px]");
      expect(opt.className).not.toContain("font-bold");
      expect(opt.className).not.toContain("!text-[20px]");
    });

    // Question number & Part header remain 18px
    const questionCard = p1Stem.closest('[class*="rounded-2xl"]') as HTMLElement;
    expect(questionCard.querySelector("span.text-\\[18px\\]")?.textContent?.trim()).toBe("Câu 1");
    expect(within(questionCard).getByText("PHẦN I – Trắc nghiệm").className).toContain("text-[18px]");

    // --- PART II (TF) ---
    fireEvent.click(screen.getByRole("button", { name: /Câu sau ›/i }));
    const p2Stem = container.querySelector(".standard-question-stem") as HTMLElement;
    expect(p2Stem.className).toContain("!text-[20px]");
    expect(p2Stem.className).toContain("font-bold");
    const codeBlocks = p2Stem.querySelectorAll("pre.code-content");
    expect(codeBlocks.length).toBeGreaterThanOrEqual(1);
    expect(codeBlocks[0].textContent).toContain("    <p>Xin chào</p>");
    expect(p2Stem.textContent).toContain("SELECT MaHS, HoTen");

    // Part II TF statements stay 17px and NOT bold
    const tfOpts = container.querySelectorAll(".standard-option-text");
    expect(tfOpts.length).toBe(4);
    tfOpts.forEach((opt) => {
      expect(opt.className).toContain("!text-[17px]");
      expect(opt.className).not.toContain("font-bold");
      expect(opt.className).not.toContain("!text-[20px]");
    });

    // --- PART III (SA) ---
    fireEvent.click(screen.getByRole("button", { name: /Câu sau ›/i }));
    const p3Stem = container.querySelector(".standard-question-stem") as HTMLElement;
    expect(p3Stem.className).toContain("!text-[20px]");
    expect(p3Stem.className).toContain("font-bold");
    expect(p3Stem.textContent).toContain("Dòng 1:");
    expect(p3Stem.textContent).toContain("Dòng 2:");
    expect(p3Stem.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);

    const saInput = screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i);
    expect(saInput.className).toContain("!text-[17px]");
    expect(saInput.className).not.toContain("!text-[20px]");
  });

  it("3. Leaves Single-Question mode, Team mode, and Teacher/Create/Preview screens completely untouched", () => {
    expect(takeContent).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeContent).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');
    expect(teamTakeContent).not.toContain("standard-question-stem");
    expect(teamTakeContent).toContain("!text-[34px] sm:!text-[38px]");
  });
});
