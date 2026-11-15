import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  attachQuestionScores,
  buildScale10Scoring,
  detectExamStructure,
  formatScore,
  gradeExam,
  isScale10Scoring,
  reconcileScale10Scoring,
  validateScale10Parts,
} from "@/lib/grading";
import type { ParsedExam } from "@/lib/docxParser";
import ScoringConfigPanel from "@/components/ScoringConfigPanel";

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
      text: `Câu đúng sai ${i + 1}`,
      items: Array.from({ length: tfItemsPerQ }, (__, j) => ({
        key: String.fromCharCode(97 + j) as "a" | "b" | "c" | "d",
        text: `Ý ${String.fromCharCode(97 + j)}`,
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

describe("Thang điểm 10 & Tự động phân bổ điểm (8 trường hợp kiểm thử cốt lõi)", () => {
  it("Case 1: 12 P1 (3đ -> 0.25đ/câu), 4 P2 (4đ -> 1đ/câu, 0.25đ/ý), 5 P3 (3đ -> 0.6đ/câu)", () => {
    const exam = makeSampleExam(12, 4, 5);
    const counts = detectExamStructure(exam);
    expect(counts).toEqual({ p1: 12, p2: 4, p3: 5 });

    const scoring = buildScale10Scoring(exam, { p1: 3, p2: 4, p3: 3 });
    expect(scoring.mode).toBe("scale_10");
    expect(scoring.totalScale).toBe(10);
    expect(scoring.perQuestion.p1).toBeCloseTo(0.25, 10);
    expect(scoring.perQuestion.p2).toBeCloseTo(1, 10);
    expect(scoring.perItemP2).toBeCloseTo(0.25, 10);
    expect(scoring.perQuestion.p3).toBeCloseTo(0.6, 10);

    const check = validateScale10Parts(scoring.parts, counts);
    expect(check.valid).toBe(true);
    expect(check.total).toBe(10);
  });

  it("Case 2: Phần II có 5 câu với 4 điểm -> tự chia 0.8đ/câu và 0.2đ/ý", () => {
    const exam = makeSampleExam(12, 5, 5);
    const scoring = buildScale10Scoring(exam, { p1: 3, p2: 4, p3: 3 });

    expect(scoring.counts.p2).toBe(5);
    expect(scoring.perQuestion.p2).toBeCloseTo(0.8, 10);
    expect(scoring.perItemP2).toBeCloseTo(0.2, 10);

    // Đúng 1 câu Phần II (đủ 4 ý) = 0.8 điểm
    const res1Q = gradeExam(
      exam,
      {
        p2_1: { a: true, b: false, c: true, d: false },
      },
      scoring
    );
    expect(res1Q.score).toBe(0.8);
  });

  it("Case 3: Số câu hỏi thay đổi (12 -> 15 câu Phần I) tự động chia lại điểm mỗi câu", () => {
    const exam12 = makeSampleExam(12, 4, 5);
    const initial = buildScale10Scoring(exam12, { p1: 3, p2: 4, p3: 3 });
    expect(initial.perQuestion.p1).toBeCloseTo(0.25, 10);

    const exam15 = makeSampleExam(15, 4, 5);
    const updated = reconcileScale10Scoring(exam15, initial);
    expect(updated.counts.p1).toBe(15);
    expect(updated.parts).toEqual({ p1: 3, p2: 4, p3: 3 });
    expect(updated.perQuestion.p1).toBeCloseTo(0.2, 10); // 3 / 15 = 0.2
  });

  it("Case 4: Giáo viên thay đổi điểm của một phần (vd Phần II: 4 -> 5) -> tính lại toàn bộ", () => {
    const exam = makeSampleExam(10, 4, 5);
    const s1 = buildScale10Scoring(exam, { p1: 3, p2: 4, p3: 3 });
    expect(s1.perQuestion.p2).toBeCloseTo(1, 10);
    expect(s1.perItemP2).toBeCloseTo(0.25, 10);

    // Đổi Phần II lên 5đ, Phần I còn 2.5đ, Phần III còn 2.5đ
    const s2 = buildScale10Scoring(exam, { p1: 2.5, p2: 5, p3: 2.5 }, s1);
    expect(s2.perQuestion.p1).toBeCloseTo(0.25, 10);
    expect(s2.perQuestion.p2).toBeCloseTo(1.25, 10);
    expect(s2.perItemP2).toBeCloseTo(0.3125, 10);
    expect(s2.perQuestion.p3).toBeCloseTo(0.5, 10);
  });

  it("Case 5: Chia ra số thập phân vô hạn tuần hoàn (vd 4/3, 3/7) vẫn cộng đạt chính xác 10 điểm", () => {
    // 12 P1 (3đ = 0.25đ/câu), 3 P2 (4đ = 1.3333...đ/câu, 0.3333...đ/ý), 7 P3 (3đ = 0.42857...đ/câu)
    const exam = makeSampleExam(12, 3, 7);
    const scoring = buildScale10Scoring(exam, { p1: 3, p2: 4, p3: 3 });

    // Kiểm tra giá trị nội bộ không bị làm tròn sớm thành 1.33 hay 0.43
    expect(Math.abs(scoring.perQuestion.p2 - 4 / 3)).toBeLessThan(1e-12);
    expect(Math.abs(scoring.perItemP2 - 4 / 12)).toBeLessThan(1e-12);
    expect(Math.abs(scoring.perQuestion.p3 - 3 / 7)).toBeLessThan(1e-12);

    // Đúng tất cả 100% -> phải đạt ĐÚNG 10 (không bị 9.99 hay 10.01)
    const fullRes = gradeExam(exam, makeAllCorrectAnswers(exam), scoring);
    expect(fullRes.score).toBe(10);
    expect(fullRes.maxScore).toBe(10);

    // Trường hợp khác: tất cả các phần đều chia lẻ: 3 P1 (1đ), 3 P2 (4đ), 7 P3 (5đ)
    const examAllOdd = makeSampleExam(3, 3, 7);
    const oddScoring = buildScale10Scoring(examAllOdd, { p1: 1, p2: 4, p3: 5 });
    const fullOddRes = gradeExam(examAllOdd, makeAllCorrectAnswers(examAllOdd), oddScoring);
    expect(fullOddRes.score).toBe(10);
    expect(fullOddRes.maxScore).toBe(10);
  });

  it("Case 6: Phần II chấm độc lập từng ý (0/4, 1/4, 2/4, 3/4, 4/4, bỏ trống) theo phương thức chia đều", () => {
    const exam = makeSampleExam(0, 2, 0); // Chỉ có Phần II: 2 câu = 10đ => 5đ/câu => 1.25đ/ý
    const scoring = buildScale10Scoring(exam, { p1: 0, p2: 10, p3: 0 });
    expect(scoring.perQuestion.p2).toBe(5);
    expect(scoring.perItemP2).toBe(1.25);

    // Đúng 1 ý trên câu 1 => 1.25 điểm (1/4 của 5)
    const res1 = gradeExam(exam, { p2_1: { a: true, b: true, c: false, d: true } }, scoring);
    expect(res1.score).toBe(1.25);

    // Đúng 2 ý trên câu 1 => 2.5 điểm (2/4 của 5)
    const res2 = gradeExam(exam, { p2_1: { a: true, b: false, c: false, d: true } }, scoring);
    expect(res2.score).toBe(2.5);

    // Đúng 3 ý trên câu 1 => 3.75 điểm (3/4 của 5)
    const res3 = gradeExam(exam, { p2_1: { a: true, b: false, c: true, d: true } }, scoring);
    expect(res3.score).toBe(3.75);

    // Học sinh chỉ làm 2 ý (a đúng, c đúng, b và d bỏ trống null) => đúng 2 ý = 2.5 điểm
    const resPartialBlank = gradeExam(exam, { p2_1: { a: true, c: true } }, scoring);
    expect(resPartialBlank.score).toBe(2.5);

    // Không đúng ý nào => 0 điểm
    const res0 = gradeExam(exam, { p2_1: { a: false, b: true, c: false, d: true } }, scoring);
    expect(res0.score).toBe(0);
  });

  it("Case 7: Đúng toàn bộ đề thi (12 P1 + 4 P2 + 5 P3) luôn đạt đúng 10 điểm", () => {
    const exam = makeSampleExam(12, 4, 5);
    const scoring = buildScale10Scoring(exam); // Mặc định 3/4/3
    const allCorrect = makeAllCorrectAnswers(exam);
    const res = gradeExam(exam, allCorrect, scoring);

    expect(res.correct).toBe(21);
    expect(res.wrong).toBe(0);
    expect(res.total).toBe(21);
    expect(res.score).toBe(10);
    expect(res.maxScore).toBe(10);
    expect((res.breakdown.p1 as any).earnedScore).toBe(3);
    expect((res.breakdown.p2 as any).earnedScore).toBe(4);
    expect((res.breakdown.p3 as any).earnedScore).toBe(3);
  });

  it("Case 8: Lưu trữ (JSON roundtrip), gắn metadata câu hỏi, bảo toàn config khác & validate giao diện ScoringConfigPanel", () => {
    const exam = makeSampleExam(8, 2, 4);
    const rawScoring = buildScale10Scoring(
      exam,
      { p1: 4, p2: 4, p3: 2 },
      { enable_min_correct_percentage: true, min_correct_percentage_for_review: 75 }
    );
    const attachedExam = attachQuestionScores(exam, rawScoring);

    // Nội dung câu hỏi không bị thay đổi, chỉ thêm metadata maxScore
    expect(attachedExam.partI[0].text).toBe(exam.partI[0].text);
    expect((attachedExam.partI[0] as any).maxScore).toBe(0.5);
    expect((attachedExam.partII[0] as any).maxScore).toBe(2);
    expect((attachedExam.partII[0] as any).itemMaxScore).toBe(0.5);
    expect((attachedExam.partIII[0] as any).maxScore).toBe(0.5);

    // Giả lập lưu JSONB vào Supabase / localStorage và đọc lại
    const stored = JSON.parse(JSON.stringify({ questions: attachedExam, scoring: rawScoring }));
    expect(isScale10Scoring(stored.scoring)).toBe(true);
    expect(stored.scoring.enable_min_correct_percentage).toBe(true);
    expect(stored.scoring.min_correct_percentage_for_review).toBe(75);

    const reloadedScoring = reconcileScale10Scoring(stored.questions, stored.scoring);
    const graded = gradeExam(stored.questions, makeAllCorrectAnswers(exam), reloadedScoring);
    expect(graded.score).toBe(10);
    expect(graded.maxScore).toBe(10);

    // Kiểm tra giao diện ScoringConfigPanel khi tổng != 10 và phần 0 câu bị khóa
    const onChange = vi.fn();
    const invalidScoring = buildScale10Scoring(makeSampleExam(10, 4, 0), { p1: 5, p2: 3, p3: 0 });
    render(
      <ScoringConfigPanel
        counts={{ p1: 10, p2: 4, p3: 0 }}
        itemCountP2={4}
        scoring={invalidScoring}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("8/10");
    const p3Input = screen.getByLabelText("Điểm Phần III") as HTMLInputElement;
    expect(p3Input.disabled).toBe(true);
    expect(p3Input.value).toBe("0");

    // Khi sửa điểm Phần I thành 7, onChange nhận được cấu hình mới tổng = 10
    const p1Input = screen.getByLabelText("Điểm Phần I") as HTMLInputElement;
    fireEvent.change(p1Input, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const nextArg = onChange.mock.calls[0][0];
    expect(nextArg.parts).toEqual({ p1: 7, p2: 3, p3: 0 });
    expect(nextArg.perQuestion.p1).toBe(0.7);
    expect(formatScore(nextArg.perItemP2)).toBe("0.19");
  });
});
