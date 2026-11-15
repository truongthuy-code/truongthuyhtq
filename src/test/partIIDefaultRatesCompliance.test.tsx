import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  buildScale10Scoring,
  DEFAULT_PART_II_RATES,
  gradeExam,
  normalizePartIIRates,
  reconcileScale10Scoring,
} from "@/lib/grading";
import type { ParsedExam } from "@/lib/docxParser";
import { saveUnifiedExam, getLocalStoredExams } from "@/lib/allExamsStorage";
import Teacher from "@/pages/Teacher";
import EditExam from "@/pages/EditExam";
import Result from "@/pages/Result";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "mocked-offline" } }),
    from: vi.fn(() => {
      throw new Error("mocked-offline");
    }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "teacher-1" } } }),
    },
    storage: {
      from: vi.fn(),
    },
  },
}));

const MOCK_AUTH_VALUE = {
  user: { id: "teacher-1", email: "teacher@test.local", role: "teacher" },
  profile: { full_name: "Giáo viên A", school_name: "THPT Test", subject_name: "Tin học" },
  roles: ["teacher"],
  role: "teacher",
  isSuperAdmin: false,
  isAdmin: false,
  isTeacher: true,
  loading: false,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => MOCK_AUTH_VALUE,
}));

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

function makePartII10PtExam(): ParsedExam {
  // 10 câu Phần II tổng 10đ => mỗi câu tối đa 1 điểm
  return {
    partI: [],
    partII: Array.from({ length: 10 }, (_, idx) => ({
      type: "tf",
      id: `q_p2_${idx + 1}`,
      text: `Câu ${idx + 1} Phần II (1 điểm)`,
      items: [
        { key: "a", text: `Ý a câu ${idx + 1}`, correct: true },
        { key: "b", text: `Ý b câu ${idx + 1}`, correct: false },
        { key: "c", text: `Ý c câu ${idx + 1}`, correct: true },
        { key: "d", text: `Ý d câu ${idx + 1}`, correct: false },
      ],
    })),
    partIII: [],
  };
}

function makeTFChoice(okCount: number): Record<string, boolean> {
  const truth = { a: true, b: false, c: true, d: false };
  const keys = ["a", "b", "c", "d"] as const;
  const out: Record<string, boolean> = {};
  keys.forEach((k, i) => {
    out[k] = i < okCount ? truth[k] : !truth[k];
  });
  return out;
}

describe("Kiểm thử tỷ lệ điểm mặc định Phần II (10% - 25% - 50% - 100%) trên thang điểm 10", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("1. Tạo bài kiểm tra mới và chọn phương thức tỷ lệ số ý đúng -> tự động điền 0%, 10%, 25%, 50%, 100%", async () => {
    expect(DEFAULT_PART_II_RATES).toEqual({
      "1": 10,
      "2": 25,
      "3": 50,
      "4": 100,
    });
    expect(normalizePartIIRates(undefined)).toEqual({
      "1": 10,
      "2": 25,
      "3": 50,
      "4": 100,
    });

    render(
      <MemoryRouter initialEntries={["/teacher"]}>
        <Routes>
          <Route path="/teacher" element={<Teacher />} />
        </Routes>
      </MemoryRouter>
    );

    // Chuyển sang tab Nhập tay và phân tích 1 câu Phần II để tạo bài kiểm tra mới
    const manualTab = screen.getByRole("tab", { name: /Nhập tay/i });
    fireEvent.mouseDown(manualTab);
    fireEvent.click(manualTab);
    const textarea = await screen.findByPlaceholderText(/PHẦN I/i);
    fireEvent.change(textarea, {
      target: {
        value: [
          "PHẦN II",
          "Câu 1. Khẳng định nào sau đây đúng?",
          "*a) Mệnh đề a",
          "b) Mệnh đề b",
          "*c) Mệnh đề c",
          "d) Mệnh đề d",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Phân tích/i }));

    // Chọn Phương thức 2: Tỷ lệ giáo viên thiết lập
    const customRadio = screen.getByRole("radio", { name: /Phương thức 2: Tỷ lệ giáo viên thiết lập/i });
    fireEvent.click(customRadio);

    expect(screen.getByText(/0% \(cố định\)/i)).toBeTruthy();
    expect((screen.getByLabelText("Tỷ lệ đúng 1/4 ý") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement).value).toBe("50");
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("2. Câu hỏi điểm tối đa 1 điểm chấm chính xác 0, 0.1, 0.25, 0.5, 1 điểm & hiển thị ở Kết quả học sinh", () => {
    const exam = makePartII10PtExam();
    const scoring = buildScale10Scoring(
      exam,
      { p1: 0, p2: 10, p3: 0 },
      { p2Method: "custom_rates" } // Chưa sửa tỷ lệ -> tự dùng mặc định 10/25/50/100
    );

    expect(scoring.perQuestion.p2).toBe(1);
    expect(scoring.p2Rates).toEqual({ "1": 10, "2": 25, "3": 50, "4": 100 });

    const answers = {
      q_p2_1: makeTFChoice(0), // 0/4 -> 0đ
      q_p2_2: makeTFChoice(1), // 1/4 -> 0.1đ
      q_p2_3: makeTFChoice(2), // 2/4 -> 0.25đ
      q_p2_4: makeTFChoice(3), // 3/4 -> 0.5đ
      q_p2_5: makeTFChoice(4), // 4/4 -> 1đ
    };

    const graded = gradeExam(exam, answers, scoring);
    expect(graded.partIISummary.slice(0, 5).map((s) => s.ratePercent)).toEqual([0, 10, 25, 50, 100]);
    expect(graded.partIISummary.slice(0, 5).map((s) => s.earnedScore)).toEqual([0, 0.1, 0.25, 0.5, 1]);
    expect(graded.score).toBe(1.85); // 0 + 0.1 + 0.25 + 0.5 + 1

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result/sub-10pt",
            state: {
              submission: {
                id: "sub-10pt",
                exam_id: "exam-10pt",
                student_name: "Nguyễn An",
                student_class: "12A1",
                score: graded.score,
                max_score: graded.maxScore,
                correct_count: graded.correct,
                wrong_count: graded.wrong,
                answers,
                scoring_snapshot: scoring,
                part2_summary: graded.partIISummary,
              },
              exam: {
                id: "exam-10pt",
                title: "Đề Phần II thang 10 điểm",
                allow_review: true,
                scoring,
                questions: exam,
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("10%")).toBeTruthy();
    expect(screen.getByText("0.1/1")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("0.25/1")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("0.5/1")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("3 & 4 & 6. Chỉnh sửa tỷ lệ, lưu bài kiểm tra, mở lại giữ nguyên cấu hình đã lưu và khôi phục mặc định về 10%-25%-50%-100%", async () => {
    const examQs = makePartII10PtExam();
    const initialScoring = buildScale10Scoring(
      examQs,
      { p1: 0, p2: 10, p3: 0 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );

    saveUnifiedExam({
      id: "exam-edit-1",
      title: "Đề kiểm tra chỉnh tỷ lệ",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      created_by: "teacher-1",
      questions: examQs,
      scoring: initialScoring,
    });

    const view1 = render(
      <MemoryRouter initialEntries={["/exam/exam-edit-1/edit"]}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/exam/:id/edit" element={<EditExam />} />
        </Routes>
      </MemoryRouter>
    );

    // Chờ tải đề thi xong -> thấy tỷ lệ mặc định 10 / 25 / 50
    const input1 = (await screen.findByLabelText("Tỷ lệ đúng 1/4 ý")) as HTMLInputElement;
    const input2 = screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement;
    const input3 = screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement;
    expect(input1.value).toBe("10");
    expect(input2.value).toBe("25");
    expect(input3.value).toBe("50");

    // 3. Chỉnh sửa thành 15 / 35 / 70 và lưu
    fireEvent.change(input1, { target: { value: "15" } });
    fireEvent.change(input2, { target: { value: "35" } });
    fireEvent.change(input3, { target: { value: "70" } });

    fireEvent.click(screen.getByRole("button", { name: /Lưu cài đặt/i }));

    await waitFor(() => {
      const saved = getLocalStoredExams().find((e) => e.id === "exam-edit-1");
      expect(saved?.scoring?.p2Rates).toEqual({ "1": 15, "2": 35, "3": 70, "4": 100 });
    });

    view1.unmount();

    // 4. Mở lại bài kiểm tra đã lưu -> không bị ghi đè bởi mặc định mới
    const view2 = render(
      <MemoryRouter initialEntries={["/exam/exam-edit-1/edit"]}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/exam/:id/edit" element={<EditExam />} />
        </Routes>
      </MemoryRouter>
    );

    const reopened1 = (await screen.findByLabelText("Tỷ lệ đúng 1/4 ý")) as HTMLInputElement;
    const reopened2 = screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement;
    const reopened3 = screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement;
    expect(reopened1.value).toBe("15");
    expect(reopened2.value).toBe("35");
    expect(reopened3.value).toBe("70");

    // 6. Chủ động bấm Khôi phục thiết lập mặc định -> đưa về đúng 10 / 25 / 50 / 100
    fireEvent.click(screen.getByRole("button", { name: /Khôi phục thiết lập mặc định/i }));
    expect((screen.getByLabelText("Tỷ lệ đúng 1/4 ý") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement).value).toBe("50");

    view2.unmount();
  });

  it("5. Bài kiểm tra cũ đã thiết lập tỷ lệ riêng (20%/45%/75%/100%) hoặc thang điểm cũ không bị ghi đè", async () => {
    const examQs = makePartII10PtExam();
    const legacyRates = { "1": 20, "2": 45, "3": 75, "4": 100 };
    const oldSavedScoring = buildScale10Scoring(
      examQs,
      { p1: 0, p2: 10, p3: 0 },
      { p2Method: "custom_rates", p2Rates: legacyRates }
    );

    // Kiểm tra reconcileScale10Scoring không tự động reset tỷ lệ cũ
    const reconciled = reconcileScale10Scoring(examQs, oldSavedScoring);
    expect(reconciled.p2Rates).toEqual(legacyRates);

    // Chấm điểm bài cũ vẫn dùng đúng tỷ lệ cũ 20% / 45% / 75% / 100% trên câu 1đ
    expect(gradeExam(examQs, { q_p2_1: makeTFChoice(1) }, reconciled).score).toBe(0.2);
    expect(gradeExam(examQs, { q_p2_1: makeTFChoice(2) }, reconciled).score).toBe(0.45);
    expect(gradeExam(examQs, { q_p2_1: makeTFChoice(3) }, reconciled).score).toBe(0.75);

    saveUnifiedExam({
      id: "exam-old-preserved",
      title: "Đề cũ giữ nguyên tỷ lệ",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      created_by: "teacher-1",
      questions: examQs,
      scoring: oldSavedScoring,
    });

    render(
      <MemoryRouter initialEntries={["/exam/exam-old-preserved/edit"]}>
        <Routes>
          <Route path="/exam/:id/edit" element={<EditExam />} />
        </Routes>
      </MemoryRouter>
    );

    expect(((await screen.findByLabelText("Tỷ lệ đúng 1/4 ý")) as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement).value).toBe("45");
    expect((screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement).value).toBe("75");
  });
});
