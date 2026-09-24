import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type Role = "admin" | "teacher";

export type TeacherProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  subject_id: string | null;
  subject_name: string | null;
  school_id: string | null;
  school_name: string | null;
  profile_completed: boolean;
};

type AuthCtx = {
  session: Session | null;
  user: User | null;
  roles: Role[];
  isAdmin: boolean;
  loading: boolean;
  profile: TeacherProfile | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  session: null, user: null, roles: [], isAdmin: false, loading: true,
  profile: null, refreshProfile: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUserData = useCallback(async (uid: string) => {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    ]);
    setRoles((r || []).map((x: any) => x.role));
    setProfile((p as any) || null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadUserData(user.id);
  }, [user, loadUserData]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => { loadUserData(s.user.id); }, 0);
      } else {
        setRoles([]); setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadUserData(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [loadUserData]);

  return (
    <Ctx.Provider value={{
      session, user, roles,
      isAdmin: roles.includes("admin"),
      loading, profile, refreshProfile,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
