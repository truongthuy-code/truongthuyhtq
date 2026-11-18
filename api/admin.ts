import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_PROJECT_REF = "zhixpglctyfffpwamixv";
const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT_REF}.supabase.co`;
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

const SUPER_ADMIN_EMAIL = "bichthuylqd@gmail.com";

export type SyncGroup = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "UNRESOLVED";

export interface ReconcileStats {
  total_auth_users: number;
  total_teachers_before: number;
  missing_profiles_created: number;
  legacy_pending_restored: number;
  status_mismatch_synced: number;
  new_pending_preserved: number;
  locked_rejected_preserved: number;
  total_teachers_after: number;
  total_students_skipped: number;
}

export interface UnifiedTeacherAccount {
  id: string;
  email: string;
  username: string;
  full_name: string;
  phone: string;
  school_name: string;
  subject_name: string;
  role: string;
  status: "active" | "locked" | "pending" | "rejected";
  approval_status: "PENDING" | "APPROVED" | "REJECTED" | "LOCKED";
  rejection_reason: string | null;
  is_deleted: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  exam_count: number;
  folder_count: number;
  missing_profile: boolean;
  missing_user_role: boolean;
  auth_exists: boolean;
  has_registration: boolean;
  registration_status: string | null;
  sync_group: SyncGroup;
  sync_warning: string | null;
}

function cleanEnvValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let val = raw.trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  if (!val || val === "undefined" || val === "null") return "";
  return val;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isApiKeyGatewayError(errOrMsg: unknown): boolean {
  const status = typeof errOrMsg === "object" && errOrMsg !== null ? Number((errOrMsg as any).status) : 0;
  const msg =
    typeof errOrMsg === "string"
      ? errOrMsg
      : typeof errOrMsg === "object" && errOrMsg !== null
        ? String((errOrMsg as any).message || (errOrMsg as any).error_description || (errOrMsg as any).msg || "")
        : "";
  const lower = msg.toLowerCase();
  if (status === 401 && !lower.includes("invalid login credentials")) return true;
  return (
    lower.includes("invalid api key") ||
    lower.includes("no api key found") ||
    lower.includes("invalid jwt") ||
    lower.includes("apikey")
  );
}

function isMissingFunctionOrTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "42P01" ||
    msg.includes("could not find the function") ||
    msg.includes("could not find the table") ||
    msg.includes("does not exist")
  );
}

export function resolveAdminSupabaseEnv(env: Record<string, string | undefined> = process.env) {
  const rawUrl =
    cleanEnvValue(env.VITE_SUPABASE_URL) ||
    cleanEnvValue(env.SUPABASE_URL) ||
    cleanEnvValue(env.NEXT_PUBLIC_SUPABASE_URL);

  const supabaseUrl =
    rawUrl && /^https?:\/\/[^/\s]+/i.test(rawUrl) ? rawUrl.replace(/\/+$/, "") : DEFAULT_SUPABASE_URL;

  const urlMatch = supabaseUrl.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const projectRef = urlMatch?.[1] || "";

  const rawAnon =
    cleanEnvValue(env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    cleanEnvValue(env.VITE_SUPABASE_ANON_KEY) ||
    cleanEnvValue(env.SUPABASE_PUBLISHABLE_KEY) ||
    cleanEnvValue(env.SUPABASE_ANON_KEY);

  let anonKey = rawAnon;
  let anonInvalid = !anonKey || /\s/.test(anonKey) || anonKey.startsWith("sb_secret_") || anonKey.startsWith("sbp_");
  if (!anonInvalid && anonKey.startsWith("eyJ")) {
    const payload = decodeJwtPayload(anonKey);
    if (!payload || payload.role === "service_role" || (projectRef && payload.ref && payload.ref !== projectRef)) {
      anonInvalid = true;
    }
  } else if (!anonInvalid && !anonKey.startsWith("sb_publishable_")) {
    anonInvalid = true;
  }

  if (anonInvalid) {
    anonKey =
      projectRef === DEFAULT_SUPABASE_PROJECT_REF || !projectRef
        ? DEFAULT_SUPABASE_ANON_KEY
        : rawAnon || DEFAULT_SUPABASE_ANON_KEY;
  }

  const rawService =
    cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnvValue(env.SUPABASE_SERVICE_KEY);
  let serviceRoleKey = "";
  if (rawService && !/\s/.test(rawService) && !rawService.startsWith("sb_publishable_") && !rawService.startsWith("sbp_")) {
    if (rawService.startsWith("eyJ")) {
      const payload = decodeJwtPayload(rawService);
      if (payload && (!payload.role || payload.role === "service_role") && (!projectRef || !payload.ref || payload.ref === projectRef)) {
        serviceRoleKey = rawService;
      }
    } else if (rawService.startsWith("sb_secret_")) {
      serviceRoleKey = rawService;
    }
  }

  return { supabaseUrl, anonKey, serviceRoleKey, projectRef };
}

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-CSRF-Token, X-Requested-With, Accept, Content-Type"
  );
}

function getBearerToken(req: any): string | null {
  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Paginated fetch across ANY Supabase table so >1,000 rows are NEVER silently truncated.
 */
export async function fetchAllRows<T = any>(
  client: any,
  table: string,
  selectCols = "*",
  options: { orderCol?: string; ascending?: boolean; pageSize?: number } = {}
): Promise<{ rows: T[]; error: any | null }> {
  const pageSize = options.pageSize || 1000;
  const rows: T[] = [];
  let offset = 0;
  let useOrder = Boolean(options.orderCol);

  while (true) {
    let q = client.from(table).select(selectCols);
    if (useOrder && options.orderCol) {
      q = q.order(options.orderCol, { ascending: options.ascending ?? false });
    }
    const { data, error } = await q.range(offset, offset + pageSize - 1);
    if (error) {
      // Retry once without ORDER BY in case a column isn't present
      if (useOrder && offset === 0) {
        useOrder = false;
        continue;
      }
      return { rows, error };
    }
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return { rows, error: null };
}

/**
 * Paginated fetch of ALL Supabase Auth users via service_role admin API (avoids 50/1000 cap).
 */
export async function fetchAllAuthUsers(serviceClient: any): Promise<{ users: any[]; accessible: boolean; error?: any }> {
  if (!serviceClient?.auth?.admin?.listUsers) {
    return { users: [], accessible: false };
  }
  const users: any[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    try {
      const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage });
      if (error) {
        return { users, accessible: false, error };
      }
      const batch = Array.isArray(data?.users) ? data.users : [];
      users.push(...batch);
      if (batch.length < perPage) break;
      if (data?.nextPage && data.nextPage <= page) break;
      page += 1;
    } catch (err) {
      return { users, accessible: false, error: err };
    }
  }
  return { users, accessible: true };
}

/**
 * Paginated RPC call for RETURNS TABLE(...) functions so >1,000 rows are never truncated.
 */
export async function fetchAllRpcRows<T = any>(
  client: any,
  fnName: string,
  params: Record<string, any> = {},
  pageSize = 1000
): Promise<{ rows: T[]; error: any | null }> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const req = client.rpc(fnName, params);
    const { data, error } = typeof req?.range === "function"
      ? await req.range(offset, offset + pageSize - 1)
      : await req;
    if (error) {
      return { rows, error };
    }
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize || typeof req?.range !== "function") break;
    offset += pageSize;
  }
  return { rows, error: null };
}

function resolveUniqueUsername(
  uid: string,
  email: string,
  rawUsername: string | null | undefined,
  usedUsernames: Set<string>
): string {
  const cleanedRaw = String(rawUsername || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  const emailPrefix = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    .replace(/[^a-z0-9._-]/g, "");
  const shortId = uid.replace(/-/g, "").slice(0, 6);
  const base = cleanedRaw.length >= 2 ? cleanedRaw : emailPrefix.length >= 2 ? emailPrefix : `gv_${shortId}`;

  let candidate = base;
  if (usedUsernames.has(candidate.toLowerCase())) {
    candidate = `${base}_${shortId}`;
  }
  if (usedUsernames.has(candidate.toLowerCase())) {
    candidate = `gv_${uid.replace(/-/g, "")}`;
  }
  usedUsernames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Pure deterministic FULL OUTER JOIN & Group A-G classification across all data sources.
 * Can be called from API handlers and tested directly in unit tests.
 */
export function assembleAndClassifyTeacherAccounts(input: {
  authUsers: any[];
  profiles: any[];
  userRoles: any[];
  registrations: any[];
  exams: any[];
  folders: any[];
  cutoffIso?: string | null;
  includeDeleted?: boolean;
}) {
  const authMap = new Map<string, any>();
  for (const au of input.authUsers || []) {
    if (au?.id) authMap.set(au.id, au);
  }

  const profileMap = new Map<string, any>();
  for (const pr of input.profiles || []) {
    if (pr?.id) profileMap.set(pr.id, pr);
  }

  const regMap = new Map<string, any>();
  for (const tr of input.registrations || []) {
    const uid = tr?.user_id || tr?.teacher_id || tr?.id;
    if (uid) regMap.set(uid, tr);
  }

  const roleMap = new Map<string, Set<string>>();
  for (const ur of input.userRoles || []) {
    if (!ur?.user_id || !ur?.role) continue;
    if (!roleMap.has(ur.user_id)) roleMap.set(ur.user_id, new Set());
    roleMap.get(ur.user_id)!.add(String(ur.role).toLowerCase());
  }

  const examActiveCounts = new Map<string, number>();
  const examTotalCounts = new Map<string, number>();
  for (const ex of input.exams || []) {
    if (!ex?.created_by) continue;
    examTotalCounts.set(ex.created_by, (examTotalCounts.get(ex.created_by) || 0) + 1);
    if (!ex.is_deleted) {
      examActiveCounts.set(ex.created_by, (examActiveCounts.get(ex.created_by) || 0) + 1);
    }
  }

  const folderActiveCounts = new Map<string, number>();
  const folderTotalCounts = new Map<string, number>();
  for (const fl of input.folders || []) {
    if (!fl?.teacher_id) continue;
    folderTotalCounts.set(fl.teacher_id, (folderTotalCounts.get(fl.teacher_id) || 0) + 1);
    if (!fl.is_deleted) {
      folderActiveCounts.set(fl.teacher_id, (folderActiveCounts.get(fl.teacher_id) || 0) + 1);
    }
  }

  const allUids = new Set<string>([
    ...authMap.keys(),
    ...profileMap.keys(),
    ...roleMap.keys(),
    ...regMap.keys(),
    ...examTotalCounts.keys(),
    ...folderTotalCounts.keys(),
  ]);

  const nowMs = Date.now();
  const groupCounts: Record<SyncGroup, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
    F: 0,
    G: 0,
    UNRESOLVED: 0,
  };

  let totalStudentsSkipped = 0;
  let totalTeachersBefore = 0;
  let missingProfilesCount = 0;
  let legacyPendingRestored = 0;
  let statusMismatchSynced = 0;
  let newPendingPreserved = 0;
  let lockedRejectedPreserved = 0;

  for (const pr of input.profiles || []) {
    const emailLower = String(pr.email || "").trim().toLowerCase();
    const roleLower = String(pr.role || "teacher").toLowerCase();
    if (!pr.is_deleted && emailLower !== SUPER_ADMIN_EMAIL && roleLower !== "super_admin" && roleLower !== "student") {
      totalTeachersBefore += 1;
    }
  }

  const accounts: UnifiedTeacherAccount[] = [];
  const unresolvedErrors: { user_id: string; email: string; group: string; reason: string }[] = [];

  for (const uid of allUids) {
    const au = authMap.get(uid) || null;
    const pr = profileMap.get(uid) || null;
    const tr = regMap.get(uid) || null;
    const roles = roleMap.get(uid) || new Set<string>();
    const examCnt = examActiveCounts.get(uid) || 0;
    const examTotalCnt = examTotalCounts.get(uid) || 0;
    const folderCnt = folderActiveCounts.get(uid) || 0;
    const folderTotalCnt = folderTotalCounts.get(uid) || 0;

    const email = String(pr?.email || au?.email || tr?.email || "").trim().toLowerCase();
    const appRole = String(au?.app_metadata?.role || au?.raw_app_meta_data?.role || "").toLowerCase();
    const userMetaRole = String(au?.user_metadata?.role || au?.raw_user_meta_data?.role || "").toLowerCase();
    const profileRole = String(pr?.role || "").toLowerCase();

    const isSuper =
      email === SUPER_ADMIN_EMAIL ||
      profileRole === "super_admin" ||
      appRole === "super_admin" ||
      roles.has("super_admin");
    if (isSuper) continue;

    const isPureStudent =
      (profileRole === "student" || roles.has("student") || appRole === "student" || userMetaRole === "student") &&
      !roles.has("teacher") &&
      !roles.has("admin") &&
      !roles.has("super_admin") &&
      profileRole !== "teacher" &&
      profileRole !== "admin" &&
      examTotalCnt === 0 &&
      folderTotalCnt === 0 &&
      !tr;

    if (isPureStudent) {
      totalStudentsSkipped += 1;
      continue;
    }

    const authExists = Boolean(au) || Boolean(pr); // When service_role key isn't set, profiles rows reference auth.users via FK
    const reallyHasAuth = authMap.size > 0 ? Boolean(au) : Boolean(pr);
    const missingProfile = !pr;
    const missingUserRole = !roles.has("teacher");

    const pStatusLower = String(pr?.status || "").toLowerCase();
    const pApprovalUpper = String(pr?.approval_status || "").toUpperCase();
    const trStatusUpper = String(tr?.status || "").toUpperCase();
    const bannedUntilMs = au?.banned_until ? new Date(au.banned_until).getTime() : 0;
    const isBanned = bannedUntilMs > nowMs;

    const flagLocked = Boolean(
      pr?.is_deleted || pStatusLower === "locked" || pApprovalUpper === "LOCKED" || isBanned
    );

    const approvedAtMs = pr?.approved_at ? new Date(pr.approved_at).getTime() : 0;
    const rejectedAtMs = pr?.rejected_at ? new Date(pr.rejected_at).getTime() : 0;
    const flagRejected =
      !flagLocked &&
      (pStatusLower === "rejected" || pApprovalUpper === "REJECTED" || trStatusUpper === "REJECTED") &&
      (!approvedAtMs || (rejectedAtMs > 0 && rejectedAtMs > approvedAtMs));

    const flagTruePending =
      !flagLocked &&
      !flagRejected &&
      Boolean(tr) &&
      trStatusUpper === "PENDING" &&
      examTotalCnt === 0 &&
      folderTotalCnt === 0 &&
      !pr?.approved_at &&
      pApprovalUpper !== "APPROVED";

    const rawMeta = au?.user_metadata || au?.raw_user_meta_data || {};
    const username =
      String(pr?.username || tr?.username || rawMeta.username || email.split("@")[0] || "").trim() ||
      `gv_${uid.replace(/-/g, "").slice(0, 6)}`;
    const fullName =
      String(pr?.full_name || tr?.full_name || rawMeta.full_name || email.split("@")[0] || "").trim() ||
      "Giáo viên";

    let effStatus: UnifiedTeacherAccount["status"] = "active";
    let effApproval: UnifiedTeacherAccount["approval_status"] = "APPROVED";

    if (flagLocked) {
      effStatus = "locked";
      effApproval = "LOCKED";
    } else if (flagRejected) {
      effStatus = "rejected";
      effApproval = "REJECTED";
    } else if (flagTruePending) {
      effStatus = "pending";
      effApproval = "PENDING";
    } else if (
      !missingProfile &&
      (pStatusLower === "pending" || pApprovalUpper === "PENDING") &&
      tr &&
      trStatusUpper === "PENDING"
    ) {
      effStatus = "pending";
      effApproval = "PENDING";
    }

    let syncGroup: SyncGroup = "A";
    let syncWarning: string | null = null;

    if (!reallyHasAuth) {
      syncGroup = "UNRESOLVED";
      syncWarning = "Dữ liệu đề thi/thư mục không có tài khoản auth.users gốc";
    } else if (flagLocked || flagRejected) {
      syncGroup = "G";
      if (missingProfile) {
        syncWarning = "Tài khoản bị khóa/từ chối nhưng thiếu hồ sơ profiles";
      }
    } else if (flagTruePending) {
      syncGroup = "F";
      if (missingProfile) {
        syncWarning = "Đăng ký mới chờ duyệt nhưng thiếu bản ghi profiles";
      }
    } else if (missingProfile) {
      syncGroup = "C";
      syncWarning = "Thiếu bản ghi trong bảng profiles (đã phát hiện từ auth.users / dữ liệu đề thi)";
    } else if (
      (pStatusLower === "active" && pApprovalUpper !== "APPROVED") ||
      (pStatusLower !== "active" && pApprovalUpper === "APPROVED") ||
      (tr && trStatusUpper !== (pApprovalUpper || "APPROVED")) ||
      missingUserRole
    ) {
      syncGroup = "E";
      syncWarning = missingUserRole
        ? "Thiếu vai trò teacher trong bảng user_roles"
        : "Lệch trạng thái giữa profiles / teacher_registrations";
    } else if (pStatusLower === "pending" || pApprovalUpper === "PENDING") {
      syncGroup = "B";
      syncWarning = "Giáo viên cũ đang bị đặt trạng thái PENDING nhầm";
    } else if (
      profileRole !== "teacher" ||
      !email ||
      !pr?.full_name ||
      !pr?.username ||
      pr?.is_deleted === null ||
      pr?.is_deleted === undefined
    ) {
      syncGroup = "D";
      syncWarning = "Hồ sơ giáo viên thiếu trường thông tin chuẩn hóa";
    }

    groupCounts[syncGroup] += 1;
    if (syncGroup === "UNRESOLVED") {
      unresolvedErrors.push({ user_id: uid, email, group: "UNRESOLVED", reason: syncWarning || "Lỗi chưa xác định" });
    } else if (syncGroup === "B") {
      legacyPendingRestored += 1;
    } else if (syncGroup === "C") {
      missingProfilesCount += 1;
    } else if (syncGroup === "D" || syncGroup === "E") {
      statusMismatchSynced += 1;
    } else if (syncGroup === "F") {
      newPendingPreserved += 1;
      if (missingProfile) missingProfilesCount += 1;
    } else if (syncGroup === "G") {
      lockedRejectedPreserved += 1;
      if (missingProfile) missingProfilesCount += 1;
    }

    const isDeleted = Boolean(pr?.is_deleted);
    const record: UnifiedTeacherAccount = {
      id: uid,
      email,
      username,
      full_name: fullName,
      phone: String(pr?.phone || tr?.phone || rawMeta.phone || ""),
      school_name: String(pr?.school_name || tr?.school_name || rawMeta.school_name || ""),
      subject_name: String(pr?.subject_name || tr?.subject_name || rawMeta.subject_name || ""),
      role: pr?.role || "teacher",
      status: effStatus,
      approval_status: effApproval,
      rejection_reason: pr?.rejection_reason || tr?.rejection_reason || null,
      is_deleted: isDeleted,
      created_at: pr?.created_at || au?.created_at || tr?.created_at || new Date().toISOString(),
      last_sign_in_at: au?.last_sign_in_at || null,
      email_confirmed_at: au?.email_confirmed_at || null,
      exam_count: examCnt,
      folder_count: folderCnt,
      missing_profile: missingProfile,
      missing_user_role: missingUserRole,
      auth_exists: reallyHasAuth,
      has_registration: Boolean(tr),
      registration_status: tr?.status || null,
      sync_group: syncGroup,
      sync_warning: syncWarning,
    };

    if (input.includeDeleted !== false || !isDeleted) {
      accounts.push(record);
    }
  }

  accounts.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const visibleAfterCount = accounts.filter((a) => !a.is_deleted && a.sync_group !== "UNRESOLVED").length;

  const stats: ReconcileStats = {
    total_auth_users: authMap.size > 0 ? authMap.size : profileMap.size,
    total_teachers_before: totalTeachersBefore,
    missing_profiles_created: missingProfilesCount,
    legacy_pending_restored: legacyPendingRestored,
    status_mismatch_synced: statusMismatchSynced,
    new_pending_preserved: newPendingPreserved,
    locked_rejected_preserved: lockedRejectedPreserved,
    total_teachers_after: visibleAfterCount,
    total_students_skipped: totalStudentsSkipped,
  };

  return {
    accounts,
    stats,
    group_counts: groupCounts,
    unresolved_errors: unresolvedErrors,
    auth_users_accessible: authMap.size > 0,
  };
}

async function fetchUnifiedDirectory(
  callerClient: any,
  db: any,
  serviceClient: any,
  includeDeleted = true
) {
  // 1. Prefer server-side SQL SECURITY DEFINER RPC (has full access to auth.users even without service_role key)
  const rpcRes = await fetchAllRpcRows<UnifiedTeacherAccount>(
    callerClient,
    "admin_fetch_all_teacher_accounts",
    { p_include_deleted: includeDeleted }
  );

  if (!rpcRes.error && Array.isArray(rpcRes.rows)) {
    const accounts = rpcRes.rows.map((r: any) => ({
      ...r,
      exam_count: Number(r.exam_count || 0),
      folder_count: Number(r.folder_count || 0),
      missing_profile: Boolean(r.missing_profile),
      missing_user_role: Boolean(r.missing_user_role),
      auth_exists: r.auth_exists !== false,
      has_registration: Boolean(r.has_registration),
    }));
    return { source: "rpc" as const, accounts, authUsersAccessible: true };
  }

  // 2. Fallback: paginated Node merge across all tables + auth.users (if serviceClient available)
  const [authRes, profRes, roleRes, regRes, examsRes, foldersRes] = await Promise.all([
    fetchAllAuthUsers(serviceClient),
    fetchAllRows(db, "profiles", "*", { orderCol: "created_at", ascending: false }),
    fetchAllRows(db, "user_roles", "user_id, role"),
    fetchAllRows(db, "teacher_registrations", "*", { orderCol: "created_at", ascending: false }),
    fetchAllRows(db, "exams", "id, created_by, is_deleted"),
    fetchAllRows(db, "exam_folders", "id, teacher_id, is_deleted"),
  ]);

  const assembled = assembleAndClassifyTeacherAccounts({
    authUsers: authRes.users,
    profiles: profRes.rows,
    userRoles: roleRes.rows,
    registrations: regRes.rows,
    exams: examsRes.rows,
    folders: foldersRes.rows,
    includeDeleted,
  });

  return {
    source: "node" as const,
    accounts: assembled.accounts,
    assembled,
    authUsersAccessible: authRes.accessible,
  };
}

async function notifyTeacherDecision(
  supabaseUrl: string,
  anonKey: string,
  payload: {
    type: "TEACHER_APPROVED" | "TEACHER_REJECTED";
    teacherEmail?: string | null;
    teacherName?: string | null;
    reason?: string | null;
  }
) {
  if (!payload.teacherEmail) return { sent: false };
  const resendKey = cleanEnvValue(process.env.RESEND_API_KEY);
  const mailFrom = cleanEnvValue(process.env.MAIL_FROM) || "Hệ thống Trắc nghiệm <onboarding@resend.dev>";

  if (resendKey) {
    try {
      const isApproved = payload.type === "TEACHER_APPROVED";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: mailFrom,
          to: [payload.teacherEmail],
          subject: isApproved
            ? "[Đã phê duyệt] Tài khoản Giáo viên đã được kích hoạt"
            : "[Thông báo] Yêu cầu đăng ký tài khoản Giáo viên chưa được phê duyệt",
          html: isApproved
            ? `<div style="font-family: 'Times New Roman', serif;"><h3>Xin chào ${payload.teacherName || "Thầy/Cô"},</h3><p>Tài khoản giáo viên của bạn trên Hệ thống Tạo đề Trắc nghiệm Online đã được <strong>Quản trị viên phê duyệt</strong>. Bạn có thể đăng nhập và sử dụng đầy đủ các tính năng ngay bây giờ.</p></div>`
            : `<div style="font-family: 'Times New Roman', serif;"><h3>Xin chào ${payload.teacherName || "Thầy/Cô"},</h3><p>Yêu cầu đăng ký tài khoản giáo viên của bạn hiện chưa được phê duyệt.</p><p><strong>Lý do:</strong> ${payload.reason || "Không đáp ứng điều kiện xét duyệt"}</p></div>`,
        }),
      });
      if (resp.ok) return { sent: true };
    } catch {}
  }

  try {
    await fetch(`${supabaseUrl}/functions/v1/teacher-register-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        eventType: payload.type,
        type: payload.type,
        teacherEmail: payload.teacherEmail,
        teacherName: payload.teacherName,
        rejectionReason: payload.reason,
        reason: payload.reason,
      }),
    });
  } catch {}
  return { sent: false };
}

async function writeAuditLog(
  sb: any,
  actor: { id: string; email: string },
  entry: {
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    summary?: string | null;
    beforeData?: any;
    afterData?: any;
    metadata?: any;
  }
) {
  try {
    await sb.from("admin_activity_logs").insert({
      admin_id: actor.id,
      admin_email: actor.email,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId || null,
      target_label: entry.targetLabel || null,
      detail: entry.summary || null,
      outcome: "success",
      before_data: entry.beforeData ?? null,
      after_data: entry.afterData ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.warn("[admin-api] writeAuditLog warning:", err);
  }
}

async function ensureServiceProfileUpsert(
  serviceClient: any,
  teacherId: string,
  overrideFields: Record<string, any>
) {
  const { data: before } = await serviceClient.from("profiles").select("*").eq("id", teacherId).maybeSingle();
  if (before) {
    const { error } = await serviceClient.from("profiles").update(overrideFields).eq("id", teacherId);
    return { before, error };
  }

  let authUser: any = null;
  try {
    const res = await serviceClient.auth.admin.getUserById(teacherId);
    authUser = res?.data?.user || null;
  } catch {}

  const { data: reg } = await serviceClient
    .from("teacher_registrations")
    .select("*")
    .eq("user_id", teacherId)
    .maybeSingle();

  const email = (authUser?.email || reg?.email || "").trim().toLowerCase() || null;
  const meta = authUser?.user_metadata || {};
  const rawUsername = reg?.username || meta.username || (email ? email.split("@")[0] : "");
  const cleanUser =
    String(rawUsername || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "") || `gv_${teacherId.replace(/-/g, "").slice(0, 8)}`;

  const payload = {
    id: teacherId,
    email,
    username: `${cleanUser}_${teacherId.replace(/-/g, "").slice(0, 6)}`,
    full_name: reg?.full_name || meta.full_name || (email ? email.split("@")[0] : "Giáo viên"),
    phone: reg?.phone || meta.phone || null,
    school_name: reg?.school_name || meta.school_name || null,
    subject_name: reg?.subject_name || meta.subject_name || null,
    role: "teacher",
    profile_completed: true,
    is_deleted: false,
    created_at: authUser?.created_at || reg?.created_at || new Date().toISOString(),
    ...overrideFields,
  };

  const { error } = await serviceClient.from("profiles").upsert(payload, { onConflict: "id" });
  return { before: null, error };
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { supabaseUrl, anonKey: initialAnonKey, serviceRoleKey, projectRef } = resolveAdminSupabaseEnv(
      process.env
    );
    let activeAnonKey = initialAnonKey;

    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Chưa xác thực phiên đăng nhập Quản trị viên." });
    }

    let callerClient = createClient(supabaseUrl, activeAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    if (
      userErr &&
      isApiKeyGatewayError(userErr) &&
      (projectRef === DEFAULT_SUPABASE_PROJECT_REF || !projectRef) &&
      activeAnonKey !== DEFAULT_SUPABASE_ANON_KEY
    ) {
      activeAnonKey = DEFAULT_SUPABASE_ANON_KEY;
      callerClient = createClient(DEFAULT_SUPABASE_URL, activeAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const retry = await callerClient.auth.getUser(token);
      userData = retry.data;
      userErr = retry.error;
    }

    const caller = userData?.user;
    if (userErr || !caller) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
    }

    let serviceClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

    if (serviceClient) {
      const probe = await serviceClient.from("profiles").select("id").limit(1);
      if (probe.error && isApiKeyGatewayError(probe.error)) {
        console.warn("[admin-api] SUPABASE_SERVICE_ROLE_KEY rejected by Supabase; falling back to Super Admin caller session.");
        serviceClient = null;
      }
    }

    const db = serviceClient || callerClient;

    // Server-side verification of SUPER_ADMIN (never trust client-supplied role)
    const callerEmail = (caller.email || "").trim().toLowerCase();
    let isAuthorizedSuperAdmin = callerEmail === SUPER_ADMIN_EMAIL || caller.app_metadata?.role === "super_admin";

    if (!isAuthorizedSuperAdmin) {
      try {
        const { data: rpcCheck } = await callerClient.rpc("is_super_admin", { _user_id: caller.id });
        if (rpcCheck === true) isAuthorizedSuperAdmin = true;
      } catch {}
    }

    if (!isAuthorizedSuperAdmin) {
      return res.status(403).json({
        ok: false,
        error: "Truy cập bị từ chối: Chỉ Super Admin mới có quyền thực hiện thao tác này.",
      });
    }

    const actor = { id: caller.id, email: callerEmail || SUPER_ADMIN_EMAIL };
    const body = req.body || {};
    const action = String(body.action || req.query?.action || "overview");

    switch (action) {
      case "overview": {
        const [dir, examsRes, foldersRes, subsRes] = await Promise.all([
          fetchUnifiedDirectory(callerClient, db, serviceClient, false),
          fetchAllRows(db, "exams", "id, is_deleted, manual_closed"),
          fetchAllRows(db, "exam_folders", "id, is_deleted"),
          fetchAllRows(db, "submissions", "id"),
        ]);

        const activeTeachers = dir.accounts.filter((t) => !t.is_deleted && t.sync_group !== "UNRESOLVED");
        const exams = examsRes.rows.filter((e: any) => !e.is_deleted);
        const folders = foldersRes.rows.filter((f: any) => !f.is_deleted);

        const pendingCount = activeTeachers.filter((t) => t.approval_status === "PENDING").length;
        const approvedCount = activeTeachers.filter((t) => t.approval_status === "APPROVED").length;
        const lockedCount = activeTeachers.filter((t) => t.approval_status === "LOCKED").length;
        const rejectedCount = activeTeachers.filter((t) => t.approval_status === "REJECTED").length;

        return res.status(200).json({
          ok: true,
          metrics: {
            totalTeachers: activeTeachers.length,
            pendingCount,
            approvedCount,
            lockedCount,
            rejectedCount,
            totalExams: exams.length,
            totalFolders: folders.length,
            totalSubmissions: subsRes.rows.length,
          },
        });
      }

      case "list_registrations": {
        const [regsRes, dir] = await Promise.all([
          fetchAllRows(db, "teacher_registrations", "*", { orderCol: "created_at", ascending: false }),
          fetchUnifiedDirectory(callerClient, db, serviceClient, false),
        ]);

        const regMap = new Map<string, any>();
        for (const r of regsRes.rows) {
          const uid = r.user_id || r.teacher_id || r.id;
          const emailLower = String(r.email || "").trim().toLowerCase();
          if (emailLower === SUPER_ADMIN_EMAIL) continue;
          regMap.set(uid, { ...r, teacher_id: uid, user_id: uid });
        }

        for (const t of dir.accounts) {
          if (t.email === SUPER_ADMIN_EMAIL || t.role === "super_admin") continue;
          const existing = regMap.get(t.id);
          if (!existing) {
            const st =
              t.approval_status === "PENDING"
                ? "PENDING"
                : t.approval_status === "REJECTED"
                  ? "REJECTED"
                  : "APPROVED";
            regMap.set(t.id, {
              id: t.id,
              user_id: t.id,
              teacher_id: t.id,
              email: t.email,
              username: t.username,
              full_name: t.full_name,
              phone: t.phone || "",
              school_name: t.school_name || "",
              subject_name: t.subject_name || "",
              status: st,
              rejection_reason: t.rejection_reason || null,
              reviewed_at: null,
              created_at: t.created_at,
              missing_profile: t.missing_profile,
              sync_warning: t.sync_warning,
            });
          } else {
            regMap.set(t.id, {
              ...existing,
              missing_profile: t.missing_profile,
              sync_warning: t.sync_warning,
            });
          }
        }

        const list = Array.from(regMap.values()).sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        return res.status(200).json({ ok: true, registrations: list });
      }

      case "list_teachers": {
        const includeDeleted = !!body.includeDeleted;
        const dir = await fetchUnifiedDirectory(callerClient, db, serviceClient, includeDeleted);
        return res.status(200).json({
          ok: true,
          teachers: dir.accounts,
          source: dir.source,
          authUsersAccessible: dir.authUsersAccessible,
        });
      }

      case "reconcile_audit": {
        const cutoff = body.cutoff ? String(body.cutoff) : null;
        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_reconcile_legacy_teachers", {
          p_apply: false,
          p_cutoff: cutoff,
        });

        if (!rpcErr && rpcRes?.ok) {
          return res.status(200).json({
            ...rpcRes,
            source: "rpc",
            auth_users_accessible: true,
          });
        }

        // Node fallback if 20261121000000 migration is not deployed yet
        const [authRes, profRes, roleRes, regRes, examsRes, foldersRes] = await Promise.all([
          fetchAllAuthUsers(serviceClient),
          fetchAllRows(db, "profiles", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(db, "user_roles", "user_id, role"),
          fetchAllRows(db, "teacher_registrations", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(db, "exams", "id, created_by, is_deleted"),
          fetchAllRows(db, "exam_folders", "id, teacher_id, is_deleted"),
        ]);

        const assembled = assembleAndClassifyTeacherAccounts({
          authUsers: authRes.users,
          profiles: profRes.rows,
          userRoles: roleRes.rows,
          registrations: regRes.rows,
          exams: examsRes.rows,
          folders: foldersRes.rows,
          cutoffIso: cutoff,
          includeDeleted: true,
        });

        const discrepancies = assembled.accounts
          .filter((a) => a.sync_group !== "A" && a.sync_group !== "UNRESOLVED")
          .slice(0, 500)
          .map((a) => ({
            user_id: a.id,
            email: a.email,
            full_name: a.full_name,
            sync_group: a.sync_group,
            missing_profile: a.missing_profile,
            missing_user_role: a.missing_user_role,
            exam_count: a.exam_count,
            folder_count: a.folder_count,
            approval_status: a.approval_status,
            sync_warning: a.sync_warning,
          }));

        return res.status(200).json({
          ok: true,
          applied: false,
          source: "node",
          auth_users_accessible: authRes.accessible,
          rpc_missing: isMissingFunctionOrTableError(rpcErr),
          stats: assembled.stats,
          group_counts: assembled.group_counts,
          discrepancies,
          unresolved_errors: assembled.unresolved_errors,
          verification: {
            remaining_missing_profiles: assembled.accounts.filter(
              (a) => a.missing_profile && a.sync_group !== "UNRESOLVED"
            ).length,
            remaining_unsynced_legacy: assembled.accounts.filter((a) =>
              ["B", "C", "D", "E"].includes(a.sync_group)
            ).length,
            idempotent_clean: false,
          },
        });
      }

      case "reconcile_execute": {
        const cutoff = body.cutoff ? String(body.cutoff) : null;
        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_reconcile_legacy_teachers", {
          p_apply: true,
          p_cutoff: cutoff,
        });

        if (!rpcErr && rpcRes?.ok) {
          return res.status(200).json({
            ...rpcRes,
            source: "rpc",
            auth_users_accessible: true,
          });
        }

        if (!serviceClient) {
          return res.status(400).json({
            ok: false,
            error:
              "Chưa triển khai hàm SQL admin_reconcile_legacy_teachers trên Supabase và máy chủ chưa có SUPABASE_SERVICE_ROLE_KEY. Vui lòng chạy migration 20261121000000_reconcile_legacy_teachers.sql trong Supabase SQL Editor.",
          });
        }

        // Node service_role fallback: fetch all paginated tables & apply per-user idempotently with error isolation
        const [authRes, profRes, roleRes, regRes, examsRes, foldersRes] = await Promise.all([
          fetchAllAuthUsers(serviceClient),
          fetchAllRows(serviceClient, "profiles", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(serviceClient, "user_roles", "user_id, role"),
          fetchAllRows(serviceClient, "teacher_registrations", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(serviceClient, "exams", "id, created_by, is_deleted"),
          fetchAllRows(serviceClient, "exam_folders", "id, teacher_id, is_deleted"),
        ]);

        const preAssembled = assembleAndClassifyTeacherAccounts({
          authUsers: authRes.users,
          profiles: profRes.rows,
          userRoles: roleRes.rows,
          registrations: regRes.rows,
          exams: examsRes.rows,
          folders: foldersRes.rows,
          cutoffIso: cutoff,
          includeDeleted: true,
        });

        const usedUsernames = new Set<string>(
          profRes.rows
            .filter((p: any) => !p.is_deleted && p.username)
            .map((p: any) => String(p.username).trim().toLowerCase())
        );

        const errors: { user_id: string; email: string; group: string; reason: string }[] = [
          ...preAssembled.unresolved_errors,
        ];
        const nowIso = new Date().toISOString();

        for (const acc of preAssembled.accounts) {
          if (acc.sync_group === "A" || acc.sync_group === "UNRESOLVED") continue;
          try {
            const safeUsername = acc.missing_profile
              ? resolveUniqueUsername(acc.id, acc.email, acc.username, usedUsernames)
              : acc.username || resolveUniqueUsername(acc.id, acc.email, null, usedUsernames);

            if (acc.sync_group === "F") {
              if (acc.missing_profile) {
                const { error } = await serviceClient.from("profiles").upsert(
                  {
                    id: acc.id,
                    email: acc.email || null,
                    full_name: acc.full_name,
                    username: safeUsername,
                    phone: acc.phone || null,
                    school_name: acc.school_name || null,
                    subject_name: acc.subject_name || null,
                    role: "teacher",
                    status: "pending",
                    approval_status: "PENDING",
                    profile_completed: true,
                    is_deleted: false,
                    created_at: acc.created_at,
                    updated_at: nowIso,
                  },
                  { onConflict: "id" }
                );
                if (error) throw error;
              }
              if (acc.missing_user_role) {
                await serviceClient
                  .from("user_roles")
                  .upsert({ user_id: acc.id, role: "teacher" }, { onConflict: "user_id,role" });
              }
            } else if (acc.sync_group === "G") {
              const targetStatus = acc.approval_status === "LOCKED" ? "locked" : "rejected";
              if (acc.missing_profile) {
                const { error } = await serviceClient.from("profiles").upsert(
                  {
                    id: acc.id,
                    email: acc.email || null,
                    full_name: acc.full_name,
                    username: safeUsername,
                    role: "teacher",
                    status: targetStatus,
                    approval_status: acc.approval_status,
                    rejection_reason: acc.rejection_reason,
                    profile_completed: true,
                    is_deleted: acc.is_deleted,
                    created_at: acc.created_at,
                    updated_at: nowIso,
                  },
                  { onConflict: "id" }
                );
                if (error) throw error;
              } else {
                const { error } = await serviceClient
                  .from("profiles")
                  .update({
                    status: targetStatus,
                    approval_status: acc.approval_status,
                    role: acc.role || "teacher",
                    updated_at: nowIso,
                  })
                  .eq("id", acc.id);
                if (error) throw error;
              }
            } else {
              // Groups B, C, D, E -> Active & Approved legacy teacher
              const { error } = await serviceClient.from("profiles").upsert(
                {
                  id: acc.id,
                  email: acc.email || null,
                  full_name: acc.full_name,
                  username: safeUsername,
                  phone: acc.phone || null,
                  school_name: acc.school_name || null,
                  subject_name: acc.subject_name || null,
                  role: "teacher",
                  status: "active",
                  approval_status: "APPROVED",
                  approved_at: nowIso,
                  rejection_reason: null,
                  profile_completed: true,
                  is_deleted: false,
                  created_at: acc.created_at,
                  updated_at: nowIso,
                },
                { onConflict: "id" }
              );
              if (error) throw error;

              await serviceClient
                .from("user_roles")
                .upsert({ user_id: acc.id, role: "teacher" }, { onConflict: "user_id,role" });

              if (acc.has_registration && acc.registration_status !== "APPROVED") {
                await serviceClient
                  .from("teacher_registrations")
                  .update({
                    status: "APPROVED",
                    rejection_reason: null,
                    reviewed_at: nowIso,
                    updated_at: nowIso,
                  })
                  .eq("user_id", acc.id);
              }
            }
          } catch (itemErr: any) {
            errors.push({
              user_id: acc.id,
              email: acc.email,
              group: acc.sync_group,
              reason: itemErr?.message || "Lỗi cập nhật tài khoản",
            });
          }
        }

        // Second verification pass
        const [postProfRes, postRoleRes, postRegRes] = await Promise.all([
          fetchAllRows(serviceClient, "profiles", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(serviceClient, "user_roles", "user_id, role"),
          fetchAllRows(serviceClient, "teacher_registrations", "*", { orderCol: "created_at", ascending: false }),
        ]);

        const postAssembled = assembleAndClassifyTeacherAccounts({
          authUsers: authRes.users,
          profiles: postProfRes.rows,
          userRoles: postRoleRes.rows,
          registrations: postRegRes.rows,
          exams: examsRes.rows,
          folders: foldersRes.rows,
          cutoffIso: cutoff,
          includeDeleted: true,
        });

        await writeAuditLog(serviceClient, actor, {
          action: "RECONCILE_LEGACY_TEACHERS",
          targetType: "system",
          targetLabel: "Đối soát & đồng bộ tài khoản giáo viên cũ",
          afterData: {
            ...preAssembled.stats,
            total_teachers_after: postAssembled.stats.total_teachers_after,
            errors_count: errors.length,
          },
          summary: `Đồng bộ tài khoản giáo viên cũ: bổ sung ${preAssembled.stats.missing_profiles_created} profile, khôi phục ${preAssembled.stats.legacy_pending_restored} tài khoản PENDING, đồng bộ ${preAssembled.stats.status_mismatch_synced} lệch trạng thái.`,
        });

        return res.status(200).json({
          ok: true,
          applied: true,
          source: "node",
          auth_users_accessible: authRes.accessible,
          stats: {
            ...preAssembled.stats,
            total_teachers_after: postAssembled.stats.total_teachers_after,
          },
          group_counts: preAssembled.group_counts,
          verification: {
            remaining_missing_profiles: postAssembled.accounts.filter(
              (a) => a.missing_profile && a.sync_group !== "UNRESOLVED"
            ).length,
            remaining_unsynced_legacy: postAssembled.accounts.filter((a) =>
              ["B", "C", "D", "E"].includes(a.sync_group)
            ).length,
            idempotent_clean:
              postAssembled.accounts.filter((a) => ["B", "C", "D", "E"].includes(a.sync_group)).length === 0,
          },
          unresolved_errors: errors,
        });
      }

      case "approve_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_approve_teacher", {
          p_user_id: teacherId,
        });

        let targetProfile: any = null;
        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể phê duyệt." });
          }
          const nowIso = new Date().toISOString();
          const { before, error: upErr } = await ensureServiceProfileUpsert(serviceClient, teacherId, {
            status: "active",
            approval_status: "APPROVED",
            approved_at: nowIso,
            approved_by: actor.id,
            rejection_reason: null,
            is_deleted: false,
            updated_at: nowIso,
          });
          if (upErr) return res.status(400).json({ ok: false, error: upErr.message });
          targetProfile = before;

          await serviceClient
            .from("user_roles")
            .upsert({ user_id: teacherId, role: "teacher" }, { onConflict: "user_id,role" });

          await serviceClient
            .from("teacher_registrations")
            .update({
              status: "APPROVED",
              reviewed_by: actor.id,
              reviewed_at: nowIso,
              rejection_reason: null,
              updated_at: nowIso,
            })
            .eq("user_id", teacherId);

          await writeAuditLog(serviceClient, actor, {
            action: "APPROVE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: before?.full_name || before?.email || body.email,
            summary: `Phê duyệt tài khoản giáo viên ${before?.email || body.email || teacherId}`,
            beforeData: before,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, {
            ban_duration: "none",
            email_confirm: true,
          }).catch(() => {});
          if (!targetProfile) {
            const { data: prof } = await serviceClient.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
            targetProfile = prof;
          }
        } else {
          const { data: prof } = await db.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
          targetProfile = prof;
        }

        await notifyTeacherDecision(supabaseUrl, activeAnonKey, {
          type: "TEACHER_APPROVED",
          teacherEmail: targetProfile?.email || body.email,
          teacherName: targetProfile?.full_name || body.fullName,
        });

        return res.status(200).json({ ok: true });
      }

      case "reject_teacher": {
        const teacherId = String(body.teacherId || "");
        const reason = String(body.reason || "").trim() || "Không đáp ứng điều kiện xét duyệt";
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_reject_teacher", {
          p_user_id: teacherId,
          p_reason: reason,
        });

        let targetProfile: any = null;
        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể từ chối." });
          }
          const { data: checkProf } = await serviceClient.from("profiles").select("email, role").eq("id", teacherId).maybeSingle();
          if ((checkProf?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || checkProf?.role === "super_admin") {
            return res.status(403).json({ ok: false, error: "Không thể từ chối Super Admin." });
          }
          const nowIso = new Date().toISOString();
          const { before, error: upErr } = await ensureServiceProfileUpsert(serviceClient, teacherId, {
            status: "rejected",
            approval_status: "REJECTED",
            rejected_at: nowIso,
            rejected_by: actor.id,
            rejection_reason: reason,
            updated_at: nowIso,
          });
          if (upErr) return res.status(400).json({ ok: false, error: upErr.message });
          targetProfile = before;

          await serviceClient
            .from("teacher_registrations")
            .update({
              status: "REJECTED",
              rejection_reason: reason,
              reviewed_by: actor.id,
              reviewed_at: nowIso,
              updated_at: nowIso,
            })
            .eq("user_id", teacherId);

          await writeAuditLog(serviceClient, actor, {
            action: "REJECT_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: before?.full_name || before?.email || body.email,
            summary: `Từ chối đăng ký giáo viên: ${reason}`,
            beforeData: before,
          });
        } else {
          const { data: prof } = await db.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
          targetProfile = prof;
        }

        await notifyTeacherDecision(supabaseUrl, activeAnonKey, {
          type: "TEACHER_REJECTED",
          teacherEmail: targetProfile?.email || body.email,
          teacherName: targetProfile?.full_name || body.fullName,
          reason,
        });

        return res.status(200).json({ ok: true });
      }

      case "update_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_update_teacher", {
          p_user_id: teacherId,
          p_full_name: body.fullName ?? null,
          p_username: body.username ?? null,
          p_phone: body.phone ?? null,
          p_school_name: body.schoolName ?? null,
          p_subject_name: body.subjectName ?? null,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể cập nhật." });
          }
          const nowIso = new Date().toISOString();
          const { before, error: upErr } = await ensureServiceProfileUpsert(serviceClient, teacherId, {
            ...(body.fullName !== undefined ? { full_name: body.fullName } : {}),
            ...(body.username !== undefined ? { username: body.username } : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.schoolName !== undefined ? { school_name: body.schoolName } : {}),
            ...(body.subjectName !== undefined ? { subject_name: body.subjectName } : {}),
            updated_at: nowIso,
          });
          if (upErr) return res.status(400).json({ ok: false, error: upErr.message });

          await writeAuditLog(serviceClient, actor, {
            action: "UPDATE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: body.fullName || before?.email,
            summary: `Cập nhật thông tin giáo viên ${before?.email || teacherId}`,
            beforeData: before,
          });
        }

        return res.status(200).json({ ok: true });
      }

      case "lock_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: target } = await db.from("profiles").select("email, role").eq("id", teacherId).maybeSingle();
        if ((target?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || target?.role === "super_admin") {
          return res.status(403).json({ ok: false, error: "Không thể khóa tài khoản Super Admin!" });
        }

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_lock_teacher", {
          p_user_id: teacherId,
          p_reason: body.reason || null,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể khóa." });
          }
          const nowIso = new Date().toISOString();
          await ensureServiceProfileUpsert(serviceClient, teacherId, {
            status: "locked",
            approval_status: "LOCKED",
            locked_at: nowIso,
            locked_by: actor.id,
            updated_at: nowIso,
          });
          await writeAuditLog(serviceClient, actor, {
            action: "LOCK_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: target?.email,
            summary: `Khóa tài khoản giáo viên ${target?.email || teacherId}`,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
          await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
        }

        return res.status(200).json({ ok: true });
      }

      case "unlock_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_unlock_teacher", {
          p_user_id: teacherId,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể mở khóa." });
          }
          const nowIso = new Date().toISOString();
          await ensureServiceProfileUpsert(serviceClient, teacherId, {
            status: "active",
            approval_status: "APPROVED",
            approved_at: nowIso,
            locked_at: null,
            locked_by: null,
            is_deleted: false,
            updated_at: nowIso,
          });
          await serviceClient
            .from("teacher_registrations")
            .update({ status: "APPROVED", updated_at: nowIso })
            .eq("user_id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "UNLOCK_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            summary: `Mở khóa tài khoản giáo viên ${teacherId}`,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "none" }).catch(() => {});
        }

        return res.status(200).json({ ok: true });
      }

      case "delete_teacher": {
        const teacherId = String(body.teacherId || "");
        const preserveData = body.preserveData !== false;
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: target } = await db.from("profiles").select("email, role").eq("id", teacherId).maybeSingle();
        if ((target?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || target?.role === "super_admin") {
          return res.status(403).json({ ok: false, error: "Không thể xóa tài khoản Super Admin!" });
        }

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_delete_teacher", {
          p_user_id: teacherId,
          p_preserve_data: preserveData,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể xóa tài khoản." });
          }
          const nowIso = new Date().toISOString();
          if (preserveData) {
            await ensureServiceProfileUpsert(serviceClient, teacherId, {
              is_deleted: true,
              deleted_at: nowIso,
              status: "locked",
              approval_status: "LOCKED",
              updated_at: nowIso,
            });
            await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
            await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
          } else {
            const { data: teacherExams } = await serviceClient.from("exams").select("id").eq("created_by", teacherId);
            const examIds = (teacherExams || []).map((e: any) => e.id);
            if (examIds.length > 0) {
              await serviceClient.from("submissions").delete().in("exam_id", examIds);
              await serviceClient.from("exams").delete().in("id", examIds);
            }
            await serviceClient.from("exam_folders").delete().eq("teacher_id", teacherId);
            await serviceClient.from("teacher_registrations").delete().eq("user_id", teacherId);
            await serviceClient.from("user_roles").delete().eq("user_id", teacherId);
            await serviceClient.from("profiles").delete().eq("id", teacherId);
            await serviceClient.auth.admin.deleteUser(teacherId).catch(() => {});
          }
          await writeAuditLog(serviceClient, actor, {
            action: preserveData ? "ARCHIVE_TEACHER" : "DELETE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: target?.email,
            summary: preserveData
              ? `Lưu trữ tài khoản ${target?.email || teacherId} (giữ nguyên đề thi và kết quả)`
              : `Xóa vĩnh viễn tài khoản ${target?.email || teacherId} và dữ liệu`,
          });
        } else if (serviceClient) {
          if (preserveData) {
            await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
            await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
          } else {
            await serviceClient.auth.admin.deleteUser(teacherId).catch(() => {});
          }
        }

        return res.status(200).json({ ok: true, preserveData });
      }

      case "get_teacher_data": {
        const teacherId = String(body.teacherId || req.query?.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const [profRes, foldersRes, examsRes] = await Promise.all([
          db.from("profiles").select("*").eq("id", teacherId).maybeSingle(),
          db.from("exam_folders").select("*").eq("teacher_id", teacherId).order("name", { ascending: true }),
          db.from("exams").select("*").eq("created_by", teacherId).order("created_at", { ascending: false }),
        ]);

        const exams = (examsRes.data || []).filter((e: any) => !e.is_deleted);
        const folders = (foldersRes.data || []).filter((f: any) => !f.is_deleted);
        const examIds = exams.map((e: any) => e.id);

        let submissions: any[] = [];
        if (examIds.length > 0) {
          const { data: subs } = await db
            .from("submissions")
            .select("*")
            .in("exam_id", examIds)
            .order("submitted_at", { ascending: false });
          submissions = subs || [];
        }

        const subjects = Array.from(
          new Set([profRes.data?.subject_name, ...exams.map((e: any) => e.subject_name)].filter(Boolean))
        );
        const schools = Array.from(
          new Set([profRes.data?.school_name, ...exams.map((e: any) => e.school_name)].filter(Boolean))
        );

        return res.status(200).json({
          ok: true,
          teacher: profRes.data || null,
          folders,
          exams,
          submissions,
          subjects,
          schools,
        });
      }

      case "save_exam": {
        const exam = body.exam || {};
        if (!exam.title) {
          return res.status(400).json({ ok: false, error: "Tiêu đề đề thi không được để trống." });
        }

        const isUpdate = Boolean(exam.id);
        let beforeData: any = null;
        if (isUpdate) {
          const { data: oldEx } = await db.from("exams").select("*").eq("id", exam.id).maybeSingle();
          beforeData = oldEx;
        }

        const payload: Record<string, any> = {
          title: exam.title,
          duration_minutes: Number(exam.duration_minutes) || 45,
          subject_name: exam.subject_name ?? null,
          school_name: exam.school_name ?? null,
          teacher_name: exam.teacher_name ?? beforeData?.teacher_name ?? null,
          folder_id: exam.folder_id ?? null,
          manual_closed: !!exam.manual_closed,
          allow_review: exam.allow_review !== false,
          instant_feedback: !!exam.instant_feedback,
          auto_submit_on_close: exam.auto_submit_on_close !== false,
          display_mode: exam.display_mode || "standard",
          open_at: exam.open_at || null,
          close_at: exam.close_at || null,
          scoring: exam.scoring ?? beforeData?.scoring ?? {},
          scoring_mode: exam.scoring_mode || beforeData?.scoring_mode || "equal",
          shuffle_questions: !!exam.shuffle_questions,
          shuffle_options: !!exam.shuffle_options,
          questions: exam.questions ?? beforeData?.questions ?? { partI: [], partII: [], partIII: [] },
          lock_mode: exam.lock_mode ?? beforeData?.lock_mode ?? {},
          team_config: exam.team_config ?? beforeData?.team_config ?? {},
        };

        if (!isUpdate && exam.created_by) {
          payload.created_by = exam.created_by;
        }

        let saved: any = null;
        if (isUpdate && beforeData) {
          const { data, error } = await db.from("exams").update(payload).eq("id", exam.id).select("*").single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          saved = data;
        } else {
          if (exam.id) payload.id = exam.id;
          const { data, error } = await db.from("exams").insert(payload).select("*").single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          saved = data;
        }

        await writeAuditLog(db, actor, {
          action: isUpdate ? "UPDATE_EXAM" : "CREATE_EXAM",
          targetType: "exam",
          targetId: saved?.id || exam.id,
          targetLabel: saved?.title || exam.title,
          summary: `${isUpdate ? "Chỉnh sửa" : "Tạo mới"} đề thi "${saved?.title || exam.title}"`,
        });

        return res.status(200).json({ ok: true, exam: saved });
      }

      case "delete_exam": {
        const examId = String(body.examId || "");
        const hardDelete = !!body.hardDelete;
        if (!examId) return res.status(400).json({ ok: false, error: "Thiếu ID đề thi." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_delete_exam", {
          p_exam_id: examId,
          p_hard_delete: hardDelete,
        });

        if (rpcErr || !rpcRes?.ok) {
          const { count: subCount } = await db
            .from("submissions")
            .select("id", { count: "exact", head: true })
            .eq("exam_id", examId);
          const { data: ex } = await db.from("exams").select("title").eq("id", examId).maybeSingle();

          if (!hardDelete && (subCount || 0) > 0) {
            await db
              .from("exams")
              .update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                deleted_by: actor.id,
                manual_closed: true,
              })
              .eq("id", examId);
          } else {
            if ((subCount || 0) > 0) {
              await db.from("submissions").delete().eq("exam_id", examId);
            }
            await db.from("exams").delete().eq("id", examId);
          }

          await writeAuditLog(db, actor, {
            action: "DELETE_EXAM",
            targetType: "exam",
            targetId: examId,
            targetLabel: ex?.title || examId,
            summary: `Xóa đề thi "${ex?.title || examId}" (${subCount || 0} bài nộp)`,
          });
        }

        return res.status(200).json({ ok: true });
      }

      case "save_folder": {
        const folder = body.folder || {};
        if (!folder.name?.trim()) {
          return res.status(400).json({ ok: false, error: "Tên thư mục không được để trống." });
        }
        const nowIso = new Date().toISOString();
        if (folder.id) {
          const { data, error } = await db
            .from("exam_folders")
            .update({
              name: folder.name.trim(),
              description: folder.description ?? null,
              color: folder.color || "sky",
              icon: folder.icon || "folder",
              parent_id: folder.parent_id ?? null,
              updated_at: nowIso,
            })
            .eq("id", folder.id)
            .select("*")
            .single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          await writeAuditLog(db, actor, {
            action: "UPDATE_FOLDER",
            targetType: "folder",
            targetId: folder.id,
            targetLabel: folder.name,
            summary: `Cập nhật thư mục "${folder.name}"`,
          });
          return res.status(200).json({ ok: true, folder: data });
        } else {
          const { data, error } = await db
            .from("exam_folders")
            .insert({
              name: folder.name.trim(),
              description: folder.description ?? null,
              color: folder.color || "sky",
              icon: folder.icon || "folder",
              parent_id: folder.parent_id ?? null,
              teacher_id: folder.teacher_id ?? null,
              created_at: nowIso,
              updated_at: nowIso,
            })
            .select("*")
            .single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          await writeAuditLog(db, actor, {
            action: "CREATE_FOLDER",
            targetType: "folder",
            targetId: data?.id,
            targetLabel: folder.name,
            summary: `Tạo thư mục "${folder.name}" cho giáo viên`,
          });
          return res.status(200).json({ ok: true, folder: data });
        }
      }

      case "delete_folder": {
        const folderId = String(body.folderId || "");
        if (!folderId) return res.status(400).json({ ok: false, error: "Thiếu ID thư mục." });

        const { data: target } = await db.from("exam_folders").select("*").eq("id", folderId).maybeSingle();
        await db.from("exam_folders").update({ parent_id: target?.parent_id ?? null }).eq("parent_id", folderId);
        await db.from("exams").update({ folder_id: null }).eq("folder_id", folderId);
        const { error } = await db.from("exam_folders").delete().eq("id", folderId);
        if (error) return res.status(400).json({ ok: false, error: error.message });

        await writeAuditLog(db, actor, {
          action: "DELETE_FOLDER",
          targetType: "folder",
          targetId: folderId,
          targetLabel: target?.name || folderId,
          summary: `Xóa thư mục "${target?.name || folderId}" (giữ nguyên toàn bộ đề thi bên trong)`,
        });
        return res.status(200).json({ ok: true });
      }

      case "list_exams_system": {
        const [examsRes, subsRes] = await Promise.all([
          fetchAllRows(db, "exams", "*", { orderCol: "created_at", ascending: false }),
          fetchAllRows(db, "submissions", "id, exam_id"),
        ]);
        const counts: Record<string, number> = {};
        for (const s of subsRes.rows) {
          counts[s.exam_id] = (counts[s.exam_id] || 0) + 1;
        }
        const exams = examsRes.rows.filter((e: any) => !e.is_deleted);
        return res.status(200).json({ ok: true, exams, submissionCounts: counts });
      }

      case "list_activity_logs": {
        const limit = Math.min(Number(body.limit) || 200, 500);
        const { data, error } = await db
          .from("admin_activity_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return res.status(200).json({ ok: true, logs: [] });
        const logs = (data || []).map((row: any) => ({
          ...row,
          actor_id: row.admin_id || row.actor_id || null,
          actor_email: row.admin_email || row.actor_email || SUPER_ADMIN_EMAIL,
          summary: row.detail || row.summary || "",
        }));
        return res.status(200).json({ ok: true, logs });
      }

      case "change_super_admin_password": {
        const newPassword = String(body.newPassword || "");
        if (newPassword.length < 6 || newPassword === "123456") {
          return res.status(400).json({
            ok: false,
            error: "Mật khẩu mới phải từ 6 ký tự trở lên và không được là 123456.",
          });
        }
        if (serviceClient) {
          const { error: updErr } = await serviceClient.auth.admin.updateUserById(caller.id, {
            password: newPassword,
          });
          if (updErr) return res.status(400).json({ ok: false, error: updErr.message });
        } else {
          const { error: updErr } = await callerClient.auth.updateUser({ password: newPassword });
          if (updErr) return res.status(400).json({ ok: false, error: updErr.message });
        }
        await db
          .from("profiles")
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq("id", caller.id);
        await writeAuditLog(db, actor, {
          action: "CHANGE_SUPER_ADMIN_PASSWORD",
          targetType: "system",
          targetId: caller.id,
          targetLabel: actor.email,
          summary: "Super Admin đổi mật khẩu tài khoản quản trị.",
        });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ ok: false, error: `Action không được hỗ trợ: ${action}` });
    }
  } catch (err: any) {
    console.error("[admin-api] unexpected error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Lỗi máy chủ nội bộ." });
  }
}
