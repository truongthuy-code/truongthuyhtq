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

function buildExam(p1Count: number, p2Count: number, p3Count: number) {
  const partI = Array.from({ length: p1Count }, (_, i) => ({
    id: `fw_p1_${i + 1}`,
    text: `Câu hỏi Phần I số ${i + 1}: Chọn đáp án đúng cho câu ${i + 1}.`,
    options: [
      { key: "A", text: `Đáp án A câu ${i + 1}` },
      { key: "B", text: `Đáp án B câu ${i + 1}` },
      { key: "C", text: `Đáp án C câu ${i + 1}` },
      { key: "D", text: `Đáp án D câu ${i + 1}` },
    ],
    answer: "A",
  }));

  const partII = Array.from({ length: p2Count }, (_, i) => ({
    id: `fw_p2_${i + 1}`,
    text: `Câu hỏi Phần II số ${i + 1}: Đánh giá Đúng/Sai các nhận định sau.`,
    items: [
      { key: "a", text: `Ý a của câu ${i + 1}`, correct: true },
      { key: "b", text: `Ý b của câu ${i + 1}`, correct: false },
      { key: "c", text: `Ý c của câu ${i + 1}`, correct: true },
      { key: "d", text: `Ý d của câu ${i + 1}`, correct: false },
    ],
  }));

  const partIII = Array.from({ length: p3Count }, (_, i) => ({
    id: `fw_p3_${i + 1}`,
    text: `Câu hỏi Phần III số ${i + 1}: Nhập kết quả tính toán.`,
    answer: String(200 + i),
  }));

  return {
    id: `std-fullwidth-${p1Count}-${p2Count}-${p3Count}`,
    code: "FULLW",
    title: "Đề thi toàn màn hình – Chế độ Tiêu chuẩn",
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

describe("STANDARD MODE FULL-WIDTH LAYOUT & SYNCHRONIZED NAVIGATION BUTTONS", () => {
  const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
  const takeContent = fs.readFileSync(takePath, "utf-8");
  const teamTakePath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
  const teamTakeContent = fs.readFileSync(teamTakePath, "utf-8");

  beforeEach(() => {
    localStorage.clear();
    setCurrentStudent({
      id: "stu_fw_1",
      fullName: "Lê Bảo Ngọc",
      className: "12A3",
      account: "ngoc.le@test.local",
      passwordHash: "00000000",
      createdAt: new Date().toISOString(),
    });
  });

  it("1. Synchronizes Câu trước and Câu sau with identical teal styling, dimensions, and muted disabled state", () => {
    const exam = buildExam(2, 1, 1); // 4 questions total
    const { container } = renderStandardExam(exam);

    const controlsBar = container.querySelector('[data-standard-controls="true"]') as HTMLElement;
    expect(controlsBar).not.toBeNull();

    const prevBtn = within(controlsBar).getByRole("button", { name: /‹ Câu trước/i }) as HTMLButtonElement;
    const nextBtn = within(controlsBar).getByRole("button", { name: /Câu sau ›/i }) as HTMLButtonElement;

    // Identical core style & sizing classes
    expect(prevBtn.className).toBe(nextBtn.className);
    expect(prevBtn.className).toContain("bg-teal-600");
    expect(prevBtn.className).toContain("hover:bg-teal-700");
    expect(prevBtn.className).toContain("text-white");
    expect(prevBtn.className).toContain("h-9 sm:h-10");
    expect(prevBtn.className).toContain("px-3 sm:px-4");
    expect(prevBtn.className).toContain("rounded-lg");
    expect(prevBtn.className).toContain("disabled:opacity-45");
    expect(prevBtn.className).toContain("disabled:bg-slate-300");

    // Disabled state on Question 1: Câu trước disabled, Câu sau enabled
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    // Move to Question 2: both enabled
    fireEvent.click(nextBtn);
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(false);

    // Move to Question 4 (last): Câu sau disabled, Câu trước enabled
    fireEvent.click(nextBtn);
    fireEvent.click(nextBtn);
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(true);
  });

  it("2. Uses full viewport width (max-w-none) without max-w-7xl constraint and expands both columns responsively", () => {
    const exam = buildExam(10, 4, 4);
    const { container } = renderStandardExam(exam);

    const headerInner = container.querySelector("header > div") as HTMLElement;
    expect(headerInner).not.toBeNull();
    expect(headerInner.className).toContain("max-w-none");
    expect(headerInner.className).not.toContain("max-w-7xl");

    const mainEl = container.querySelector("main.standard-take-layout") as HTMLElement;
    expect(mainEl).not.toBeNull();
    expect(mainEl.className).toContain("max-w-none");
    expect(mainEl.className).not.toContain("max-w-7xl");

    const twoColGrid = mainEl.firstElementChild as HTMLElement;
    expect(twoColGrid.className).toContain("grid-cols-1");
    expect(twoColGrid.className).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(340px,33vw)]");
    expect(twoColGrid.className).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(390px,31vw)]");
    expect(twoColGrid.className).toContain("2xl:grid-cols-[minmax(0,1fr)_minmax(440px,29vw)]");

    // Both columns carry min-w-0 to prevent horizontal overflow
    expect(twoColGrid.children[0].className).toContain("min-w-0");
    expect(twoColGrid.children[1].className).toContain("min-w-0");
  });

  it("3. Removes internal scrollbars inside DANH SÁCH CÂU and uses adaptive multi-column grids", () => {
    // Medium exam (28 questions: 18 MC + 4 TF + 6 SA)
    const mediumExam = buildExam(18, 4, 6);
    const { container: cMed, unmount: uMed } = renderStandardExam(mediumExam);
    const listMed = cMed.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(listMed).not.toBeNull();
    expect(listMed.className).not.toContain("max-h-[34vh]");
    expect(listMed.className).not.toContain("overflow-y-auto");
    expect(listMed.querySelectorAll("button").length).toBe(28);

    const gridsMed = listMed.querySelectorAll("[data-standard-part-group] .grid");
    expect(gridsMed.length).toBe(3);
    gridsMed.forEach((grid) => {
      expect(grid.className).not.toContain("grid-cols-5");
      expect((grid as HTMLElement).style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(40px, 1fr))");
    });
    uMed();

    // Large exam (55 questions: 45 MC + 6 TF + 4 SA) uses denser 36px min cell width
    const largeExam = buildExam(45, 6, 4);
    const { container: cLarge } = renderStandardExam(largeExam);
    const listLarge = cLarge.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(listLarge.className).not.toContain("max-h-[34vh]");
    expect(listLarge.className).not.toContain("overflow-y-auto");
    expect(listLarge.querySelectorAll("button").length).toBe(55);

    const gridsLarge = listLarge.querySelectorAll("[data-standard-part-group] .grid");
    expect(gridsLarge.length).toBe(3);
    gridsLarge.forEach((grid) => {
      expect((grid as HTMLElement).style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(36px, 1fr))");
    });

    // Legend & NỘP BÀI button remain completely visible and unobstructed
    const listCard = screen.getByText("DANH SÁCH CÂU").closest('[class*="rounded-2xl"]') as HTMLElement;
    expect(within(listCard).getByText("Đang làm")).toBeTruthy();
    expect(within(listCard).getAllByText("Đã làm").length).toBeGreaterThanOrEqual(2);
    expect(within(listCard).getByText("Chưa làm")).toBeTruthy();
    const submitBtn = within(listCard).getByRole("button", { name: /NỘP BÀI/i });
    expect(submitBtn).toBeTruthy();
    fireEvent.click(submitBtn);
    expect(screen.getByRole("button", { name: /Xác nhận nộp bài/i })).toBeTruthy();
  });

  it("4. Preserves navigation, answer state across parts, and leaves Single-Question & Team modes untouched", () => {
    const exam = buildExam(2, 1, 1);
    const { container } = renderStandardExam(exam);
    const listContainer = container.querySelector('[data-standard-question-list="true"]') as HTMLElement;

    // Answer Q1 (Part I)
    fireEvent.click(screen.getByText(/Đáp án B câu 1/i));

    // Use Câu sau › to navigate to Q3 (Part II)
    const nextBtn = screen.getByRole("button", { name: /Câu sau ›/i });
    fireEvent.click(nextBtn);
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Câu hỏi Phần II số 1/i)).toBeTruthy();

    // Verify Q1 shows answered state (bg-teal-50) and Q3 shows current state (bg-teal-600)
    expect(within(listContainer).getByRole("button", { name: "1" }).className).toContain("bg-teal-50");
    expect(within(listContainer).getByRole("button", { name: "3" }).className).toContain("bg-teal-600");

    // Jump to Q4 (Part III), enter answer, go back via ‹ Câu trước, verify answer persisted
    fireEvent.click(within(listContainer).getByRole("button", { name: "4" }));
    const saInput = screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i) as HTMLInputElement;
    fireEvent.change(saInput, { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: /‹ Câu trước/i }));
    expect(screen.getByText(/Câu hỏi Phần II số 1/i)).toBeTruthy();
    fireEvent.click(within(listContainer).getByRole("button", { name: "4" }));
    expect((screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i) as HTMLInputElement).value).toBe("200");

    // Single-Question mode (isQuiz) & TeamTake.tsx unaffected
    expect(takeContent).toContain('max-w-[96vw] 2xl:max-w-[94vw] px-3 sm:px-6 py-2.5');
    expect(takeContent).toContain('<main className="flex-1 w-full max-w-[96vw] 2xl:max-w-[94vw] mx-auto px-2 sm:px-4 py-3 sm:py-5 flex flex-col justify-between relative z-10 font-times-new-roman">');
    expect(teamTakeContent).not.toContain("standard-take-layout");
  });
});
