// ExamCodeGenerator — single source of truth for exam code generation & validation.
// Rules (see spec):
//  1) If manualCodes provided (non-empty), use them as-is after validation.
//  2) Else auto-generate: prefix + zero-padded sequence, total length = codeLength.

export type CodeGenInput = {
  prefix: string;
  codeLength: number;
  quantity: number;
  manualCodes?: string;
};

export type CodeGenResult =
  | { ok: true; codes: string[] }
  | { ok: false; error: string };

export function parseManualCodes(input: string): string[] {
  return (input || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function autoGenerateCodes(prefix: string, codeLength: number, quantity: number): string[] {
  const p = String(prefix ?? "");
  const seqLen = Math.max(1, codeLength - p.length);
  const codes: string[] = [];
  for (let i = 1; i <= quantity; i++) {
    codes.push(p + String(i).padStart(seqLen, "0"));
  }
  return codes;
}

export function validateManualCodes(codes: string[], prefix: string, codeLength: number, quantity: number): string | null {
  if (codes.length !== quantity) return "Số lượng mã đề nhập tay không khớp.";
  const seen = new Set<string>();
  for (const c of codes) {
    if (seen.has(c)) return "Mã đề bị trùng.";
    seen.add(c);
    if (codeLength > 0 && c.length !== codeLength) return `Mã đề ${c} không đúng độ dài.`;
    if (prefix && !c.startsWith(prefix)) return `Mã đề ${c} không đúng tiền tố.`;
  }
  return null;
}

export function generateExamCodes(input: CodeGenInput): CodeGenResult {
  const { prefix, codeLength, quantity, manualCodes } = input;
  if (quantity < 1) return { ok: false, error: "Số lượng mã đề phải ≥ 1." };
  if (codeLength < 1) return { ok: false, error: "Độ dài mã đề không hợp lệ." };
  if (prefix && prefix.length > codeLength) return { ok: false, error: "Tiền tố dài hơn độ dài mã đề." };

  const manual = parseManualCodes(manualCodes || "");
  if (manual.length > 0) {
    const err = validateManualCodes(manual, prefix, codeLength, quantity);
    if (err) return { ok: false, error: err };
    return { ok: true, codes: manual };
  }
  return { ok: true, codes: autoGenerateCodes(prefix, codeLength, quantity) };
}
