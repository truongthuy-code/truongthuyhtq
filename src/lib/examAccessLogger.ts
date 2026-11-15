import { supabase } from "@/integrations/supabase/client";

export type ExamAccessErrorType =
  | "validation"
  | "not_found"
  | "closed"
  | "not_open"
  | "expired"
  | "unauthorized"
  | "network"
  | "server"
  | "sync_error";

export type ExamAccessType = "code" | "short_link" | "url_uuid" | "create_sync";

export type ExamAccessOutcome =
  | "success"
  | "not_found"
  | "closed"
  | "not_open"
  | "expired"
  | "unauthorized"
  | "network_error"
  | "server_error"
  | "sync_error";

export interface ExamAccessLogEntry {
  id: string;
  timestamp: string;
  examId?: string | null;
  codeMasked: string;
  accessType: ExamAccessType;
  outcome: ExamAccessOutcome;
  errorCategory?: string;
  errorDetail?: string;
  origin?: string;
}

const LOG_STORAGE_KEY = "qc_exam_access_logs_v1";
const MAX_LOCAL_LOGS = 100;
let memoryLogs: ExamAccessLogEntry[] = [];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks whether an RPC error simply means the new migration RPC is not deployed yet
 * on the remote database (so client can fall back cleanly without misclassifying).
 */
export function isRpcNotFoundError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "").toUpperCase();
  const msg = String(err.message || "").toLowerCase();
  const details = String(err.details || "").toLowerCase();
  const status = Number(err.status || err.statusCode || 0);

  if (code === "PGRST202" || code === "42883" || code === "42P01") return true;
  if (
    status === 404 &&
    (msg.includes("could not find the function") ||
      msg.includes("schema cache") ||
      msg.includes("does not exist"))
  ) {
    return true;
  }
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    details.includes("does not exist")
  );
}

/**
 * Classifies Supabase / network / PostgREST errors so server/network/RLS errors
 * are NEVER falsely reported to students as "mã không tồn tại".
 */
export function classifySupabaseError(err: any): {
  type: "not_found" | "unauthorized" | "network" | "server";
  message: string;
  technicalDetail: string;
} {
  if (!err) {
    return {
      type: "server",
      message: "Lỗi hệ thống không xác định. Vui lòng thử lại.",
      technicalDetail: "unknown_error",
    };
  }

  const code = String(err.code || "").toUpperCase();
  const status = Number(err.status || err.statusCode || 0);
  const msg = String(err.message || err.error_description || err || "");
  const lower = msg.toLowerCase();

  // Explicit "not found" from get_exam_for_student or empty single row
  if (
    lower.includes("exam not found") ||
    lower.includes("not found") && status === 404 ||
    code === "PGRST116" ||
    code === "22P02"
  ) {
    return {
      type: "not_found",
      message: "Mã bài thi không hợp lệ hoặc không tồn tại.",
      technicalDetail: `${code || status || "not_found"}: ${msg.slice(0, 180)}`,
    };
  }

  // Network / timeout / offline / CORS / DNS failures
  if (
    err.name === "AbortError" ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("err_internet_disconnected") ||
    lower.includes("fetch failed")
  ) {
    return {
      type: "network",
      message: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.",
      technicalDetail: `network: ${msg.slice(0, 180)}`,
    };
  }

  // Authorization / RLS / JWT errors
  if (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    lower.includes("permission denied") ||
    lower.includes("row-level security") ||
    lower.includes("jwt")
  ) {
    return {
      type: "unauthorized",
      message: "Phiên truy cập không hợp lệ hoặc chưa được cấp quyền. Vui lòng tải lại trang và thử lại.",
      technicalDetail: `auth_${code || status}: ${msg.slice(0, 180)}`,
    };
  }

  // Server / DB 5xx / transient gateway errors
  if (status >= 500 || status === 429 || lower.includes("502") || lower.includes("503") || lower.includes("504")) {
    return {
      type: "server",
      message: "Máy chủ dữ liệu đang tạm bận hoặc gặp sự cố. Vui lòng thử lại sau ít giây.",
      technicalDetail: `server_${code || status}: ${msg.slice(0, 180)}`,
    };
  }

  return {
    type: "server",
    message: "Không thể xác minh bài thi do lỗi kết nối hoặc hệ thống. Vui lòng thử lại.",
    technicalDetail: `${code || status || "err"}: ${msg.slice(0, 180)}`,
  };
}

/**
 * Masks or sanitizes code tokens before technical logging.
 * Never logs passwords or query secrets.
 */
export function sanitizeCodeForLog(rawInput?: string | null): string {
  const s = String(rawInput || "").trim();
  if (!s) return "(empty)";
  // Strip query parameters or password hints if URL passed
  const cleanUrl = s.split("?")[0].split("#")[0];
  const lastSeg = cleanUrl.includes("/") ? cleanUrl.split("/").filter(Boolean).pop() || cleanUrl : cleanUrl;
  const upper = lastSeg.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!upper) return "(invalid)";
  if (upper.length <= 4) return upper;
  return `${upper.slice(0, 3)}***${upper.slice(-2)}`;
}

export function sanitizeTechnicalDetail(detail?: string | null): string {
  if (!detail) return "";
  return String(detail)
    .replace(/(password|token|apikey|authorization|secret|jwt)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 280);
}

export function getLocalExamAccessLogs(): ExamAccessLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryLogs = parsed;
        return parsed;
      }
    }
  } catch {}
  return memoryLogs;
}

function appendLocalLog(entry: ExamAccessLogEntry): void {
  const next = [entry, ...getLocalExamAccessLogs()].slice(0, MAX_LOCAL_LOGS);
  memoryLogs = next;
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    try {
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(next.slice(0, 25)));
    } catch {}
  }
}

/**
 * Records a non-blocking technical diagnostic log entry for teacher/admin inspection.
 * Never exposes technical data to student UI and never stores passwords or PII.
 */
export function logExamAccessEvent(params: {
  examId?: string | null;
  rawCode?: string | null;
  accessType: ExamAccessType;
  outcome: ExamAccessOutcome;
  errorCategory?: string;
  errorDetail?: string;
}): void {
  const validExamId = params.examId && UUID_REGEX.test(params.examId) ? params.examId : null;
  const codeMasked = sanitizeCodeForLog(params.rawCode);
  const errorDetail = sanitizeTechnicalDetail(params.errorDetail);
  const origin = typeof window !== "undefined" ? window.location.origin : "server";

  const entry: ExamAccessLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    examId: validExamId,
    codeMasked,
    accessType: params.accessType,
    outcome: params.outcome,
    errorCategory: params.errorCategory,
    errorDetail: errorDetail || undefined,
    origin,
  };

  appendLocalLog(entry);

  // Also emit to console only in dev/diagnostics and fire non-blocking Supabase RPC
  if (params.outcome !== "success") {
    console.warn("[ExamAccessDiag]", {
      examId: validExamId,
      code: codeMasked,
      type: params.accessType,
      outcome: params.outcome,
      category: params.errorCategory,
      detail: errorDetail,
    });
  }

  // Only persist non-trivial diagnostics or failures remotely when running in a real browser/RPC environment
  if (params.outcome === "success") return;

  try {
    const rpcPromise = (supabase as any)?.rpc?.("log_exam_access_event", {
      p_exam_id: validExamId,
      p_code_masked: codeMasked,
      p_access_type: params.accessType,
      p_outcome: params.outcome,
      p_error_category: params.errorCategory || null,
      p_error_detail: errorDetail || null,
      p_app_env: origin,
    });
    if (rpcPromise && typeof rpcPromise.then === "function") {
      rpcPromise.then(() => {}, () => {});
    }
  } catch {}
}
