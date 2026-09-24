// Fisher-Yates shuffle using crypto.getRandomValues
import type { MCQuestion, TFQuestion, SAQuestion, ParsedExam } from "./docxParser";

function secureRandomInt(max: number): number {
  const arr = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  let x: number;
  do {
    crypto.getRandomValues(arr);
    x = arr[0];
  } while (x >= limit);
  return x % max;
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type ShuffleOptions = {
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  keepSaOrder: boolean;
};

const MC_KEYS: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
const TF_KEYS: ("a" | "b" | "c" | "d")[] = ["a", "b", "c", "d"];

export function shuffleMC(q: MCQuestion, opts: ShuffleOptions): MCQuestion {
  if (!opts.shuffleAnswers) return { ...q };
  const shuffled = shuffleArray(q.options);
  const oldCorrect = q.options.find((o) => o.key === q.answer);
  const newOptions = shuffled.map((o, i) => ({ key: MC_KEYS[i], text: o.text }));
  const newAnswerIdx = shuffled.findIndex((o) => o.text === oldCorrect?.text && o.key === oldCorrect?.key);
  return { ...q, options: newOptions, answer: MC_KEYS[newAnswerIdx >= 0 ? newAnswerIdx : 0] };
}

export function shuffleTF(q: TFQuestion, opts: ShuffleOptions): TFQuestion {
  if (!opts.shuffleAnswers) return { ...q };
  const shuffled = shuffleArray(q.items);
  const newItems = shuffled.map((it, i) => ({ key: TF_KEYS[i], text: it.text, correct: it.correct }));
  return { ...q, items: newItems };
}

export function buildVariant(base: ParsedExam, opts: ShuffleOptions): ParsedExam {
  let p1 = base.partI.map((q) => shuffleMC(q, opts));
  let p2 = base.partII.map((q) => shuffleTF(q, opts));
  let p3 = base.partIII.map((q) => ({ ...q }));
  if (opts.shuffleQuestions) {
    p1 = shuffleArray(p1);
    p2 = shuffleArray(p2);
    if (!opts.keepSaOrder) p3 = shuffleArray(p3);
  }
  return { partI: p1, partII: p2, partIII: p3 };
}

// Estimate distinct permutations possible
function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function estimateMaxVariants(base: ParsedExam, opts: ShuffleOptions): number {
  let total = 1;
  if (opts.shuffleQuestions) {
    total *= factorial(base.partI.length);
    total *= factorial(base.partII.length);
    if (!opts.keepSaOrder) total *= factorial(base.partIII.length);
  }
  if (opts.shuffleAnswers) {
    base.partI.forEach(() => (total *= 24));
    base.partII.forEach(() => (total *= 24));
  }
  return total;
}

function variantSignature(v: ParsedExam): string {
  const p1 = v.partI.map((q) => q.id + ":" + q.options.map((o) => o.text.slice(0, 8)).join("|")).join(";");
  const p2 = v.partII.map((q) => q.id + ":" + q.items.map((it) => it.key + it.text.slice(0, 5)).join("|")).join(";");
  const p3 = v.partIII.map((q) => q.id).join(";");
  return p1 + "##" + p2 + "##" + p3;
}

export function generateVariants(base: ParsedExam, count: number, opts: ShuffleOptions): ParsedExam[] {
  const max = estimateMaxVariants(base, opts);
  const seen = new Set<string>();
  const out: ParsedExam[] = [];
  const target = Math.min(count, Number.isFinite(max) ? max : count);
  let attempts = 0;
  const maxAttempts = target * 50 + 100;
  while (out.length < target && attempts < maxAttempts) {
    attempts++;
    const v = buildVariant(base, opts);
    const sig = variantSignature(v);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(v);
  }
  return out;
}

export function parseCodes(input: string, count: number, prefix: string, length: number): string[] {
  const manual = input
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (manual.length >= count) return manual.slice(0, count);
  const start = prefix ? parseInt(prefix + "1".padStart(Math.max(1, length - prefix.length), "0")) : 101;
  const base = prefix ? parseInt(prefix) * Math.pow(10, Math.max(1, length - prefix.length)) : 100;
  const codes: string[] = [];
  for (let i = 1; i <= count; i++) codes.push(String(base + i));
  return codes;
}
