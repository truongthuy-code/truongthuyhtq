import { supabase } from "@/integrations/supabase/client";
import { findSampleExam, getSampleExamById } from "@/lib/sampleExams";
import { withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";
import { getLocalStoredExams } from "@/lib/allExamsStorage";
import {
  ExamAccessErrorType,
  classifySupabaseError,
  isRpcNotFoundError,
  logExamAccessEvent,
} from "@/lib/examAccessLogger";

export interface ExamAssignment {
  id: string;
  examId: string;
  code: string;
  shortCode?: string;
  className: string;
  title: string;
  teacherName?: string;
  schoolName?: string;
  subjectName?: string;
  durationMinutes?: number;
  openAt?: string | null;
  closeAt?: string | null;
  createdAt: string;
  createdBy?: string;
}

export interface ExamLookupResult {
  success: boolean;
  error?: string;
  errorType?: ExamAccessErrorType;
  exam?: any;
  assignment?: ExamAssignment;
}

const STORAGE_KEY = "qc_exam_assignments_v1";

// Legacy character set for backwards compatibility with older exams
const CODE_CHARS = "2346789ABCDEFGHJKLMNPQRTUVWXYZ";

/**
 * Check if a string is a standard UUID
 */
export function isUuid(val?: string | null): val is string {
  if (!val || typeof val !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

/**
 * Normalizes an exam code to a consistent format.
 * - Supports both number (123456) and string ("123456", "012345")
 * - Strictly preserves leading zeros for numeric codes up to 6 digits (e.g. "012345")
 * - Trims and normalizes alphanumeric legacy codes (e.g. "TIN12-7A3K9")
 */
export function normalizeExamCode(code: any): string {
  if (code === null || code === undefined) return "";
  const raw = String(code).trim().toUpperCase();
  if (/^\d{1,6}$/.test(raw)) {
    return raw.padStart(6, "0");
  }
  return raw;
}

/**
 * Generate a random 6-digit numeric code strictly with digits 0-9
 * e.g. "583214", "927461", "012345"
 * Length is strictly 6 digits, zero-padded so leading zeros are preserved.
 */
export function generateNumericExamCode(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const num = arr[0] % 1000000;
    return String(num).padStart(6, "0");
  }
  const num = Math.floor(Math.random() * 1000000);
  return String(num).padStart(6, "0");
}

/**
 * Check if an exam code already exists across local storage, sample exams,
 * authoritative SECURITY DEFINER RPC, Supabase schools registry, exam_short_links, or exams table.
 */
export async function isExamCodeTaken(code: string): Promise<boolean> {
  if (!code) return false;
  const clean = String(code).trim().toUpperCase();
  const normalized = normalizeExamCode(code);
  const rawNum = clean.replace(/^0+/, "");

  // 1. Check sample exams
  if (findSampleExam(clean) || findSampleExam(normalized)) return true;

  // 2. Check local assignments cache
  const localList = getLocalAssignments();
  if (
    localList.some((a) => {
      if (!a?.code) return false;
      const aNorm = normalizeExamCode(a.code);
      const aClean = String(a.code).trim().toUpperCase();
      return (
        aNorm === normalized ||
        aClean === clean ||
        (a.shortCode && a.shortCode.trim().toUpperCase() === clean) ||
        (rawNum && aNorm.replace(/^0+/, "") === rawNum)
      );
    })
  ) {
    return true;
  }

  // 3. Authoritative global check via SECURITY DEFINER RPC (sees ALL teachers' exams & short links)
  try {
    const { data: rpcTaken, error: rpcErr } = await (supabase as any).rpc("check_exam_code_taken", {
      p_code: normalized,
    });
    if (!rpcErr && typeof rpcTaken === "boolean") {
      return rpcTaken;
    }
  } catch {}

  // 4. Fallback: Check Supabase schools registry table (assign_code:* AND short_code:*)
  try {
    const keysToCheck = Array.from(
      new Set([
        `assign_code:${normalized}`,
        `assign_code:${clean}`,
        `short_code:${clean}`,
        `short_code:${normalized}`,
        ...(rawNum ? [`assign_code:${rawNum}`] : []),
      ])
    );
    const { data: rows } = await supabase
      .from("schools")
      .select("name_key")
      .in("name_key", keysToCheck);
    if (rows && rows.length > 0) return true;
  } catch {}

  // 5. Fallback: Check exam_short_links
  try {
    const { data: slRow, error: slErr } = await (supabase as any)
      .from("exam_short_links")
      .select("id")
      .eq("short_code", clean)
      .maybeSingle();
    if (!slErr && slRow) return true;
  } catch {}

  // 6. Fallback: Check Supabase exams table where team_config->>'primary_code' = code
  try {
    const { data: exRow } = await supabase
      .from("exams")
      .select("id")
      .filter("team_config->>primary_code", "eq", normalized)
      .maybeSingle();
    if (exRow) return true;
  } catch {}

  return false;
}

/**
 * Generate a unique 6-digit numeric exam code (digits 0-9 only, strictly 6 digits).
 * Checks database and local storage to guarantee no collisions.
 */
export async function generateUniqueNumericExamCode(): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = generateNumericExamCode();
    const taken = await isExamCodeTaken(code);
    if (!taken) {
      return code;
    }
  }
  const fallbackNum = (Date.now() % 900000) + 100000;
  return String(fallbackNum);
}

/**
 * Generate a random code. By default returns a 6-digit numeric code.
 */
export function generateRandomCode(length = 6): string {
  if (length === 6) {
    return generateNumericExamCode();
  }
  let res = "";
  for (let i = 0; i < length; i++) {
    res += Math.floor(Math.random() * 10);
  }
  return res;
}

/**
 * Generate a code for assignment/exam.
 * Generates a 6-digit numeric code.
 */
export function generateAssignmentCode(_className?: string, _prefix?: string): string {
  return generateNumericExamCode();
}

/**
 * Generate a deterministic 6-digit numeric code from exam ID.
 */
export function getDeterministicNumericExamCode(examId: string): string {
  if (!examId) return generateNumericExamCode();
  let hash = 0x55555555;
  for (let i = 0; i < examId.length; i++) {
    hash ^= examId.charCodeAt(i);
    hash = (hash << 5) - hash + examId.charCodeAt(i);
    hash &= hash;
  }
  const absHash = Math.abs(hash);
  const num = (absHash % 900000) + 100000;
  return String(num);
}

/**
 * Generate a deterministic legacy primary code from exam ID.
 */
export function getDeterministicPrimaryCode(examId: string, subjectName?: string): string {
  if (!examId) return generateRandomCode(6);
  let hash = 0x55555555;
  for (let i = 0; i < examId.length; i++) {
    hash ^= examId.charCodeAt(i);
    hash = (hash << 5) - hash + examId.charCodeAt(i);
    hash &= hash;
  }
  const absHash = Math.abs(hash);
  let code = "";
  let temp = absHash;
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[temp % CODE_CHARS.length];
    temp = Math.floor(temp / CODE_CHARS.length);
  }

  let prefix = "EX";
  if (subjectName) {
    const sub = subjectName.trim().toUpperCase();
    if (sub.includes("TOÁN") || sub.includes("TOAN")) prefix = "TOAN";
    else if (sub.includes("LÝ") || sub.includes("LY") || sub.includes("VẬT LÝ")) prefix = "LY";
    else if (sub.includes("HÓA") || sub.includes("HOA")) prefix = "HOA";
    else if (sub.includes("SINH")) prefix = "SINH";
    else if (sub.includes("TIN")) prefix = "TIN";
    else if (sub.includes("ANH") || sub.includes("TIẾNG ANH")) prefix = "ANH";
    else if (sub.includes("VĂN") || sub.includes("VAN")) prefix = "VAN";
    else if (sub.includes("SỬ") || sub.includes("SU")) prefix = "SU";
    else if (sub.includes("ĐỊA") || sub.includes("DIA")) prefix = "DIA";
    else if (sub.includes("GDCD") || sub.includes("KINH TẾ")) prefix = "GD";
  }

  return `${prefix}-${code}`;
}

/**
 * Get the public origin for student exam URLs.
 */
export function getExamPublicOrigin(): string {
  const envUrl = (import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_PRODUCTION_URL || "").trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    try {
      const savedDomain = localStorage.getItem("qc_production_domain");
      if (savedDomain && savedDomain.trim()) {
        return savedDomain.trim().replace(/\/+$/, "");
      }
    } catch {}

    return window.location.origin;
  }
  return "";
}

/**
 * Configure custom production domain for student links.
 */
export function setCustomProductionDomain(domain: string) {
  if (typeof window !== "undefined") {
    try {
      if (domain && domain.trim()) {
        localStorage.setItem("qc_production_domain", domain.trim().replace(/\/+$/, ""));
      } else {
        localStorage.removeItem("qc_production_domain");
      }
    } catch {}
  }
}

/**
 * Get the full student share URL for an exam and code.
 */
export function getExamShareUrl(examId: string, code?: string): string {
  const origin = getExamPublicOrigin();
  const c = code ? normalizeExamCode(code) : "";
  if (c) {
    return `${origin}/take/${examId}?code=${encodeURIComponent(c)}`;
  }
  return `${origin}/take/${examId}`;
}

/**
 * Get primary code of an exam.
 */
export function getExamPrimaryCode(exam: any): string {
  if (!exam) return "";
  const teamCfg = exam.team_config || {};
  const code = teamCfg.primary_code ?? teamCfg.code ?? exam.primary_code ?? exam.code;
  if (code !== null && code !== undefined && String(code).trim().length > 0) {
    return normalizeExamCode(code);
  }
  return getDeterministicNumericExamCode(exam.id);
}

/**
 * Get persisted primary short code of an exam if already generated.
 */
export function getExamPrimaryShortCode(exam: any): string {
  if (!exam) return "";
  const teamCfg = exam.team_config || {};
  const sc = teamCfg.primary_short_code ?? exam.primary_short_code ?? "";
  return typeof sc === "string" ? sc.trim().toUpperCase() : "";
}

let memoryAssignmentsCache: ExamAssignment[] | null = null;
let hasAssignmentsQuotaFallback = false;

if (typeof Storage !== "undefined" && Storage.prototype && typeof Storage.prototype.clear === "function") {
  try {
    const origClear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      memoryAssignmentsCache = null;
      hasAssignmentsQuotaFallback = false;
      return origClear.apply(this);
    };
  } catch {}
}

/**
 * Get all locally cached assignments.
 */
export function getLocalAssignments(): ExamAssignment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      if (hasAssignmentsQuotaFallback && memoryAssignmentsCache && memoryAssignmentsCache.length > 0) {
        return memoryAssignmentsCache;
      }
      return [];
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    if (hasAssignmentsQuotaFallback && memoryAssignmentsCache && memoryAssignmentsCache.length > 0) {
      return memoryAssignmentsCache;
    }
    return [];
  } catch {
    return memoryAssignmentsCache || [];
  }
}

/**
 * Save to local assignments cache with quota protection.
 */
export function saveLocalAssignments(list: ExamAssignment[]) {
  memoryAssignmentsCache = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    hasAssignmentsQuotaFallback = false;
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 40)));
      hasAssignmentsQuotaFallback = false;
    } catch {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 15)));
        hasAssignmentsQuotaFallback = false;
      } catch {
        hasAssignmentsQuotaFallback = true;
      }
    }
  }
}

/**
 * Retrieve all assignments for a specific exam.
 */
export async function getAssignmentsForExam(examId: string, examObj?: any): Promise<ExamAssignment[]> {
  const results: ExamAssignment[] = [];
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();

  let currentExam = examObj;
  if (!currentExam) {
    try {
      const { data } = await supabase.from("exams").select("*").eq("id", examId).maybeSingle();
      currentExam = data;
    } catch {}
  }

  if (currentExam) {
    const teamCfg = currentExam.team_config || {};
    if (Array.isArray(teamCfg.assignments)) {
      teamCfg.assignments.forEach((a: any) => {
        if (a && a.id && a.code && !seenIds.has(a.id)) {
          const normCode = normalizeExamCode(a.code);
          seenIds.add(a.id);
          seenCodes.add(normCode);
          results.push({
            id: a.id,
            examId: a.examId || examId,
            code: normCode,
            shortCode: a.shortCode ? String(a.shortCode).trim().toUpperCase() : undefined,
            className: a.className || "Chung",
            title: a.title || currentExam.title,
            teacherName: a.teacherName || currentExam.teacher_name,
            schoolName: a.schoolName || currentExam.school_name,
            subjectName: a.subjectName || currentExam.subject_name,
            durationMinutes: a.durationMinutes || currentExam.duration_minutes,
            openAt: a.openAt ?? currentExam.open_at,
            closeAt: a.closeAt ?? currentExam.close_at,
            createdAt: a.createdAt || new Date().toISOString(),
            createdBy: a.createdBy || currentExam.created_by,
          });
        }
      });
    }
  }

  const localList = getLocalAssignments().filter((a) => a.examId === examId);
  localList.forEach((a) => {
    const normCode = normalizeExamCode(a.code);
    if (!seenIds.has(a.id) && !seenCodes.has(normCode)) {
      seenIds.add(a.id);
      seenCodes.add(normCode);
      results.push({ ...a, code: normCode });
    }
  });

  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

/**
 * Synchronize all codes of an exam to Supabase public registry (schools table)
 * and ensure legacy exams without team_config.primary_code get persisted cleanly.
 */
export async function syncExamAssignmentCodes(exam: any): Promise<{
  success: boolean;
  error?: string;
  errorType?: ExamAccessErrorType;
}> {
  if (!exam?.id) return { success: false, error: "Thiếu ID bài thi", errorType: "validation" };
  try {
    const primaryCode = getExamPrimaryCode(exam);
    const legacyCode = getDeterministicPrimaryCode(exam.id, exam.subject_name);
    const payload = {
      id: `primary_${exam.id}`,
      examId: exam.id,
      code: primaryCode,
      shortCode: getExamPrimaryShortCode(exam) || undefined,
      className: "Chung",
      title: exam.title,
      teacherName: exam.teacher_name,
      schoolName: exam.school_name,
      subjectName: exam.subject_name,
      durationMinutes: exam.duration_minutes,
      openAt: exam.open_at,
      closeAt: exam.close_at,
      createdAt: new Date().toISOString(),
    };
    const jsonStr = JSON.stringify(payload);

    const keysToRegister = new Set<string>();
    if (primaryCode) {
      keysToRegister.add(`assign_code:${primaryCode}`);
      const unpadded = primaryCode.replace(/^0+/, "");
      if (unpadded && unpadded !== primaryCode) {
        keysToRegister.add(`assign_code:${unpadded}`);
      }
    }
    if (legacyCode) {
      keysToRegister.add(`assign_code:${legacyCode.toUpperCase()}`);
      keysToRegister.add(`assign_code:${legacyCode.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`);
    }
    keysToRegister.add(`assign_code:${exam.id.toLowerCase()}`);

    const upsertRows = Array.from(keysToRegister)
      .filter(Boolean)
      .map((k) => ({ name_key: k, name: jsonStr }));

    const { error: upErr } = await withSupabaseAuthRetry(async () => {
      return await supabase.from("schools").upsert(upsertRows, { onConflict: "name_key" });
    });

    if (upErr) {
      const classified = classifySupabaseError(upErr);
      logExamAccessEvent({
        examId: exam.id,
        rawCode: primaryCode,
        accessType: "create_sync",
        outcome: "sync_error",
        errorCategory: classified.type,
        errorDetail: `schools_upsert: ${classified.technicalDetail}`,
      });
      return {
        success: false,
        error: upErr.message || classified.message,
        errorType: classified.type,
      };
    }

    // Backfill team_config.primary_code on legacy exams if missing
    const teamCfg = (exam.team_config as any) || {};
    if (isUuid(exam.id) && !teamCfg.primary_code && primaryCode) {
      try {
        await withSupabaseAuthRetry(async () => {
          return await supabase
            .from("exams")
            .update({ team_config: { ...teamCfg, primary_code: primaryCode } as any } as any)
            .eq("id", exam.id);
        });
      } catch {}
    }

    // Also sync team_config assignments if any
    if (Array.isArray(teamCfg.assignments)) {
      const assignRows: { name_key: string; name: string }[] = [];
      for (const a of teamCfg.assignments) {
        if (a && a.code) {
          const aCode = normalizeExamCode(a.code);
          const aPayload = JSON.stringify({
            ...a,
            code: aCode,
            examId: a.examId || exam.id,
            title: a.title || exam.title,
          });
          assignRows.push({ name_key: `assign_code:${aCode}`, name: aPayload });
          const unpadded = aCode.replace(/^0+/, "");
          if (unpadded && unpadded !== aCode) {
            assignRows.push({ name_key: `assign_code:${unpadded}`, name: aPayload });
          }
        }
      }
      if (assignRows.length > 0) {
        const { error: assignErr } = await withSupabaseAuthRetry(async () => {
          return await supabase.from("schools").upsert(assignRows, { onConflict: "name_key" });
        });
        if (assignErr) {
          const classified = classifySupabaseError(assignErr);
          logExamAccessEvent({
            examId: exam.id,
            rawCode: primaryCode,
            accessType: "create_sync",
            outcome: "sync_error",
            errorCategory: classified.type,
            errorDetail: `assignments_upsert: ${classified.technicalDetail}`,
          });
          return {
            success: false,
            error: assignErr.message || classified.message,
            errorType: classified.type,
          };
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    const classified = classifySupabaseError(err);
    logExamAccessEvent({
      examId: exam?.id,
      rawCode: getExamPrimaryCode(exam),
      accessType: "create_sync",
      outcome: "sync_error",
      errorCategory: classified.type,
      errorDetail: classified.technicalDetail,
    });
    return { success: false, error: err?.message || classified.message, errorType: classified.type };
  }
}

/**
 * Create a new assignment (lượt giao bài) for an exam.
 * Verifies persistence in Supabase before returning success to teacher.
 */
export async function createAssignment(params: {
  exam: any;
  className?: string;
  customCode?: string;
}): Promise<ExamAssignment> {
  const { exam, className = "Chung" } = params;
  const rawCustom = (params.customCode || "").trim().toUpperCase();
  let code = rawCustom;

  if (code) {
    const normalizedCustom = normalizeExamCode(code);
    const taken = await isExamCodeTaken(normalizedCustom);
    if (taken) {
      throw new Error(`Mã bài thi "${normalizedCustom}" đã được sử dụng. Vui lòng chọn mã khác.`);
    }
    code = normalizedCustom;
  } else {
    code = await generateUniqueNumericExamCode();
  }

  const normalizedCode = normalizeExamCode(code);

  const newAssignment: ExamAssignment = {
    id: `assign_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    examId: exam.id,
    code: normalizedCode,
    className: className.trim() || "Chung",
    title: exam.title,
    teacherName: exam.teacher_name,
    schoolName: exam.school_name,
    subjectName: exam.subject_name,
    durationMinutes: exam.duration_minutes,
    openAt: exam.open_at,
    closeAt: exam.close_at,
    createdAt: new Date().toISOString(),
    createdBy: exam.created_by,
  };

  let persistedExamUpdate = false;
  let persistedSchoolsUpsert = false;
  let lastDbError: any = null;

  // 1. Persist to Supabase in exams.team_config.assignments
  try {
    const { data: latestExam } = await supabase.from("exams").select("team_config").eq("id", exam.id).maybeSingle();
    const existingTeamCfg = (latestExam?.team_config as any) || exam.team_config || {};
    const existingAssignments = Array.isArray(existingTeamCfg.assignments) ? existingTeamCfg.assignments : [];

    const updatedAssignments = [newAssignment, ...existingAssignments.filter((a: any) => a.id !== newAssignment.id)];
    const updatedTeamConfig = {
      ...existingTeamCfg,
      assignments: updatedAssignments,
    };

    const { error: exUpdErr } = await withSupabaseAuthRetry(async () => {
      return await supabase
        .from("exams")
        .update({ team_config: updatedTeamConfig as any } as any)
        .eq("id", exam.id);
    });

    if (exUpdErr) {
      lastDbError = exUpdErr;
    } else {
      persistedExamUpdate = true;
    }
  } catch (e) {
    lastDbError = e;
  }

  // 2. Persist to schools table as a globally accessible mapping across devices
  try {
    const assignRows = [
      {
        name_key: `assign_code:${normalizedCode}`,
        name: JSON.stringify(newAssignment),
      },
    ];
    const unpadded = normalizedCode.replace(/^0+/, "");
    if (unpadded && unpadded !== normalizedCode) {
      assignRows.push({
        name_key: `assign_code:${unpadded}`,
        name: JSON.stringify(newAssignment),
      });
    }

    const { error: schErr } = await withSupabaseAuthRetry(async () => {
      return await supabase.from("schools").upsert(assignRows, { onConflict: "name_key" });
    });
    if (schErr) {
      lastDbError = schErr;
    } else {
      persistedSchoolsUpsert = true;
    }
  } catch (e) {
    lastDbError = e;
  }

  // Never show/return an unsaved assignment code if remote persistence completely failed on a real UUID exam
  if (isUuid(exam.id) && !persistedExamUpdate && !persistedSchoolsUpsert) {
    const classified = classifySupabaseError(lastDbError);
    logExamAccessEvent({
      examId: exam.id,
      rawCode: normalizedCode,
      accessType: "create_sync",
      outcome: "sync_error",
      errorCategory: classified.type,
      errorDetail: `createAssignment_failed: ${classified.technicalDetail}`,
    });
    throw new Error(
      "Không thể lưu mã bài thi lên máy chủ. Vui lòng kiểm tra kết nối mạng hoặc đăng nhập lại rồi thử lại."
    );
  }

  // 3. Persist local cache only after remote confirmation
  const currentLocal = getLocalAssignments();
  saveLocalAssignments([newAssignment, ...currentLocal.filter((a) => a.id !== newAssignment.id)]);

  // 4. Sync primary code + automatically generate & persist unique short link
  await syncExamAssignmentCodes(exam);

  const { ensureExamShortLink } = await import("./shortLinks");
  const shortRes = await ensureExamShortLink({ exam, assignment: newAssignment });
  if (shortRes?.shortCode) {
    newAssignment.shortCode = shortRes.shortCode;
    const updatedLocal = getLocalAssignments().map((a) =>
      a.id === newAssignment.id ? { ...a, shortCode: shortRes.shortCode } : a
    );
    saveLocalAssignments(updatedLocal);
  }

  return newAssignment;
}

/**
 * Delete an assignment.
 */
export async function deleteAssignment(examId: string, assignmentId: string): Promise<boolean> {
  try {
    const existingLocal = getLocalAssignments().find((a) => a.id === assignmentId);
    const currentLocal = getLocalAssignments().filter((a) => a.id !== assignmentId);
    saveLocalAssignments(currentLocal);

    let deletedCode = existingLocal?.code;

    const { data: latestExam } = await supabase.from("exams").select("team_config").eq("id", examId).maybeSingle();
    if (latestExam) {
      const existingTeamCfg = (latestExam.team_config as any) || {};
      const existingAssignments = Array.isArray(existingTeamCfg.assignments) ? existingTeamCfg.assignments : [];
      const matchedAssign = existingAssignments.find((a: any) => a.id === assignmentId);
      if (matchedAssign?.code) deletedCode = matchedAssign.code;
      const updatedAssignments = existingAssignments.filter((a: any) => a.id !== assignmentId);

      await withSupabaseAuthRetry(async () => {
        return await supabase
          .from("exams")
          .update({
            team_config: { ...existingTeamCfg, assignments: updatedAssignments } as any,
          } as any)
          .eq("id", examId);
      });
    }

    if (deletedCode) {
      const normDel = normalizeExamCode(deletedCode);
      try {
        await withSupabaseAuthRetry(async () => {
          return await supabase.from("schools").delete().eq("name_key", `assign_code:${normDel}`);
        });
      } catch {}
    }

    try {
      const { deactivateAssignmentShortLink } = await import("./shortLinks");
      await deactivateAssignmentShortLink(examId, assignmentId, deletedCode);
    } catch {}

    return true;
  } catch (e) {
    console.error("Failed to delete assignment from Supabase:", e);
    return false;
  }
}

function buildExamStatusError(examData: any): { errorType?: ExamAccessErrorType; message?: string } {
  if (!examData) return {};
  if (examData.manual_closed === true || examData.status === "closed") {
    return { errorType: "closed", message: "Bài thi đã đóng, bạn không thể tham gia." };
  }
  if (examData.close_at && new Date() > new Date(examData.close_at)) {
    return { errorType: "expired", message: "Bài thi đã hết thời gian làm bài." };
  }
  if (examData.status === "not_open" || (examData.open_at && new Date() < new Date(examData.open_at))) {
    return { errorType: "not_open", message: "Bài thi chưa đến thời gian mở làm bài." };
  }
  return {};
}

/**
 * Look up an exam or assignment by Code, URL or QR Content.
 * Distinguishes network/server errors cleanly from invalid/missing codes.
 */
export async function findAssignmentOrExamByCode(inputRaw: string): Promise<ExamLookupResult> {
  const raw = (inputRaw || "").trim();
  if (!raw) {
    return {
      success: false,
      errorType: "validation",
      error: "Vui lòng nhập mã bài thi hoặc quét mã QR",
    };
  }

  let targetExamId: string | null = null;
  let extractedCode = "";
  let targetClass = "";
  let hadRemoteError: {
    type: "network" | "server" | "unauthorized";
    message: string;
    detail: string;
  } | null = null;

  const recordRemoteErr = (err: any) => {
    if (!err || isRpcNotFoundError(err)) return;
    const c = classifySupabaseError(err);
    if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
      if (!hadRemoteError || c.type === "network") {
        hadRemoteError = { type: c.type, message: c.message, detail: c.technicalDetail };
      }
    }
  };

  // 0. Short link URL (/e/<SHORT_CODE>)
  const shortLinkMatch = raw.match(/\/e\/([^/?#\s]+)/i);
  if (shortLinkMatch?.[1]) {
    let seg = shortLinkMatch[1];
    try {
      seg = decodeURIComponent(seg);
    } catch {}
    const { resolveShortLink } = await import("./shortLinks");
    const shortRes = await resolveShortLink(seg);
    if (shortRes.success && shortRes.exam) {
      return {
        success: true,
        exam: shortRes.exam,
        assignment: shortRes.assignment,
      };
    }
    return {
      success: false,
      errorType: shortRes.errorType || "not_found",
      error: shortRes.error || "Link bài thi không hợp lệ hoặc không tồn tại.",
    };
  }

  // 1. Check URL paths like /take/TOKEN or /exam/TOKEN
  const pathMatch = raw.match(/\/(?:take|exam)\/([^/?#\s]+)/i);
  if (pathMatch) {
    let segment = pathMatch[1];
    try {
      segment = decodeURIComponent(segment).trim();
    } catch {
      segment = segment.trim();
    }
    if (isUuid(segment)) {
      targetExamId = segment;
    } else {
      extractedCode = segment;
    }
  }

  const codeInUrlMatch = raw.match(/[?&](?:code|join)=([^&#\s]+)/i);
  const classInUrlMatch = raw.match(/[?&]targetClass=([^&#\s]+)/i);

  if (codeInUrlMatch) {
    try {
      extractedCode = decodeURIComponent(codeInUrlMatch[1]).trim().toUpperCase();
    } catch {
      extractedCode = codeInUrlMatch[1].trim().toUpperCase();
    }
  }
  if (classInUrlMatch) {
    try {
      targetClass = decodeURIComponent(classInUrlMatch[1]).trim();
    } catch {
      targetClass = classInUrlMatch[1].trim();
    }
  }

  if (!targetExamId && isUuid(raw)) {
    targetExamId = raw;
  }

  // 1.5. Check sample exams by UUID
  if (targetExamId) {
    const sampleById = findSampleExam(targetExamId) || getSampleExamById(targetExamId);
    if (sampleById) {
      return {
        success: true,
        exam: sampleById,
        assignment: {
          id: `sample_${sampleById.id}`,
          examId: sampleById.id,
          code: sampleById.code,
          className: targetClass || sampleById.className,
          title: sampleById.title,
          teacherName: sampleById.teacher_name,
          schoolName: sampleById.school_name,
          subjectName: sampleById.subject_name,
          durationMinutes: sampleById.duration_minutes,
          openAt: sampleById.open_at,
          closeAt: sampleById.close_at,
          createdAt: new Date().toISOString(),
        },
      };
    }
  }

  // 1.6. Direct UUID fetch via SECURITY DEFINER RPC
  if (targetExamId && isUuid(targetExamId)) {
    try {
      const { data: exData, error: rpcErr } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: targetExamId,
      });

      if (!rpcErr && exData) {
        const localList = getLocalAssignments();
        const localFound = localList.find(
          (a) =>
            a.examId === targetExamId &&
            (!extractedCode || normalizeExamCode(a.code) === normalizeExamCode(extractedCode))
        );

        return {
          success: true,
          exam: exData,
          assignment: localFound || {
            id: `assign_${targetExamId}`,
            examId: targetExamId,
            code: extractedCode ? normalizeExamCode(extractedCode) : getExamPrimaryCode(exData),
            className: targetClass || "Chung",
            title: (exData as any).title,
            teacherName: (exData as any).teacher_name,
            schoolName: (exData as any).school_name,
            subjectName: (exData as any).subject_name,
            durationMinutes: (exData as any).duration_minutes,
            openAt: (exData as any).open_at,
            closeAt: (exData as any).close_at,
            createdAt: new Date().toISOString(),
          },
        };
      }

      if (rpcErr) {
        recordRemoteErr(rpcErr);
        const c = classifySupabaseError(rpcErr);
        if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
          logExamAccessEvent({
            examId: targetExamId,
            rawCode: extractedCode || targetExamId,
            accessType: "url_uuid",
            outcome: c.type === "network" ? "network_error" : c.type === "unauthorized" ? "unauthorized" : "server_error",
            errorCategory: c.type,
            errorDetail: c.technicalDetail,
          });
          return {
            success: false,
            errorType: c.type,
            error: c.message,
          };
        }
      }
    } catch (e) {
      recordRemoteErr(e);
    }
  }

  const lookupRaw = (extractedCode || raw).trim();
  const lookupCode = lookupRaw.toUpperCase();
  const cleanCode = lookupCode.replace(/[^A-Z0-9]/g, "");
  const normalizedNumCode = normalizeExamCode(cleanCode);
  const unpaddedNumCode = cleanCode.replace(/^0+/, "");

  const candidateCodes = Array.from(
    new Set([lookupCode, cleanCode, normalizedNumCode, unpaddedNumCode].filter(Boolean))
  );

  // 2. Check built-in sample exams
  for (const c of candidateCodes) {
    const sample = findSampleExam(c);
    if (sample) {
      return {
        success: true,
        exam: sample,
        assignment: {
          id: `sample_${sample.id}`,
          examId: sample.id,
          code: sample.code,
          className: targetClass || sample.className,
          title: sample.title,
          teacherName: sample.teacher_name,
          schoolName: sample.school_name,
          subjectName: sample.subject_name,
          durationMinutes: sample.duration_minutes,
          openAt: sample.open_at,
          closeAt: sample.close_at,
          createdAt: new Date().toISOString(),
        },
      };
    }
  }

  // 3. Authoritative server RPC lookup `resolve_exam_access_code`
  // Covers exam_short_links, schools, AND exams.team_config (even for older/unsynced exams)
  try {
    const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc("resolve_exam_access_code", {
      p_code: lookupCode,
    });
    if (rpcErr) {
      recordRemoteErr(rpcErr);
    } else if (rpcRes && (rpcRes as any).found && isUuid((rpcRes as any).exam_id)) {
      const r = rpcRes as any;
      const { data: exData, error: exErr } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: r.exam_id,
      });

      if (!exErr && exData) {
        const assignmentObj: ExamAssignment = {
          id: r.assignment_id || `assign_${r.exam_id}`,
          examId: r.exam_id,
          code: r.assignment_code ? normalizeExamCode(r.assignment_code) : normalizedNumCode || lookupCode,
          shortCode: r.short_code ? String(r.short_code).toUpperCase() : undefined,
          className: targetClass || r.class_name || "Chung",
          title: (exData as any).title,
          teacherName: (exData as any).teacher_name,
          schoolName: (exData as any).school_name,
          subjectName: (exData as any).subject_name,
          durationMinutes: (exData as any).duration_minutes,
          openAt: (exData as any).open_at,
          closeAt: (exData as any).close_at,
          createdAt: new Date().toISOString(),
        };

        const localList = getLocalAssignments();
        saveLocalAssignments([assignmentObj, ...localList.filter((a) => a.id !== assignmentObj.id)]);

        const statusErr = buildExamStatusError(exData);
        if (statusErr.errorType) {
          logExamAccessEvent({
            examId: r.exam_id,
            rawCode: lookupCode,
            accessType: "code",
            outcome: statusErr.errorType as any,
            errorCategory: statusErr.errorType,
            errorDetail: `rpc_status_${statusErr.errorType}`,
          });
        }

        return {
          success: true,
          exam: exData,
          assignment: assignmentObj,
        };
      }

      if (exErr) {
        const c = classifySupabaseError(exErr);
        recordRemoteErr(exErr);
        if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
          logExamAccessEvent({
            examId: r.exam_id,
            rawCode: lookupCode,
            accessType: "code",
            outcome: c.type === "network" ? "network_error" : c.type === "unauthorized" ? "unauthorized" : "server_error",
            errorCategory: c.type,
            errorDetail: c.technicalDetail,
          });
          return {
            success: false,
            errorType: c.type,
            error: c.message,
          };
        }
      }
    }
  } catch (e) {
    recordRemoteErr(e);
  }

  // 4. Cross-device lookup via public `schools` registry table
  const localList = getLocalAssignments();
  try {
    const keysToTry: string[] = [];
    for (const c of candidateCodes) {
      keysToTry.push(`assign_code:${c}`);
      keysToTry.push(`assign_code:${c.toLowerCase()}`);
    }

    let rowData: string | null = null;
    const { data: exactRows, error: exactErr } = await supabase
      .from("schools")
      .select("name_key, name")
      .in("name_key", Array.from(new Set(keysToTry)));

    if (exactErr) {
      recordRemoteErr(exactErr);
    } else if (exactRows && exactRows.length > 0) {
      rowData = exactRows[0]?.name || null;
    }

    // Bounded fallback for punctuation-stripped keys
    if (!rowData && !exactErr) {
      const { data: rows, error: likeErr } = await supabase
        .from("schools")
        .select("name_key, name")
        .like("name_key", "assign_code:%")
        .limit(1000);

      if (likeErr) {
        recordRemoteErr(likeErr);
      } else if (rows && rows.length > 0) {
        for (const r of rows) {
          const rawKey = r.name_key.replace(/^assign_code:/i, "").trim().toUpperCase();
          const cleanKey = rawKey.replace(/[^A-Z0-9]/g, "");
          const normKey = normalizeExamCode(cleanKey);
          const unpadKey = cleanKey.replace(/^0+/, "");
          if (
            candidateCodes.includes(rawKey) ||
            candidateCodes.includes(cleanKey) ||
            candidateCodes.includes(normKey) ||
            (unpadKey && candidateCodes.includes(unpadKey))
          ) {
            rowData = r.name;
            break;
          }
        }
      }
    }

    if (rowData) {
      const parsed = JSON.parse(rowData);
      if (parsed?.examId && isUuid(parsed.examId)) {
        const sampleById = findSampleExam(parsed.examId);
        if (sampleById) {
          return {
            success: true,
            exam: sampleById,
            assignment: {
              id: parsed.id || `sample_${sampleById.id}`,
              examId: sampleById.id,
              code: parsed.code || sampleById.code,
              className: targetClass || parsed.className || sampleById.className,
              title: parsed.title || sampleById.title,
              teacherName: parsed.teacherName || sampleById.teacher_name,
              schoolName: parsed.schoolName || sampleById.school_name,
              subjectName: parsed.subjectName || sampleById.subject_name,
              durationMinutes: parsed.durationMinutes || sampleById.duration_minutes,
              openAt: parsed.openAt ?? sampleById.open_at,
              closeAt: parsed.closeAt ?? sampleById.close_at,
              createdAt: parsed.createdAt || new Date().toISOString(),
            },
          };
        }

        const { data: exData, error: rpcErr } = await supabase.rpc("get_exam_for_student", {
          p_exam_id: parsed.examId,
        });

        if (exData && !rpcErr) {
          const rawExam = (typeof exData === "object" && exData !== null ? exData : {}) as Record<string, any>;
          const examObj = {
            ...rawExam,
            teacher_name: parsed.teacherName || rawExam.teacher_name,
            school_name: parsed.schoolName || rawExam.school_name,
            subject_name: parsed.subjectName || rawExam.subject_name,
          };

          const assignmentObj: ExamAssignment = {
            id: parsed.id || `assign_${parsed.examId}`,
            examId: parsed.examId,
            code: parsed.code ? normalizeExamCode(parsed.code) : normalizedNumCode || lookupCode,
            shortCode: parsed.shortCode ? String(parsed.shortCode).toUpperCase() : undefined,
            className: targetClass || parsed.className || "Chung",
            title: parsed.title || (examObj as any).title,
            teacherName: parsed.teacherName || (examObj as any).teacher_name,
            schoolName: parsed.schoolName || (examObj as any).school_name,
            subjectName: parsed.subjectName || (examObj as any).subject_name,
            durationMinutes: parsed.durationMinutes || (examObj as any).duration_minutes,
            openAt: parsed.openAt ?? (examObj as any).open_at,
            closeAt: parsed.closeAt ?? (examObj as any).close_at,
            createdAt: parsed.createdAt || new Date().toISOString(),
          };

          saveLocalAssignments([assignmentObj, ...localList.filter((a) => a.id !== assignmentObj.id)]);

          return {
            success: true,
            exam: examObj,
            assignment: assignmentObj,
          };
        }

        if (rpcErr) {
          recordRemoteErr(rpcErr);
          const c = classifySupabaseError(rpcErr);
          if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
            logExamAccessEvent({
              examId: parsed.examId,
              rawCode: lookupCode,
              accessType: "code",
              outcome: c.type === "network" ? "network_error" : c.type === "unauthorized" ? "unauthorized" : "server_error",
              errorCategory: c.type,
              errorDetail: c.technicalDetail,
            });
            return {
              success: false,
              errorType: c.type,
              error: c.message,
            };
          }
        }
      }
    }
  } catch (e) {
    recordRemoteErr(e);
  }

  // 5. If current session is an authenticated teacher or admin, fallback to exams table
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (sess?.session) {
      const { data: exams, error: exQueryErr } = await supabase
        .from("exams")
        .select(
          "id, title, duration_minutes, teacher_name, school_name, subject_name, open_at, close_at, manual_closed, display_mode, team_config, created_at, created_by"
        )
        .order("created_at", { ascending: false });

      if (exQueryErr) {
        recordRemoteErr(exQueryErr);
      } else if (exams && exams.length > 0) {
        for (const ex of exams) {
          const teamCfg = (ex.team_config as any) || {};
          if (Array.isArray(teamCfg.assignments)) {
            const matched = teamCfg.assignments.find((a: any) => {
              if (!a?.code) return false;
              const aNorm = normalizeExamCode(a.code);
              const aClean = String(a.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
              const aUnpadded = aClean.replace(/^0+/, "");
              return (
                candidateCodes.includes(aNorm) ||
                candidateCodes.includes(aClean) ||
                (aUnpadded && candidateCodes.includes(aUnpadded))
              );
            });
            if (matched) {
              const { data: fullExam, error: fullErr } = await supabase.rpc("get_exam_for_student", {
                p_exam_id: ex.id,
              });
              if (fullErr) recordRemoteErr(fullErr);
              return {
                success: true,
                exam: fullExam || ex,
                assignment: {
                  id: matched.id,
                  examId: ex.id,
                  code: normalizeExamCode(matched.code),
                  shortCode: matched.shortCode ? String(matched.shortCode).toUpperCase() : undefined,
                  className: targetClass || matched.className || "Chung",
                  title: matched.title || ex.title,
                  teacherName: matched.teacherName || ex.teacher_name,
                  schoolName: matched.schoolName || ex.school_name,
                  subjectName: matched.subjectName || ex.subject_name,
                  durationMinutes: matched.durationMinutes || ex.duration_minutes,
                  openAt: matched.openAt ?? ex.open_at,
                  closeAt: matched.closeAt ?? ex.close_at,
                  createdAt: matched.createdAt || ex.created_at,
                },
              };
            }
          }

          const primaryCode = teamCfg.primary_code
            ? normalizeExamCode(teamCfg.primary_code)
            : getDeterministicNumericExamCode(ex.id);
          const legacyCode = getDeterministicPrimaryCode(ex.id, ex.subject_name).toUpperCase();

          if (
            candidateCodes.includes(primaryCode) ||
            candidateCodes.includes(primaryCode.replace(/^0+/, "")) ||
            candidateCodes.includes(legacyCode) ||
            candidateCodes.includes(legacyCode.replace(/[^A-Z0-9]/g, ""))
          ) {
            const { data: fullExam, error: fullErr } = await supabase.rpc("get_exam_for_student", { p_exam_id: ex.id });
            if (fullErr) recordRemoteErr(fullErr);
            return { success: true, exam: fullExam || ex };
          }
        }
      }
    }
  } catch (e) {
    recordRemoteErr(e);
  }

  // 6. Check local assignments cache (verified against remote DB cleanly!)
  const localFound = localList.find((a) => {
    if (!a?.code) return false;
    const aNorm = normalizeExamCode(a.code);
    const aClean = String(a.code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const aUnpadded = aClean.replace(/^0+/, "");
    return (
      candidateCodes.includes(aNorm) ||
      candidateCodes.includes(aClean) ||
      (aUnpadded && candidateCodes.includes(aUnpadded))
    );
  });

  if (localFound) {
    const sampleMatch = findSampleExam(localFound.code) || findSampleExam(localFound.examId);
    if (sampleMatch) {
      return {
        success: true,
        exam: sampleMatch,
        assignment: localFound,
      };
    }

    if (isUuid(localFound.examId)) {
      try {
        const { data: exData, error: rpcErr } = await supabase.rpc("get_exam_for_student", {
          p_exam_id: localFound.examId,
        });

        if (!rpcErr && exData) {
          return {
            success: true,
            exam: exData,
            assignment: localFound,
          };
        }

        if (rpcErr) {
          const c = classifySupabaseError(rpcErr);
          if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
            logExamAccessEvent({
              examId: localFound.examId,
              rawCode: lookupCode,
              accessType: "code",
              outcome: c.type === "network" ? "network_error" : c.type === "unauthorized" ? "unauthorized" : "server_error",
              errorCategory: c.type,
              errorDetail: c.technicalDetail,
            });
            return {
              success: false,
              errorType: c.type,
              error: c.message,
            };
          }
        }
      } catch (e) {
        const c = classifySupabaseError(e);
        if (c.type === "network" || c.type === "server") {
          logExamAccessEvent({
            examId: localFound.examId,
            rawCode: lookupCode,
            accessType: "code",
            outcome: c.type === "network" ? "network_error" : "server_error",
            errorCategory: c.type,
            errorDetail: c.technicalDetail,
          });
          return {
            success: false,
            errorType: c.type,
            error: c.message,
          };
        }
      }
    }

    // Check unified local exam store for full offline questions if available
    const localStored = getLocalStoredExams().find((e) => e.id === localFound.examId);
    if (localStored) {
      return {
        success: true,
        exam: localStored,
        assignment: localFound,
      };
    }

    // If a remote network/server error already occurred earlier, do NOT hide it with an empty local shell
    if (hadRemoteError) {
      return {
        success: false,
        errorType: hadRemoteError.type,
        error: hadRemoteError.message,
      };
    }

    return {
      success: true,
      exam: {
        id: localFound.examId,
        title: localFound.title || "Bài thi",
        duration_minutes: localFound.durationMinutes || 45,
        teacher_name: localFound.teacherName,
        school_name: localFound.schoolName,
        subject_name: localFound.subjectName,
        open_at: localFound.openAt,
        close_at: localFound.closeAt,
        questions: [],
      },
      assignment: localFound,
    };
  }

  // 7. Fallback: check if the entered token is a Short Link code (e.g. "A8K29X")
  try {
    const { resolveShortLink, isValidShortCodeFormat } = await import("./shortLinks");
    if (isValidShortCodeFormat(lookupCode)) {
      const shortRes = await resolveShortLink(lookupCode);
      if (shortRes.success && shortRes.exam) {
        return {
          success: true,
          exam: shortRes.exam,
          assignment: shortRes.assignment,
        };
      }
      if (
        shortRes.errorType === "network" ||
        shortRes.errorType === "server" ||
        shortRes.errorType === "unauthorized"
      ) {
        hadRemoteError = {
          type: shortRes.errorType,
          message: shortRes.error || "Không thể kết nối máy chủ.",
          detail: shortRes.error || "short_link_remote_error",
        };
      }
    }
  } catch (e) {
    recordRemoteErr(e);
  }

  // 8. Surface explicit remote/network errors rather than falsely claiming "code doesn't exist"
  if (hadRemoteError) {
    logExamAccessEvent({
      rawCode: lookupCode,
      accessType: "code",
      outcome:
        hadRemoteError.type === "network"
          ? "network_error"
          : hadRemoteError.type === "unauthorized"
            ? "unauthorized"
            : "server_error",
      errorCategory: hadRemoteError.type,
      errorDetail: hadRemoteError.detail,
    });
    return {
      success: false,
      errorType: hadRemoteError.type,
      error: hadRemoteError.message,
    };
  }

  logExamAccessEvent({
    rawCode: lookupCode,
    accessType: "code",
    outcome: "not_found",
    errorCategory: "not_found",
    errorDetail: "code_not_found_in_any_registry",
  });

  return {
    success: false,
    errorType: "not_found",
    error: "Mã bài thi không hợp lệ hoặc không tồn tại.",
  };
}
