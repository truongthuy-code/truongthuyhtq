import type { ParsedExam, MCQuestion, TFQuestion, SAQuestion } from "./docxParser";
import { stripRich } from "./docxParser";

export type StudentAnswers = Record<string, any>;

export type ScoringConfig = {
  p1: number;
  p2: { "1": number; "2": number; "3": number; "4": number };
  p3: number;
};

export const DEFAULT_SCORING: ScoringConfig = {
  p1: 0.25,
  p2: { "1": 0.1, "2": 0.25, "3": 0.5, "4": 1 },
  p3: 0.25,
};

/**
 * Đọc câu trả lời Đúng/Sai cho 1 ý theo mô hình 3 trạng thái.
 * Trả về true (chọn Đúng), false (chọn Sai), null (chưa trả lời).
 * Hỗ trợ ngược định dạng cũ: mảng các key được tick = Đúng, còn lại = Sai.
 */
export function getTFValue(raw: any, key: string): boolean | null {
  if (Array.isArray(raw)) return raw.includes(key); // legacy: không có trạng thái "chưa trả lời"
  if (raw && typeof raw === "object") {
    const v = (raw as Record<string, any>)[key];
    return v === true ? true : v === false ? false : null;
  }
  return null;
}

export function gradeExam(exam: ParsedExam, answers: StudentAnswers, scoring: ScoringConfig = DEFAULT_SCORING) {
  let correct = 0;
  let total = 0;
  let score = 0;
  let maxScore = 0;
  const details: { id: string; ok: boolean }[] = [];
  const breakdown = {
    p1: { correct: 0, total: (exam.partI || []).length },
    p2: { total: (exam.partII || []).length, perQuestion: [] as { id: string; text: string; okItems: number; totalItems: number }[] },
    p3: { correct: 0, total: (exam.partIII || []).length },
  };

  for (const q of exam.partI as MCQuestion[]) {
    total++;
    maxScore += scoring.p1;
    const ok = answers[q.id] === q.answer;
    if (ok) { correct++; score += scoring.p1; breakdown.p1.correct++; }
    details.push({ id: q.id, ok });
  }
  for (const q of exam.partII as TFQuestion[]) {
    total++;
    maxScore += scoring.p2["4"];
    const ans = answers[q.id];
    // chỉ chấm những ý đã trả lời; ý chưa trả lời = sai (0 điểm), không cộng điểm
    let okItems = 0;
    for (const it of q.items) {
      const v = getTFValue(ans, it.key);
      if (v !== null && v === !!it.correct) okItems++;
    }
    const key = String(okItems) as "1" | "2" | "3" | "4";
    const pts = okItems >= 1 ? (scoring.p2[key] ?? 0) : 0;
    score += pts;
    const ok = okItems === q.items.length;
    if (ok) correct++;
    breakdown.p2.perQuestion.push({ id: q.id, text: q.text, okItems, totalItems: q.items.length });
    details.push({ id: q.id, ok });
  }
  for (const q of exam.partIII as SAQuestion[]) {
    total++;
    maxScore += scoring.p3;
    const given = String(answers[q.id] ?? "").trim().toLowerCase();
    const expected = stripRich(String(q.answer)).trim().toLowerCase();
    let ok = given === expected;
    if (!ok) {
      const a = parseFloat(given.replace(",", "."));
      const b = parseFloat(expected.replace(",", "."));
      if (!isNaN(a) && !isNaN(b) && Math.abs(a - b) < 1e-6) ok = true;
    }
    if (ok) { correct++; score += scoring.p3; breakdown.p3.correct++; }
    details.push({ id: q.id, ok });
  }

  return {
    correct,
    wrong: total - correct,
    total,
    score: Math.round(score * 100) / 100,
    maxScore: Math.round(maxScore * 100) / 100,
    details,
    breakdown,
  };
}

export function flattenQuestions(exam: ParsedExam) {
  return [...exam.partI, ...exam.partII, ...exam.partIII];
}
