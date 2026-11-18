import { supabase } from "@/integrations/supabase/client";
import { findSampleExam, getSampleExamById } from "@/lib/sampleExams";
import { withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";
import {
  ExamAssignment,
  getExamPrimaryCode,
  getExamPublicOrigin,
  getLocalAssignments,
  isUuid,
  normalizeExamCode,
  syncSchoolsRegistryEntries,
} from "@/lib/examAssignments";
import {
  ExamAccessErrorType,
  classifySupabaseError,
  isRpcNotFoundError,
  logExamAccessEvent,
} from "@/lib/examAccessLogger";

/**
 * Unambiguous uppercase alphanumeric character set (31 chars):
 * Excludes easily confused characters: 0, O, 1, I, L
 */
export const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const DEFAULT_SHORT_CODE_LENGTH = 6;
const SHORT_LINKS_STORAGE_KEY = "qc_exam_short_links_v1";

export interface ExamShortLink {
  shortCode: string;
  examId: string;
  targetPath: string;
  assignmentId?: string;
  assignmentCode?: string;
  className?: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface ShortLinkResolveResult {
  success: boolean;
  error?: string;
  errorType?: ExamAccessErrorType;
  shortLink?: ExamShortLink;
  exam?: any;
  assignment?: ExamAssignment;
  targetUrl?: string;
}

let memoryShortLinksCache: ExamShortLink[] | null = null;
let hasShortLinksQuotaFallback = false;
const inFlightEnsureMap = new Map<string, Promise<ExamShortLink>>();

if (typeof Storage !== "undefined" && Storage.prototype && typeof Storage.prototype.clear === "function") {
  try {
    const origClear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      memoryShortLinksCache = null;
      hasShortLinksQuotaFallback = false;
      return origClear.apply(this);
    };
  } catch {}
}

/**
 * Normalizes a short code, /e/<CODE>, or /<6-DIGIT-CODE> path/URL into an uppercase code token.
 */
export function normalizeShortCode(raw?: string | null): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.trim();
  const pathMatch = s.match(/\/e\/([^/?#\s]+)/i);
  if (pathMatch?.[1]) {
    try {
      s = decodeURIComponent(pathMatch[1]);
    } catch {
      s = pathMatch[1];
    }
  } else {
    const rootNumericMatch = s.match(/^(?:https?:\/\/[^/?#]+)?\/(\d{6})(?:[/?#]|$)/i);
    if (rootNumericMatch?.[1]) {
      s = rootNumericMatch[1];
    }
  }
  return s.trim().toUpperCase();
}

export function isValidShortCodeFormat(code?: string | null): boolean {
  const norm = normalizeShortCode(code);
  return /^[A-Z0-9]{4,16}$/.test(norm);
}

/**
 * Generates a random short code from the unambiguous alphabet (no 0/O, 1/I/L).
 * Guarantees at least one alphabetic letter so new short codes never look identical
 * to 6-digit numeric exam access codes.
 */
export function generateShortCode(length = DEFAULT_SHORT_CODE_LENGTH): string {
  const safeLen = Math.max(5, Math.min(8, Math.floor(length)));
  const chars = SHORT_CODE_ALPHABET;
  const letterChars = "ABCDEFGHJKMNPQRSTUVWXYZ";

  const drawFrom = (alphabet: string, count: number): string => {
    let out = "";
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = new Uint32Array(count);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < count; i++) {
        out += alphabet[bytes[i] % alphabet.length];
      }
      return out;
    }
    for (let i = 0; i < count; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  };

  let result = drawFrom(chars, safeLen);
  if (!/[A-Z]/.test(result)) {
    const replacement = drawFrom(letterChars, 1);
    const pos = Math.floor(Math.random() * safeLen);
    result = result.slice(0, pos) + replacement + result.slice(pos + 1);
  }
  return result;
}

/**
 * Builds the canonical short URL on the current app domain:
 * - https://<origin>/<6-DIGIT-CODE> for 6-digit exam codes
 * - https://<origin>/e/<SHORT_CODE> for legacy alphanumeric short codes
 */
export function getShortExamUrl(shortCode: string): string {
  const norm = normalizeShortCode(shortCode);
  const origin = getExamPublicOrigin();
  const path = /^\d{6}$/.test(norm) ? `/${norm}` : `/e/${norm}`;
  return origin ? `${origin}${path}` : path;
}

export function buildExamTargetPath(params: {
  examId: string;
  code?: string;
  className?: string;
  displayMode?: string;
}): string {
  const { examId, code, className, displayMode } = params;
  const cleanCode = code ? normalizeExamCode(code) : "";
  if (displayMode === "team") {
    return `/team/${examId}`;
  }
  const search = new URLSearchParams();
  if (cleanCode) search.set("code", cleanCode);
  if (className && className.trim() && className.trim() !== "Chung") {
    search.set("targetClass", className.trim());
  }
  const qs = search.toString();
  return qs ? `/take/${examId}?${qs}` : `/take/${examId}`;
}

export function getLocalShortLinks(): ExamShortLink[] {
  try {
    const raw = localStorage.getItem(SHORT_LINKS_STORAGE_KEY);
    if (!raw) {
      if (hasShortLinksQuotaFallback && memoryShortLinksCache && memoryShortLinksCache.length > 0) {
        return memoryShortLinksCache;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    if (hasShortLinksQuotaFallback && memoryShortLinksCache && memoryShortLinksCache.length > 0) {
      return memoryShortLinksCache;
    }
    return [];
  } catch {
    return memoryShortLinksCache || [];
  }
}

export function saveLocalShortLinks(list: ExamShortLink[]): void {
  memoryShortLinksCache = list;
  try {
    localStorage.setItem(SHORT_LINKS_STORAGE_KEY, JSON.stringify(list));
    hasShortLinksQuotaFallback = false;
  } catch {
    try {
      localStorage.setItem(SHORT_LINKS_STORAGE_KEY, JSON.stringify(list.slice(0, 60)));
      hasShortLinksQuotaFallback = false;
    } catch {
      try {
        localStorage.setItem(SHORT_LINKS_STORAGE_KEY, JSON.stringify(list.slice(0, 20)));
        hasShortLinksQuotaFallback = false;
      } catch {
        hasShortLinksQuotaFallback = true;
      }
    }
  }
}

function upsertLocalShortLink(record: ExamShortLink): void {
  const existing = getLocalShortLinks().filter((item) => {
    if (normalizeShortCode(item.shortCode) === normalizeShortCode(record.shortCode)) return false;
    if (record.isPrimary && item.examId === record.examId && item.isPrimary) return false;
    if (record.assignmentId && item.examId === record.examId && item.assignmentId === record.assignmentId) {
      return false;
    }
    return true;
  });
  saveLocalShortLinks([record, ...existing]);
}

function findLocalShortLinkForExam(examId: string, assignment?: ExamAssignment | null): ExamShortLink | null {
  const list = getLocalShortLinks();
  if (assignment) {
    const foundAssign = list.find(
      (item) =>
        item.isActive !== false &&
        item.examId === examId &&
        ((assignment.id && item.assignmentId === assignment.id) ||
          (assignment.code &&
            item.assignmentCode &&
            normalizeExamCode(item.assignmentCode) === normalizeExamCode(assignment.code)))
    );
    if (foundAssign) return foundAssign;
    return null;
  }
  return list.find((item) => item.isActive !== false && item.examId === examId && item.isPrimary) || null;
}

/**
 * Checks whether a short code is already used across local cache, sample exams,
 * SECURITY DEFINER RPC, exam_short_links table, or schools registry.
 */
export async function isShortCodeTaken(candidateCode: string): Promise<boolean> {
  const norm = normalizeShortCode(candidateCode);
  if (!norm) return true;

  if (findSampleExam(norm)) return true;

  const localLinks = getLocalShortLinks();
  if (localLinks.some((l) => normalizeShortCode(l.shortCode) === norm)) return true;

  const localAssigns = getLocalAssignments();
  if (
    localAssigns.some(
      (a) =>
        (a.shortCode && normalizeShortCode(a.shortCode) === norm) ||
        normalizeExamCode(a.code) === norm
    )
  ) {
    return true;
  }

  try {
    const { data: rpcTaken, error: rpcErr } = await (supabase as any).rpc("check_exam_code_taken", {
      p_code: norm,
    });
    if (!rpcErr && typeof rpcTaken === "boolean") {
      return rpcTaken;
    }
  } catch {}

  try {
    const { data: slRow, error: slErr } = await (supabase as any)
      .from("exam_short_links")
      .select("id")
      .eq("short_code", norm)
      .maybeSingle();
    if (!slErr && slRow) return true;
  } catch {}

  try {
    const { data: schRows } = await supabase
      .from("schools")
      .select("name_key")
      .in("name_key", [`short_code:${norm}`, `assign_code:${norm}`]);
    if (schRows && schRows.length > 0) return true;
  } catch {}

  return false;
}

export async function generateUniqueShortCode(length = DEFAULT_SHORT_CODE_LENGTH): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = generateShortCode(length);
    const taken = await isShortCodeTaken(candidate);
    if (!taken) return candidate;
  }
  const chars = SHORT_CODE_ALPHABET;
  let ts = Date.now();
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix = chars[ts % chars.length] + suffix;
    ts = Math.floor(ts / chars.length);
  }
  return `E${generateShortCode(1)}${suffix}`;
}

async function fetchExistingActiveShortLink(
  examId: string,
  assignment?: ExamAssignment | null
): Promise<ExamShortLink | null> {
  if (!isUuid(examId)) return null;
  try {
    let query = (supabase as any)
      .from("exam_short_links")
      .select("*")
      .eq("exam_id", examId)
      .eq("is_active", true);

    if (assignment?.id) {
      query = query.eq("assignment_id", assignment.id);
    } else {
      query = query.eq("is_primary", true);
    }

    const { data: dbRow, error: dbErr } = await query.maybeSingle();
    if (!dbErr && dbRow?.short_code) {
      return {
        shortCode: normalizeShortCode(dbRow.short_code),
        examId,
        targetPath: dbRow.target_path || buildExamTargetPath({ examId, code: dbRow.assignment_code }),
        assignmentId: dbRow.assignment_id || assignment?.id,
        assignmentCode: dbRow.assignment_code || assignment?.code,
        className: dbRow.class_name || assignment?.className,
        isPrimary: !!dbRow.is_primary,
        isActive: dbRow.is_active !== false,
        createdAt: dbRow.created_at || new Date().toISOString(),
      };
    }
  } catch {}
  return null;
}

async function persistShortLinkRecord(
  record: ExamShortLink,
  exam?: any,
  assignment?: ExamAssignment | null
): Promise<ExamShortLink> {
  const jsonPayload = JSON.stringify(record);
  const reverseKey = record.isPrimary
    ? `short_exam:${record.examId}`
    : `short_assign:${record.examId}:${normalizeExamCode(record.assignmentCode || record.assignmentId || "")}`;

  let persistedRemote = false;
  let lastError: any = null;

  // 1. Persist to cross-device public registry (`schools` table) using RLS-safe sync
  try {
    const syncRes = await syncSchoolsRegistryEntries({
      examId: record.examId,
      entries: [
        { name_key: `short_code:${record.shortCode}`, name: jsonPayload },
        { name_key: reverseKey, name: jsonPayload },
      ],
      requiredKeys: [`short_code:${record.shortCode}`],
      shortCode: record.shortCode,
    });
    if (syncRes.success) {
      persistedRemote = true;
    } else if (syncRes.error) {
      lastError = new Error(syncRes.error);
    }
  } catch (e) {
    lastError = e;
  }

  // 2. Persist to dedicated `exam_short_links` table
  if (isUuid(record.examId)) {
    try {
      const { error: slErr } = await withSupabaseAuthRetry(async () => {
        return await (supabase as any).from("exam_short_links").insert({
          short_code: record.shortCode,
          exam_id: record.examId,
          assignment_id: record.assignmentId || null,
          assignment_code: record.assignmentCode || null,
          class_name: record.className || null,
          target_path: record.targetPath,
          is_primary: record.isPrimary,
          is_active: true,
          created_by: exam?.created_by || null,
        });
      });

      if (!slErr) {
        persistedRemote = true;
      } else if (String(slErr.code) === "23505") {
        // Check if another concurrent tab already created an active short link for the same exam/assignment
        const concurrent = await fetchExistingActiveShortLink(record.examId, assignment);
        if (concurrent) {
          upsertLocalShortLink(concurrent);
          return concurrent;
        }
        lastError = slErr;
      } else if (!isRpcNotFoundError(slErr)) {
        lastError = slErr;
      }
    } catch (e) {
      lastError = e;
    }
  }

  // 3. Persist on `exams.team_config` so future loads read it directly from exam row
  if (isUuid(record.examId)) {
    try {
      const { data: latestExam } = await supabase
        .from("exams")
        .select("team_config")
        .eq("id", record.examId)
        .maybeSingle();

      const currentCfg = ((latestExam?.team_config as any) || exam?.team_config || {}) as Record<string, any>;
      let nextCfg: Record<string, any> | null = null;

      if (record.isPrimary && !currentCfg.primary_short_code) {
        nextCfg = {
          ...currentCfg,
          primary_short_code: record.shortCode,
        };
      } else if (!record.isPrimary && record.assignmentId && Array.isArray(currentCfg.assignments)) {
        const updatedAssignments = currentCfg.assignments.map((a: any) =>
          a && (a.id === record.assignmentId || normalizeExamCode(a.code) === normalizeExamCode(record.assignmentCode))
            ? { ...a, shortCode: a.shortCode || record.shortCode }
            : a
        );
        nextCfg = {
          ...currentCfg,
          assignments: updatedAssignments,
        };
      }

      if (nextCfg) {
        const { error: exUpdErr } = await withSupabaseAuthRetry(async () => {
          return await supabase
            .from("exams")
            .update({ team_config: nextCfg as any } as any)
            .eq("id", record.examId);
        });
        if (!exUpdErr) {
          persistedRemote = true;
        } else {
          lastError = exUpdErr;
        }
      }
    } catch (e) {
      lastError = e;
    }
  }

  // Only cache locally after confirmed persistence when dealing with real UUID exams
  if (isUuid(record.examId) && !persistedRemote) {
    const classified = classifySupabaseError(lastError);
    logExamAccessEvent({
      examId: record.examId,
      rawCode: record.shortCode,
      accessType: "create_sync",
      outcome: "sync_error",
      errorCategory: classified.type,
      errorDetail: `short_link_persist_failed: ${classified.technicalDetail}`,
    });
    throw new Error("Không thể lưu link ngắn lên hệ thống. Vui lòng thử lại.");
  }

  upsertLocalShortLink(record);
  return record;
}

/**
 * Automatically ensures an exam (or specific class assignment) has a unique persisted short link.
 * Reuses the existing saved short link if already generated; never regenerates on page reopen.
 */
export async function ensureExamShortLink(params: {
  exam: any;
  assignment?: ExamAssignment | null;
  forceNew?: boolean;
}): Promise<ExamShortLink> {
  const { exam, assignment = null, forceNew = false } = params;
  if (!exam?.id) {
    throw new Error("Thiếu thông tin bài thi để tạo link ngắn");
  }

  const assignmentKey = assignment
    ? assignment.id || normalizeExamCode(assignment.code) || "assign"
    : "primary";
  const dedupeKey = `${exam.id}:${assignmentKey}:${forceNew ? "new" : "reuse"}`;

  if (!forceNew && inFlightEnsureMap.has(dedupeKey)) {
    return inFlightEnsureMap.get(dedupeKey)!;
  }

  const run = async (): Promise<ExamShortLink> => {
    const primaryCode = getExamPrimaryCode(exam);
    const effectiveCode = assignment ? normalizeExamCode(assignment.code) : primaryCode;
    const effectiveClass = assignment?.className || "Chung";
    const targetPath = buildExamTargetPath({
      examId: exam.id,
      code: effectiveCode,
      className: effectiveClass,
      displayMode: exam.display_mode,
    });

    if (!forceNew) {
      // 1. Check in-object team_config / assignment field
      const teamCfg = (exam.team_config as any) || {};
      let existingShortCode = "";

      if (assignment) {
        existingShortCode = normalizeShortCode(assignment.shortCode);
        if (!existingShortCode && Array.isArray(teamCfg.assignments)) {
          const match = teamCfg.assignments.find(
            (a: any) =>
              a &&
              ((assignment.id && a.id === assignment.id) ||
                (assignment.code && normalizeExamCode(a.code) === normalizeExamCode(assignment.code)))
          );
          if (match?.shortCode) {
            existingShortCode = normalizeShortCode(match.shortCode);
          }
        }
      } else {
        existingShortCode = normalizeShortCode(teamCfg.primary_short_code || exam.primary_short_code);
      }

      if (existingShortCode && isValidShortCodeFormat(existingShortCode)) {
        const record: ExamShortLink = {
          shortCode: existingShortCode,
          examId: exam.id,
          targetPath,
          assignmentId: assignment?.id,
          assignmentCode: effectiveCode,
          className: effectiveClass,
          isPrimary: !assignment,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
        upsertLocalShortLink(record);
        // Ensure cross-device schools lookup is populated safely without mutating short code or tripping UPDATE RLS
        try {
          const reverseKey = record.isPrimary
            ? `short_exam:${record.examId}`
            : `short_assign:${record.examId}:${normalizeExamCode(effectiveCode)}`;
          await syncSchoolsRegistryEntries({
            examId: record.examId,
            entries: [
              { name_key: `short_code:${record.shortCode}`, name: JSON.stringify(record) },
              { name_key: reverseKey, name: JSON.stringify(record) },
            ],
            requiredKeys: [`short_code:${record.shortCode}`],
            shortCode: record.shortCode,
          });
        } catch {}
        return record;
      }

      // 2. Check local storage cache
      const localFound = findLocalShortLinkForExam(exam.id, assignment);
      if (localFound && isValidShortCodeFormat(localFound.shortCode)) {
        return localFound;
      }

      // 3. Check Supabase `exam_short_links` table
      const dbExisting = await fetchExistingActiveShortLink(exam.id, assignment);
      if (dbExisting) {
        upsertLocalShortLink(dbExisting);
        return dbExisting;
      }

      // 4. Check Supabase `schools` reverse index
      try {
        const reverseKey = assignment
          ? `short_assign:${exam.id}:${normalizeExamCode(effectiveCode)}`
          : `short_exam:${exam.id}`;
        const { data: revRow } = await supabase
          .from("schools")
          .select("name")
          .eq("name_key", reverseKey)
          .maybeSingle();

        if (revRow?.name) {
          const parsed = JSON.parse(revRow.name);
          if (parsed?.shortCode && isValidShortCodeFormat(parsed.shortCode)) {
            const record: ExamShortLink = {
              shortCode: normalizeShortCode(parsed.shortCode),
              examId: exam.id,
              targetPath: parsed.targetPath || targetPath,
              assignmentId: parsed.assignmentId || assignment?.id,
              assignmentCode: parsed.assignmentCode || effectiveCode,
              className: parsed.className || effectiveClass,
              isPrimary: assignment ? false : parsed.isPrimary !== false,
              isActive: parsed.isActive !== false,
              createdAt: parsed.createdAt || new Date().toISOString(),
            };
            upsertLocalShortLink(record);
            return record;
          }
        }
      } catch {}
    }

    // Generate a fresh collision-free short code and persist it
    const shortCode = await generateUniqueShortCode(DEFAULT_SHORT_CODE_LENGTH);
    const created: ExamShortLink = {
      shortCode,
      examId: exam.id,
      targetPath,
      assignmentId: assignment?.id,
      assignmentCode: effectiveCode,
      className: effectiveClass,
      isPrimary: !assignment,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    return await persistShortLinkRecord(created, exam, assignment);
  };

  const promise = run().finally(() => {
    inFlightEnsureMap.delete(dedupeKey);
  });
  if (!forceNew) {
    inFlightEnsureMap.set(dedupeKey, promise);
  }
  return promise;
}

/**
 * Deactivates/removes a short link when a class assignment is deleted.
 */
export async function deactivateAssignmentShortLink(
  examId: string,
  assignmentId: string,
  assignmentCode?: string
): Promise<void> {
  const existing = getLocalShortLinks();
  const matching = existing.filter(
    (item) => item.examId === examId && item.assignmentId === assignmentId
  );
  saveLocalShortLinks(
    existing.filter((item) => !(item.examId === examId && item.assignmentId === assignmentId))
  );

  for (const item of matching) {
    try {
      await withSupabaseAuthRetry(async () => {
        return await supabase.from("schools").delete().eq("name_key", `short_code:${item.shortCode}`);
      });
    } catch {}
  }

  if (assignmentCode) {
    try {
      await withSupabaseAuthRetry(async () => {
        return await supabase
          .from("schools")
          .delete()
          .eq("name_key", `short_assign:${examId}:${normalizeExamCode(assignmentCode)}`);
      });
    } catch {}
  }

  if (isUuid(examId)) {
    try {
      await withSupabaseAuthRetry(async () => {
        return await (supabase as any)
          .from("exam_short_links")
          .update({ is_active: false })
          .eq("exam_id", examId)
          .eq("assignment_id", assignmentId);
      });
    } catch {}
  }
}

/**
 * Resolves a short link (/e/<SHORT_CODE> or raw <SHORT_CODE>) safely without exposing answers
 * or masking network/server errors as missing links.
 */
export async function resolveShortLink(rawInput: string): Promise<ShortLinkResolveResult> {
  const shortCode = normalizeShortCode(rawInput);
  if (!shortCode || !isValidShortCodeFormat(shortCode)) {
    return {
      success: false,
      errorType: "validation",
      error: "Link bài thi không hợp lệ hoặc không đúng định dạng.",
    };
  }

  let mapped: ExamShortLink | null = null;
  let rpcDisplayMode: string | undefined;
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

  // 1. Try Security Definer RPC `resolve_exam_short_link`
  try {
    const { data: rpcRes, error: rpcErr } = await (supabase as any).rpc("resolve_exam_short_link", {
      p_short_code: shortCode,
    });
    if (rpcErr) {
      recordRemoteErr(rpcErr);
    } else if (rpcRes && (rpcRes as any).found) {
      const r = rpcRes as any;
      rpcDisplayMode = r.display_mode;
      mapped = {
        shortCode: normalizeShortCode(r.short_code || shortCode),
        examId: r.exam_id,
        targetPath:
          r.target_path ||
          buildExamTargetPath({
            examId: r.exam_id,
            code: r.assignment_code,
            className: r.class_name,
            displayMode: r.display_mode,
          }),
        assignmentId: r.assignment_id || undefined,
        assignmentCode: r.assignment_code || undefined,
        className: r.class_name || undefined,
        isPrimary: r.is_primary !== false,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    recordRemoteErr(e);
  }

  // 1.5. Fallback to unified `resolve_exam_access_code` RPC if available
  if (!mapped) {
    try {
      const { data: accessRes, error: accessErr } = await (supabase as any).rpc("resolve_exam_access_code", {
        p_code: shortCode,
      });
      if (accessErr) {
        recordRemoteErr(accessErr);
      } else if (accessRes && (accessRes as any).found && isUuid((accessRes as any).exam_id)) {
        const r = accessRes as any;
        rpcDisplayMode = r.display_mode;
        mapped = {
          shortCode: normalizeShortCode(r.short_code || shortCode),
          examId: r.exam_id,
          targetPath:
            r.target_path ||
            buildExamTargetPath({
              examId: r.exam_id,
              code: r.assignment_code,
              className: r.class_name,
              displayMode: r.display_mode,
            }),
          assignmentId: r.assignment_id || undefined,
          assignmentCode: r.assignment_code || undefined,
          className: r.class_name || undefined,
          isPrimary: r.is_primary !== false,
          isActive: true,
          createdAt: new Date().toISOString(),
        };
      }
    } catch (e) {
      recordRemoteErr(e);
    }
  }

  // 2. Try cross-device `schools` registry (`short_code:<CODE>`)
  if (!mapped) {
    try {
      const { data: row, error: schErr } = await supabase
        .from("schools")
        .select("name")
        .eq("name_key", `short_code:${shortCode}`)
        .maybeSingle();

      if (schErr) {
        recordRemoteErr(schErr);
      } else if (row?.name) {
        const parsed = JSON.parse(row.name);
        if (parsed?.examId && parsed.isActive !== false) {
          mapped = {
            shortCode: normalizeShortCode(parsed.shortCode || shortCode),
            examId: parsed.examId,
            targetPath:
              parsed.targetPath ||
              buildExamTargetPath({
                examId: parsed.examId,
                code: parsed.assignmentCode,
                className: parsed.className,
              }),
            assignmentId: parsed.assignmentId,
            assignmentCode: parsed.assignmentCode,
            className: parsed.className,
            isPrimary: parsed.isPrimary !== false,
            isActive: parsed.isActive !== false,
            createdAt: parsed.createdAt || new Date().toISOString(),
          };
        }
      }
    } catch (e) {
      recordRemoteErr(e);
    }
  }

  // 3. Try local short links cache
  if (!mapped) {
    const localFound = getLocalShortLinks().find(
      (item) => item.isActive !== false && normalizeShortCode(item.shortCode) === shortCode
    );
    if (localFound) {
      mapped = localFound;
    }
  }

  // 4. Try local assignments cache matching `shortCode`
  if (!mapped) {
    const localAssign = getLocalAssignments().find(
      (a) => a.shortCode && normalizeShortCode(a.shortCode) === shortCode
    );
    if (localAssign) {
      mapped = {
        shortCode,
        examId: localAssign.examId,
        targetPath: buildExamTargetPath({
          examId: localAssign.examId,
          code: localAssign.code,
          className: localAssign.className,
        }),
        assignmentId: localAssign.id,
        assignmentCode: localAssign.code,
        className: localAssign.className,
        isPrimary: false,
        isActive: true,
        createdAt: localAssign.createdAt,
      };
    }
  }

  if (!mapped || !mapped.examId) {
    if (hadRemoteError) {
      logExamAccessEvent({
        rawCode: shortCode,
        accessType: "short_link",
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
      rawCode: shortCode,
      accessType: "short_link",
      outcome: "not_found",
      errorCategory: "not_found",
      errorDetail: "short_code_not_found",
    });

    return {
      success: false,
      errorType: "not_found",
      error: "Link bài thi không tồn tại, đã hết hạn hoặc đã bị xóa.",
    };
  }

  // 5. Fetch sanitized exam data via sample registry or `get_exam_for_student` RPC
  const sample = findSampleExam(mapped.examId) || getSampleExamById(mapped.examId);
  let examObj: any = sample || null;

  if (!examObj && isUuid(mapped.examId)) {
    try {
      const { data: exData, error: exErr } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: mapped.examId,
      });
      if (!exErr && exData) {
        examObj = exData;
      } else if (exErr) {
        const c = classifySupabaseError(exErr);
        if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
          logExamAccessEvent({
            examId: mapped.examId,
            rawCode: shortCode,
            accessType: "short_link",
            outcome:
              c.type === "network"
                ? "network_error"
                : c.type === "unauthorized"
                  ? "unauthorized"
                  : "server_error",
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
      if (c.type === "network" || c.type === "server" || c.type === "unauthorized") {
        logExamAccessEvent({
          examId: mapped.examId,
          rawCode: shortCode,
          accessType: "short_link",
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

  if (!examObj) {
    if (hadRemoteError) {
      logExamAccessEvent({
        examId: mapped.examId,
        rawCode: shortCode,
        accessType: "short_link",
        outcome: hadRemoteError.type === "network" ? "network_error" : "server_error",
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
      examId: mapped.examId,
      rawCode: shortCode,
      accessType: "short_link",
      outcome: "not_found",
      errorCategory: "exam_deleted",
      errorDetail: "short_link_target_exam_not_found",
    });

    return {
      success: false,
      errorType: "not_found",
      error: "Bài thi không tồn tại hoặc đã bị xóa khỏi hệ thống.",
    };
  }

  const resolvedDisplayMode = examObj.display_mode || rpcDisplayMode;
  const effectiveCode = mapped.assignmentCode || getExamPrimaryCode(examObj);
  const targetUrl = buildExamTargetPath({
    examId: mapped.examId,
    code: effectiveCode,
    className: mapped.className,
    displayMode: resolvedDisplayMode,
  });

  const assignmentObj: ExamAssignment | undefined = mapped.assignmentCode
    ? {
        id: mapped.assignmentId || `short_${mapped.shortCode}`,
        examId: mapped.examId,
        code: normalizeExamCode(mapped.assignmentCode),
        shortCode: mapped.shortCode,
        className: mapped.className || "Chung",
        title: examObj.title || "Bài thi",
        teacherName: examObj.teacher_name,
        schoolName: examObj.school_name,
        subjectName: examObj.subject_name,
        durationMinutes: examObj.duration_minutes,
        openAt: examObj.open_at,
        closeAt: examObj.close_at,
        createdAt: mapped.createdAt,
      }
    : undefined;

  return {
    success: true,
    shortLink: mapped,
    exam: examObj,
    assignment: assignmentObj,
    targetUrl,
  };
}
