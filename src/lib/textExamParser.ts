import type { ParsedExam, MCQuestion, TFQuestion, SAQuestion, QuestionLevel } from "./docxParser";
import { QUESTION_START_RE, QUESTION_PREFIX_RE } from "./docxParser";

/**
 * Parse plain text (with optional $..$ LaTeX math) into a ParsedExam.
 *
 * Conventions:
 *  - Section headers: "PHẦN I", "PHẦN II", "PHẦN III" (case-insensitive)
 *  - Question line starts with "Câu N:" or "Câu N."
 *  - Part I options on separate lines:  A. ..   B. ..   C. ..   D. ..
 *      Correct answer marked by:  *A. ...   or "Đáp án: B" line
 *  - Part II items:  a) ..  b) ..  c) ..  d) ..
 *      Correct items prefixed with `*`  (e.g.  *a) ...)
 *  - Part III: question text, then "Đáp án: <giá trị>" line
 *  - Math may be wrapped in $..$, $$..$$, \(..\), \[..\] — kept verbatim, RichText renders.
 */
export function parseTextExam(raw: string): ParsedExam {
  const text = raw.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  const partI: MCQuestion[] = [];
  const partII: TFQuestion[] = [];
  const partIII: SAQuestion[] = [];

  let part: 1 | 2 | 3 = 1;
  let qIdx = 0;
  let buf: string[] = [];
  let bufPart: 1 | 2 | 3 = 1;
  let bufLevel: QuestionLevel | null = null;

  const flush = () => {
    if (!buf.length) return;
    const block = buf.join("\n").trim();
    buf = [];
    if (!block) return;
    qIdx++;
    if (bufPart === 1) partI.push(parsePartIBlock(block, qIdx, bufLevel));
    else if (bufPart === 2) partII.push(parsePartIIBlock(block, qIdx, bufLevel));
    else partIII.push(parsePartIIIBlock(block, qIdx, bufLevel));
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    const trimmed = line.trim();
    const u = trimmed.toUpperCase();
    if (/^PH[ẦA]N\s*(III|3)\b/.test(u)) { flush(); part = 3; continue; }
    if (/^PH[ẦA]N\s*(II|2)\b/.test(u)) { flush(); part = 2; continue; }
    if (/^PH[ẦA]N\s*(I|1)\b/.test(u)) { flush(); part = 1; continue; }
    const qm = trimmed.match(QUESTION_START_RE);
    if (qm) {
      flush();
      bufPart = part;
      bufLevel = (qm[2]?.toUpperCase() as QuestionLevel) ?? null;
      buf.push(line);
    } else if (buf.length) {
      buf.push(line);
    }
  }
  flush();

  return { partI, partII, partIII };
}

function stripQuestionPrefix(s: string): string {
  return s.replace(QUESTION_PREFIX_RE, "");
}

/** Split a question block into (main lines, explanation string|null). */
function splitExplanation(block: string, part: 1 | 2 | 3): { main: string; explanation: string | null } {
  const lines = block.split("\n");
  const explLines: string[] = [];
  const mainLines: string[] = [];
  let inExpl = false;
  const loiRe = /^\s*L[ờo]i\s*gi[ảa]i\s*[:.]\s*(.*)$/i;
  const dapRe = /^\s*Đ[áa]p\s*[áa]n\s*[:.]\s*(.*)$/i;
  for (const ln of lines) {
    if (!inExpl) {
      const mL = ln.match(loiRe);
      if (mL) {
        inExpl = true;
        if (mL[1].trim()) explLines.push(mL[1]);
        continue;
      }
      const mD = ln.match(dapRe);
      if (mD) {
        const rest = mD[1].trim();
        // Preserve backward compat for simple answer forms.
        const isSimpleAnsPart1 = part === 1 && /^[A-D]\.?$/i.test(rest);
        const isSimpleAnsPart3 = part === 3 && rest.length > 0 && rest.length <= 60 && !/[.!?…]\s+\S/.test(rest);
        if (isSimpleAnsPart1 || isSimpleAnsPart3) {
          mainLines.push(ln);
          continue;
        }
        inExpl = true;
        if (rest) explLines.push(rest);
        continue;
      }
      mainLines.push(ln);
    } else {
      explLines.push(ln);
    }
  }
  const explanation = explLines.join("\n").replace(/^\s+|\s+$/g, "");
  return { main: mainLines.join("\n"), explanation: explanation || null };
}

function parsePartIBlock(block: string, idx: number, level: QuestionLevel | null = null): MCQuestion {
  const { main, explanation } = splitExplanation(block, 1);
  const lines = main.split("\n");
  const stem: string[] = [];
  const opts: { key: "A" | "B" | "C" | "D"; text: string; marked: boolean }[] = [];
  let answer: "A" | "B" | "C" | "D" | "" = "";
  let inOptions = false;
  let cur: typeof opts[number] | null = null;
  const optRe = /^\s*(\*?)\s*([A-D])\s*[.\)]\s*(.*)$/;
  const ansRe = /^\s*Đáp\s*án\s*[:.]?\s*([A-D])\b/i;
  for (const ln of lines) {
    const am = ln.match(ansRe);
    if (am) { answer = am[1].toUpperCase() as any; continue; }
    const m = ln.match(optRe);
    if (m) {
      inOptions = true;
      if (cur) opts.push(cur);
      cur = { key: m[2] as any, text: m[3], marked: m[1] === "*" };
    } else if (inOptions && cur) {
      cur.text += "\n" + ln.trim();
    } else {
      stem.push(ln);
    }
  }
  if (cur) opts.push(cur);
  if (!answer) {
    const marked = opts.find((o) => o.marked);
    if (marked) answer = marked.key;
  }
  return {
    type: "mc",
    id: `q${idx}`,
    text: stripQuestionPrefix(stem.join("\n")).trim(),
    options: opts.map((o) => ({ key: o.key, text: o.text.trim() })),
    answer: (answer || "A") as any,
    explanation,
    level,
  };
}

function parsePartIIBlock(block: string, idx: number, level: QuestionLevel | null = null): TFQuestion {
  const { main, explanation } = splitExplanation(block, 2);
  const lines = main.split("\n");
  const stem: string[] = [];
  const items: { key: "a" | "b" | "c" | "d"; text: string; correct: boolean }[] = [];
  let inItems = false;
  let cur: typeof items[number] | null = null;
  const re = /^\s*(\*?)\s*([a-d])\s*\)\s*(.*)$/;
  for (const ln of lines) {
    const m = ln.match(re);
    if (m) {
      inItems = true;
      if (cur) items.push(cur);
      cur = { key: m[2] as any, text: m[3], correct: m[1] === "*" };
    } else if (inItems && cur) {
      cur.text += "\n" + ln.trim();
    } else {
      stem.push(ln);
    }
  }
  if (cur) items.push(cur);
  return {
    type: "tf",
    id: `q${idx}`,
    text: stripQuestionPrefix(stem.join("\n")).trim(),
    items: items.map((i) => ({ key: i.key, text: i.text.trim(), correct: i.correct })),
    explanation,
    level,
  };
}


function parsePartIIIBlock(block: string, idx: number, level: QuestionLevel | null = null): SAQuestion {
  const { main, explanation } = splitExplanation(block, 3);
  const lines = main.split("\n");
  const stem: string[] = [];
  let answer = "";
  for (const ln of lines) {
    const m = ln.match(/^\s*Đáp\s*án\s*[:.]?\s*(.+)$/i);
    if (m && !answer) answer = m[1].trim();
    else stem.push(ln);
  }
  return {
    type: "sa",
    id: `q${idx}`,
    text: stripQuestionPrefix(stem.join("\n")).trim(),
    answer,
    explanation,
    level,
  };
}

