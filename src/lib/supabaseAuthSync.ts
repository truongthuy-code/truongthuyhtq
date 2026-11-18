import { supabase } from "@/integrations/supabase/client";
import { AuthSessionUser, isUuid, setCurrentAuthUser } from "@/lib/teacherStorage";
import { RequestTimeoutError, withRequestTimeout } from "@/lib/requestTimeout";

export const AuthTimeoutError = RequestTimeoutError;
export const withAuthTimeout = withRequestTimeout;

const isVitestEnv = typeof process !== "undefined" && Boolean((process as any).env?.VITEST);
const SESSION_MICRO_CACHE_TTL_MS = 2000;

let inFlightSessionPromise: Promise<string | null> | null = null;
let lastResolvedSession: { userId: string | null; email: string | null; checkedAt: number } | null = null;

export function resetSupabaseAuthSyncCache(): void {
  inFlightSessionPromise = null;
  lastResolvedSession = null;
}

/**
 * Inspects and refreshes the currently authenticated Supabase Auth session.
 * Single-flight coalesced to avoid saturating GoTrue navigator.locks under concurrent UI calls.
 * Never signs in with hardcoded fallback passwords or system bridge accounts.
 */
export async function ensureSupabaseSession(user?: AuthSessionUser | null): Promise<string | null> {
  const userEmailLower = user?.email ? user.email.trim().toLowerCase() : null;

  if (!isVitestEnv && lastResolvedSession && Date.now() - lastResolvedSession.checkedAt < SESSION_MICRO_CACHE_TTL_MS) {
    if (!userEmailLower || !lastResolvedSession.email || userEmailLower === lastResolvedSession.email) {
      if (lastResolvedSession.userId) {
        return lastResolvedSession.userId;
      }
    }
  }

  if (!isVitestEnv && inFlightSessionPromise) {
    return inFlightSessionPromise;
  }

  const run = async (): Promise<string | null> => {
    try {
      let session: any = null;
      if (typeof supabase?.auth?.getSession === "function") {
        const res = await withRequestTimeout(
          supabase.auth.getSession(),
          4500,
          "ensureSupabaseSession.getSession"
        );
        session = res?.data?.session ?? null;
      }

      if (session?.user?.id && isUuid(session.user.id)) {
        const sessEmail = session.user.email ? session.user.email.trim().toLowerCase() : null;
        if (userEmailLower && sessEmail && sessEmail !== userEmailLower) {
          // Do not impersonate or silently cross-wire a different user's session
          if (typeof supabase?.auth?.signOut === "function") {
            await withRequestTimeout(supabase.auth.signOut(), 3000, "ensureSupabaseSession.signOut").catch(() => {});
          }
          lastResolvedSession = null;
          return user?.id || null;
        }

        if (user && user.id !== session.user.id && !user.id?.startsWith("00000000")) {
          setCurrentAuthUser({ ...user, id: session.user.id }, { silent: true });
        }
        lastResolvedSession = { userId: session.user.id, email: sessEmail, checkedAt: Date.now() };
        return session.user.id;
      }

      if (typeof supabase?.auth?.getUser === "function") {
        const userRes = await withRequestTimeout(
          supabase.auth.getUser(),
          4500,
          "ensureSupabaseSession.getUser"
        );
        const curUser = userRes?.data?.user ?? null;
        if (curUser?.id && isUuid(curUser.id)) {
          lastResolvedSession = {
            userId: curUser.id,
            email: curUser.email ? curUser.email.trim().toLowerCase() : null,
            checkedAt: Date.now(),
          };
          return curUser.id;
        }
      }

      return user?.id || null;
    } catch (err) {
      console.warn("ensureSupabaseSession check error:", err);
      return user?.id || null;
    }
  };

  if (isVitestEnv) {
    return run();
  }

  inFlightSessionPromise = run().finally(() => {
    inFlightSessionPromise = null;
  });
  return inFlightSessionPromise;
}

/**
 * Execute an operation on Supabase, refreshing an existing valid JWT once on expiry.
 * Enforces bounded execution timeout so caller UI states never spin indefinitely.
 */
export async function withSupabaseAuthRetry<T>(
  operation: (userId: string) => Promise<{ data?: T | null; error?: any }>,
  user?: AuthSessionUser | null,
  options?: { timeoutMs?: number; stepName?: string }
): Promise<{ data?: T | null; error?: any }> {
  const timeoutMs = options?.timeoutMs ?? 12000;
  const stepName = options?.stepName || "withSupabaseAuthRetry.operation";

  const userId = (await ensureSupabaseSession(user)) || user?.id || "";

  let res: { data?: T | null; error?: any };
  try {
    res = await withRequestTimeout(operation(userId), timeoutMs, stepName);
  } catch (err: any) {
    return { data: null, error: err };
  }

  if (
    res?.error &&
    (res.error.code === "42501" ||
      res.error.message?.includes("JWT") ||
      res.error.message?.includes("expired"))
  ) {
    try {
      let refreshedId: string | null = null;
      if (typeof supabase?.auth?.refreshSession === "function") {
        const refreshRes = await withRequestTimeout(
          supabase.auth.refreshSession(),
          5000,
          "withSupabaseAuthRetry.refreshSession"
        );
        refreshedId = refreshRes?.data?.session?.user?.id || null;
      }
      if (!refreshedId) {
        resetSupabaseAuthSyncCache();
        refreshedId = await ensureSupabaseSession(user);
      }
      if (refreshedId) {
        lastResolvedSession = {
          userId: refreshedId,
          email: lastResolvedSession?.email ?? null,
          checkedAt: Date.now(),
        };
        res = await withRequestTimeout(operation(refreshedId), timeoutMs, `${stepName}.retry`);
      }
    } catch (err) {
      console.warn("withSupabaseAuthRetry retry note:", err);
    }
  }

  return res;
}
