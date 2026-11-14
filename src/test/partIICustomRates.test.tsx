import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  attachQuestionScores,
  buildScale100Scoring,
  DEFAULT_PART_II_RATES,
  getPartIIMethod,
  getPartIIQuestionScoreDetails,
  gradeExam,
  normalizePartIIRates,
  reconcileScale100Scoring,
  validatePartIIRates,
  validateScale100Config,
} from "@/lib/grading";
import type { ParsedExam } from "@/lib/docxParser";
import ScoringConfigPanel from "@/components/ScoringConfigPanel";
import Result from "@/pages/Result";
import { SAMPLE_EXAMS } from "@/lib/sampleExams";
import checkQuestionAnswerHandler from "../../api/check-question-answer";
import submitExamHandler from "../../api/submit-exam";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "mocked-offline" } }),
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

function makeSampleExam(n1: number, n2: number, n3: number, tfItemsPerQ = 4): ParsedExam {
  return {
    partI: Array.from({ length: n1 }, (_, i) => ({
      id: `p1_${i + 1}`,
      text: `Câu trắc nghiệm ${i + 1}`,
      options: [
        { key: "A", text: "Đáp án A" },
        { key: "B", text: "Đáp án B" },
        { key: "C", text: "Đáp án C" },
        { key: "D", text: "Đáp án D" },
      ],
      answer: "A",
    })),
    partII: Array.from({ length: n2 }, (_, i) => ({
      id: `p2_${i + 1}`,
      text: `Nội dung bí mật câu đúng sai ${i + 1}`,
      items: Array.from({ length: tfItemsPerQ }, (__, j) => ({
        key: String.fromCharCode(97 + j) as "a" | "b" | "c" | "d",
        text: `Nội dung ý ${String.fromCharCode(97 + j)} câu ${i + 1}`,
        correct: j % 2 === 0, // a: true, b: false, c: true, d: false
      })),
    })),
    partIII: Array.from({ length: n3 }, (_, i) => ({
      id: `p3_${i + 1}`,
      text: `Câu trả lời ngắn ${i + 1}`,
      answer: String(10 + i),
    })),
  };
}

function makeAllCorrectAnswers(exam: ParsedExam): Record<string, any> {
  const ans: Record<string, any> = {};
  for (const q of exam.partI) ans[q.id] = q.answer;
  for (const q of exam.partII) {
    const tf: Record<string, boolean> = {};
    for (const it of q.items) tf[it.key] = !!it.correct;
    ans[q.id] = tf;
  }
  for (const q of exam.partIII) ans[q.id] = q.answer;
  return ans;
}

function makeTFSelection(okCount: number): Record<string, boolean> {
  // Ground truth for makeSampleExam: a=true, b=false, c=true, d=false
  const truth = { a: true, b: false, c: true, d: false };
  const keys = ["a", "b", "c", "d"] as const;
  const out: Record<string, boolean> = {};
  keys.forEach((k, idx) => {
    out[k] = idx < okCount ? truth[k] : !truth[k];
  });
  return out;
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

describe("Nâng cấp cách tính điểm Phần II – Trắc nghiệm Đúng/Sai (Mục 8 - 13 test case)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1: Phương thức mặc định ('equal') giữ nguyên kết quả chia đều 25%/50%/75%/100%", () => {
    const exam = makeSampleExam(0, 1, 0);
    const scoring = buildScale100Scoring(exam, { p1: 0, p2: 100, p3: 0 }); // p2Method mặc định là 'equal'
    expect(getPartIIMethod(scoring)).toBe("equal");

    expect(gradeExam(exam, { p2_1: makeTFSelection(0) }, scoring).score).toBe(0);
    expect(gradeExam(exam, { p2_1: makeTFSelection(1) }, scoring).score).toBe(25);
    expect(gradeExam(exam, { p2_1: makeTFSelection(2) }, scoring).score).toBe(50);
    expect(gradeExam(exam, { p2_1: makeTFSelection(3) }, scoring).score).toBe(75);
    expect(gradeExam(exam, { p2_1: makeTFSelection(4) }, scoring).score).toBe(100);
  });

  it("Test 2: Phương thức 'custom_rates' mặc định 10%-25%-50%-100% trên câu 10 điểm (40đ / 4 câu)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    expect(scoring.p2Method).toBe("custom_rates");
    expect(scoring.perQuestion.p2).toBe(10);
    expect(scoring.p2Rates).toEqual({ "1": 10, "2": 25, "3": 50, "4": 100 });
  });

  it("Test 3: Đúng 0/4 ý -> 0 điểm (0%)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const res = gradeExam(exam, { p2_1: makeTFSelection(0) }, scoring);
    expect(res.score).toBe(0);
    expect(res.partIISummary?.[0]).toMatchObject({
      okItems: 0,
      totalItems: 4,
      ratePercent: 0,
      earnedScore: 0,
      maxScore: 10,
      method: "custom_rates",
    });
  });

  it("Test 4: Đúng 1/4 ý -> 1 điểm (10% của 10đ)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const res = gradeExam(exam, { p2_1: makeTFSelection(1) }, scoring);
    expect(res.score).toBe(1);
    expect(res.partIISummary?.[0]).toMatchObject({
      okItems: 1,
      totalItems: 4,
      ratePercent: 10,
      earnedScore: 1,
      maxScore: 10,
    });
  });

  it("Test 5: Đúng 2/4 ý -> 2.5 điểm (25% của 10đ)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const res = gradeExam(exam, { p2_1: makeTFSelection(2) }, scoring);
    expect(res.score).toBe(2.5);
    expect(res.partIISummary?.[0]).toMatchObject({
      okItems: 2,
      totalItems: 4,
      ratePercent: 25,
      earnedScore: 2.5,
      maxScore: 10,
    });
  });

  it("Test 6: Đúng 3/4 ý -> 5 điểm (50% của 10đ)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const res = gradeExam(exam, { p2_1: makeTFSelection(3) }, scoring);
    expect(res.score).toBe(5);
    expect(res.partIISummary?.[0]).toMatchObject({
      okItems: 3,
      totalItems: 4,
      ratePercent: 50,
      earnedScore: 5,
      maxScore: 10,
    });
  });

  it("Test 7: Đúng 4/4 ý -> 10 điểm (100% của 10đ) & đúng cả đề đạt chính xác 100", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const res1 = gradeExam(exam, { p2_1: makeTFSelection(4) }, scoring);
    expect(res1.score).toBe(10);
    expect(res1.partIISummary?.[0]).toMatchObject({
      okItems: 4,
      totalItems: 4,
      ratePercent: 100,
      earnedScore: 10,
      maxScore: 10,
    });

    const fullRes = gradeExam(exam, makeAllCorrectAnswers(exam), scoring);
    expect(fullRes.score).toBe(100);
    expect(fullRes.maxScore).toBe(100);
  });

  it("Test 8: Giáo viên chỉnh tỷ lệ tùy ý (15/35/70/100), kiểm tra range, cảnh báo không tăng dần & nút khôi phục mặc định trên ScoringConfigPanel", () => {
    const exam = makeSampleExam(12, 4, 5);
    const customScoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: { "1": 15, "2": 35, "3": 70, "4": 100 } }
    );

    expect(gradeExam(exam, { p2_1: makeTFSelection(1) }, customScoring).score).toBe(1.5);
    expect(gradeExam(exam, { p2_1: makeTFSelection(2) }, customScoring).score).toBe(3.5);
    expect(gradeExam(exam, { p2_1: makeTFSelection(3) }, customScoring).score).toBe(7);

    // Validation tests
    expect(validatePartIIRates({ "1": -5, "2": 25, "3": 50, "4": 100 }).valid).toBe(false);
    expect(validatePartIIRates({ "1": 10, "2": 105, "3": 50, "4": 100 }).valid).toBe(false);
    expect(validatePartIIRates({ "1": 30, "2": 20, "3": 50, "4": 100 }, false)).toMatchObject({
      valid: false,
      isNonMonotonic: true,
    });
    expect(validatePartIIRates({ "1": 30, "2": 20, "3": 50, "4": 100 }, true)).toMatchObject({
      valid: true,
      isNonMonotonic: true,
    });
    expect(validateScale100Config(
      buildScale100Scoring(exam, { p1: 30, p2: 40, p3: 30 }, {
        p2Method: "custom_rates",
        p2Rates: { "1": 40, "2": 20, "3": 50, "4": 100 },
        allowNonMonotonicP2Rates: false,
      }),
      { p1: 12, p2: 4, p3: 5 }
    ).valid).toBe(false);

    // UI interaction with ScoringConfigPanel
    const counts = { p1: 12, p2: 4, p3: 5 };
    let current = buildScale100Scoring(exam, { p1: 30, p2: 40, p3: 30 });
    const onChange = vi.fn((next) => {
      current = next;
    });

    const { rerender } = render(
      <ScoringConfigPanel counts={counts} scoring={current} onChange={onChange} />
    );

    expect(screen.getByText(/THIẾT LẬP TỶ LỆ ĐIỂM THEO SỐ Ý ĐÚNG/i)).toBeTruthy();

    // Switch to custom_rates radio
    const customRadio = screen.getByRole("radio", { name: /Phương thức 2: Tỷ lệ giáo viên thiết lập/i });
    fireEvent.click(customRadio);
    expect(onChange).toHaveBeenCalled();
    expect(current.p2Method).toBe("custom_rates");

    rerender(<ScoringConfigPanel counts={counts} scoring={current} onChange={onChange} />);

    // Change 1/4 input to 20
    const input1 = screen.getByLabelText("Tỷ lệ đúng 1/4 ý") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "20" } });
    expect(current.p2Rates?.["1"]).toBe(20);

    // Set non-monotonic: 1/4 = 60 (> 2/4 = 25) -> warning & confirmation checkbox appears
    fireEvent.change(input1, { target: { value: "60" } });
    rerender(<ScoringConfigPanel counts={counts} scoring={current} onChange={onChange} />);
    expect(screen.getByRole("alert").textContent).toContain("chưa theo thứ tự tăng dần");

    const confirmBox = screen.getByLabelText(/Tôi đã kiểm tra và xác nhận sử dụng tỷ lệ không tăng dần này/i);
    fireEvent.click(confirmBox);
    expect(current.allowNonMonotonicP2Rates).toBe(true);

    // Click reset to defaults
    const resetBtn = screen.getByRole("button", { name: /Khôi phục thiết lập mặc định/i });
    fireEvent.click(resetBtn);
    expect(current.p2Rates).toEqual({ "1": 10, "2": 25, "3": 50, "4": 100 });
    expect(current.allowNonMonotonicP2Rates).toBe(false);
  });

  it("Test 9: Điểm mỗi câu là số lẻ vô hạn tuần hoàn (40 / 3 = 13.3333...) vẫn đạt tổng đúng 100 điểm khi làm đúng hết", () => {
    const exam = makeSampleExam(12, 3, 7);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    expect(Math.abs(scoring.perQuestion.p2 - 40 / 3)).toBeLessThan(1e-12);

    const fullRes = gradeExam(exam, makeAllCorrectAnswers(exam), scoring);
    expect(fullRes.score).toBe(100);
    expect(fullRes.maxScore).toBe(100);
  });

  it("Test 10: Số lẻ 40/3 và đúng 3/4 ý (50%) giữ chính xác nội bộ, không vượt 100 và cộng chính xác nhiều câu lẻ", () => {
    const exam = makeSampleExam(0, 3, 0); // 100đ / 3 câu = 33.3333.../câu
    const scoring = buildScale100Scoring(
      exam,
      { p1: 0, p2: 100, p3: 0 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );

    // 1 câu đúng 3/4 (50% của 100/3 = 16.6666... -> hiển thị 16.67)
    const onePartial = gradeExam(exam, { p2_1: makeTFSelection(3) }, scoring);
    expect(onePartial.score).toBe(16.67);

    // 2 câu mỗi câu đúng 3/4 (50% + 50% = 100% của 1 câu = 33.3333... -> hiển thị 33.33, KHÔNG phải 16.67+16.67=33.34)
    const twoPartial = gradeExam(
      exam,
      { p2_1: makeTFSelection(3), p2_2: makeTFSelection(3) },
      scoring
    );
    expect(twoPartial.score).toBe(33.33);

    // Cả 3 câu đều đúng 3/4 (50% mỗi câu = đúng 50 điểm tròn)
    const threePartial = gradeExam(
      exam,
      { p2_1: makeTFSelection(3), p2_2: makeTFSelection(3), p2_3: makeTFSelection(3) },
      scoring
    );
    expect(threePartial.score).toBe(50);
    expect(threePartial.score).toBeLessThanOrEqual(100);
  });

  it("Test 11: Giao diện kết quả học sinh hiển thị Số ý đúng, Tỷ lệ điểm được hưởng, Điểm đạt được và bảo mật khi khóa xem đáp án", () => {
    const exam = makeSampleExam(0, 2, 0);
    const scoring = buildScale100Scoring(
      exam,
      { p1: 0, p2: 100, p3: 0 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const answers = { p2_1: makeTFSelection(2), p2_2: makeTFSelection(3) };
    const graded = gradeExam(exam, answers, scoring);

    // 11a. Allow review = true -> hiển thị bảng chi tiết Phần II
    const subOpen = {
      id: "sub-open-1",
      exam_id: "exam-1",
      student_name: "Nguyễn Văn A",
      student_class: "12A1",
      score: graded.score,
      max_score: graded.maxScore,
      correct_count: graded.correct,
      wrong_count: graded.wrong,
      answers,
      scoring_snapshot: scoring,
      part2_summary: graded.partIISummary,
    };

    const { unmount } = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result/sub-open-1",
            state: {
              submission: subOpen,
              exam: { id: "exam-1", title: "Đề kiểm tra Phần II", allow_review: true, scoring, questions: exam },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getAllByText(/Số ý đúng/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Tỷ lệ điểm được hưởng/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Điểm đạt được/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2/4")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("12.5/50")).toBeTruthy();
    expect(screen.getByText("3/4")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("25/50")).toBeTruthy();
    unmount();

    // 11b. Allow review = false (locked) -> hiển thị bảng tóm tắt điểm & tỷ lệ KHÔNG lộ nội dung câu hỏi/đáp án gốc
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result/sub-locked-1",
            state: {
              submission: subOpen,
              exam: { id: "exam-1", title: "Đề kiểm tra Phần II (Khóa)", allow_review: false, scoring, questions: null },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/Chi tiết điểm Phần II — Đúng \/ Sai/i)).toBeTruthy();
    expect(screen.getByText("2/4")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("12.5/50")).toBeTruthy();
    expect(screen.queryByText(/Nội dung bí mật câu đúng sai/i)).toBeNull();
    expect(screen.queryByText(/Nội dung ý a câu 1/i)).toBeNull();
  });

  it("Test 12: Snapshot JSON roundtrip & sửa cấu hình đề thi sau khi đã có bài nộp không làm biến đổi kết quả lịch sử", () => {
    const exam = makeSampleExam(4, 2, 2);
    const oldScoring = buildScale100Scoring(
      exam,
      { p1: 40, p2: 40, p3: 20 },
      { p2Method: "custom_rates", p2Rates: { "1": 10, "2": 25, "3": 50, "4": 100 } }
    );
    const attached = attachQuestionScores(exam, oldScoring);
    expect((attached.partII[0] as any).p2Method).toBe("custom_rates");
    expect((attached.partII[0] as any).p2Rates).toEqual({ "1": 10, "2": 25, "3": 50, "4": 100 });

    const studentAnswers = { p2_1: makeTFSelection(2), p2_2: makeTFSelection(3) };
    const originalGrade = gradeExam(attached, studentAnswers, oldScoring);

    // Giả lập JSONB roundtrip lưu vào DB (scoring_snapshot & part2_summary)
    const storedScoringSnapshot = JSON.parse(JSON.stringify(oldScoring));
    const storedPart2Summary = JSON.parse(JSON.stringify(originalGrade.partIISummary));
    expect(storedPart2Summary).toHaveLength(2);

    // Sau đó giáo viên sửa lại đề (đổi sang chia đều hoặc tăng tỷ lệ khác)
    const editedExam = reconcileScale100Scoring(attached, {
      ...oldScoring,
      p2Method: "equal",
    });
    expect(editedExam.p2Method).toBe("equal");

    // Khi học sinh xem lại bài đã nộp cũ, hệ thống chấm/hiển thị theo scoring_snapshot cũ -> điểm giữ nguyên tuyệt đối!
    const historicalReplay = gradeExam(attached, studentAnswers, storedScoringSnapshot);
    expect(historicalReplay.score).toBe(originalGrade.score);
    expect(historicalReplay.partIISummary).toEqual(storedPart2Summary);

    // Helpers normalization test
    expect(normalizePartIIRates(undefined)).toEqual(DEFAULT_PART_II_RATES);
    expect(getPartIIQuestionScoreDetails(2, 4, 10, storedScoringSnapshot)).toMatchObject({
      ratePercent: 25,
      earnedScore: 2.5,
      method: "custom_rates",
    });
  });

  it("Test 13: API check-question-answer & submit-exam chấm chuẩn xác câu Phần II với phương thức custom_rates", async () => {
    const sample = SAMPLE_EXAMS[0];
    const p2Q = sample.questions.partII[0];
    expect(p2Q).toBeTruthy();

    const customScoring = buildScale100Scoring(
      sample.questions,
      { p1: 30, p2: 40, p3: 30 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );

    // Build answer matching exactly 2/4 items
    const twoCorrectAns: Record<string, boolean> = {};
    p2Q.items.forEach((it, idx) => {
      twoCorrectAns[it.key] = idx < 2 ? it.correct : !it.correct;
    });

    const reqCheck: any = {
      method: "POST",
      body: {
        examId: sample.id,
        questionId: p2Q.id,
        answer: twoCorrectAns,
        scoring: customScoring,
        fallbackQuestion: { ...p2Q, scoring: customScoring },
      },
      headers: {},
    };
    const resCheck = createMockRes();
    await checkQuestionAnswerHandler(reqCheck, resCheck);
    const checkJson = resCheck._getBody();
    expect(resCheck._getStatus()).toBe(200);
    expect(checkJson.okItems).toBe(2);
    expect(checkJson.totalItems).toBe(p2Q.items.length);

    // Check submit-exam handler directly on sample exam
    const allAns = makeAllCorrectAnswers(sample.questions);
    const reqSubmit: any = {
      method: "POST",
      body: {
        examId: sample.id,
        studentName: "Học sinh Test",
        studentClass: "12A9",
        answers: allAns,
      },
      headers: {},
    };
    const resSubmit = createMockRes();
    await submitExamHandler(reqSubmit, resSubmit);
    expect(resSubmit._getStatus()).toBe(200);
    const submitJson = resSubmit._getBody();
    expect(submitJson.id).toBeTruthy();
    expect(submitJson.submission?.score).toBeGreaterThan(0);
    expect(Array.isArray(submitJson.partIISummary)).toBe(true);
    expect(submitJson.partIISummary.length).toBe(sample.questions.partII.length);
  });
});
