import { resolveClientSupabaseConfig, supabase } from "@/integrations/supabase/client";
import { isRequestTimeoutError, withRequestTimeout } from "@/lib/requestTimeout";
import { ensureSupabaseSession, resetSupabaseAuthSyncCache } from "@/lib/supabaseAuthSync";
import type { AuthSessionUser } from "@/lib/teacherStorage";

export const EXAM_FILES_BUCKET = "exam-files";

export type ExamStorageErrorCode =
  | "no_file"
  | "not_found"
  | "bucket_not_found"
  | "unauthorized"
  | "forbidden"
  | "payload_too_large"
  | "unsupported_mime"
  | "timeout"
  | "network"
  | "invalid_path"
  | "unknown";

export interface ClassifiedStorageError {
  code: ExamStorageErrorCode;
  httpStatus?: number;
  message: string;
  retryableAuth: boolean;
}

export type UploadOriginalExamFileResult =
  | {
      ok: true;
      path: string;
      originalName: string;
      mimeType: string;
    }
  | {
      ok: false;
      code: ExamStorageErrorCode;
      httpStatus?: number;
      message: string;
    };

export type ResolveOriginalFileAccessResult =
  | {
      ok: true;
      source: "signed_url" | "external";
      url: string;
      path?: string;
      fileName?: string;
    }
  | {
      ok: false;
      code: ExamStorageErrorCode;
      httpStatus?: number;
      message: string;
      path?: string;
    };

export function sanitizeStorageSegment(segment: string): string {
  const ascii = String(segment || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (ch) => (ch === "đ" ? "d" : "D"));
  const cleaned = ascii
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "");
  return cleaned || "teacher";
}

export function sanitizeVietnameseStorageFileName(fileName: string): string {
  const raw = String(fileName || "").trim();
  const lastDot = raw.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < raw.length - 1;
  const baseRaw = hasExt ? raw.slice(0, lastDot) : raw;
  const extRaw = hasExt ? raw.slice(lastDot + 1) : "";

  const asciiBase = baseRaw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (ch) => (ch === "đ" ? "d" : "D"))
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const asciiExt = extRaw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const safeBase = asciiBase || "de_thi";
  return asciiExt ? `${safeBase}.${asciiExt}` : safeBase;
}

export function inferExamFileMimeType(fileName: string, providedType?: string | null): string {
  const cleanType = String(providedType || "").trim();
  if (cleanType && cleanType !== "application/octet-stream") {
    return cleanType;
  }
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  return cleanType || "application/octet-stream";
}

function safeDecodeUriSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function normalizeStorageObjectPath(rawPath: string): string {
  let clean = String(rawPath || "").trim();
  if (!clean) return "";

  const qIdx = clean.indexOf("?");
  if (qIdx >= 0) clean = clean.slice(0, qIdx);
  const hIdx = clean.indexOf("#");
  if (hIdx >= 0) clean = clean.slice(0, hIdx);

  clean = clean.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean.startsWith(`${EXAM_FILES_BUCKET}/`)) {
    clean = clean.slice(EXAM_FILES_BUCKET.length + 1);
  }
  if (clean.includes("%")) {
    clean = clean
      .split("/")
      .map((seg) => safeDecodeUriSegment(seg))
      .join("/");
  }
  return clean.replace(/^\/+/, "");
}

export function extractStoragePathFromExam(exam: {
  original_file_path?: string | null;
  original_file_url?: string | null;
}): { storagePath: string | null; externalUrl: string | null } {
  const directPath = normalizeStorageObjectPath(exam?.original_file_path || "");
  if (directPath) {
    // Handle edge case where a full Supabase URL was mistakenly saved in original_file_path
    if (/^https?:\/\//i.test(directPath)) {
      const fromDirectUrl = extractStoragePathFromUrl(directPath);
      if (fromDirectUrl.storagePath) return fromDirectUrl;
    } else {
      return { storagePath: directPath, externalUrl: null };
    }
  }

  const rawUrl = String(exam?.original_file_url || "").trim();
  if (!rawUrl) {
    return { storagePath: null, externalUrl: null };
  }

  return extractStoragePathFromUrl(rawUrl);
}

function extractStoragePathFromUrl(rawUrl: string): {
  storagePath: string | null;
  externalUrl: string | null;
} {
  const markers = [
    `/storage/v1/object/public/${EXAM_FILES_BUCKET}/`,
    `/storage/v1/object/sign/${EXAM_FILES_BUCKET}/`,
    `/storage/v1/object/authenticated/${EXAM_FILES_BUCKET}/`,
    `/object/public/${EXAM_FILES_BUCKET}/`,
    `/object/sign/${EXAM_FILES_BUCKET}/`,
    `/object/authenticated/${EXAM_FILES_BUCKET}/`,
    `/${EXAM_FILES_BUCKET}/`,
  ];

  for (const marker of markers) {
    const idx = rawUrl.indexOf(marker);
    if (idx >= 0) {
      const after = rawUrl.slice(idx + marker.length);
      const normalized = normalizeStorageObjectPath(after);
      if (normalized) {
        return { storagePath: normalized, externalUrl: null };
      }
    }
  }

  return { storagePath: null, externalUrl: rawUrl };
}

export function classifyStorageError(
  err: any,
  action: "upload" | "sign" | "download",
  path?: string
): ClassifiedStorageError {
  if (isRequestTimeoutError(err)) {
    return {
      code: "timeout",
      httpStatus: 408,
      retryableAuth: false,
      message:
        action === "upload"
          ? "Quá thời gian tải file gốc lên Supabase Storage (timeout). Vui lòng kiểm tra kết nối mạng và thử lại."
          : "Quá thời gian kết nối tới Supabase Storage khi lấy đường dẫn file gốc (timeout).",
    };
  }

  const rawMsg = String(err?.message || err?.error_description || err?.error || "").trim();
  const lowerMsg = rawMsg.toLowerCase();
  const statusNum = Number(err?.statusCode || err?.status || 0) || undefined;
  const codeStr = String(err?.code || "").toLowerCase();

  if (
    lowerMsg.includes("failed to fetch") ||
    lowerMsg.includes("networkerror") ||
    lowerMsg.includes("load failed") ||
    lowerMsg.includes("err_network")
  ) {
    return {
      code: "network",
      httpStatus: 0,
      retryableAuth: false,
      message: "Lỗi kết nối mạng tới Supabase Storage. Vui lòng kiểm tra đường truyền Internet và thử lại.",
    };
  }

  if (lowerMsg.includes("bucket not found")) {
    return {
      code: "bucket_not_found",
      httpStatus: 404,
      retryableAuth: false,
      message: `Không tìm thấy kho lưu trữ '${EXAM_FILES_BUCKET}' trên Supabase Storage (404).`,
    };
  }

  if (
    statusNum === 404 ||
    codeStr === "nosuchkey" ||
    lowerMsg.includes("object not found") ||
    lowerMsg.includes("not_found")
  ) {
    return {
      code: "not_found",
      httpStatus: 404,
      retryableAuth: false,
      message:
        `File gốc không còn tồn tại trong Supabase Storage (404)` +
        (path ? ` [${path}]` : "") +
        ". Dữ liệu câu hỏi của đề thi hiện tại vẫn được giữ nguyên.",
    };
  }

  if (
    statusNum === 401 ||
    lowerMsg.includes("invalid jwt") ||
    lowerMsg.includes("jwt expired") ||
    lowerMsg.includes("exp claim") ||
    lowerMsg.includes("signature verification failed")
  ) {
    return {
      code: "unauthorized",
      httpStatus: 401,
      retryableAuth: true,
      message: "Phiên đăng nhập Supabase đã hết hạn hoặc không hợp lệ (401). Vui lòng đăng nhập lại rồi thử lại.",
    };
  }

  if (
    statusNum === 403 ||
    codeStr === "accessdenied" ||
    lowerMsg.includes("row-level security") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("permission") ||
    lowerMsg.includes("forbidden")
  ) {
    return {
      code: "forbidden",
      httpStatus: 403,
      retryableAuth: true,
      message:
        action === "upload"
          ? "Không đủ quyền tải file gốc lên Supabase Storage (403 - RLS). Vui lòng đăng nhập lại bằng tài khoản giáo viên hợp lệ."
          : "Không đủ quyền truy cập file gốc này trên Supabase Storage (403 - RLS).",
    };
  }

  if (
    statusNum === 413 ||
    lowerMsg.includes("maximum allowed size") ||
    lowerMsg.includes("payload too large") ||
    lowerMsg.includes("entity too large")
  ) {
    return {
      code: "payload_too_large",
      httpStatus: 413,
      retryableAuth: false,
      message: "Dung lượng file gốc vượt quá giới hạn cho phép của Supabase Storage (413).",
    };
  }

  if (statusNum === 415 || lowerMsg.includes("mime type") || lowerMsg.includes("not supported")) {
    return {
      code: "unsupported_mime",
      httpStatus: 415,
      retryableAuth: false,
      message: `Định dạng file gốc không được kho lưu trữ hỗ trợ (415): ${rawMsg || "MIME type invalid"}.`,
    };
  }

  return {
    code: "unknown",
    httpStatus: statusNum,
    retryableAuth: false,
    message:
      (action === "upload" ? "Không tải được file gốc lên kho lưu trữ" : "Không thể truy cập file gốc") +
      (rawMsg ? `: ${rawMsg}` : "."),
  };
}

async function tryRefreshSessionOnce(): Promise<boolean> {
  try {
    if (typeof supabase?.auth?.refreshSession !== "function") return false;
    resetSupabaseAuthSyncCache();
    const res = await withRequestTimeout(
      supabase.auth.refreshSession(),
      5000,
      "examFileStorage.refreshSession"
    );
    return Boolean(res?.data?.session?.access_token);
  } catch {
    return false;
  }
}

export async function uploadOriginalExamFile(
  file: File,
  user?: AuthSessionUser | null,
  options?: { timeoutMs?: number }
): Promise<UploadOriginalExamFileResult> {
  const timeoutMs = options?.timeoutMs ?? 20000;
  let activeUserId = user?.id || "";

  try {
    const ensured = await withRequestTimeout(
      ensureSupabaseSession(user || null),
      8000,
      "examFileStorage.ensureSession"
    );
    if (ensured) activeUserId = ensured;
  } catch {}

  const folder = sanitizeStorageSegment(activeUserId || user?.id || "teacher");
  const safeName = sanitizeVietnameseStorageFileName(file.name);
  const path = `${folder}/${Date.now()}-${safeName}`;
  const mimeType = inferExamFileMimeType(file.name, file.type);

  const attemptUpload = async () => {
    return await withRequestTimeout<any>(
      supabase.storage.from(EXAM_FILES_BUCKET).upload(path, file, {
        contentType: mimeType,
        upsert: true,
      }),
      timeoutMs,
      "examFileStorage.upload"
    );
  };

  try {
    let res = await attemptUpload();
    if (res?.error) {
      const classified = classifyStorageError(res.error, "upload", path);
      if (classified.retryableAuth) {
        const refreshed = await tryRefreshSessionOnce();
        if (refreshed) {
          res = await attemptUpload();
        }
      }
    }

    if (res?.error) {
      const finalErr = classifyStorageError(res.error, "upload", path);
      return {
        ok: false,
        code: finalErr.code,
        httpStatus: finalErr.httpStatus,
        message: finalErr.message,
      };
    }

    return {
      ok: true,
      path: res?.data?.path || path,
      originalName: file.name,
      mimeType,
    };
  } catch (err: any) {
    const classified = classifyStorageError(err, "upload", path);
    return {
      ok: false,
      code: classified.code,
      httpStatus: classified.httpStatus,
      message: classified.message,
    };
  }
}

function toAbsoluteSignedUrl(rawSignedUrl: string): string {
  const clean = String(rawSignedUrl || "").trim();
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  const { supabaseUrl } = resolveClientSupabaseConfig();
  if (clean.startsWith("/storage/v1/")) return `${supabaseUrl}${clean}`;
  if (clean.startsWith("/object/")) return `${supabaseUrl}/storage/v1${clean}`;
  if (clean.startsWith("/")) return `${supabaseUrl}${clean}`;
  return clean;
}

export async function resolveOriginalFileAccess(
  exam: {
    id?: string;
    original_file_path?: string | null;
    original_file_url?: string | null;
    original_file_name?: string | null;
  },
  user?: AuthSessionUser | null,
  expiresInSeconds = 300
): Promise<ResolveOriginalFileAccessResult> {
  const { storagePath, externalUrl } = extractStoragePathFromExam(exam || {});

  if (externalUrl) {
    return {
      ok: true,
      source: "external",
      url: externalUrl,
      fileName: exam?.original_file_name || undefined,
    };
  }

  if (!storagePath) {
    return {
      ok: false,
      code: "no_file",
      message: "Đề thi này chưa có file gốc đính kèm.",
    };
  }

  try {
    await withRequestTimeout(
      ensureSupabaseSession(user || null),
      5000,
      "examFileStorage.ensureSessionForRead"
    ).catch(() => null);

    const requestSign = async () =>
      await withRequestTimeout<any>(
        supabase.storage.from(EXAM_FILES_BUCKET).createSignedUrl(storagePath, expiresInSeconds),
        10000,
        "examFileStorage.createSignedUrl"
      );

    let res = await requestSign();
    if (res?.error) {
      const classified = classifyStorageError(res.error, "sign", storagePath);
      if (classified.retryableAuth) {
        const refreshed = await tryRefreshSessionOnce();
        if (refreshed) {
          res = await requestSign();
        }
      }
    }

    if (res?.error) {
      const finalErr = classifyStorageError(res.error, "sign", storagePath);
      return {
        ok: false,
        code: finalErr.code,
        httpStatus: finalErr.httpStatus,
        message: finalErr.message,
        path: storagePath,
      };
    }

    const signedUrl = toAbsoluteSignedUrl(res?.data?.signedUrl || "");
    if (!signedUrl) {
      return {
        ok: false,
        code: "not_found",
        httpStatus: 404,
        message: `Không tạo được đường dẫn truy cập hợp lệ cho file gốc [${storagePath}].`,
        path: storagePath,
      };
    }

    return {
      ok: true,
      source: "signed_url",
      url: signedUrl,
      path: storagePath,
      fileName: exam?.original_file_name || storagePath.split("/").pop() || undefined,
    };
  } catch (err: any) {
    const classified = classifyStorageError(err, "sign", storagePath);
    return {
      ok: false,
      code: classified.code,
      httpStatus: classified.httpStatus,
      message: classified.message,
      path: storagePath,
    };
  }
}

export function openOrDownloadOriginalFile(url: string, fileName?: string): void {
  if (!url || typeof document === "undefined") return;
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (fileName) {
      a.download = fileName;
    }
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    if (typeof window !== "undefined") {
      window.location.assign(url);
    }
  }
}
