import { supabase } from "@/integrations/supabase/client";
import { AuthSessionUser, isUuid, setCurrentAuthUser } from "@/lib/teacherStorage";

/**
 * Inspects and refreshes the currently authenticated Supabase Auth session.
 * Never signs in with hardcoded fallback passwords or system bridge accounts.
 */
export async function ensureSupabaseSession(user?: AuthSessionUser | null): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user?.id && isUuid(session.user.id)) {
      if (user?.email && session.user.email) {
        const sessEmail = session.user.email.trim().toLowerCase();
        const userEmail = user.email.trim().toLowerCase();
        if (sessEmail !== userEmail) {
          // Do not impersonate or silently cross-wire a different user's session
          await supabase.auth.signOut().catch(() => {});
          return user?.id || null;
        }
      }

      if (user && user.id !== session.user.id && !user.id?.startsWith("00000000")) {
        setCurrentAuthUser({ ...user, id: session.user.id });
      }
      return session.user.id;
    }

    const {
      data: { user: curUser },
    } = await supabase.auth.getUser();
    if (curUser?.id && isUuid(curUser.id)) {
      return curUser.id;
    }

    return user?.id || null;
  } catch (err) {
    console.warn("ensureSupabaseSession check error:", err);
    return user?.id || null;
  }
}

/**
 * Execute an operation on Supabase, refreshing an existing valid JWT once on expiry.
 */
export async function withSupabaseAuthRetry<T>(
  operation: (userId: string) => Promise<{ data?: T | null; error?: any }>,
  user?: AuthSessionUser | null
): Promise<{ data?: T | null; error?: any }> {
  const userId = (await ensureSupabaseSession(user)) || user?.id || "";
  let res = await operation(userId);

  if (
    res.error &&
    (res.error.code === "42501" ||
      res.error.message?.includes("JWT") ||
      res.error.message?.includes("expired"))
  ) {
    try {
      const { data: refreshData } = await supabase.auth.refreshSession();
      const refreshedId = refreshData?.session?.user?.id || (await ensureSupabaseSession(user));
      if (refreshedId) {
        res = await operation(refreshedId);
      }
    } catch (err) {
      console.warn("withSupabaseAuthRetry retry note:", err);
    }
  }

  return res;
}
