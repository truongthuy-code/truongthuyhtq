import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
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
import { ensureSupabaseSession } from "@/lib/supabaseAuthSync";
import { performFullLogout } from "@/lib/authCleanup";

export type Role = "super_admin" | "admin" | "teacher";

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
  profile: TeacherProfile | null;
  refreshProfile: () => Promise<void>;
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
  profile: null,
  refreshProfile: async () => {},
  updateTeacherProfile: async () => false,
  signOut: async () => {},
});

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

  const syncState = useCallback(async () => {
    try {
      const {
        data: { session: sbSession },
      } = await supabase.auth.getSession();
      setSession(sbSession);

      const customUser = getCurrentAuthUser();

      // 1. Authoritative Supabase Auth session path (Production / Vercel / Live Preview)
      if (sbSession?.user) {
        const sbUser = sbSession.user;
        const sbEmail = (sbUser.email || "").trim().toLowerCase();

        let statePayload: any = null;
        try {
          const { data: rpcState, error: rpcErr } = await (supabase as any).rpc("get_my_account_state");
          if (!rpcErr && rpcState && rpcState.authenticated !== false) {
            statePayload = rpcState;
          }
        } catch {}

        const [{ data: roleRows }, { data: profRow }] = statePayload
          ? [{ data: null }, { data: null }]
          : await Promise.all([
              supabase.from("user_roles").select("role").eq("user_id", sbUser.id),
              supabase.from("profiles").select("*").eq("id", sbUser.id).maybeSingle(),
            ]);

        const effectiveProfile = statePayload || profRow;
        const mappedRoles = (roleRows || []).map((x: any) => x.role as Role);
        const isSuper =
          isSuperAdminEmail(sbEmail) ||
          statePayload?.role === "super_admin" ||
          statePayload?.is_super_admin === true ||
          mappedRoles.includes("super_admin") ||
          effectiveProfile?.role === "super_admin";

        const roleVal: Role = isSuper ? "super_admin" : "teacher";
        const mustChange = isSuper
          ? Boolean(statePayload?.must_change_password ?? profRow?.must_change_password ?? customUser?.mustChangePassword)
          : false;

        const approvalInfo = deriveApprovalStatus(effectiveProfile, null, isSuper);

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

        // Keep local auth cache synced cleanly with server state (only when approved or Super Admin)
        if (isSuper || approvalInfo.approvalStatus === "APPROVED") {
          setCurrentAuthUser({
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
          });
        }
        return;
      }

      // 2. Fallback to local session ONLY for local/offline/Vitest testing
      if (customUser) {
        const isSuper = customUser.role === "super_admin" || isSuperAdminEmail(customUser.email);
        const roleVal: Role = isSuper ? "super_admin" : "teacher";
        const localTeacher = !isSuper
          ? getTeacherById(customUser.id) || getTeacherByUsernameOrEmail(customUser.username || customUser.email)
          : null;
        const approvalInfo = deriveApprovalStatus(null, localTeacher, isSuper);

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
        return;
      }

      setUser(null);
      setRoles([]);
      setProfile(null);
      setMustChangePassword(false);
      setApprovalStatus(null);
      setRejectionReason(null);
      setAccountBlockReason(null);
    } catch {
      setUser(null);
      setRoles([]);
      setProfile(null);
      setMustChangePassword(false);
      setApprovalStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncState();

    const onAppAuth = () => syncState();
    window.addEventListener("app_auth_change", onAppAuth);
    window.addEventListener("teacher_registry_changed", onAppAuth);
    window.addEventListener("admin_registry_changed", onAppAuth);
    window.addEventListener("storage", onAppAuth);

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      syncState();
    });

    return () => {
      window.removeEventListener("app_auth_change", onAppAuth);
      window.removeEventListener("teacher_registry_changed", onAppAuth);
      window.removeEventListener("admin_registry_changed", onAppAuth);
      window.removeEventListener("storage", onAppAuth);
      sub.subscription.unsubscribe();
    };
  }, [syncState]);

  const refreshProfile = useCallback(async () => {
    await syncState();
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
      setCurrentAuthUser(nextAuth);

      const teacher = getTeacherById(authUser.id) || getTeacherByUsernameOrEmail(authUser.username || authUser.email);
      if (teacher) {
        upsertTeacher({
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
        });
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
          await supabase
            .from("profiles")
            .update({
              full_name: nextAuth.name,
              phone: nextAuth.phone,
              school_name: nextAuth.school,
              subject_name: nextAuth.subject,
              avatar: nextAuth.avatar,
            } as any)
            .eq("id", session.user.id);
        }
      } catch {}

      await syncState();
      return true;
    },
    [syncState, session]
  );

  const signOut = useCallback(async (options?: { redirectTo?: string; redirect?: boolean }) => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Supabase auth signOut warning:", e);
    }

    logoutCurrentUser();

    setUser(null);
    setSession(null);
    setRoles([]);
    setProfile(null);
    setMustChangePassword(false);
    setApprovalStatus(null);
    setRejectionReason(null);
    setAccountBlockReason(null);

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
        profile,
        refreshProfile,
        updateTeacherProfile,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
