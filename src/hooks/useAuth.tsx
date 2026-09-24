import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import {
  getCurrentAuthUser,
  setCurrentAuthUser,
  logoutCurrentUser,
  getTeacherById,
  upsertTeacher,
  AuthSessionUser,
  TeacherUser,
} from "@/lib/teacherStorage";

export type Role = "admin" | "teacher";

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
  user: { id: string; email?: string | null; role?: string } | null;
  roles: Role[];
  role: Role | null;
  isAdmin: boolean;
  isTeacher: boolean;
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
  isAdmin: false,
  isTeacher: false,
  loading: true,
  profile: null,
  refreshProfile: async () => {},
  updateTeacherProfile: async () => false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string | null; role?: string } | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync profile & user from either custom storage or Supabase Auth
  const syncState = useCallback(async () => {
    const customUser = getCurrentAuthUser();
    if (customUser) {
      const isAdm = customUser.role === "admin";
      setUser({
        id: customUser.id,
        email: customUser.email,
        role: customUser.role,
      });
      setRoles(isAdm ? ["admin"] : ["teacher"]);

      if (isAdm) {
        setProfile({
          id: customUser.id,
          email: customUser.email,
          username: customUser.username,
          full_name: customUser.name || "Quản trị viên Hệ thống",
          phone: "",
          subject_id: null,
          subject_name: "Toàn quyền Quản trị",
          school_id: null,
          school_name: "Hệ thống Quản trị",
          profile_completed: true,
          status: "active",
        });
      } else {
        const teacher = getTeacherById(customUser.id);
        setProfile({
          id: customUser.id,
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
      } else {
        setUser(null);
        setRoles([]);
        setProfile(null);
      }
    } catch {
      setUser(null);
      setRoles([]);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncState();

    const onAppAuth = () => syncState();
    window.addEventListener("app_auth_change", onAppAuth);
    window.addEventListener("teacher_registry_changed", onAppAuth);
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
        }
      }
    });

    return () => {
      window.removeEventListener("app_auth_change", onAppAuth);
      window.removeEventListener("teacher_registry_changed", onAppAuth);
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
    window.dispatchEvent(new Event("app_auth_change"));
  }, []);

  const isAdmin = roles.includes("admin");
  const isTeacher = !isAdmin && (roles.includes("teacher") || !!user);

  return (
    <Ctx.Provider value={{
      session,
      user,
      roles,
      role: isAdmin ? "admin" : (user ? "teacher" : null),
      isAdmin,
      isTeacher,
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
