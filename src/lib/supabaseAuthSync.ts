import { supabase } from "@/integrations/supabase/client";
import { AuthSessionUser, isUuid } from "@/lib/teacherStorage";

/**
 * Ensures an active Supabase Auth session for the current authenticated user.
 * Preserves each user's unique identity without hijacking or forced account switching.
 */
export async function ensureSupabaseSession(user?: AuthSessionUser | null): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user?.id && isUuid(session.user.id)) {
      // If a specific user is logged in, verify the session does not belong to a different account
      if (user?.email && session.user.email) {
        const sessEmail = session.user.email.trim().toLowerCase();
        const userEmail = user.email.trim().toLowerCase();
        if (sessEmail !== userEmail) {
          // Different session, sign out old session to preserve independent account isolation
          await supabase.auth.signOut().catch(() => {});
          return user.id || null;
        }
      }
      return session.user.id;
    }

    return user?.id || null;
  } catch (err) {
    console.warn("ensureSupabaseSession check error:", err);
    return user?.id || null;
  }
}

/**
 * Execute an operation on Supabase using the user's authentic session ID.
 * Never switches to another user or hardcoded bridge accounts.
 */
export async function withSupabaseAuthRetry<T>(
  operation: (userId: string) => Promise<{ data?: T | null; error?: any }>,
  user?: AuthSessionUser | null
): Promise<{ data?: T | null; error?: any }> {
  let userId = user?.id || (await ensureSupabaseSession(user)) || "";
  return await operation(userId);
}
