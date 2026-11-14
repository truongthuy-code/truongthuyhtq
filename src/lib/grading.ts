import type { ParsedExam, MCQuestion, TFQuestion, SAQuestion } from "./docxParser";
import { stripRich } from "./docxParser";

export type StudentAnswers = Record<string, any>;

export const DEFAULT_TOTAL_SCALE = 100;

export type PartPoints = {
  p1: number;
  p2: number;
  p3: number;
};

export type ExamStructureCounts = {
  p1: number;
  p2: number;
  p3: number;
};

export type PartIIMethod = "equal" | "custom_rates";

export type PartIIRates = {
  "1": number;
  "2": number;
  "3": number;
  "4": number;
};

export const DEFAULT_PART_II_RATES: PartIIRates = {
  "1": 10,
  "2": 25,
  "3": 50,
  "4": 100,
};

export type PartIIQuestionSummary = {
  questionIndex: number;
  id: string;
  okItems: number;
  totalItems: number;
  ratePercent: number;
  earnedScore: number;
  maxScore: number;
  method: PartIIMethod;
  itemStatuses: Array<"correct" | "wrong" | "blank">;
};

export type Scale100ScoringConfig = {
  mode: "scale_100";
  totalScale: number;
  parts: PartPoints;
  counts: ExamStructureCounts;
  perQuestion: {
    p1: number;
    p2: number;
    p3: number;
  };
  perItemP2: number;
  p2Method?: PartIIMethod;
  p2Rates?: PartIIRates;
  allowNonMonotonicP2Rates?: boolean;
  // Backward-compatible legacy keys (populated linearly for fallback RPC safety)
  p1: number;
  p2: { "1": number; "2": number; "3": number; "4": number };
  p3: number;
  enable_min_correct_percentage?: boolean;
  min_correct_percentage_for_review?: number;
};

export type ScoringConfig = {
  p1: number;
  p2: { "1": number; "2": number; "3": number; "4": number };
  p3: number;
  mode?: "scale_100" | "legacy";
  totalScale?: number;
  parts?: PartPoints;
  counts?: ExamStructureCounts;
  perQuestion?: { p1: number; p2: number; p3: number };
  perItemP2?: number;
  p2Method?: PartIIMethod;
  p2Rates?: PartIIRates;
  allowNonMonotonicP2Rates?: boolean;
  enable_min_correct_percentage?: boolean;
  min_correct_percentage_for_review?: number;
};

export const DEFAULT_SCORING: ScoringConfig = {
  p1: 0.25,
  p2: { "1": 0.1, "2": 0.25, "3": 0.5, "4": 1 },
  p3: 0.25,
};

export function normalizePartIIRates(rates?: Partial<PartIIRates> | null): PartIIRates {
  const pick = (raw: any, fallback: number) => {
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    "1": pick(rates?.["1"], DEFAULT_PART_II_RATES["1"]),
    "2": pick(rates?.["2"], DEFAULT_PART_II_RATES["2"]),
    "3": pick(rates?.["3"], DEFAULT_PART_II_RATES["3"]),
    "4": pick(rates?.["4"], DEFAULT_PART_II_RATES["4"]),
  };
}

export function getPartIIMethod(scoring?: any): PartIIMethod {
  return scoring?.p2Method === "custom_rates" ? "custom_rates" : "equal";
}

export function validatePartIIRates(
  rates: Partial<PartIIRates> | null | undefined,
  allowNonMonotonic = false
): {
  valid: boolean;
  hasRangeError: boolean;
  isNonMonotonic: boolean;
  message: string | null;
} {
  const norm = normalizePartIIRates(rates);
  const vals = [norm["1"], norm["2"], norm["3"], norm["4"]];

  for (const v of vals) {
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return {
        valid: false,
        hasRangeError: true,
        isNonMonotonic: false,
        message: "Tỷ lệ điểm Phần II phải là số hợp lệ trong khoảng từ 0% đến 100%.",
      };
    }
  }

  if (Math.abs(norm["4"] - 100) > 1e-6) {
    return {
      valid: false,
      hasRangeError: true,
      isNonMonotonic: false,
      message: "Tỷ lệ khi đúng 4/4 ý mặc định phải là 100% điểm câu hỏi.",
    };
  }

  const isNonMonotonic = !(norm["1"] <= norm["2"] && norm["2"] <= norm["3"] && norm["3"] <= norm["4"]);
  if (isNonMonotonic) {
    const msg = `Cảnh báo: Tỷ lệ điểm Phần II chưa theo thứ tự tăng dần (${norm["1"]}% → ${norm["2"]}% → ${norm["3"]}% → ${norm["4"]}%). Điều này có thể khiến học sinh đúng nhiều ý lại nhận ít điểm hơn đúng ít ý.`;
    return {
      valid: allowNonMonotonic,
      hasRangeError: false,
      isNonMonotonic: true,
      message: msg,
    };
  }

  return {
    valid: true,
    hasRangeError: false,
    isNonMonotonic: false,
    message: null,
  };
}

export function getPartIIQuestionScoreDetails(
  okItems: number,
  totalItems: number,
  perQuestionMax: number,
  scoring?: any
): {
  ratePercent: number;
  rawRatio: number;
  rawEarned: number;
  earnedScore: number;
  method: PartIIMethod;
} {
  const method = getPartIIMethod(scoring);
  if (okItems <= 0 || totalItems <= 0 || perQuestionMax < 0) {
    return { ratePercent: 0, rawRatio: 0, rawEarned: 0, earnedScore: 0, method };
  }

  let ratePercent: number;
  if (isScale100Scoring(scoring) && method === "custom_rates") {
    const rates = normalizePartIIRates(scoring.p2Rates);
    if (okItems >= totalItems) {
      ratePercent = rates["4"];
    } else {
      const clampedKey = String(Math.min(3, Math.max(1, okItems))) as "1" | "2" | "3";
      ratePercent = rates[clampedKey];
    }
    ratePercent = Math.max(0, Math.min(100, Number.isFinite(ratePercent) ? ratePercent : 0));
    const rawRatio = ratePercent / 100;
    const rawEarned = perQuestionMax * rawRatio;
    return {
      ratePercent: roundFinalScore(ratePercent),
      rawRatio,
      rawEarned,
      earnedScore: roundFinalScore(rawEarned),
      method,
    };
  }

  const ratio = okItems / totalItems;
  ratePercent = roundFinalScore(ratio * 100);
  const rawEarned = perQuestionMax * ratio;
  return {
    ratePercent,
    rawRatio: ratio,
    rawEarned,
    earnedScore: roundFinalScore(rawEarned),
    method: "equal",
  };
}

/**
 * Làm tròn an toàn ở kết quả tổng cuối cùng (tối đa 2 chữ số thập phân),
 * xử lý sai số dấu phẩy động (ví dụ 99.99999999999999 -> 100).
 */
export function roundFinalScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const snapped = Math.round(raw * 1e9) / 1e9;
  return Math.round((snapped + 1e-12) * 100) / 100;
}

/**
 * Định dạng hiển thị điểm (tối đa 2 chữ số thập phân, bỏ .00 dư thừa).
 */
export function formatScore(val: number | null | undefined, maxDecimals = 2): string {
  const num = Number(val);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round((num + 1e-12) * Math.pow(10, maxDecimals)) / Math.pow(10, maxDecimals);
  return Object.is(rounded, -0) ? "0" : rounded.toString();
}

export function isScale100Scoring(scoring: any): scoring is Scale100ScoringConfig {
  return Boolean(scoring && scoring.mode === "scale_100" && scoring.parts && typeof scoring.parts === "object");
}

function normalizeQuestionsContainer(examOrQuestions: any): { partI: any[]; partII: any[]; partIII: any[] } {
  if (!examOrQuestions) return { partI: [], partII: [], partIII: [] };

  let raw = examOrQuestions;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { partI: [], partII: [], partIII: [] };
    }
  }
  if (raw && typeof raw === "object" && "questions" in raw && !("partI" in raw) && !("partII" in raw) && !("partIII" in raw)) {
    raw = raw.questions;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return { partI: [], partII: [], partIII: [] };
      }
    }
  }

  if (Array.isArray(raw)) {
    return {
      partI: raw.filter((q: any) => q && (q._part === 1 || q.type === "mc" || (Array.isArray(q.options) && q.options.length > 0))),
      partII: raw.filter((q: any) => q && (q._part === 2 || q.type === "tf" || (Array.isArray(q.items) && q.items.length > 0))),
      partIII: raw.filter((q: any) => q && (q._part === 3 || q.type === "sa" || (!q.options?.length && !q.items?.length && q.type !== "mc" && q.type !== "tf"))),
    };
  }

  if (raw && typeof raw === "object") {
    const p1 = Array.isArray(raw.partI) ? raw.partI : Array.isArray(raw.part1) ? raw.part1 : Array.isArray(raw.PartI) ? raw.PartI : [];
    const p2 = Array.isArray(raw.partII) ? raw.partII : Array.isArray(raw.part2) ? raw.part2 : Array.isArray(raw.PartII) ? raw.PartII : [];
    const p3 = Array.isArray(raw.partIII) ? raw.partIII : Array.isArray(raw.part3) ? raw.part3 : Array.isArray(raw.PartIII) ? raw.PartIII : [];
    return { partI: p1, partII: p2, partIII: p3 };
  }

  return { partI: [], partII: [], partIII: [] };
}

/**
 * Tự động nhận dạng cấu trúc đề thi và số lượng câu hỏi của từng phần.
 */
export function detectExamStructure(examOrQuestions: any): ExamStructureCounts {
  const { partI, partII, partIII } = normalizeQuestionsContainer(examOrQuestions);
  return {
    p1: partI.length,
    p2: partII.length,
    p3: partIII.length,
  };
}

/**
 * Lấy số ý chuẩn trong câu hỏi Phần II (mặc định 4 ý a, b, c, d).
 */
export function getPartIISampleItemCount(examOrQuestions: any): number {
  const { partII } = normalizeQuestionsContainer(examOrQuestions);
  for (const q of partII) {
    if (Array.isArray(q?.items) && q.items.length > 0) {
      return q.items.length;
    }
  }
  return 4;
}

/**
 * Phân bổ mặc định hợp lý đạt tổng 100 điểm dựa trên các phần hiện có trong đề.
 */
export function suggestDefaultPartPoints(counts: ExamStructureCounts, totalScale = DEFAULT_TOTAL_SCALE): PartPoints {
  const has1 = counts.p1 > 0;
  const has2 = counts.p2 > 0;
  const has3 = counts.p3 > 0;

  if (!has1 && !has2 && !has3) {
    return { p1: 0, p2: 0, p3: 0 };
  }

  let base: PartPoints;
  if (has1 && has2 && has3) {
    base = { p1: 30, p2: 40, p3: 30 };
  } else if (has1 && has2 && !has3) {
    base = { p1: 60, p2: 40, p3: 0 };
  } else if (has1 && !has2 && has3) {
    base = { p1: 70, p2: 0, p3: 30 };
  } else if (!has1 && has2 && has3) {
    base = { p1: 0, p2: 60, p3: 40 };
  } else if (has1) {
    base = { p1: 100, p2: 0, p3: 0 };
  } else if (has2) {
    base = { p1: 0, p2: 100, p3: 0 };
  } else {
    base = { p1: 0, p2: 0, p3: 100 };
  }

  if (totalScale === 100) return base;

  const factor = totalScale / 100;
  const scaled = {
    p1: has1 ? roundFinalScore(base.p1 * factor) : 0,
    p2: has2 ? roundFinalScore(base.p2 * factor) : 0,
    p3: has3 ? roundFinalScore(base.p3 * factor) : 0,
  };
  return scaled;
}

function sanitizePointValue(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Tạo cấu hình thang điểm 100 đầy đủ kèm điểm tự động phân bổ cho từng câu và từng ý Phần II.
 * Giữ giá trị số thực chính xác nội bộ (không làm tròn sớm từng câu trước khi cộng).
 */
export function buildScale100Scoring(
  examOrQuestions: any,
  customParts?: Partial<PartPoints>,
  preserveExtra?: Record<string, any>
): Scale100ScoringConfig {
  const counts = detectExamStructure(examOrQuestions);
  const suggested = suggestDefaultPartPoints(counts, DEFAULT_TOTAL_SCALE);

  const rawParts: PartPoints = {
    p1: counts.p1 > 0 ? sanitizePointValue(customParts?.p1 ?? suggested.p1) : 0,
    p2: counts.p2 > 0 ? sanitizePointValue(customParts?.p2 ?? suggested.p2) : 0,
    p3: counts.p3 > 0 ? sanitizePointValue(customParts?.p3 ?? suggested.p3) : 0,
  };

  const perQ1 = counts.p1 > 0 ? rawParts.p1 / counts.p1 : 0;
  const perQ2 = counts.p2 > 0 ? rawParts.p2 / counts.p2 : 0;
  const perQ3 = counts.p3 > 0 ? rawParts.p3 / counts.p3 : 0;
  const itemCountP2 = getPartIISampleItemCount(examOrQuestions);
  const perItemP2 = counts.p2 > 0 && itemCountP2 > 0 ? perQ2 / itemCountP2 : 0;

  const roundHigh = (n: number) => Math.round(n * 1e10) / 1e10;
  const p2Method: PartIIMethod = getPartIIMethod(preserveExtra);
  const p2Rates = normalizePartIIRates(preserveExtra?.p2Rates);
  const allowNonMonotonicP2Rates = Boolean(preserveExtra?.allowNonMonotonicP2Rates);

  const p2LegacyMap =
    p2Method === "custom_rates"
      ? {
          "1": roundHigh((perQ2 * p2Rates["1"]) / 100),
          "2": roundHigh((perQ2 * p2Rates["2"]) / 100),
          "3": roundHigh((perQ2 * p2Rates["3"]) / 100),
          "4": roundHigh((perQ2 * p2Rates["4"]) / 100),
        }
      : {
          "1": roundHigh(perItemP2),
          "2": roundHigh(perItemP2 * 2),
          "3": roundHigh(perItemP2 * 3),
          "4": roundHigh(perItemP2 * 4),
        };

  const config: Scale100ScoringConfig = {
    mode: "scale_100",
    totalScale: DEFAULT_TOTAL_SCALE,
    parts: rawParts,
    counts,
    perQuestion: {
      p1: perQ1,
      p2: perQ2,
      p3: perQ3,
    },
    perItemP2,
    p2Method,
    p2Rates,
    allowNonMonotonicP2Rates,
    p1: roundHigh(perQ1),
    p2: p2LegacyMap,
    p3: roundHigh(perQ3),
  };

  if (preserveExtra && typeof preserveExtra === "object") {
    if ("enable_min_correct_percentage" in preserveExtra) {
      config.enable_min_correct_percentage = Boolean(preserveExtra.enable_min_correct_percentage);
    }
    if ("min_correct_percentage_for_review" in preserveExtra) {
      config.min_correct_percentage_for_review = Number(preserveExtra.min_correct_percentage_for_review) || 0;
    }
  }

  return config;
}

/**
 * Tự động đồng bộ cấu hình điểm khi số lượng câu hỏi hoặc cấu trúc đề thi thay đổi.
 * - Nếu chỉ số câu trong các phần đang có thay đổi (vd: 12 -> 15 câu), giữ nguyên điểm giáo viên đặt cho từng phần và chia lại điểm mỗi câu.
 * - Nếu có phần chuyển từ 0 -> >0 hoặc >0 -> 0 làm tổng lệch khỏi 100, tự cân bằng lại đạt tổng 100.
 */
export function reconcileScale100Scoring(examOrQuestions: any, prevScoring?: any): Scale100ScoringConfig {
  const newCounts = detectExamStructure(examOrQuestions);

  if (!isScale100Scoring(prevScoring)) {
    return buildScale100Scoring(examOrQuestions, undefined, prevScoring);
  }

  const prevCounts = prevScoring.counts || { p1: 0, p2: 0, p3: 0 };
  const prevParts = prevScoring.parts || { p1: 0, p2: 0, p3: 0 };

  const activeChanged =
    (prevCounts.p1 > 0) !== (newCounts.p1 > 0) ||
    (prevCounts.p2 > 0) !== (newCounts.p2 > 0) ||
    (prevCounts.p3 > 0) !== (newCounts.p3 > 0);

  let nextParts: PartPoints = {
    p1: newCounts.p1 > 0 ? sanitizePointValue(prevParts.p1) : 0,
    p2: newCounts.p2 > 0 ? sanitizePointValue(prevParts.p2) : 0,
    p3: newCounts.p3 > 0 ? sanitizePointValue(prevParts.p3) : 0,
  };

  if (activeChanged) {
    const curSum = Math.round((nextParts.p1 + nextParts.p2 + nextParts.p3) * 1e6) / 1e6;
    const newlyAdded: (keyof PartPoints)[] = [];
    if (prevCounts.p1 === 0 && newCounts.p1 > 0) newlyAdded.push("p1");
    if (prevCounts.p2 === 0 && newCounts.p2 > 0) newlyAdded.push("p2");
    if (prevCounts.p3 === 0 && newCounts.p3 > 0) newlyAdded.push("p3");

    if (newlyAdded.length === 1 && curSum > 0 && curSum < DEFAULT_TOTAL_SCALE) {
      nextParts[newlyAdded[0]] = Math.round((DEFAULT_TOTAL_SCALE - curSum) * 1e6) / 1e6;
    } else if (Math.abs(curSum - DEFAULT_TOTAL_SCALE) > 1e-6) {
      nextParts = suggestDefaultPartPoints(newCounts, DEFAULT_TOTAL_SCALE);
    }
  }

  return buildScale100Scoring(examOrQuestions, nextParts, prevScoring);
}

/**
 * Kiểm tra tổng điểm các phần có đúng bằng 100 hay không.
 */
export function validateScale100Parts(
  parts: PartPoints,
  counts: ExamStructureCounts
): { valid: boolean; total: number; diff: number; message: string | null } {
  const totalQuestions = counts.p1 + counts.p2 + counts.p3;
  const activeSum =
    (counts.p1 > 0 ? sanitizePointValue(parts.p1) : 0) +
    (counts.p2 > 0 ? sanitizePointValue(parts.p2) : 0) +
    (counts.p3 > 0 ? sanitizePointValue(parts.p3) : 0);
  const total = Math.round(activeSum * 1e6) / 1e6;
  const diff = Math.round((DEFAULT_TOTAL_SCALE - total) * 1e6) / 1e6;

  if (totalQuestions === 0) {
    return {
      valid: false,
      total,
      diff,
      message: "Đề thi chưa có câu hỏi nào để phân bổ điểm.",
    };
  }

  if (Math.abs(diff) > 1e-6) {
    const absDiff = formatScore(Math.abs(diff));
    return {
      valid: false,
      total,
      diff,
      message:
        diff > 0
          ? `Tổng điểm các phần đang là ${formatScore(total)}/100 (còn thiếu ${absDiff} điểm). Vui lòng điều chỉnh để tổng bằng đúng 100 điểm.`
          : `Tổng điểm các phần đang là ${formatScore(total)}/100 (vượt quá ${absDiff} điểm). Vui lòng điều chỉnh để tổng bằng đúng 100 điểm.`,
    };
  }

  return { valid: true, total: DEFAULT_TOTAL_SCALE, diff: 0, message: null };
}

/**
 * Kiểm tra toàn diện cấu hình thang điểm 100 (bao gồm tổng 100 điểm và tỷ lệ Phần II).
 */
export function validateScale100Config(
  scoring: ScoringConfig,
  counts: ExamStructureCounts
): { valid: boolean; total: number; diff: number; message: string | null } {
  if (!isScale100Scoring(scoring)) {
    return { valid: true, total: 100, diff: 0, message: null };
  }
  const partCheck = validateScale100Parts(scoring.parts, counts);
  if (!partCheck.valid) return partCheck;

  if (counts.p2 > 0 && getPartIIMethod(scoring) === "custom_rates") {
    const rateCheck = validatePartIIRates(scoring.p2Rates, Boolean(scoring.allowNonMonotonicP2Rates));
    if (!rateCheck.valid) {
      return {
        valid: false,
        total: partCheck.total,
        diff: 0,
        message: rateCheck.message,
      };
    }
  }

  return partCheck;
}

/**
 * Gắn metadata điểm tối đa vào từng câu hỏi và từng ý Phần II để lưu đồng bộ,
 * tuyệt đối không làm biến đổi nội dung câu hỏi hay đáp án.
 */
export function attachQuestionScores<T extends ParsedExam>(exam: T, scoring: ScoringConfig): T {
  if (!exam || !isScale100Scoring(scoring)) return exam;

  const n1 = (exam.partI || []).length;
  const n2 = (exam.partII || []).length;
  const n3 = (exam.partIII || []).length;

  const perQ1 = n1 > 0 ? scoring.parts.p1 / n1 : 0;
  const perQ2 = n2 > 0 ? scoring.parts.p2 / n2 : 0;
  const perQ3 = n3 > 0 ? scoring.parts.p3 / n3 : 0;
  const p2Method = getPartIIMethod(scoring);
  const p2Rates = normalizePartIIRates(scoring.p2Rates);

  return {
    ...exam,
    partI: (exam.partI || []).map((q) => ({ ...q, maxScore: perQ1 })),
    partII: (exam.partII || []).map((q) => {
      const itemCount = q.items?.length || 4;
      const perItem = itemCount > 0 ? perQ2 / itemCount : 0;
      return {
        ...q,
        maxScore: perQ2,
        p2Method,
        ...(p2Method === "custom_rates" ? { p2Rates } : { itemMaxScore: perItem }),
        items: (q.items || []).map((it) =>
          p2Method === "custom_rates" ? { ...it } : { ...it, maxScore: perItem }
        ),
      };
    }),
    partIII: (exam.partIII || []).map((q) => ({ ...q, maxScore: perQ3 })),
  };
}

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
  const details: {
    id: string;
    ok: boolean;
    earnedScore?: number;
    maxScore?: number;
    okItems?: number;
    totalItems?: number;
    ratePercent?: number;
    p2Method?: PartIIMethod;
  }[] = [];

  const partI = (exam?.partI || []) as MCQuestion[];
  const partII = (exam?.partII || []) as TFQuestion[];
  const partIII = (exam?.partIII || []) as SAQuestion[];

  if (isScale100Scoring(scoring)) {
    const n1 = partI.length;
    const n2 = partII.length;
    const n3 = partIII.length;

    const ptsP1 = n1 > 0 ? sanitizePointValue(scoring.parts.p1) : 0;
    const ptsP2 = n2 > 0 ? sanitizePointValue(scoring.parts.p2) : 0;
    const ptsP3 = n3 > 0 ? sanitizePointValue(scoring.parts.p3) : 0;

    const perQ1 = n1 > 0 ? ptsP1 / n1 : 0;
    const perQ2 = n2 > 0 ? ptsP2 / n2 : 0;
    const perQ3 = n3 > 0 ? ptsP3 / n3 : 0;

    let correctP1 = 0;
    let p2RatioSum = 0;
    let correctP3 = 0;

    const p2PerQuestion: {
      id: string;
      text: string;
      okItems: number;
      totalItems: number;
      earnedScore: number;
      maxScore: number;
      ratePercent: number;
      method: PartIIMethod;
    }[] = [];
    const partIISummary: PartIIQuestionSummary[] = [];

    for (const q of partI) {
      total++;
      const ok = q.answer ? answers[q.id] === q.answer : false;
      if (ok) {
        correct++;
        correctP1++;
      }
      details.push({ id: q.id, ok, earnedScore: ok ? perQ1 : 0, maxScore: perQ1 });
    }

    partII.forEach((q, qIdx) => {
      total++;
      const ans = answers[q.id];
      const itemLen = q.items?.length || 0;
      let okItems = 0;
      const itemStatuses: Array<"correct" | "wrong" | "blank"> = [];
      for (const it of q.items || []) {
        const v = getTFValue(ans, it.key);
        if (v === null) {
          itemStatuses.push("blank");
        } else if (it.correct !== null && it.correct !== undefined && v === !!it.correct) {
          okItems++;
          itemStatuses.push("correct");
        } else {
          itemStatuses.push("wrong");
        }
      }
      const denom = itemLen > 0 ? itemLen : 4;
      const qScore = getPartIIQuestionScoreDetails(okItems, denom, perQ2, scoring);
      p2RatioSum += qScore.rawRatio;

      const ok = itemLen > 0 && okItems === itemLen;
      if (ok) correct++;

      p2PerQuestion.push({
        id: q.id,
        text: q.text,
        okItems,
        totalItems: itemLen,
        earnedScore: qScore.earnedScore,
        maxScore: roundFinalScore(perQ2),
        ratePercent: qScore.ratePercent,
        method: qScore.method,
      });
      partIISummary.push({
        questionIndex: qIdx + 1,
        id: q.id,
        okItems,
        totalItems: itemLen,
        ratePercent: qScore.ratePercent,
        earnedScore: qScore.earnedScore,
        maxScore: roundFinalScore(perQ2),
        method: qScore.method,
        itemStatuses,
      });
      details.push({
        id: q.id,
        ok,
        earnedScore: qScore.rawEarned,
        maxScore: perQ2,
        okItems,
        totalItems: itemLen,
        ratePercent: qScore.ratePercent,
        p2Method: qScore.method,
      });
    });

    for (const q of partIII) {
      total++;
      const given = String(answers[q.id] ?? "").trim().toLowerCase();
      const expected = q.answer ? stripRich(String(q.answer)).trim().toLowerCase() : "";
      let ok = expected !== "" && given === expected;
      if (!ok && expected !== "") {
        const a = parseFloat(given.replace(",", "."));
        const b = parseFloat(expected.replace(",", "."));
        if (!isNaN(a) && !isNaN(b) && Math.abs(a - b) < 1e-6) ok = true;
      }
      if (ok) {
        correct++;
        correctP3++;
      }
      details.push({ id: q.id, ok, earnedScore: ok ? perQ3 : 0, maxScore: perQ3 });
    }

    // Cộng theo tỷ lệ chính xác của từng phần để không bao giờ tích lũy sai số làm tròn
    const rawP1 = n1 > 0 ? (correctP1 / n1) * ptsP1 : 0;
    const rawP2 = n2 > 0 ? (p2RatioSum / n2) * ptsP2 : 0;
    const rawP3 = n3 > 0 ? (correctP3 / n3) * ptsP3 : 0;

    const rawTotal = rawP1 + rawP2 + rawP3;
    const rawMaxScore = ptsP1 + ptsP2 + ptsP3;

    return {
      correct,
      wrong: total - correct,
      total,
      score: roundFinalScore(rawTotal),
      maxScore: roundFinalScore(rawMaxScore),
      details,
      partIISummary,
      breakdown: {
        p1: { correct: correctP1, total: n1, earnedScore: roundFinalScore(rawP1), maxScore: ptsP1 },
        p2: { total: n2, perQuestion: p2PerQuestion, earnedScore: roundFinalScore(rawP2), maxScore: ptsP2 },
        p3: { correct: correctP3, total: n3, earnedScore: roundFinalScore(rawP3), maxScore: ptsP3 },
      },
    };
  }

  // Legacy scoring fallback (backward compatibility)
  let score = 0;
  let maxScore = 0;
  const partIISummary: PartIIQuestionSummary[] = [];
  const breakdown = {
    p1: { correct: 0, total: partI.length },
    p2: {
      total: partII.length,
      perQuestion: [] as {
        id: string;
        text: string;
        okItems: number;
        totalItems: number;
        earnedScore?: number;
        maxScore?: number;
        ratePercent?: number;
      }[],
    },
    p3: { correct: 0, total: partIII.length },
  };

  for (const q of partI) {
    total++;
    maxScore += scoring.p1;
    const ok = q.answer ? answers[q.id] === q.answer : false;
    if (ok) { correct++; score += scoring.p1; breakdown.p1.correct++; }
    details.push({ id: q.id, ok, earnedScore: ok ? scoring.p1 : 0, maxScore: scoring.p1 });
  }
  partII.forEach((q, qIdx) => {
    total++;
    const qMax = scoring.p2["4"];
    maxScore += qMax;
    const ans = answers[q.id];
    let okItems = 0;
    const itemStatuses: Array<"correct" | "wrong" | "blank"> = [];
    for (const it of q.items) {
      const v = getTFValue(ans, it.key);
      if (v === null) {
        itemStatuses.push("blank");
      } else if (it.correct !== null && it.correct !== undefined && v === !!it.correct) {
        okItems++;
        itemStatuses.push("correct");
      } else {
        itemStatuses.push("wrong");
      }
    }
    const key = String(okItems) as "1" | "2" | "3" | "4";
    const pts = okItems >= 1 ? (scoring.p2[key] ?? 0) : 0;
    const ratePercent = qMax > 0 ? roundFinalScore((pts / qMax) * 100) : 0;
    score += pts;
    const ok = okItems === q.items.length;
    if (ok) correct++;
    breakdown.p2.perQuestion.push({
      id: q.id,
      text: q.text,
      okItems,
      totalItems: q.items.length,
      earnedScore: roundFinalScore(pts),
      maxScore: roundFinalScore(qMax),
      ratePercent,
    });
    partIISummary.push({
      questionIndex: qIdx + 1,
      id: q.id,
      okItems,
      totalItems: q.items.length,
      ratePercent,
      earnedScore: roundFinalScore(pts),
      maxScore: roundFinalScore(qMax),
      method: "equal",
      itemStatuses,
    });
    details.push({
      id: q.id,
      ok,
      earnedScore: pts,
      maxScore: qMax,
      okItems,
      totalItems: q.items.length,
      ratePercent,
    });
  });
  for (const q of partIII) {
    total++;
    maxScore += scoring.p3;
    const given = String(answers[q.id] ?? "").trim().toLowerCase();
    const expected = q.answer ? stripRich(String(q.answer)).trim().toLowerCase() : "";
    let ok = expected !== "" && given === expected;
    if (!ok && expected !== "") {
      const a = parseFloat(given.replace(",", "."));
      const b = parseFloat(expected.replace(",", "."));
      if (!isNaN(a) && !isNaN(b) && Math.abs(a - b) < 1e-6) ok = true;
    }
    if (ok) { correct++; score += scoring.p3; breakdown.p3.correct++; }
    details.push({ id: q.id, ok, earnedScore: ok ? scoring.p3 : 0, maxScore: scoring.p3 });
  }

  return {
    correct,
    wrong: total - correct,
    total,
    score: roundFinalScore(score),
    maxScore: roundFinalScore(maxScore),
    details,
    partIISummary,
    breakdown,
  };
}

export function flattenQuestions(exam: ParsedExam) {
  return [...exam.partI, ...exam.partII, ...exam.partIII];
}

