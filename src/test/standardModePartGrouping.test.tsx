import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

function buildExam(p1Count: number, p2Count: number, p3Count: number, overrideQuestions?: any) {
  const partI = Array.from({ length: p1Count }, (_, i) => ({
    id: `p1_${i + 1}`,
    text: `Nội dung trắc nghiệm Phần I câu ${i + 1}`,
    options: [
      { key: "A", text: `Lựa chọn A (${i + 1})` },
      { key: "B", text: `Lựa chọn B (${i + 1})` },
      { key: "C", text: `Lựa chọn C (${i + 1})` },
      { key: "D", text: `Lựa chọn D (${i + 1})` },
    ],
    answer: "A",
  }));

  const partII = Array.from({ length: p2Count }, (_, i) => ({
    id: `p2_${i + 1}`,
    text: `Nội dung Đúng/Sai Phần II câu ${i + 1}`,
    items: [
      { key: "a", text: `Ý a câu ${i + 1}`, correct: true },
      { key: "b", text: `Ý b câu ${i + 1}`, correct: false },
      { key: "c", text: `Ý c câu ${i + 1}`, correct: true },
      { key: "d", text: `Ý d câu ${i + 1}`, correct: false },
    ],
  }));

  const partIII = Array.from({ length: p3Count }, (_, i) => ({
    id: `p3_${i + 1}`,
    text: `Nội dung Trả lời ngắn Phần III câu ${i + 1}`,
    answer: String(100 + i),
  }));

  return {
    id: `std-part-group-${p1Count}-${p2Count}-${p3Count}`,
    code: "PARTGRP",
    title: "Đề thi kiểm tra phân chia theo phần",
    duration_minutes: 45,
    display_mode: "standard",
    shuffle_questions: false,
    shuffle_options: false,
    instant_feedback: false,
    questions: overrideQuestions ?? { partI, partII, partIII },
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

describe("STANDARD MODE QUESTION LIST GROUPED BY EXAM PARTS (PHẦN I, II, III)", () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentStudent({
      id: "stu_group_1",
      fullName: "Trần Minh Khoa",
      className: "12A2",
      account: "khoa.tran@test.local",
      passwordHash: "00000000",
      createdAt: new Date().toISOString(),
    });
  });

  it("1. Renders all 3 part sections (Phần I, II, III) with exact titles, auto counts, continuous numbering, and distinct colors", () => {
    const exam = buildExam(18, 4, 6);
    const { container } = renderStandardExam(exam);

    const listContainer = container.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(listContainer).not.toBeNull();

    // Check all 3 groups exist
    const p1Group = listContainer.querySelector('[data-standard-part-group="1"]') as HTMLElement;
    const p2Group = listContainer.querySelector('[data-standard-part-group="2"]') as HTMLElement;
    const p3Group = listContainer.querySelector('[data-standard-part-group="3"]') as HTMLElement;
    expect(p1Group).not.toBeNull();
    expect(p2Group).not.toBeNull();
    expect(p3Group).not.toBeNull();

    // Exact titles & counts
    expect(p1Group.textContent).toContain("PHẦN I – TRẮC NGHIỆM NHIỀU LỰA CHỌN");
    expect(p1Group.textContent).toContain("18 câu");

    expect(p2Group.textContent).toContain("PHẦN II – TRẮC NGHIỆM ĐÚNG/SAI");
    expect(p2Group.textContent).toContain("4 câu");

    expect(p3Group.textContent).toContain("PHẦN III – TRẮC NGHIỆM TRẢ LỜI NGẮN");
    expect(p3Group.textContent).toContain("6 câu");

    // Continuous numbering preserved inside each group
    const p1Buttons = within(p1Group).getAllByRole("button");
    expect(p1Buttons.map((b) => b.textContent)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)));

    const p2Buttons = within(p2Group).getAllByRole("button");
    expect(p2Buttons.map((b) => b.textContent)).toEqual(["19", "20", "21", "22"]);

    const p3Buttons = within(p3Group).getAllByRole("button");
    expect(p3Buttons.map((b) => b.textContent)).toEqual(["23", "24", "25", "26", "27", "28"]);

    // Distinct header colors between Part I, II, III
    expect(p1Group.innerHTML).toContain("bg-sky-50");
    expect(p2Group.innerHTML).toContain("bg-amber-50");
    expect(p3Group.innerHTML).toContain("bg-indigo-50");

    // NỘP BÀI remains at the bottom of DANH SÁCH CÂU
    const listHeading = screen.getByText("DANH SÁCH CÂU");
    const listCard = listHeading.closest('[class*="rounded-2xl"]') as HTMLElement;
    expect(within(listCard).getByRole("button", { name: /NỘP BÀI/i })).toBeTruthy();
  });

  it("2. Clicking buttons across Phần I, II, III jumps accurately and preserves answers + status colors", () => {
    const exam = buildExam(2, 2, 2);
    const { container } = renderStandardExam(exam);

    const listContainer = container.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    const p1Group = listContainer.querySelector('[data-standard-part-group="1"]') as HTMLElement;
    const p2Group = listContainer.querySelector('[data-standard-part-group="2"]') as HTMLElement;
    const p3Group = listContainer.querySelector('[data-standard-part-group="3"]') as HTMLElement;

    // Answer Question 1 (Part I)
    expect(screen.getByText("Nội dung trắc nghiệm Phần I câu 1")).toBeTruthy();
    fireEvent.click(screen.getByText(/Lựa chọn A \(1\)/i));

    // Jump to Question 4 (Part II question 2)
    fireEvent.click(within(p2Group).getByRole("button", { name: "4" }));
    expect(screen.getByText("Nội dung Đúng/Sai Phần II câu 2")).toBeTruthy();

    // Button 1 in Part I should now have answered styling (bg-teal-50), Button 4 active (bg-teal-600)
    const btn1 = within(p1Group).getByRole("button", { name: "1" });
    const btn4 = within(p2Group).getByRole("button", { name: "4" });
    expect(btn1.className).toContain("bg-teal-50");
    expect(btn4.className).toContain("bg-teal-600");

    // Answer all 4 TF items on Question 4
    const trueBtns = screen.getAllByRole("button", { name: /^Đúng$/i });
    trueBtns.forEach((btn) => fireEvent.click(btn));

    // Jump to Question 6 (Part III question 2)
    fireEvent.click(within(p3Group).getByRole("button", { name: "6" }));
    expect(screen.getByText("Nội dung Trả lời ngắn Phần III câu 2")).toBeTruthy();
    expect(btn4.className).toContain("bg-teal-50");

    const saInput = screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i);
    fireEvent.change(saInput, { target: { value: "101" } });

    // Jump back to Question 1 and verify MC answer is preserved
    fireEvent.click(within(p1Group).getByRole("button", { name: "1" }));
    expect(screen.getByText("Nội dung trắc nghiệm Phần I câu 1")).toBeTruthy();
    const radioA = container.querySelector('#std-p1_1-A') as HTMLInputElement;
    expect(radioA.checked || radioA.getAttribute("data-state") === "checked" || radioA.getAttribute("aria-checked") === "true").toBe(true);

    // Jump back to Question 6 and verify SA answer is preserved
    fireEvent.click(within(p3Group).getByRole("button", { name: "6" }));
    expect((screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i) as HTMLInputElement).value).toBe("101");
  });

  it("3. Automatically omits missing parts (e.g., no Part III, or only Part II, or Part I + III only)", () => {
    // Case A: Only Part I & Part II (no Part III)
    const examNoP3 = buildExam(3, 2, 0);
    const { container: c1, unmount: u1 } = renderStandardExam(examNoP3);
    const list1 = c1.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(list1.querySelector('[data-standard-part-group="1"]')).not.toBeNull();
    expect(list1.querySelector('[data-standard-part-group="2"]')).not.toBeNull();
    expect(list1.querySelector('[data-standard-part-group="3"]')).toBeNull();
    u1();

    // Case B: Only Part II
    const examOnlyP2 = buildExam(0, 3, 0);
    const { container: c2, unmount: u2 } = renderStandardExam(examOnlyP2);
    const list2 = c2.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(list2.querySelector('[data-standard-part-group="1"]')).toBeNull();
    expect(list2.querySelector('[data-standard-part-group="2"]')).not.toBeNull();
    expect(list2.querySelector('[data-standard-part-group="3"]')).toBeNull();
    expect(list2.textContent).toContain("3 câu");
    u2();

    // Case C: Part I + Part III (no Part II)
    const examNoP2 = buildExam(4, 0, 2);
    const { container: c3 } = renderStandardExam(examNoP2);
    const list3 = c3.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    expect(list3.querySelector('[data-standard-part-group="1"]')).not.toBeNull();
    expect(list3.querySelector('[data-standard-part-group="2"]')).toBeNull();
    expect(list3.querySelector('[data-standard-part-group="3"]')).not.toBeNull();
  });

  it("4. Classifies shuffled/mixed flat-array questions strictly by actual question type/structure, never by order", () => {
    const mixedFlatQuestions = [
      {
        id: "mix_1",
        type: "sa",
        text: "Câu trả lời ngắn đứng đầu danh sách",
        answer: "42",
      },
      {
        id: "mix_2",
        type: "tf",
        text: "Câu Đúng/Sai đứng thứ 2",
        items: [
          { key: "a", text: "Ý a", correct: true },
          { key: "b", text: "Ý b", correct: false },
        ],
      },
      {
        id: "mix_3",
        type: "mc",
        text: "Câu Nhiều lựa chọn đứng thứ 3",
        options: [
          { key: "A", text: "ĐA A" },
          { key: "B", text: "ĐA B" },
        ],
        answer: "A",
      },
      {
        id: "mix_4",
        // No explicit type or _part: inferred from items array -> Part II
        text: "Câu Đúng/Sai suy từ items đứng thứ 4",
        items: [{ key: "a", text: "Ý suy diễn", correct: true }],
      },
    ];

    const exam = buildExam(0, 0, 0, mixedFlatQuestions);
    const { container } = renderStandardExam(exam);

    const list = container.querySelector('[data-standard-question-list="true"]') as HTMLElement;
    const p1 = list.querySelector('[data-standard-part-group="1"]') as HTMLElement;
    const p2 = list.querySelector('[data-standard-part-group="2"]') as HTMLElement;
    const p3 = list.querySelector('[data-standard-part-group="3"]') as HTMLElement;

    // Group counts & exact original numbers preserved:
    // Part I -> Question 3 (1 câu)
    // Part II -> Questions 2, 4 (2 câu)
    // Part III -> Question 1 (1 câu)
    expect(p1.textContent).toContain("1 câu");
    expect(within(p1).getAllByRole("button").map((b) => b.textContent)).toEqual(["3"]);

    expect(p2.textContent).toContain("2 câu");
    expect(within(p2).getAllByRole("button").map((b) => b.textContent)).toEqual(["2", "4"]);

    expect(p3.textContent).toContain("1 câu");
    expect(within(p3).getAllByRole("button").map((b) => b.textContent)).toEqual(["1"]);

    // Click button "3" inside Part I and verify it opens mix_3
    fireEvent.click(within(p1).getByRole("button", { name: "3" }));
    expect(screen.getByText("Câu Nhiều lựa chọn đứng thứ 3")).toBeTruthy();

    // Click button "4" inside Part II and verify it opens mix_4
    fireEvent.click(within(p2).getByRole("button", { name: "4" }));
    expect(screen.getByText("Câu Đúng/Sai suy từ items đứng thứ 4")).toBeTruthy();
  });
});
