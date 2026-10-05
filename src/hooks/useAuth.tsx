import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import {
  getCurrentAuthUser,
  setCurrentAuthUser,
  logoutCurrentUser,
  getTeacherById,
  upsertTeacher,
  AuthSessionUser,
  TeacherUser,
  isUuid,
  ROOT_SUPER_ADMIN_ID,
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
  status?: "active" | "locked";
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
  loading: true,
  profile: null,
  refreshProfile: async () => {},
  updateTeacherProfile: async () => false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  // Initialize synchronously from currently authenticated session user
  const [user, setUser] = useState<{ id: string; email?: string | null; role?: Role; mustChangePassword?: boolean } | null>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return null;
    const isSuper = custom.role === "super_admin" || (custom.email && custom.email.toLowerCase() === "admin@admin.com");
    const isAdm = isSuper || custom.role === "admin";
    return {
      id: custom.id,
      email: custom.email,
      role: isSuper ? "super_admin" : (isAdm ? "admin" : "teacher"),
      mustChangePassword: !!custom.mustChangePassword,
    };
  });

  const [roles, setRoles] = useState<Role[]>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return [];
    const isSuper = custom.role === "super_admin" || (custom.email && custom.email.toLowerCase() === "admin@admin.com");
    const isAdm = isSuper || custom.role === "admin";
    return [isSuper ? "super_admin" : (isAdm ? "admin" : "teacher")];
  });

  const [profile, setProfile] = useState<TeacherProfile | null>(() => {
    const custom = getCurrentAuthUser();
    if (!custom) return null;
    const isSuper = custom.role === "super_admin" || (custom.email && custom.email.toLowerCase() === "admin@admin.com");
    const isAdm = isSuper || custom.role === "admin";
    if (isAdm) {
      return {
        id: custom.id,
        email: custom.email,
        username: custom.username,
        full_name: custom.name || (isSuper ? "Quản trị viên hệ thống" : "Quản trị viên"),
        phone: custom.phone || "",
        subject_id: null,
        subject_name: isSuper ? "Toàn quyền Quản trị Super Admin" : "Quản trị viên Hệ thống",
        school_id: null,
        school_name: "Hệ thống Quản trị",
        profile_completed: true,
        status: "active",
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
    };
  });

  const [mustChangePassword, setMustChangePassword] = useState(() => {
    const custom = getCurrentAuthUser();
    return !!custom?.mustChangePassword;
  });

  const [loading, setLoading] = useState(false);

  // Sync profile & user from either custom storage or Supabase Auth
  const syncState = useCallback(async () => {
    const customUser = getCurrentAuthUser();
    if (customUser) {
      const isSuper =
        customUser.role === "super_admin" ||
        customUser.id === ROOT_SUPER_ADMIN_ID ||
        customUser.id === "b9e61e93-caa6-4e72-a534-55072d943ad2" ||
        customUser.id === "00000000-0000-4000-8000-000000000000" ||
        customUser.id === "super-admin-system-root-001" ||
        (customUser.email && customUser.email.toLowerCase() === "admin@admin.com") ||
        (customUser.username && customUser.username.toLowerCase() === "admin");
      const isAdm = isSuper || customUser.role === "admin";
      const roleVal: Role = isSuper ? "super_admin" : (isAdm ? "admin" : "teacher");

      // The currently logged in user is 100% authoritative and MUST NOT be overwritten
      setUser({
        id: customUser.id,
        email: customUser.email,
        role: roleVal,
        mustChangePassword: !!customUser.mustChangePassword,
      });
      setRoles([roleVal]);
      setMustChangePassword(!!customUser.mustChangePassword);

      if (isAdm) {
        setProfile({
          id: customUser.id,
          email: customUser.email,
          username: customUser.username,
          full_name: customUser.name || (isSuper ? "Quản trị viên hệ thống" : "Quản trị viên"),
          phone: customUser.phone || "",
          subject_id: null,
          subject_name: isSuper ? "Toàn quyền Quản trị Super Admin" : "Quản trị viên Hệ thống",
          school_id: null,
          school_name: "Hệ thống Quản trị",
          profile_completed: true,
          status: "active",
        });
      } else {
        const teacher = getTeacherById(customUser.id) || getTeacherByUsernameOrEmail(customUser.username || customUser.email);
        setProfile({
          id: customUser.id,
          email: customUser.email || teacher?.email || "",
          username: customUser.username || teacher?.username || "",
          full_name: customUser.name || teacher?.name || "Giáo viên",
          phone: customUser.phone || teacher?.phone || "",
          subject_id: null,
          subject_name: customUser.subject || teacher?.subject || "",
          school_id: null,
          school_name: customUser.school || teacher?.school || "",
          profile_completed: true,
          avatar: customUser.avatar || teacher?.avatar,
          status: teacher?.status || "active",
        });
      }

      setLoading(false);

      // Seamlessly sync Supabase Auth session for PostgreSQL RLS permissions in the background
      ensureSupabaseSession(customUser).then(() => {
        supabase.auth.getSession().then(({ data: { session: s } }) => {
          if (s) setSession(s);
        });
      }).catch(() => {});

      return;
    }

    // Fallback to Supabase auth session if available and no custom user is logged in
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (s?.user) {
        const isSbAdminUser =
          s.user.id === ROOT_SUPER_ADMIN_ID ||
          s.user.id === "b9e61e93-caa6-4e72-a534-55072d943ad2" ||
          s.user.email?.toLowerCase() === "admin@admin.com";

        const [{ data: r }, { data: p }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", s.user.id),
          supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
        ]);
        const mappedRoles = (r || []).map((x: any) => x.role as Role);
        if (isSbAdminUser && !mappedRoles.includes("super_admin") && !mappedRoles.includes("admin")) {
          mappedRoles.unshift("super_admin");
        }
        const effectiveRole = mappedRoles.length ? mappedRoles[0] : (isSbAdminUser ? "super_admin" : "teacher");
        setUser({ id: s.user.id, email: s.user.email, role: effectiveRole });
        setRoles(mappedRoles.length ? mappedRoles : (isSbAdminUser ? ["super_admin"] : ["teacher"]));
        setProfile(
          (p as any) || {
            id: s.user.id,
            email: s.user.email,
            full_name: isSbAdminUser ? "Quản trị viên hệ thống" : s.user.email?.split("@")[0] || "Người dùng",
            subject_name: isSbAdminUser ? "Toàn quyền Quản trị Super Admin" : "Tin học",
            school_name: isSbAdminUser ? "Hệ thống Quản trị" : "",
            profile_completed: true,
          }
        );
        setMustChangePassword(false);
      } else {
        setUser(null);
        setRoles([]);
        setProfile(null);
        setMustChangePassword(false);
      }
    } catch {
      setUser(null);
      setRoles([]);
      setProfile(null);
      setMustChangePassword(false);
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
      if (!getCurrentAuthUser()) {
        setSession(s);
        if (s?.user) {
          syncState();
        } else {
          setUser(null);
          setRoles([]);
          setProfile(null);
          setMustChangePassword(false);
        }
      }
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

  const updateTeacherProfile = useCallback(async (updates: Partial<TeacherUser>): Promise<boolean> => {
    const authUser = getCurrentAuthUser();
    if (!authUser) return false;

    // 1. Immediately update the authenticated session user so UI reflects changes
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

    // 2. Update persistent teacher registry if role is teacher
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

    // 3. Update admin registry if admin
    if (authUser.role === "admin" || authUser.role === "super_admin") {
      const admin = getAdminById(authUser.id) || getAdminByUsernameOrEmail(authUser.username || authUser.email);
      if (admin) {
        saveAdminAccount({
          ...admin,
          name: nextAuth.name,
          email: nextAuth.email,
        });
      }
    }

    // 4. Update Supabase profile if active session exists
    try {
      if (session?.user?.id) {
        await supabase.from("profiles").update({
          full_name: nextAuth.name,
          email: nextAuth.email,
          phone: nextAuth.phone,
          school_name: nextAuth.school,
          subject_name: nextAuth.subject,
          avatar: nextAuth.avatar,
        }).eq("id", session.user.id);
      }
    } catch {}

    await syncState();
    return true;
  }, [syncState, session]);

  const signOut = useCallback(async (options?: { redirectTo?: string; redirect?: boolean }) => {
    // 1. Sign out of Supabase auth client if active
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Supabase auth signOut warning:", e);
    }

    // 2. Clear current auth user locally
    logoutCurrentUser();

    // 3. Reset React auth state
    setUser(null);
    setSession(null);
    setRoles([]);
    setProfile(null);
    setMustChangePassword(false);

    // 4. Thoroughly wipe localStorage, sessionStorage, Cookies, and cleanly redirect to /auth
    await performFullLogout({
      redirectTo: options?.redirectTo || "/auth",
      type: "teacher",
      redirect: options?.redirect !== false,
    });
  }, []);

  const isSuperAdmin = roles.includes("super_admin") || user?.role === "super_admin" || (user?.email && user.email.toLowerCase() === "admin@admin.com");
  const isAdmin = isSuperAdmin || roles.includes("admin") || user?.role === "admin";
  const isTeacher = !isAdmin && (roles.includes("teacher") || !!user);

  return (
    <Ctx.Provider value={{
      session,
      user,
      roles,
      role: isSuperAdmin ? "super_admin" : (isAdmin ? "admin" : (user ? "teacher" : null)),
      isSuperAdmin,
      isAdmin,
      isTeacher,
      mustChangePassword,
      loading,
      profile,
      refreshProfile,
      updateTeacherProfile,
      signOut,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
