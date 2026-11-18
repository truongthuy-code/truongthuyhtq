import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
  useCallback,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import {
  getCurrentAuthUser,
  setCurrentAuthUser,
  logoutCurrentUser,
  getTeacherById,
  getTeacherByUsernameOrEmail,
  getAdminById,
  getAdminByUsernameOrEmail,
  saveAdminAccount,
  upsertTeacher,
  AuthSessionUser,
  TeacherUser,
  ApprovalStatus,
  SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
} from "@/lib/teacherStorage";
import {
  AuthTimeoutError,
  ensureSupabaseSession,
  withAuthTimeout,
} from "@/lib/supabaseAuthSync";
import { performFullLogout } from "@/lib/authCleanup";

export type Role = "super_admin" | "admin" | "teacher";

export const AUTH_TIMEOUT_CONFIG = {
  STEP_TIMEOUT_MS: 4500,
  OVERALL_INIT_TIMEOUT_MS: 9500,
};

export type TeacherProfile = {
  id: string;
  email: string | null;
  username?: string | null;
  full_name: string | null;
  phone: string | null;
  subject_id: string | null;
  subject_name: string | null;
  school_id: string | null;
  school_name: string | null;
  profile_completed: boolean;
  avatar?: string | null;
  status?: "active" | "locked" | "pending" | "rejected";
  approval_status?: ApprovalStatus;
  rejection_reason?: string | null;
};

type SyncOptions = {
  sessionOverride?: Session | null;
  hasSessionOverride?: boolean;
  force?: boolean;
  background?: boolean;
  reason?: string;
};

type AuthCtx = {
  session: Session | null;
  user: { id: string; email?: string | null; role?: Role; mustChangePassword?: boolean } | null;
  roles: Role[];
  role: Role | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  mustChangePassword: boolean;
  approvalStatus: ApprovalStatus | null;
  rejectionReason: string | null;
  accountBlockReason: string | null;
  loading: boolean;
  authError: string | null;
  profile: TeacherProfile | null;
  refreshProfile: () => Promise<void>;
  retryAuth: () => Promise<void>;
  updateTeacherProfile: (updates: Partial<TeacherUser>) => Promise<boolean>;
  signOut: (options?: { redirectTo?: string; redirect?: boolean }) => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  roles: [],
  role: null,
  isSuperAdmin: false,
  isAdmin: false,
  isTeacher: false,
  mustChangePassword: false,
  approvalStatus: null,
  rejectionReason: null,
  accountBlockReason: null,
  loading: true,
  authError: null,
  profile: null,
  refreshProfile: async () => {},
  retryAuth: async () => {},
  updateTeacherProfile: async () => false,
  signOut: async () => {},
});

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logAuthDiag(step: string, startMs: number, outcome: string, detail?: string) {
  const elapsed = Math.round(nowMs() - startMs);
  const msg = `[AuthDiag] ${step} (${elapsed}ms) -> ${outcome}${detail ? ` | ${detail}` : ""}`;
  if (outcome === "timeout" || outcome === "error") {
    console.warn(msg);
  } else if (import.meta.env.DEV) {
    console.info(msg);
  }
}

function isRpcMissingError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "").toUpperCase();
  const status = Number(err.status || err.statusCode || 0);
  const msg = String(err.message || "").toLowerCase();
  return (
    code === "PGRST202" ||
    code === "42883" ||
    status === 404 ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist")
  );
}

function isMissingTableError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "").toUpperCase();
  const status = Number(err.status || err.statusCode || 0);
  const msg = String(err.message || "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    status === 404 ||
    msg.includes("could not find the table") ||
    msg.includes("does not exist")
  );
}

function isConnectionOrTimeoutError(err: any): boolean {
  if (!err) return false;
  if (err instanceof AuthTimeoutError || err?.name === "AuthTimeoutError") return true;
  if (err?.name === "AuthRetryableFetchError") return true;
  const status = Number(err.status || err.statusCode || 0);
  if (status >= 500) return true;
  const msg = String(err.message || err || "").toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("offline")
  );
}

function deriveApprovalStatus(
  profileRow: any,
  localTeacher: TeacherUser | null,
  isSuper: boolean
): { approvalStatus: ApprovalStatus; rejectionReason: string | null; blockReason: string | null } {
  if (isSuper) {
    return { approvalStatus: "APPROVED", rejectionReason: null, blockReason: null };
  }

  if (profileRow) {
    if (profileRow.is_deleted) {
      return {
        approvalStatus: "LOCKED",
        rejectionReason: null,
        blockReason: "Tài khoản giáo viên này đã bị khóa hoặc lưu trữ bởi Quản trị viên.",
      };
    }

    const rawApproval = String(profileRow.approval_status || "").toUpperCase();
    const rawStatus = String(profileRow.status || "").toLowerCase();

    if (rawApproval === "LOCKED" || rawStatus === "locked") {
      return {
        approvalStatus: "LOCKED",
        rejectionReason: null,
        blockReason: "Tài khoản của bạn đã bị Quản trị viên tạm khóa. Vui lòng liên hệ Super Admin.",
      };
    }
    if (rawApproval === "REJECTED" || rawStatus === "rejected") {
      const reason = profileRow.rejection_reason || "Đăng ký chưa đáp ứng điều kiện xét duyệt.";
      return {
        approvalStatus: "REJECTED",
        rejectionReason: reason,
        blockReason: `Tài khoản của bạn đã bị từ chối: ${reason}`,
      };
    }
    if (rawApproval === "PENDING" || rawStatus === "pending") {
      return {
        approvalStatus: "PENDING",
        rejectionReason: null,
        blockReason: "Tài khoản của bạn đang chờ Quản trị viên phê duyệt trước khi sử dụng.",
      };
    }
    return { approvalStatus: "APPROVED", rejectionReason: null, blockReason: null };
  }

  if (localTeacher) {
    if (localTeacher.status === "locked" || localTeacher.approvalStatus === "LOCKED") {
      return {
        approvalStatus: "LOCKED",
        rejectionReason: null,
        blockReason: "Tài khoản của bạn đã bị Quản trị viên tạm khóa.",
      };
    }
    if (localTeacher.status === "rejected" || localTeacher.approvalStatus === "REJECTED") {
      const reason = localTeacher.rejectionReason || "Không đáp ứng điều kiện xét duyệt.";
      return {
        approvalStatus: "REJECTED",
        rejectionReason: reason,
        blockReason: `Tài khoản đã bị từ chối: ${reason}`,
      };
    }
    if (localTeacher.status === "pending" || localTeacher.approvalStatus === "PENDING") {
      return {
        approvalStatus: "PENDING",
        rejectionReason: null,
        blockReason: "Tài khoản đang chờ Quản trị viên phê duyệt.",
      };
    }
  }

  return { approvalStatus: "APPROVED", rejectionReason: null, blockReason: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const [user, setUser] = useState<{
    id: string;
    email?: string | null;
    role?: Role;
    mustChangePassword?: boolean;
  } | null>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return null;
    const isSuper = custom.role === "super_admin" || isSuperAdminEmail(custom.email);
    const roleVal: Role = isSuper ? "super_admin" : "teacher";
    return {
      id: custom.id,
      email: custom.email,
      role: roleVal,
      mustChangePassword: isSuper ? !!custom.mustChangePassword : false,
    };
  });

  const [roles, setRoles] = useState<Role[]>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return [];
    const isSuper = custom.role === "super_admin" || isSuperAdminEmail(custom.email);
    return [isSuper ? "super_admin" : "teacher"];
  });

  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | null>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return null;
    if (custom.role === "super_admin" || isSuperAdminEmail(custom.email)) return "APPROVED";
    return custom.approvalStatus || "APPROVED";
  });

  const [rejectionReason, setRejectionReason] = useState<string | null>(() => {
    return getCurrentAuthUser()?.rejectionReason || null;
  });

  const [accountBlockReason, setAccountBlockReason] = useState<string | null>(null);

  const [profile, setProfile] = useState<TeacherProfile | null>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return null;
    const isSuper = custom.role === "super_admin" || isSuperAdminEmail(custom.email);
    if (isSuper) {
      return {
        id: custom.id,
        email: SUPER_ADMIN_EMAIL,
        username: custom.username || "bichthuylqd",
        full_name: custom.name || "Trương Thị Bích Thủy",
        phone: custom.phone || "",
        subject_id: null,
        subject_name: "Toàn quyền Quản trị Super Admin",
        school_id: null,
        school_name: "Hệ thống Quản trị",
        profile_completed: true,
        status: "active",
        approval_status: "APPROVED",
      };
    }
    const teacher = getTeacherById(custom.id) || getTeacherByUsernameOrEmail(custom.username || custom.email);
    return {
      id: custom.id,
      email: custom.email || teacher?.email || "",
      username: custom.username || teacher?.username || "",
      full_name: custom.name || teacher?.name || "Giáo viên",
      phone: custom.phone || teacher?.phone || "",
      subject_id: null,
      subject_name: custom.subject || teacher?.subject || "",
      school_id: null,
      school_name: custom.school || teacher?.school || "",
      profile_completed: true,
      avatar: custom.avatar || teacher?.avatar,
      status: teacher?.status || "active",
      approval_status: custom.approvalStatus || teacher?.approvalStatus || "APPROVED",
    };
  });

  const [mustChangePassword, setMustChangePassword] = useState(() => {
    const custom = getCurrentAuthUser();
    const isSuper = custom?.role === "super_admin" || isSuperAdminEmail(custom?.email);
    return isSuper ? !!custom?.mustChangePassword : false;
  });

  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const syncSeqRef = useRef(0);
  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const queuedSyncRef = useRef<SyncOptions | null>(null);
  const lastVerifiedUserIdRef = useRef<string | null>(null);
  const initialMountResolvedRef = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  const clearUnauthenticatedState = useCallback((errorMessage: string | null) => {
    if (!mountedRef.current) return;
    lastVerifiedUserIdRef.current = null;
    setUser(null);
    setRoles([]);
    setProfile(null);
    setMustChangePassword(false);
    setApprovalStatus(null);
    setRejectionReason(null);
    setAccountBlockReason(null);
    setAuthError(errorMessage);
  }, []);

  const executeSync = useCallback(
    async (opts: SyncOptions = {}) => {
      const seq = ++syncSeqRef.current;
      const syncStart = nowMs();
      const reason = opts.reason || "sync";
      const isCurrentSeq = () => mountedRef.current && syncSeqRef.current === seq;

      let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
      let watchdogTripped = false;

      if (!opts.background && mountedRef.current) {
        setAuthError(null);
      }

      const watchdogPromise = new Promise<never>((_, reject) => {
        watchdogTimer = setTimeout(() => {
          watchdogTripped = true;
          reject(new AuthTimeoutError("overall_auth_init", AUTH_TIMEOUT_CONFIG.OVERALL_INIT_TIMEOUT_MS));
        }, AUTH_TIMEOUT_CONFIG.OVERALL_INIT_TIMEOUT_MS);
      });

      const work = async () => {
        // 1. Resolve Supabase Auth session (reuse delivered session from onAuthStateChange when available)
        let sbSession: Session | null = null;
        if (opts.hasSessionOverride) {
          sbSession = opts.sessionOverride ?? null;
          logAuthDiag(`session(${reason})`, syncStart, sbSession ? "override_hit" : "override_empty");
        } else {
          const stepStart = nowMs();
          try {
            const res = await withAuthTimeout(
              supabase.auth.getSession(),
              AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS,
              "supabase.auth.getSession"
            );
            if (res?.error && isConnectionOrTimeoutError(res.error)) {
              throw res.error;
            }
            sbSession = res?.data?.session ?? null;
            logAuthDiag(`getSession(${reason})`, stepStart, sbSession ? "ok_session" : "ok_anonymous");
          } catch (err: any) {
            const outcome = err instanceof AuthTimeoutError ? "timeout" : "error";
            logAuthDiag(`getSession(${reason})`, stepStart, outcome, err?.message);
            if (!isCurrentSeq()) return;
            clearUnauthenticatedState(
              "Không thể kết nối tới máy chủ xác thực (quá thời gian chờ hoặc lỗi mạng). Vui lòng thử lại."
            );
            return;
          }
        }

        if (!isCurrentSeq()) return;
        setSession(sbSession);

        const customUser = getCurrentAuthUser();

        // 2. Authoritative Supabase Auth session path
        if (sbSession?.user) {
          const sbUser = sbSession.user;
          const sbEmail = (sbUser.email || "").trim().toLowerCase();
          const isEmailSuper = isSuperAdminEmail(sbEmail);

          let statePayload: any = null;
          let rpcNetworkFailure = false;

          const rpcStart = nowMs();
          try {
            const { data: rpcState, error: rpcErr } = await withAuthTimeout(
              (supabase as any).rpc("get_my_account_state"),
              AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS,
              "rpc.get_my_account_state"
            );
            if (!rpcErr && rpcState && rpcState.authenticated !== false) {
              statePayload = rpcState;
              logAuthDiag("rpc.get_my_account_state", rpcStart, "ok");
            } else if (isRpcMissingError(rpcErr)) {
              logAuthDiag("rpc.get_my_account_state", rpcStart, "rpc_missing");
            } else if (rpcErr) {
              rpcNetworkFailure = isConnectionOrTimeoutError(rpcErr);
              logAuthDiag("rpc.get_my_account_state", rpcStart, "error", rpcErr.message);
            } else {
              logAuthDiag("rpc.get_my_account_state", rpcStart, "empty");
            }
          } catch (err: any) {
            rpcNetworkFailure = isConnectionOrTimeoutError(err);
            logAuthDiag(
              "rpc.get_my_account_state",
              rpcStart,
              err instanceof AuthTimeoutError ? "timeout" : "error",
              err?.message
            );
          }

          if (!isCurrentSeq()) return;

          let roleRows: any[] | null = null;
          let profRow: any = null;
          let dbVerificationFailed = false;

          if (!statePayload) {
            const dbStart = nowMs();
            try {
              const [rolesRes, profRes] = await withAuthTimeout(
                Promise.all([
                  supabase.from("user_roles").select("role").eq("user_id", sbUser.id),
                  supabase.from("profiles").select("*").eq("id", sbUser.id).maybeSingle(),
                ]),
                AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS,
                "db.roles_and_profile"
              );

              if (rolesRes?.error && !isMissingTableError(rolesRes.error)) {
                logAuthDiag("db.user_roles", dbStart, "error", rolesRes.error.message);
              }
              if (profRes?.error && !isMissingTableError(profRes.error)) {
                if (isConnectionOrTimeoutError(profRes.error)) {
                  dbVerificationFailed = true;
                }
                logAuthDiag("db.profiles", dbStart, "error", profRes.error.message);
              } else {
                logAuthDiag("db.roles_and_profile", dbStart, profRes?.data ? "ok_row" : "ok_no_row");
              }

              roleRows = rolesRes?.data || null;
              profRow = profRes?.data || null;
            } catch (err: any) {
              dbVerificationFailed = true;
              logAuthDiag(
                "db.roles_and_profile",
                dbStart,
                err instanceof AuthTimeoutError ? "timeout" : "error",
                err?.message
              );
            }
          }

          if (!isCurrentSeq()) return;

          // If BOTH primary RPC and fallback DB profile query failed due to network/timeout,
          // NEVER grant unverified access — show explicit connection error + Retry button.
          if (!statePayload && (dbVerificationFailed || (rpcNetworkFailure && !profRow))) {
            clearUnauthenticatedState(
              "Không thể xác minh quyền truy cập từ Supabase (mất kết nối hoặc quá thời gian chờ). Vui lòng thử lại."
            );
            return;
          }

          let effectiveProfile = statePayload || profRow;

          // Legacy / registration check ONLY for non-Super-Admin teachers when profile is absent or flagged missing
          if (!isEmailSuper && (!effectiveProfile || effectiveProfile.missing_profile)) {
            const regStart = nowMs();
            try {
              const { data: regRow, error: regErr } = await withAuthTimeout(
                (supabase as any)
                  .from("teacher_registrations")
                  .select("status, rejection_reason")
                  .eq("user_id", sbUser.id)
                  .maybeSingle(),
                AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS,
                "db.teacher_registrations"
              );
              if (regErr) {
                if (isMissingTableError(regErr)) {
                  logAuthDiag("db.teacher_registrations", regStart, "table_missing");
                } else if (isConnectionOrTimeoutError(regErr)) {
                  logAuthDiag("db.teacher_registrations", regStart, "error", regErr.message);
                  clearUnauthenticatedState(
                    "Không thể kiểm tra trạng thái phê duyệt giáo viên do lỗi kết nối. Vui lòng thử lại."
                  );
                  return;
                }
              } else {
                logAuthDiag("db.teacher_registrations", regStart, regRow ? `ok_${regRow.status}` : "ok_none");
              }

              if (!regRow && effectiveProfile?.missing_profile) {
                effectiveProfile = { ...effectiveProfile, status: "active", approval_status: "APPROVED" };
              } else if (regRow?.status === "APPROVED") {
                effectiveProfile = { ...(effectiveProfile || {}), status: "active", approval_status: "APPROVED" };
              } else if (regRow && !effectiveProfile) {
                effectiveProfile = {
                  status: String(regRow.status || "").toLowerCase(),
                  approval_status: regRow.status,
                  rejection_reason: regRow.rejection_reason || null,
                };
              }
            } catch (err: any) {
              logAuthDiag(
                "db.teacher_registrations",
                regStart,
                err instanceof AuthTimeoutError ? "timeout" : "error",
                err?.message
              );
              if (isConnectionOrTimeoutError(err)) {
                clearUnauthenticatedState(
                  "Kiểm tra trạng thái phê duyệt tài khoản bị quá thời gian chờ. Vui lòng thử lại."
                );
                return;
              }
            }
          }

          if (!isCurrentSeq()) return;

          const mappedRoles = (roleRows || []).map((x: any) => x.role as Role);
          const isSuper =
            isEmailSuper ||
            statePayload?.role === "super_admin" ||
            statePayload?.is_super_admin === true ||
            mappedRoles.includes("super_admin") ||
            effectiveProfile?.role === "super_admin";

          const roleVal: Role = isSuper ? "super_admin" : "teacher";
          const mustChange = isSuper
            ? Boolean(statePayload?.must_change_password ?? profRow?.must_change_password ?? customUser?.mustChangePassword)
            : false;

          const approvalInfo = deriveApprovalStatus(effectiveProfile, null, isSuper);

          lastVerifiedUserIdRef.current = sbUser.id;
          setAuthError(null);
          setUser({
            id: sbUser.id,
            email: sbEmail,
            role: roleVal,
            mustChangePassword: mustChange,
          });
          setRoles([roleVal]);
          setMustChangePassword(mustChange);
          setApprovalStatus(approvalInfo.approvalStatus);
          setRejectionReason(approvalInfo.rejectionReason);
          setAccountBlockReason(approvalInfo.blockReason);

          const nextProfile: TeacherProfile = {
            id: sbUser.id,
            email: sbEmail,
            username: effectiveProfile?.username || sbEmail.split("@")[0],
            full_name:
              effectiveProfile?.full_name ||
              sbUser.user_metadata?.full_name ||
              (isSuper ? "Trương Thị Bích Thủy" : sbEmail.split("@")[0]),
            phone: effectiveProfile?.phone || "",
            subject_id: null,
            subject_name: isSuper
              ? "Toàn quyền Quản trị Super Admin"
              : effectiveProfile?.subject_name || "Tin học",
            school_id: null,
            school_name: isSuper ? "Hệ thống Quản trị" : effectiveProfile?.school_name || "",
            profile_completed: true,
            avatar: (effectiveProfile as any)?.avatar || customUser?.avatar || null,
            status: (effectiveProfile?.status as any) || "active",
            approval_status: approvalInfo.approvalStatus,
            rejection_reason: approvalInfo.rejectionReason,
          };
          setProfile(nextProfile);

          // Silent cache sync ONLY — never dispatch app_auth_change / teacher_registry_changed from inside syncState!
          if (isSuper || approvalInfo.approvalStatus === "APPROVED") {
            setCurrentAuthUser(
              {
                id: sbUser.id,
                username: nextProfile.username || sbEmail.split("@")[0],
                name: nextProfile.full_name || "Giáo viên",
                email: sbEmail,
                role: roleVal,
                approvalStatus: approvalInfo.approvalStatus,
                mustChangePassword: mustChange,
                phone: nextProfile.phone || "",
                school: nextProfile.school_name || "",
                subject: nextProfile.subject_name || "",
                avatar: nextProfile.avatar || undefined,
              },
              { silent: true }
            );
          } else {
            setCurrentAuthUser(null, { silent: true });
          }

          logAuthDiag(`complete(${reason})`, syncStart, `${roleVal}:${approvalInfo.approvalStatus}`);
          return;
        }

        // 3. Fallback to local session ONLY when Supabase returned cleanly with no active session
        // (supports offline/Vitest test accounts without hanging)
        if (customUser) {
          const isSuper = customUser.role === "super_admin" || isSuperAdminEmail(customUser.email);
          const roleVal: Role = isSuper ? "super_admin" : "teacher";
          const localTeacher = !isSuper
            ? getTeacherById(customUser.id) || getTeacherByUsernameOrEmail(customUser.username || customUser.email)
            : null;
          const approvalInfo = deriveApprovalStatus(null, localTeacher, isSuper);

          lastVerifiedUserIdRef.current = customUser.id;
          setAuthError(null);
          setUser({
            id: customUser.id,
            email: isSuper ? SUPER_ADMIN_EMAIL : customUser.email,
            role: roleVal,
            mustChangePassword: isSuper ? !!customUser.mustChangePassword : false,
          });
          setRoles([roleVal]);
          setMustChangePassword(isSuper ? !!customUser.mustChangePassword : false);
          setApprovalStatus(approvalInfo.approvalStatus);
          setRejectionReason(approvalInfo.rejectionReason);
          setAccountBlockReason(approvalInfo.blockReason);

          if (isSuper) {
            setProfile({
              id: customUser.id,
              email: SUPER_ADMIN_EMAIL,
              username: customUser.username || "bichthuylqd",
              full_name: customUser.name || "Trương Thị Bích Thủy",
              phone: customUser.phone || "",
              subject_id: null,
              subject_name: "Toàn quyền Quản trị Super Admin",
              school_id: null,
              school_name: "Hệ thống Quản trị",
              profile_completed: true,
              status: "active",
              approval_status: "APPROVED",
            });
          } else {
            setProfile({
              id: customUser.id,
              email: customUser.email || localTeacher?.email || "",
              username: customUser.username || localTeacher?.username || "",
              full_name: customUser.name || localTeacher?.name || "Giáo viên",
              phone: customUser.phone || localTeacher?.phone || "",
              subject_id: null,
              subject_name: customUser.subject || localTeacher?.subject || "",
              school_id: null,
              school_name: customUser.school || localTeacher?.school || "",
              profile_completed: true,
              avatar: customUser.avatar || localTeacher?.avatar,
              status: localTeacher?.status || "active",
              approval_status: approvalInfo.approvalStatus,
              rejection_reason: approvalInfo.rejectionReason,
            });
          }

          ensureSupabaseSession(customUser).catch(() => {});
          logAuthDiag(`complete(${reason})`, syncStart, `local:${roleVal}:${approvalInfo.approvalStatus}`);
          return;
        }

        // 4. Clean unauthenticated state
        clearUnauthenticatedState(null);
        logAuthDiag(`complete(${reason})`, syncStart, "unauthenticated");
      };

      try {
        await Promise.race([work(), watchdogPromise]);
      } catch (err: any) {
        logAuthDiag(`sync(${reason})`, syncStart, watchdogTripped ? "watchdog_timeout" : "error", err?.message);
        if (isCurrentSeq()) {
          clearUnauthenticatedState(
            watchdogTripped
              ? "Quá trình kiểm tra quyền truy cập mất quá nhiều thời gian. Vui lòng thử lại."
              : "Không thể hoàn tất kiểm tra quyền truy cập. Vui lòng thử lại."
          );
        }
      } finally {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        initialMountResolvedRef.current = true;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [clearUnauthenticatedState]
  );

  const syncState = useCallback(
    async (opts: SyncOptions = {}): Promise<void> => {
      if (inFlightPromiseRef.current) {
        if (opts.force || opts.hasSessionOverride) {
          queuedSyncRef.current = opts;
        }
        return inFlightPromiseRef.current;
      }

      const runChain = async (initialOpts: SyncOptions) => {
        let nextOpts: SyncOptions | null = initialOpts;
        while (nextOpts && mountedRef.current) {
          const currentOpts = nextOpts;
          queuedSyncRef.current = null;
          await executeSync(currentOpts);
          nextOpts = queuedSyncRef.current;
        }
      };

      const promise = runChain(opts).finally(() => {
        if (inFlightPromiseRef.current === promise) {
          inFlightPromiseRef.current = null;
        }
      });

      inFlightPromiseRef.current = promise;
      return promise;
    },
    [executeSync]
  );

  useEffect(() => {
    mountedRef.current = true;
    void syncState({ reason: "mount" });

    const onAppAuth = () => {
      void syncState({ force: true, reason: "app_auth_change" });
    };
    const onRegistryChange = () => {
      void syncState({ reason: "registry_changed" });
    };
    const onStorage = (e: StorageEvent) => {
      if (
        !e.key ||
        e.key.startsWith("qc_") ||
        e.key.startsWith("sb-")
      ) {
        void syncState({ force: true, reason: `storage:${e.key || "clear"}` });
      }
    };

    window.addEventListener("app_auth_change", onAppAuth);
    window.addEventListener("teacher_registry_changed", onRegistryChange);
    window.addEventListener("admin_registry_changed", onRegistryChange);
    window.addEventListener("storage", onStorage);

    const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mountedRef.current) return;
      setSession(nextSession);

      const nextUid = nextSession?.user?.id ?? null;

      // Avoid redundant double-query when INITIAL_SESSION matches already-completed/in-flight mount check
      if (
        event === "INITIAL_SESSION" &&
        initialMountResolvedRef.current &&
        nextUid === lastVerifiedUserIdRef.current
      ) {
        return;
      }

      const isSilentRefresh =
        event === "TOKEN_REFRESHED" &&
        nextUid !== null &&
        nextUid === lastVerifiedUserIdRef.current &&
        Boolean(userRef.current);

      // CRITICAL: Defer outside GoTrue's internal lock callback to avoid navigator.locks deadlocks
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        if (!mountedRef.current) return;
        void syncState({
          sessionOverride: nextSession,
          hasSessionOverride: true,
          force: !isSilentRefresh,
          background: isSilentRefresh,
          reason: `onAuthStateChange:${event}`,
        });
      }, 0);
      pendingTimers.add(timer);
    });

    return () => {
      mountedRef.current = false;
      pendingTimers.forEach((t) => clearTimeout(t));
      pendingTimers.clear();
      window.removeEventListener("app_auth_change", onAppAuth);
      window.removeEventListener("teacher_registry_changed", onRegistryChange);
      window.removeEventListener("admin_registry_changed", onRegistryChange);
      window.removeEventListener("storage", onStorage);
      sub?.subscription?.unsubscribe();
    };
  }, [syncState]);

  const refreshProfile = useCallback(async () => {
    await syncState({ force: true, reason: "refreshProfile" });
  }, [syncState]);

  const retryAuth = useCallback(async () => {
    setAuthError(null);
    setLoading(true);
    await syncState({ force: true, reason: "manual_retry" });
  }, [syncState]);

  const updateTeacherProfile = useCallback(
    async (updates: Partial<TeacherUser>): Promise<boolean> => {
      const authUser = getCurrentAuthUser();
      if (!authUser) return false;

      const nextAuth: AuthSessionUser = {
        ...authUser,
        name: updates.name !== undefined ? updates.name : authUser.name,
        email: updates.email !== undefined ? updates.email : authUser.email,
        phone: updates.phone !== undefined ? updates.phone : authUser.phone,
        school: updates.school !== undefined ? updates.school : authUser.school,
        subject: updates.subject !== undefined ? updates.subject : authUser.subject,
        avatar: updates.avatar !== undefined ? updates.avatar : authUser.avatar,
      };
      setCurrentAuthUser(nextAuth, { silent: true });

      const teacher = getTeacherById(authUser.id) || getTeacherByUsernameOrEmail(authUser.username || authUser.email);
      if (teacher) {
        upsertTeacher(
          {
            ...teacher,
            ...updates,
            id: authUser.id,
            name: nextAuth.name,
            email: nextAuth.email,
            phone: nextAuth.phone || teacher.phone,
            school: nextAuth.school || teacher.school,
            subject: nextAuth.subject || teacher.subject,
            avatar: nextAuth.avatar || teacher.avatar,
            updatedAt: new Date().toISOString(),
          },
          { silent: true }
        );
      }

      if (authUser.role === "super_admin" || isSuperAdminEmail(authUser.email)) {
        const admin = getAdminById(authUser.id) || getAdminByUsernameOrEmail(authUser.email);
        if (admin) {
          saveAdminAccount({
            ...admin,
            name: nextAuth.name,
          });
        }
      }

      try {
        if (session?.user?.id) {
          await withAuthTimeout(
            supabase
              .from("profiles")
              .update({
                full_name: nextAuth.name,
                phone: nextAuth.phone,
                school_name: nextAuth.school,
                subject_name: nextAuth.subject,
                avatar: nextAuth.avatar,
              } as any)
              .eq("id", session.user.id),
            AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS,
            "updateTeacherProfile"
          );
        }
      } catch {}

      await syncState({ force: true, reason: "updateTeacherProfile" });
      return true;
    },
    [syncState, session]
  );

  const signOut = useCallback(async (options?: { redirectTo?: string; redirect?: boolean }) => {
    try {
      await withAuthTimeout(supabase.auth.signOut(), 3000, "signOut").catch(() => {});
    } catch (e) {
      console.warn("Supabase auth signOut warning:", e);
    }

    logoutCurrentUser();

    lastVerifiedUserIdRef.current = null;
    setUser(null);
    setSession(null);
    setRoles([]);
    setProfile(null);
    setMustChangePassword(false);
    setApprovalStatus(null);
    setRejectionReason(null);
    setAccountBlockReason(null);
    setAuthError(null);

    await performFullLogout({
      redirectTo: options?.redirectTo || "/auth",
      type: "teacher",
      redirect: options?.redirect !== false,
    });
  }, []);

  const isSuperAdmin =
    roles.includes("super_admin") || user?.role === "super_admin" || isSuperAdminEmail(user?.email);
  const isAdmin = isSuperAdmin;
  const isTeacher = !isSuperAdmin && (roles.includes("teacher") || !!user);

  return (
    <Ctx.Provider
      value={{
        session,
        user,
        roles,
        role: isSuperAdmin ? "super_admin" : user ? "teacher" : null,
        isSuperAdmin,
        isAdmin,
        isTeacher,
        mustChangePassword,
        approvalStatus,
        rejectionReason,
        accountBlockReason,
        loading,
        authError,
        profile,
        refreshProfile,
        retryAuth,
        updateTeacherProfile,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
