import { supabase } from "@/integrations/supabase/client";
import { AuthSessionUser, isUuid, setCurrentAuthUser } from "@/lib/teacherStorage";

export class AuthTimeoutError extends Error {
  step: string;
  timeoutMs: number;
  constructor(step: string, timeoutMs: number) {
    super(`[AuthTimeout] Step "${step}" timed out after ${timeoutMs}ms`);
    this.name = "AuthTimeoutError";
    this.step = step;
    this.timeoutMs = timeoutMs;
  }
}

export function withAuthTimeout<T>(
  promiseOrThenable: PromiseLike<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AuthTimeoutError(stepName, timeoutMs));
    }, timeoutMs);

    Promise.resolve(promiseOrThenable).then(
      (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Inspects and refreshes the currently authenticated Supabase Auth session.
 * Never signs in with hardcoded fallback passwords or system bridge accounts.
 */
export async function ensureSupabaseSession(user?: AuthSessionUser | null): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await withAuthTimeout(supabase.auth.getSession(), 4500, "ensureSupabaseSession.getSession");

    if (session?.user?.id && isUuid(session.user.id)) {
      if (user?.email && session.user.email) {
        const sessEmail = session.user.email.trim().toLowerCase();
        const userEmail = user.email.trim().toLowerCase();
        if (sessEmail !== userEmail) {
          // Do not impersonate or silently cross-wire a different user's session
          await withAuthTimeout(supabase.auth.signOut(), 3000, "ensureSupabaseSession.signOut").catch(() => {});
          return user?.id || null;
        }
      }

      if (user && user.id !== session.user.id && !user.id?.startsWith("00000000")) {
        setCurrentAuthUser({ ...user, id: session.user.id }, { silent: true });
      }
      return session.user.id;
    }

    const {
      data: { user: curUser },
    } = await withAuthTimeout(supabase.auth.getUser(), 4500, "ensureSupabaseSession.getUser");
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
