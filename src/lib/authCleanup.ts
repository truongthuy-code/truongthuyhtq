/**
 * Auth & Session Cleanup Utilities
 * Ensures that upon logout, all localStorage, sessionStorage, and Cookies
 * associated with the login session are completely removed, and cleanly redirects
 * the user to the clean authentication page.
 */

// Critical persistent registries to protect from deletion
const PRESERVED_STORAGE_KEYS = new Set([
  "qc_teachers_registry_v2",
  "qc_admin_account_v2",
  "qc_admin_accounts_list_v3",
  "qc_schools_registry_v1",
  "qc_custom_subjects_v1",
  "exam_students",
  "exam_submissions",
  "exam_assignments_v1",
  "exam_learning_materials",
  "exam_student_learning_progress",
  "theme",
  "vite_ui_theme",
]);

/**
 * Remove all login session keys and auth tokens from localStorage
 */
export function clearAuthLocalStorage(type?: "all" | "teacher" | "student"): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    // Specific targeted session keys
    if (!type || type === "all" || type === "teacher") {
      localStorage.removeItem("qc_current_auth_user_v2");
      localStorage.removeItem("qc_current_auth_user");
      localStorage.removeItem("current_auth_user");
      localStorage.removeItem("teacher_session");
    }

    if (!type || type === "all" || type === "student") {
      localStorage.removeItem("exam_current_student");
      localStorage.removeItem("current_student");
      localStorage.removeItem("student_session");
    }

    // Dynamic scanning for Supabase and session auth tokens
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Never touch persistent local registries
      if (PRESERVED_STORAGE_KEYS.has(key)) continue;

      const lower = key.toLowerCase();
      const isAuthSessionKey =
        lower.startsWith("sb-") ||
        lower.includes("supabase.auth") ||
        lower.includes("auth-token") ||
        lower.includes("auth_token") ||
        lower.includes("authtoken") ||
        lower.includes("access_token") ||
        lower.includes("refresh_token") ||
        lower.includes("session_token") ||
        lower.startsWith("qc_current_") ||
        lower.startsWith("exam_current_") ||
        lower.endsWith("_session") ||
        lower.startsWith("session_") ||
        lower === "current_user" ||
        lower === "currentuser" ||
        lower === "auth_redirect" ||
        lower === "login_redirect";

      if (isAuthSessionKey) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {}
    });
  } catch (err) {
    console.warn("Failed to clear auth localStorage:", err);
  }
}

/**
 * Clear all sessionStorage entries
 */
export function clearAuthSessionStorage(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;

  try {
    sessionStorage.clear();
  } catch (err) {
    console.warn("Failed to clear sessionStorage:", err);
  }
}

/**
 * Remove all accessible session and auth Cookies across domains and paths
 */
export function clearAuthCookies(): void {
  if (typeof document === "undefined" || !document.cookie) return;

  try {
    const rawCookies = document.cookie.split(";");
    const hostname = window.location.hostname || "";
    const hostParts = hostname ? hostname.split(".") : [];

    // Candidate domain variations to invalidate cookies on
    const domains: string[] = ["", hostname, `.${hostname}`];
    if (hostParts.length > 2) {
      const rootDomain = hostParts.slice(-2).join(".");
      domains.push(rootDomain, `.${rootDomain}`);
    }

    // Candidate path variations
    const paths = ["/", window.location.pathname || ""];

    for (const rawCookie of rawCookies) {
      const eqPos = rawCookie.indexOf("=");
      const name = (eqPos > -1 ? rawCookie.substring(0, eqPos) : rawCookie).trim();
      if (!name) continue;

      for (const domain of domains) {
        for (const path of paths) {
          const domainAttr = domain ? `; domain=${domain}` : "";
          const pathAttr = path ? `; path=${path}` : "; path=/";

          // Set expiration in past and zero max-age
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathAttr}${domainAttr}; SameSite=Lax`;
          document.cookie = `${name}=; max-age=0${pathAttr}${domainAttr}; SameSite=Lax`;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to clear auth cookies:", err);
  }
}

/**
 * Perform complete cleanup of localStorage, sessionStorage, and Cookies,
 * dispatch synchronization events, and cleanly redirect to the login page.
 */
export async function performFullLogout(options?: {
  redirectTo?: string;
  type?: "all" | "teacher" | "student";
  redirect?: boolean;
}): Promise<void> {
  const shouldRedirect = options?.redirect !== false;
  const rawTarget = options?.redirectTo || (options?.type === "student" ? "/student/auth" : "/auth");

  // Clean target URL: strip query parameters and hash to guarantee a clean login page
  const cleanTarget = rawTarget.split("?")[0].split("#")[0] || "/auth";

  // 1. Clear Cookies
  clearAuthCookies();

  // 2. Clear sessionStorage
  clearAuthSessionStorage();

  // 3. Clear localStorage auth session keys
  clearAuthLocalStorage(options?.type);

  // 4. Notify app listeners of auth state changes
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new Event("app_auth_change"));
      window.dispatchEvent(new Event("student_auth_change"));
      window.dispatchEvent(new Event("teacher_registry_changed"));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  // 5. Clean redirect to login page (hard replace ensures all memory state is flushed)
  if (shouldRedirect && typeof window !== "undefined") {
    try {
      window.location.replace(cleanTarget);
    } catch {
      try {
        window.location.href = cleanTarget;
      } catch {}
    }
  }
}
