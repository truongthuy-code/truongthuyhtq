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
} from "@/lib/teacherStorage";
import { ensureSupabaseSession } from "@/lib/supabaseAuthSync";

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
  signOut: () => Promise<void>;
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
  const [user, setUser] = useState<{ id: string; email?: string | null; role?: Role; mustChangePassword?: boolean } | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sync profile & user from either custom storage or Supabase Auth
  const syncState = useCallback(async () => {
    let sbSession: Session | null = null;
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      sbSession = s;
      setSession(s);
    } catch {}

    const customUser = getCurrentAuthUser();
    if (customUser) {
      if (!sbSession?.user?.id) {
        ensureSupabaseSession(customUser).then((uid) => {
          if (uid) {
            supabase.auth.getSession().then(({ data: { session: freshS } }) => {
              if (freshS) setSession(freshS);
            });
          }
        }).catch(() => {});
      }

      const isSuper = customUser.role === "super_admin";
      const isAdm = isSuper || customUser.role === "admin";
      const roleVal: Role = isSuper ? "super_admin" : (isAdm ? "admin" : "teacher");

      // Prefer Supabase Auth UUID if available and valid
      const effectiveId = (sbSession?.user?.id && isUuid(sbSession.user.id))
        ? sbSession.user.id
        : customUser.id;

      setUser({
        id: effectiveId,
        email: customUser.email,
        role: roleVal,
        mustChangePassword: !!customUser.mustChangePassword,
      });
      setRoles([roleVal]);
      setMustChangePassword(!!customUser.mustChangePassword);

      if (isAdm) {
        setProfile({
          id: effectiveId,
          email: customUser.email,
          username: customUser.username,
          full_name: customUser.name || (isSuper ? "Quản trị viên hệ thống" : "Quản trị viên"),
          phone: "",
          subject_id: null,
          subject_name: isSuper ? "Toàn quyền Quản trị Super Admin" : "Quản trị viên Hệ thống",
          school_id: null,
          school_name: "Hệ thống Quản trị",
          profile_completed: true,
          status: "active",
        });
      } else {
        const teacher = getTeacherById(customUser.id) || getTeacherById(effectiveId);
        setProfile({
          id: effectiveId,
          email: teacher?.email || customUser.email,
          username: teacher?.username || customUser.username,
          full_name: teacher?.name || customUser.name,
          phone: teacher?.phone || customUser.phone || "",
          subject_id: null,
          subject_name: teacher?.subject || customUser.subject || "",
          school_id: null,
          school_name: teacher?.school || customUser.school || "",
          profile_completed: true,
          avatar: teacher?.avatar || customUser.avatar,
          status: teacher?.status || "active",
        });
      }
      setLoading(false);
      return;
    }

    // Fallback to Supabase auth session if available
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (s?.user) {
        setUser({ id: s.user.id, email: s.user.email });
        const [{ data: r }, { data: p }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", s.user.id),
          supabase.from("profiles").select("*").eq("id", s.user.id).maybeSingle(),
        ]);
        const mappedRoles = (r || []).map((x: any) => x.role as Role);
        setRoles(mappedRoles.length ? mappedRoles : ["teacher"]);
        setProfile((p as any) || null);
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
    if (!user) return false;
    const current = getTeacherById(user.id);
    if (!current) {
      // If it's admin or custom
      const authUser = getCurrentAuthUser();
      if (authUser && authUser.id === user.id) {
        const nextAuth: AuthSessionUser = {
          ...authUser,
          name: updates.name ?? authUser.name,
          email: updates.email ?? authUser.email,
          phone: updates.phone ?? authUser.phone,
          school: updates.school ?? authUser.school,
          subject: updates.subject ?? authUser.subject,
          avatar: updates.avatar ?? authUser.avatar,
        };
        setCurrentAuthUser(nextAuth);
        await syncState();
        return true;
      }
      return false;
    }

    const next: TeacherUser = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    upsertTeacher(next);

    // Sync session user
    const authUser = getCurrentAuthUser();
    if (authUser && authUser.id === user.id) {
      setCurrentAuthUser({
        ...authUser,
        name: next.name,
        email: next.email,
        phone: next.phone,
        school: next.school,
        subject: next.subject,
        avatar: next.avatar,
      });
    }

    // Also update supabase profiles if applicable
    try {
      await supabase.from("profiles").update({
        full_name: next.name,
        email: next.email,
        phone: next.phone,
        school_name: next.school,
        subject_name: next.subject,
      }).eq("id", user.id);
    } catch {}

    await syncState();
    return true;
  }, [user, syncState]);

  const signOut = useCallback(async () => {
    logoutCurrentUser();
    try {
      await supabase.auth.signOut();
    } catch {}
    setUser(null);
    setSession(null);
    setRoles([]);
    setProfile(null);
    setMustChangePassword(false);
    window.dispatchEvent(new Event("app_auth_change"));
  }, []);

  const isSuperAdmin = roles.includes("super_admin") || user?.role === "super_admin";
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
