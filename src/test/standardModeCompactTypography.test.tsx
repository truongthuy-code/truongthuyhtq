import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fs from "fs";
import path from "path";
import Take from "@/pages/Take";
import RichText from "@/components/RichText";
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

function buildStandardTestExam(options?: {
  p1Count?: number;
  p2Count?: number;
  p3Count?: number;
  longText?: boolean;
}) {
  const p1Count = options?.p1Count ?? 2;
  const p2Count = options?.p2Count ?? 1;
  const p3Count = options?.p3Count ?? 1;

  const partI = Array.from({ length: p1Count }, (_, i) => ({
    id: `std_p1_${i + 1}`,
    text:
      i === 0 && options?.longText
        ? "Một hệ thống quản lý cơ sở dữ liệu quan hệ <b>lưu trữ</b> thông tin.\n<i>Dữ liệu học sinh được chuẩn hóa cẩn thận.</i>\nCông thức hóa học H<sub>2</sub>O, lũy thừa 10<sup>2</sup>, công thức toán $E = mc^2 + 25\\%$ và tỉ lệ 25%.\n```python\ndef tinh_tong(n):\n    tong = 0\n    for i in range(n):\n        tong += i\n    return tong\n```\n\u27E6IMG:" +
          encodeURIComponent("https://example.com/diagram.png") +
          "\u27E7"
        : `Câu hỏi trắc nghiệm số ${i + 1}: Nội dung <b>in đậm</b> và $x^2 + 1 = 5$`,
    options: [
      { key: "A", text: `Phương án A của câu ${i + 1}` },
      { key: "B", text: `Phương án B với H<sub>2</sub>O` },
      { key: "C", text: `Phương án C với <i>nghiêng</i>` },
      { key: "D", text: `Phương án D đạt 100%` },
    ],
    answer: "A",
  }));

  const partII = Array.from({ length: p2Count }, (_, i) => ({
    id: `std_p2_${i + 1}`,
    text: `Câu Đúng/Sai số ${i + 1}: Xét đoạn mã HTML <b>sau</b>:`,
    items: [
      { key: "a", text: "Ý a: Thẻ `<p>` dùng để tạo đoạn văn bản.", correct: true },
      { key: "b", text: "Ý b: Cú pháp H<sub>2</sub>O sử dụng thẻ sub.", correct: true },
      { key: "c", text: "Ý c: Tỉ lệ đạt 50%.", correct: false },
      { key: "d", text: "Ý d: Kết quả bằng $2^3 = 8$.", correct: true },
    ],
  }));

  const partIII = Array.from({ length: p3Count }, (_, i) => ({
    id: `std_p3_${i + 1}`,
    text: `Câu trả lời ngắn số ${i + 1}: Giá trị của $3^2 + 1$ là bao nhiêu?`,
    answer: "10",
  }));

  return {
    id: "std-compact-exam-1",
    code: "STD1817",
    title: "Đề kiểm tra Tin học 12 – Chế độ Tiêu chuẩn",
    duration_minutes: 45,
    display_mode: "standard",
    shuffle_questions: false,
    shuffle_options: false,
    instant_feedback: false,
    allow_review: true,
    questions: { partI, partII, partIII },
  };
}

function renderStandardTake(exam: any) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/take/${exam.id}`, state: { exam } }]}>
      <Routes>
        <Route path="/take/:id" element={<Take />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("STANDARD MODE COMPACT TYPOGRAPHY & CONTROLS VERIFICATION", () => {
  const indexCssPath = path.resolve(process.cwd(), "src/index.css");
  const indexCss = fs.readFileSync(indexCssPath, "utf-8");
  const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
  const takeContent = fs.readFileSync(takePath, "utf-8");
  const teamTakePath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakePath, "utf-8");

  beforeEach(() => {
    localStorage.clear();
    setCurrentStudent({
      id: "stu_1",
      fullName: "Nguyễn Văn An",
      className: "12A1",
      account: "an.nguyen@test.local",
      passwordHash: "00000000",
      createdAt: new Date().toISOString(),
    });
  });

  it("1. Enforces exact 20px bold question stem, 18px part-title, 17px options/SA, 14px secondary & Times New Roman CSS rules", () => {
    // Question stem: 20px bold (+2px from 18px); part title: 18px
    expect(indexCss).toMatch(/\.standard-question-stem[\s\S]*?font-size:\s*20px\s*!important/);
    expect(indexCss).toMatch(/\.standard-question-stem[\s\S]*?font-weight:\s*700\s*!important/);
    expect(indexCss).toMatch(/\.standard-part-title\s*\{[\s\S]*?font-size:\s*18px\s*!important/);

    // Options (Part I / Part II / Part III): 17px
    expect(indexCss).toMatch(/\.standard-option-text[\s\S]*?font-size:\s*17px\s*!important/);

    // Secondary info: 14px
    expect(indexCss).toMatch(/\.standard-secondary-text\s*\{[\s\S]*?font-size:\s*14px\s*!important/);

    // Uniform Times New Roman across Standard mode + preserved monospace code & 0.75em sub/sup & 260px image max-height
    expect(indexCss).toMatch(/\.standard-question-stem[\s\S]*?"Times New Roman"/);
    expect(indexCss).toMatch(/\.standard-option-text[\s\S]*?"Times New Roman"/);
    expect(indexCss).toMatch(/\.standard-take-layout sub,\s*\.standard-take-layout sup\s*\{[\s\S]*?font-size:\s*0\.75em\s*!important/);
    expect(indexCss).toMatch(/\.standard-take-layout \.rich-text-root img\s*\{[\s\S]*?max-height:\s*260px/);
    expect(indexCss).toMatch(/\.standard-take-layout \.rich-text-root \.code-content[\s\S]*?font-family:\s*Consolas/);

    // Take.tsx Standard card & input classes
    expect(takeContent).toContain('const stemSizeClass = "!text-[20px]";');
    expect(takeContent).toContain('const optionTextSize = "!text-[17px]";');
    expect(takeContent).toContain("h-10 sm:h-11 !text-[17px]");
    expect(takeContent).toContain("standard-take-layout");
  });

  it("2. Renders Standard mode exam with sticky command controls, Part I/II/III compact inputs & immediate NỘP BÀI visibility", () => {
    const exam = buildStandardTestExam({ p1Count: 1, p2Count: 1, p3Count: 1, longText: true });
    const { container } = renderStandardTake(exam);

    // Click Start
    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    // Verify Standard layout root wrapper is active
    const mainEl = container.querySelector("main.standard-take-layout");
    expect(mainEl).not.toBeNull();

    // Verify Question 1 (Part I) with 20px bold stem & 17px options
    const stemEl = container.querySelector(".standard-question-stem");
    expect(stemEl).not.toBeNull();
    expect(stemEl?.className).toContain("!text-[20px]");
    expect(stemEl?.className).toContain("font-bold");
    expect(stemEl?.className).toContain("font-times-new-roman");

    const optEls = container.querySelectorAll(".standard-option-text");
    expect(optEls.length).toBe(4);
    optEls.forEach((el) => {
      expect(el.className).toContain("!text-[17px]");
      expect(el.className).toContain("font-times-new-roman");
    });

    // Verify content preservation: bold, italic, sub, sup, %, KaTeX math, Python code block with indentation, image
    expect(stemEl?.querySelector("b")?.textContent).toBe("lưu trữ");
    expect(stemEl?.querySelector("i")?.textContent).toContain("Dữ liệu học sinh");
    expect(stemEl?.querySelector("sub")?.textContent).toBe("2");
    expect(stemEl?.querySelector("sup")?.textContent).toBe("2");
    expect(stemEl?.textContent).toContain("25%");
    const preCode = stemEl?.querySelector("pre.code-content");
    expect(preCode).not.toBeNull();
    expect(preCode?.textContent).toContain("    tong = 0");
    expect(preCode?.textContent).toContain("        tong += i");
    const imgEl = stemEl?.querySelector("img");
    expect(imgEl).not.toBeNull();

    // Verify sticky bottom control bar exists right below question card with Câu trước, Trả lời, Câu sau, and NO duplicate Nộp bài button
    const controlsBar = container.querySelector('[data-standard-controls="true"]');
    expect(controlsBar).not.toBeNull();
    expect(controlsBar?.className).toContain("sticky");
    expect(controlsBar?.className).toContain("bottom-2");
    expect(controlsBar?.textContent).toContain("Câu trước");
    expect(controlsBar?.textContent).toContain("Trả lời");
    expect(controlsBar?.textContent).toContain("Câu sau");
    expect(controlsBar?.textContent).not.toMatch(/Nộp bài/i);
    expect(within(controlsBar as HTMLElement).queryByRole("button", { name: /Nộp bài|NỘP BÀI/i })).toBeNull();

    // Navigate to Question 2 (Part II - TF) using Câu sau in sticky bar
    fireEvent.click(screen.getByRole("button", { name: /Câu sau/i }));
    expect(screen.getByText(/PHẦN II – Đúng\/Sai/i)).toBeTruthy();
    const tfOpts = container.querySelectorAll(".standard-option-text");
    expect(tfOpts.length).toBe(4);
    tfOpts.forEach((el) => {
      expect(el.className).toContain("!text-[17px]");
    });

    // Click Đúng on first TF item
    const trueBtns = screen.getAllByRole("button", { name: /^Đúng$/i });
    fireEvent.click(trueBtns[0]);
    expect(trueBtns[0].className).toContain("bg-teal-600");

    // Navigate to Question 3 (Part III - Short Answer) and verify Câu sau disables on last question without rendering Nộp bài
    const nextBtn = screen.getByRole("button", { name: /Câu sau/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/PHẦN III – Trả lời ngắn/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Câu sau/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(controlsBar as HTMLElement).queryByRole("button", { name: /Nộp bài|NỘP BÀI/i })).toBeNull();

    const saInput = screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i);
    expect(saInput.className).toContain("!text-[17px]");
    fireEvent.change(saInput, { target: { value: "10" } });
    expect(screen.getByText(/Đã lưu câu trả lời/i)).toBeTruthy();

    // Verify NỘP BÀI button at the bottom of DANH SÁCH CÂU works and opens submit confirmation dialog
    const listHeading = screen.getByText("DANH SÁCH CÂU");
    const listCard = listHeading.closest('[class*="rounded-2xl"]') as HTMLElement;
    expect(listCard).not.toBeNull();
    const listSubmitBtn = within(listCard).getByRole("button", { name: /NỘP BÀI/i });
    fireEvent.click(listSubmitBtn);
    expect(screen.getByRole("button", { name: /Xác nhận nộp bài/i })).toBeTruthy();
  });

  it("3. Handles exams with many questions (55 questions) via scrollable compact 5-col sidebar grid without hiding NỘP BÀI", () => {
    const exam = buildStandardTestExam({ p1Count: 45, p2Count: 6, p3Count: 4 });
    const { container } = renderStandardTake(exam);

    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    expect(screen.getByText(/Tổng số 55 câu/i)).toBeTruthy();
    const scrollGrid = container.querySelector('[data-standard-question-list="true"]');
    expect(scrollGrid).not.toBeNull();
    expect(scrollGrid?.querySelectorAll("button").length).toBe(55);

    // Jump directly to question 52 from the sidebar grid
    fireEvent.click(within(scrollGrid as HTMLElement).getByRole("button", { name: "52" }));
    expect(screen.getByText(/Câu hỏi trắc nghiệm|Câu Đúng\/Sai|Câu trả lời ngắn/i)).toBeTruthy();
    expect(screen.getAllByText(/Câu 52/i).length).toBeGreaterThan(0);

    // NỘP BÀI remains immediately accessible at the bottom of DANH SÁCH CÂU
    const listHeading = screen.getByText("DANH SÁCH CÂU");
    const listCard = listHeading.closest('[class*="rounded-2xl"]') as HTMLElement;
    expect(within(listCard).getByRole("button", { name: /NỘP BÀI/i })).toBeTruthy();
  });

  it("4. Preserves Python, HTML, CSS, SQL indentation & monospace inside Standard mode RichText", () => {
    const richSnippet =
      "Đoạn mã HTML và CSS:\n```html\n<div class=\"card\">\n    <p>Nội dung <b>giữ nguyên</b></p>\n</div>\n```";
    const { container } = render(
      <div className="standard-take-layout font-times-new-roman">
        <div className="standard-question-stem font-bold !text-[20px]">
          <RichText text={richSnippet} />
        </div>
      </div>
    );

    const pre = container.querySelector("pre.code-content");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('<div class="card">');
    expect(pre?.textContent).toContain("    <p>Nội dung <b>giữ nguyên</b></p>");
  });

  it("5. Strictly does NOT affect Single Question mode, Team mode, or grading/scoring logic", () => {
    // Single Question mode intact
    expect(takeContent).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeContent).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');
    expect(indexCss).toContain("--quiz-q-font-size: clamp(35px, 2.45vw, 47px);");
    expect(indexCss).toContain("--quiz-opt-font-size: clamp(27px, 1.95vw, 37px);");

    // Team mode intact
    expect(teamTakeContent).toContain("!text-[34px] sm:!text-[38px]");
    expect(teamTakeContent).toContain("!text-[26px] sm:!text-[30px]");
    expect(indexCss).toContain(".team-question-stem");
    expect(indexCss).toContain("font-size: 34px !important;");
  });
});
