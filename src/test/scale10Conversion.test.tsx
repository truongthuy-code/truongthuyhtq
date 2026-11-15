import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  buildScale10Scoring,
  DEFAULT_PART_II_RATES,
  DEFAULT_TOTAL_SCALE,
  gradeExam,
  isLegacyScale100Config,
  isLegacyScale100Submission,
  normalizeScoringToScale10,
  normalizeSubmissionToScale10,
  reconcileScale10Scoring,
  suggestDefaultPartPoints,
  validateScale10Config,
  validateScale10Parts,
} from "@/lib/grading";
import type { ParsedExam } from "@/lib/docxParser";
import { saveUnifiedExam, getLocalStoredExams } from "@/lib/allExamsStorage";
import ScoringConfigPanel from "@/components/ScoringConfigPanel";
import EditExam from "@/pages/EditExam";
import Result from "@/pages/Result";
import checkQuestionAnswerHandler from "../../api/check-question-answer";
import submitExamHandler from "../../api/submit-exam";
import { SAMPLE_EXAMS } from "@/lib/sampleExams";

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

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

function makeExam(n1: number, n2: number, n3: number): ParsedExam {
  return {
    partI: Array.from({ length: n1 }, (_, i) => ({
      type: "mc",
      id: `p1_${i + 1}`,
      text: `Câu I.${i + 1}`,
      options: [
        { key: "A", text: "A" },
        { key: "B", text: "B" },
        { key: "C", text: "C" },
        { key: "D", text: "D" },
      ],
      answer: "A",
    })),
    partII: Array.from({ length: n2 }, (_, i) => ({
      type: "tf",
      id: `p2_${i + 1}`,
      text: `Câu II.${i + 1}`,
      items: [
        { key: "a", text: "Ý a", correct: true },
        { key: "b", text: "Ý b", correct: false },
        { key: "c", text: "Ý c", correct: true },
        { key: "d", text: "Ý d", correct: false },
      ],
    })),
    partIII: Array.from({ length: n3 }, (_, i) => ({
      type: "sa",
      id: `p3_${i + 1}`,
      text: `Câu III.${i + 1}`,
      answer: String(i + 1),
    })),
  };
}

function createMockRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
      return res;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: any) => {
      body = payload;
      return res;
    },
    end: () => res,
    _getStatus: () => statusCode,
    _getBody: () => body,
    _getHeaders: () => headers,
  };
  return res;
}

describe("Chuyển đổi toàn hệ thống sang Thang điểm 10 & Idempotent tương thích dữ liệu Thang điểm 100 cũ", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("1. Phân bổ mặc định tổng 10 điểm cho mọi tổ hợp phần thi", () => {
    expect(DEFAULT_TOTAL_SCALE).toBe(10);
    expect(suggestDefaultPartPoints({ p1: 12, p2: 4, p3: 5 })).toEqual({ p1: 3, p2: 4, p3: 3 });
    expect(suggestDefaultPartPoints({ p1: 12, p2: 4, p3: 0 })).toEqual({ p1: 6, p2: 4, p3: 0 });
    expect(suggestDefaultPartPoints({ p1: 10, p2: 0, p3: 5 })).toEqual({ p1: 7, p2: 0, p3: 3 });
    expect(suggestDefaultPartPoints({ p1: 0, p2: 4, p3: 5 })).toEqual({ p1: 0, p2: 6, p3: 4 });
    expect(suggestDefaultPartPoints({ p1: 10, p2: 0, p3: 0 })).toEqual({ p1: 10, p2: 0, p3: 0 });
    expect(suggestDefaultPartPoints({ p1: 0, p2: 4, p3: 0 })).toEqual({ p1: 0, p2: 10, p3: 0 });
    expect(suggestDefaultPartPoints({ p1: 0, p2: 0, p3: 5 })).toEqual({ p1: 0, p2: 0, p3: 10 });

    const invalidUnder = validateScale10Parts({ p1: 3, p2: 3, p3: 3 }, { p1: 12, p2: 4, p3: 5 });
    expect(invalidUnder.valid).toBe(false);
    expect(invalidUnder.total).toBe(9);
    expect(invalidUnder.message).toContain("9/10");

    const invalidOver = validateScale10Parts({ p1: 4, p2: 4, p3: 3 }, { p1: 12, p2: 4, p3: 5 });
    expect(invalidOver.valid).toBe(false);
    expect(invalidOver.total).toBe(11);
    expect(invalidOver.message).toContain("11/10");
  });

  it("2. ScoringConfigPanel hiển thị Thang điểm 10, chặn tổng != 10 và giữ nguyên tỷ lệ % Phần II (10%/25%/50%/100%)", () => {
    const exam = makeExam(12, 4, 5);
    let current = buildScale10Scoring(exam, { p1: 3, p2: 4, p3: 3 }, { p2Method: "custom_rates" });
    const onChange = vi.fn((next) => {
      current = next;
    });

    const { rerender } = render(
      <ScoringConfigPanel counts={{ p1: 12, p2: 4, p3: 5 }} scoring={current} onChange={onChange} />
    );

    expect(screen.getByText("Thang điểm: 10 điểm")).toBeTruthy();
    expect(screen.getByText("10 / 10 điểm")).toBeTruthy();
    expect(screen.getByText("Đủ 10đ")).toBeTruthy();

    // Tỷ lệ Phần II giữ nguyên 10 / 25 / 50 / 100
    expect((screen.getByLabelText("Tỷ lệ đúng 1/4 ý") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Tỷ lệ đúng 2/4 ý") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Tỷ lệ đúng 3/4 ý") as HTMLInputElement).value).toBe("50");
    expect(screen.getByText("100%")).toBeTruthy();

    // Part inputs có max="10"
    const p1Input = screen.getByLabelText("Điểm Phần I") as HTMLInputElement;
    expect(p1Input.max).toBe("10");

    // Khi sửa Phần I thành 4 -> tổng 11/10 -> báo lỗi vượt quá 10 điểm
    fireEvent.change(p1Input, { target: { value: "4" } });
    rerender(<ScoringConfigPanel counts={{ p1: 12, p2: 4, p3: 5 }} scoring={current} onChange={onChange} />);
    expect(screen.getByRole("alert").textContent).toContain("11/10");
    expect(validateScale10Config(current, { p1: 12, p2: 4, p3: 5 }).valid).toBe(false);
  });

  it("3. Quy đổi cấu hình Scale-100 cũ -> Scale-10 đúng 1 lần (Idempotent), tuyệt đối không chia 10 hai lần và giữ nguyên p2Rates", () => {
    const legacy100Config = {
      mode: "scale_100" as const,
      totalScale: 100,
      parts: { p1: 30, p2: 40, p3: 30 },
      counts: { p1: 12, p2: 4, p3: 5 },
      perQuestion: { p1: 2.5, p2: 10, p3: 6 },
      perItemP2: 2.5,
      p2Method: "custom_rates" as const,
      p2Rates: { "1": 20, "2": 45, "3": 75, "4": 100 },
      allowNonMonotonicP2Rates: false,
      p1: 2.5,
      p2: { "1": 1, "2": 2.5, "3": 5, "4": 10 },
      p3: 6,
      enable_min_correct_percentage: true,
      min_correct_percentage_for_review: 70,
    };

    expect(isLegacyScale100Config(legacy100Config)).toBe(true);

    const once = normalizeScoringToScale10(legacy100Config);
    expect(once.mode).toBe("scale_10");
    expect(once.totalScale).toBe(10);
    expect(once.parts).toEqual({ p1: 3, p2: 4, p3: 3 });
    expect(once.perQuestion).toEqual({ p1: 0.25, p2: 1, p3: 0.6 });
    expect(once.perItemP2).toBe(0.25);
    expect(once.p2Rates).toEqual({ "1": 20, "2": 45, "3": 75, "4": 100 });
    expect(once.enable_min_correct_percentage).toBe(true);
    expect(once.min_correct_percentage_for_review).toBe(70);

    // Gọi lặp lại nhiều lần không bao giờ chia tiếp thành 0.3 / 0.4 / 0.3
    const twice = normalizeScoringToScale10(once);
    const thrice = normalizeScoringToScale10(twice);
    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
    expect(isLegacyScale100Config(once)).toBe(false);

    // reconcileScale10Scoring trên legacy100Config cũng chỉ quy đổi 1 lần
    const exam = makeExam(12, 4, 5);
    const reconciledOnce = reconcileScale10Scoring(exam, legacy100Config);
    const reconciledTwice = reconcileScale10Scoring(exam, reconciledOnce);
    expect(reconciledOnce.parts).toEqual({ p1: 3, p2: 4, p3: 3 });
    expect(reconciledTwice.parts).toEqual({ p1: 3, p2: 4, p3: 3 });
    expect(reconciledTwice.p2Rates).toEqual({ "1": 20, "2": 45, "3": 75, "4": 100 });
  });

  it("4. EditExam tự quy đổi đề Scale-100 cũ sang 3/4/3, giữ p2Rates, lưu và mở lại không chia 10 lần 2", async () => {
    const examQs = makeExam(12, 4, 5);
    const legacy100Scoring = {
      mode: "scale_100" as const,
      totalScale: 100,
      parts: { p1: 30, p2: 40, p3: 30 },
      counts: { p1: 12, p2: 4, p3: 5 },
      perQuestion: { p1: 2.5, p2: 10, p3: 6 },
      perItemP2: 2.5,
      p2Method: "custom_rates" as const,
      p2Rates: DEFAULT_PART_II_RATES,
      p1: 2.5,
      p2: { "1": 1, "2": 2.5, "3": 5, "4": 10 },
      p3: 6,
    };

    saveUnifiedExam({
      id: "exam-legacy-100",
      title: "Đề cũ thang 100",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      created_by: "teacher-1",
      questions: examQs,
      scoring: legacy100Scoring as any,
    });

    const view1 = render(
      <MemoryRouter initialEntries={["/exam/exam-legacy-100/edit"]}>
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/exam/:id/edit" element={<EditExam />} />
        </Routes>
      </MemoryRouter>
    );

    const p1Input = (await screen.findByLabelText("Điểm Phần I")) as HTMLInputElement;
    const p2Input = screen.getByLabelText("Điểm Phần II") as HTMLInputElement;
    const p3Input = screen.getByLabelText("Điểm Phần III") as HTMLInputElement;
    expect(p1Input.value).toBe("3");
    expect(p2Input.value).toBe("4");
    expect(p3Input.value).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: /Lưu cài đặt/i }));

    await waitFor(() => {
      const saved = getLocalStoredExams().find((e) => e.id === "exam-legacy-100");
      expect(saved?.scoring?.mode).toBe("scale_10");
      expect(saved?.scoring?.parts).toEqual({ p1: 3, p2: 4, p3: 3 });
      expect(saved?.scoring?.p2Rates).toEqual({ "1": 10, "2": 25, "3": 50, "4": 100 });
    });

    view1.unmount();

    // Mở lại lần 2 -> vẫn phải là 3 / 4 / 3 (không phải 0.3 / 0.4 / 0.3)
    const view2 = render(
      <MemoryRouter initialEntries={["/exam/exam-legacy-100/edit"]}>
        <Routes>
          <Route path="/exam/:id/edit" element={<EditExam />} />
        </Routes>
      </MemoryRouter>
    );

    expect(((await screen.findByLabelText("Điểm Phần I")) as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Điểm Phần II") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("Điểm Phần III") as HTMLInputElement).value).toBe("3");

    view2.unmount();
  });

  it("5. Quy đổi bài nộp Scale-100 cũ -> Scale-10 (bao gồm ca điểm <= 10 trên max_score = 100), Idempotent & Result hiển thị đúng / 10 điểm", () => {
    const legacySub785 = {
      id: "sub-legacy-785",
      exam_id: "exam-legacy",
      student_name: "Trần Minh",
      student_class: "12A1",
      score: 78.5,
      max_score: 100,
      part2_summary: [
        {
          questionIndex: 1,
          id: "p2_1",
          okItems: 2,
          totalItems: 4,
          ratePercent: 25,
          earnedScore: 2.5,
          maxScore: 10,
          method: "custom_rates",
          itemStatuses: ["correct", "correct", "wrong", "wrong"],
        },
      ],
    };

    expect(isLegacyScale100Submission(legacySub785)).toBe(true);
    const norm1 = normalizeSubmissionToScale10(legacySub785);
    expect(norm1.score).toBe(7.85);
    expect(norm1.max_score).toBe(10);
    expect(norm1.wasLegacyScale100).toBe(true);
    expect(norm1.part2_summary[0]).toMatchObject({ earnedScore: 0.25, maxScore: 1, ratePercent: 25 });

    // Gọi lần 2 & 3 -> giữ nguyên 7.85 / 10
    const norm2 = normalizeSubmissionToScale10(norm1);
    const norm3 = normalizeSubmissionToScale10(norm2);
    expect(norm2.score).toBe(7.85);
    expect(norm3.score).toBe(7.85);
    expect(norm3.max_score).toBe(10);

    // Trường hợp biên: học sinh chỉ được 9.5/100 điểm -> phải thành 0.95/10 (dựa vào max_score=100)
    const legacyLow = { id: "sub-low", score: 9.5, max_score: 100 };
    const normLow = normalizeSubmissionToScale10(legacyLow);
    expect(normLow.score).toBe(0.95);
    expect(normLow.max_score).toBe(10);
    expect(normalizeSubmissionToScale10(normLow).score).toBe(0.95);

    // Bài nộp vốn dĩ đã thuộc thang điểm 10 (9.5/10) -> tuyệt đối không đổi thành 0.95!
    const modernSub = { id: "sub-modern", score: 9.5, max_score: 10 };
    const normModern = normalizeSubmissionToScale10(modernSub);
    expect(normModern.score).toBe(9.5);
    expect(normModern.max_score).toBe(10);
    expect(normModern.wasLegacyScale100).toBe(false);

    // Kiểm tra Result.tsx hiển thị đúng "7.85 / 10 điểm" khi nhận dữ liệu bài nộp Scale-100 cũ
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result/sub-legacy-785",
            state: {
              submission: legacySub785,
              exam: { id: "exam-legacy", title: "Đề cũ hiển thị thang 10", allow_review: false, questions: null },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/7\.85/)).toBeTruthy();
    expect(screen.getByText(/\/ 10 điểm/)).toBeTruthy();
    expect(screen.getByText("0.25/1")).toBeTruthy();
  });

  it("6. API check-question-answer & submit-exam luôn chấm theo thang điểm 10 ngay cả khi payload cấu hình cũ scale_100", async () => {
    const sample = SAMPLE_EXAMS[0];
    const p2Q = sample.questions.partII[0];

    const legacy100Payload = {
      mode: "scale_100",
      totalScale: 100,
      parts: { p1: 30, p2: 40, p3: 30 },
      counts: {
        p1: sample.questions.partI.length,
        p2: sample.questions.partII.length,
        p3: sample.questions.partIII.length,
      },
      p2Method: "custom_rates",
      p2Rates: DEFAULT_PART_II_RATES,
    };

    const reqCheck: any = {
      method: "POST",
      body: {
        examId: sample.id,
        questionId: p2Q.id,
        answer: { a: p2Q.items[0].correct, b: p2Q.items[1].correct, c: p2Q.items[2].correct, d: p2Q.items[3].correct },
        scoring: legacy100Payload,
        fallbackQuestion: { ...p2Q, scoring: legacy100Payload },
      },
      headers: {},
    };
    const resCheck = createMockRes();
    await checkQuestionAnswerHandler(reqCheck, resCheck);
    expect(resCheck._getStatus()).toBe(200);
    const checkBody = resCheck._getBody();
    expect(checkBody.okItems).toBe(p2Q.items.length);
    expect(checkBody.totalItems).toBe(p2Q.items.length);
    expect(checkBody.ratePercent).toBe(100);

    // Submit full exam via API
    const allAns: Record<string, any> = {};
    for (const q of sample.questions.partI) allAns[q.id] = q.answer;
    for (const q of sample.questions.partII) {
      allAns[q.id] = Object.fromEntries(q.items.map((it) => [it.key, it.correct]));
    }
    for (const q of sample.questions.partIII) allAns[q.id] = q.answer;

    const reqSubmit: any = {
      method: "POST",
      body: {
        examId: sample.id,
        studentName: "HS Scale 10",
        studentClass: "12A1",
        answers: allAns,
      },
      headers: {},
    };
    const resSubmit = createMockRes();
    await submitExamHandler(reqSubmit, resSubmit);
    expect(resSubmit._getStatus()).toBe(200);
    const submitBody = resSubmit._getBody();
    expect(submitBody.submission?.max_score).toBeLessThanOrEqual(10);
    expect(submitBody.submission?.score).toBeLessThanOrEqual(10);

    // Kiểm tra gradeExam trực tiếp trên legacy100Payload
    const gradedLegacy = gradeExam(sample.questions, allAns, legacy100Payload as any);
    expect(gradedLegacy.score).toBe(10);
    expect(gradedLegacy.maxScore).toBe(10);
  });
});
