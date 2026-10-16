/**
 * Tiện ích mã hóa và băm mật khẩu đề thi an toàn
 * - Sử dụng SHA-256 để băm mật khẩu (so khớp một chiều phía server, không lộ mật khẩu gốc)
 * - Sử dụng thuật toán đảo bit với salt bí mật để bảo mật mật khẩu phía giáo viên (không lưu văn bản thuần)
 */

const SECRET_SALT = "AIS_Exam_Guard_Secret_Key_2026_Secure_Vercel_Supabase";

/**
 * Băm mật khẩu bằng thuật toán SHA-256
 */
export async function sha256(text: string): Promise<string> {
  const clean = String(text || "").trim();
  if (!clean) return "";

  if (typeof window !== "undefined" && window.crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(clean);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback below
    }
  }

  // Node.js fallback
  try {
    const crypto = await import("crypto");
    return crypto.createHash("sha256").update(clean).digest("hex");
  } catch {
    // Basic fallback hash if crypto not available
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (hash << 5) - hash + clean.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(16, "0");
  }
}

/**
 * Đồng bộ hóa SHA-256 cho môi trường Node.js / Serverless
 */
export function sha256Sync(text: string): string {
  const clean = String(text || "").trim();
  if (!clean) return "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(clean).digest("hex");
  } catch {
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (hash << 5) - hash + clean.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(16, "0");
  }
}

/**
 * Mã hóa mật khẩu phía giáo viên trước khi lưu lên cơ sở dữ liệu
 * (Tránh lưu văn bản thuần trên Supabase)
 */
export function encryptExamPassword(password: string, examId: string = "default"): string {
  const clean = String(password || "").trim();
  if (!clean) return "";
  const key = `${SECRET_SALT}_${examId}`;
  let result = "";
  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  try {
    return btoa(encodeURIComponent(result));
  } catch {
    return Buffer.from(result, "utf-8").toString("base64");
  }
}

function isCleanPrintable(str: string): boolean {
  if (!str) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return false;
    }
  }
  return true;
}

/**
 * Giải mã mật khẩu để giáo viên xem/chỉnh sửa khi mở lại đề thi
 */
export function decryptExamPassword(encrypted: string, examId: string = "default"): string {
  if (!encrypted) return "";

  const tryDecryptWithKey = (keyString: string): string => {
    try {
      let raw = "";
      try {
        raw = decodeURIComponent(atob(encrypted));
      } catch {
        raw = Buffer.from(encrypted, "base64").toString("utf-8");
      }
      let result = "";
      for (let i = 0; i < raw.length; i++) {
        const charCode = raw.charCodeAt(i) ^ keyString.charCodeAt(i % keyString.length);
        result += String.fromCharCode(charCode);
      }
      return result;
    } catch {
      return "";
    }
  };

  // 1. Try with specific examId if provided
  if (examId && examId !== "default") {
    const resId = tryDecryptWithKey(`${SECRET_SALT}_${examId}`);
    if (isCleanPrintable(resId)) {
      return resId;
    }
  }

  // 2. Try with default key
  const resDef = tryDecryptWithKey(`${SECRET_SALT}_default`);
  if (isCleanPrintable(resDef)) {
    return resDef;
  }

  // 3. Try with raw SECRET_SALT
  const resSalt = tryDecryptWithKey(SECRET_SALT);
  if (isCleanPrintable(resSalt)) {
    return resSalt;
  }

  return "";
}
