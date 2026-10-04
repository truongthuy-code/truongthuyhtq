/**
 * Teacher & Admin Account Registry & Management System
 * Provides authentication, profile management, password hashing,
 * admin initialization, and role isolation for Super Admin, Admins, and Teachers.
 */
import { clearAuthLocalStorage, clearAuthSessionStorage, clearAuthCookies } from "./authCleanup";

export interface TeacherUser {
  id: string;
  username: string;
  name: string;
  email: string;
  phone?: string;
  school: string;
  subject: string;
  avatar?: string;
  status: "active" | "locked";
  passwordHash: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "admin";
  passwordHash: string;
  mustChangePassword?: boolean;
  status: "active" | "locked";
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

const STORAGE_KEYS = {
  TEACHERS: "qc_teachers_registry_v2",
  ADMIN: "qc_admin_account_v2",
  ADMINS_LIST: "qc_admin_accounts_list_v3",
  CURRENT_USER: "qc_current_auth_user_v2",
  SCHOOLS: "qc_schools_registry_v1",
  SUBJECTS: "qc_custom_subjects_v1",
};

// Simple yet secure salt+FNV1a hash for local credentials
export function hashPassword(plain: string): string {
  const salted = `__QC_SEC_SALT_2026_${plain}_SALT__`;
  let h1 = 0x811c9dc5;
  let h2 = 0x55aa55aa;
  for (let i = 0; i < salted.length; i++) {
    const code = salted.charCodeAt(i);
    h1 ^= code;
    h1 += (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24);
    h2 ^= (code * 31);
    h2 += (h2 << 2) + (h2 << 5) + (h2 << 9);
  }
  const s1 = ("00000000" + (h1 >>> 0).toString(16)).slice(-8);
  const s2 = ("00000000" + (h2 >>> 0).toString(16)).slice(-8);
  return `sha_v2_${s1}${s2}`;
}

export function isUuid(val?: string | null): val is string {
  return typeof val === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

export function normalizeUsername(u: string): string {
  return (u || "").trim().toLowerCase();
}

/** Root Super Admin default constants */
export const ROOT_SUPER_ADMIN_ID = "00000000-0000-4000-8000-000000000000";
export const LEGACY_ROOT_SUPER_ADMIN_ID = "super-admin-system-root-001";
export const DEFAULT_ROOT_ADMIN_PASSWORD_HASH = hashPassword("Admin@123456");

export const DEFAULT_ROOT_ADMIN: AdminUser = {
  id: ROOT_SUPER_ADMIN_ID,
  username: "admin",
  name: "Quản trị viên hệ thống",
  email: "admin@admin.com",
  role: "super_admin",
  passwordHash: DEFAULT_ROOT_ADMIN_PASSWORD_HASH,
  mustChangePassword: true,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Initial default demo teacher account: giaovien / 123456 */
export const DEFAULT_TEACHER_ID = "00000000-0000-4000-8000-000000000001";
export const LEGACY_DEFAULT_TEACHER_ID = "teacher-default-001";

const DEFAULT_TEACHER: TeacherUser = {
  id: DEFAULT_TEACHER_ID,
  username: "giaovien",
  name: "Trương Thị Bích Thủy",
  email: "thuy.tb@pbc.danang.edu.vn",
  phone: "0901234567",
  school: "THPT Phan Bội Châu - TP Đà Nẵng",
  subject: "Tin học",
  status: "active",
  passwordHash: hashPassword("123456"),
  createdAt: new Date().toISOString(),
};

/**
 * Get all administrators.
 * Guarantees that the root Super Admin exists once and only once.
 * Preserves custom password if Super Admin already changed password.
 */
export function getAllAdmins(): AdminUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ADMINS_LIST);
    if (raw) {
      const parsed: AdminUser[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Find the root super admin
        const rootIdx = parsed.findIndex(
          (a) =>
            a.id === ROOT_SUPER_ADMIN_ID ||
            a.id === LEGACY_ROOT_SUPER_ADMIN_ID ||
            normalizeUsername(a.username) === "admin" ||
            normalizeUsername(a.email) === "admin@admin.com"
        );

        if (rootIdx >= 0) {
          const currentRoot = parsed[rootIdx];
          // Protect root admin integrity while PRESERVING updated password & mustChangePassword flag!
          parsed[rootIdx] = {
            ...currentRoot,
            id: ROOT_SUPER_ADMIN_ID,
            username: "admin",
            name: currentRoot.name || "Quản trị viên hệ thống",
            email: currentRoot.email || "admin@admin.com",
            role: "super_admin", // Strictly super_admin
            status: "active", // Never locked
            mustChangePassword: currentRoot.mustChangePassword ?? false,
            passwordHash: currentRoot.passwordHash || DEFAULT_ROOT_ADMIN.passwordHash,
          };
        } else {
          // If missing, unshift the default root admin
          parsed.unshift(DEFAULT_ROOT_ADMIN);
        }

        // Filter out any duplicate root admin records if any
        const cleaned: AdminUser[] = [];
        let hasRoot = false;
        for (const adm of parsed) {
          const isRoot =
            adm.id === ROOT_SUPER_ADMIN_ID ||
            (normalizeUsername(adm.username) === "admin" && adm.role === "super_admin");
          if (isRoot) {
            if (!hasRoot) {
              cleaned.push(adm);
              hasRoot = true;
            }
          } else {
            cleaned.push(adm);
          }
        }

        localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(cleaned));
        return cleaned;
      }
    }
  } catch {}

  // Fallback: Check legacy v2 admin key to preserve already changed passwords
  let initialRoot = { ...DEFAULT_ROOT_ADMIN };
  try {
    const legacyRaw = localStorage.getItem(STORAGE_KEYS.ADMIN);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (
        legacy &&
        legacy.passwordHash &&
        legacy.passwordHash !== hashPassword("Admin@123") &&
        legacy.passwordHash !== DEFAULT_ROOT_ADMIN_PASSWORD_HASH
      ) {
        // Legacy admin already changed password! Keep their new password.
        initialRoot = {
          ...DEFAULT_ROOT_ADMIN,
          name: legacy.name || DEFAULT_ROOT_ADMIN.name,
          passwordHash: legacy.passwordHash,
          mustChangePassword: false,
        };
      }
    }
  } catch {}

  const initial = [initialRoot];
  localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(initial));
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(initialRoot));
  return initial;
}

export function saveAllAdmins(admins: AdminUser[]) {
  // Ensure the root super admin is never deleted or demoted
  const rootIdx = admins.findIndex(
    (a) => a.id === ROOT_SUPER_ADMIN_ID || a.role === "super_admin"
  );
  if (rootIdx === -1) {
    admins.unshift({ ...DEFAULT_ROOT_ADMIN });
  } else {
    admins[rootIdx].role = "super_admin";
    admins[rootIdx].status = "active";
    admins[rootIdx].id = ROOT_SUPER_ADMIN_ID;
  }
  localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(admins));

  const root = admins.find((a) => a.id === ROOT_SUPER_ADMIN_ID) || admins[0];
  if (root) {
    localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(root));
  }
  window.dispatchEvent(new Event("admin_registry_changed"));
}

export function getRootAdmin(): AdminUser {
  const admins = getAllAdmins();
  return (
    admins.find((a) => a.id === ROOT_SUPER_ADMIN_ID || a.role === "super_admin") ||
    admins[0] ||
    DEFAULT_ROOT_ADMIN
  );
}

// Backward-compatible alias
export function getAdminAccount(): AdminUser {
  return getRootAdmin();
}

export function saveAdminAccount(adm: AdminUser) {
  const admins = getAllAdmins();
  const idx = admins.findIndex((a) => a.id === adm.id);
  if (idx >= 0) {
    admins[idx] = {
      ...admins[idx],
      ...adm,
      updatedAt: new Date().toISOString(),
    };
  } else {
    admins.push(adm);
  }
  saveAllAdmins(admins);
}

export function getAdminById(id: string): AdminUser | null {
  const admins = getAllAdmins();
  return admins.find((a) => a.id === id) || null;
}

export function getAdminByUsernameOrEmail(identifier: string): AdminUser | null {
  const norm = normalizeUsername(identifier);
  if (!norm) return null;
  const admins = getAllAdmins();
  return (
    admins.find(
      (a) => normalizeUsername(a.username) === norm || normalizeUsername(a.email) === norm
    ) || null
  );
}

export function upsertAdmin(adm: AdminUser): { ok: boolean; message?: string } {
  const normUname = normalizeUsername(adm.username);
  const normEmail = normalizeUsername(adm.email);

  if (!normUname || !normEmail) {
    return { ok: false, message: "Vui lòng nhập đầy đủ tên đăng nhập và email" };
  }

  // Prevent conflict with teachers
  const existingTeacher = getTeacherByUsernameOrEmail(normUname) || getTeacherByUsernameOrEmail(normEmail);
  if (existingTeacher) {
    return { ok: false, message: "Tên đăng nhập hoặc Email đã thuộc về một tài khoản Giáo viên!" };
  }

  const admins = getAllAdmins();
  const existingIdx = admins.findIndex((a) => a.id === adm.id);

  // Check duplicate username or email with other admins
  const dup = admins.find(
    (a) =>
      a.id !== adm.id &&
      (normalizeUsername(a.username) === normUname || normalizeUsername(a.email) === normEmail)
  );
  if (dup) {
    return { ok: false, message: "Tên đăng nhập hoặc Email này đã tồn tại trong danh sách Quản trị viên!" };
  }

  if (existingIdx >= 0) {
    // Cannot demote root super admin
    if (admins[existingIdx].id === ROOT_SUPER_ADMIN_ID && adm.role !== "super_admin") {
      return { ok: false, message: "Không thể hạ quyền của tài khoản Super Admin gốc!" };
    }
    admins[existingIdx] = {
      ...admins[existingIdx],
      ...adm,
      updatedAt: new Date().toISOString(),
    };
  } else {
    // Only standard 'admin' role can be created. Never create secondary super_admin!
    if (adm.role === "super_admin") {
      return { ok: false, message: "Hệ thống chỉ có duy nhất 01 tài khoản Super Admin gốc!" };
    }
    admins.push({
      ...adm,
      role: "admin",
      createdAt: new Date().toISOString(),
    });
  }

  saveAllAdmins(admins);
  return { ok: true };
}

export function deleteAdmin(id: string): { ok: boolean; message?: string } {
  if (id === ROOT_SUPER_ADMIN_ID) {
    return { ok: false, message: "Tuyệt đối không thể xóa tài khoản Super Admin gốc của hệ thống!" };
  }
  const admins = getAllAdmins();
  const target = admins.find((a) => a.id === id);
  if (!target) {
    return { ok: false, message: "Không tìm thấy tài khoản quản trị viên để xóa!" };
  }
  if (target.role === "super_admin") {
    return { ok: false, message: "Không thể xóa tài khoản Super Admin!" };
  }

  const next = admins.filter((a) => a.id !== id);
  saveAllAdmins(next);
  return { ok: true };
}

/** Update an admin's password and reset mustChangePassword flag */
export function changeAdminPassword(
  adminId: string,
  newPasswordPlain: string
): { ok: boolean; message?: string } {
  const admins = getAllAdmins();
  const idx = admins.findIndex((a) => a.id === adminId);
  if (idx < 0) {
    return { ok: false, message: "Không tìm thấy thông tin Quản trị viên!" };
  }

  admins[idx] = {
    ...admins[idx],
    passwordHash: hashPassword(newPasswordPlain),
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  };

  saveAllAdmins(admins);

  // Sync current auth session user if this admin is currently logged in
  const authUser = getCurrentAuthUser();
  if (authUser && authUser.id === adminId) {
    setCurrentAuthUser({
      ...authUser,
      mustChangePassword: false,
    });
  }

  return { ok: true };
}

/** Teachers Registry & Management */
export function getAllTeachers(): TeacherUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TEACHERS);
    if (raw) {
      const parsed: TeacherUser[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let changed = false;
        const normalized = parsed.map((t) => {
          if (t.id === LEGACY_DEFAULT_TEACHER_ID) {
            changed = true;
            return { ...t, id: DEFAULT_TEACHER_ID };
          }
          if (!t.id) {
            changed = true;
            return { ...t, id: generateUuid() };
          }
          return t;
        });
        if (changed) {
          localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(normalized));
        }
        return normalized;
      }
    }
  } catch {}
  // Seed with default teacher if empty
  const initial = [DEFAULT_TEACHER];
  localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(initial));
  return initial;
}

export function saveAllTeachers(teachers: TeacherUser[]) {
  localStorage.setItem(STORAGE_KEYS.TEACHERS, JSON.stringify(teachers));
  window.dispatchEvent(new Event("teacher_registry_changed"));
}

export function getTeacherById(id: string): TeacherUser | null {
  if (!id) return null;
  const teachers = getAllTeachers();
  return teachers.find((t) => t.id === id || (id === LEGACY_DEFAULT_TEACHER_ID && t.id === DEFAULT_TEACHER_ID)) || null;
}

export function getTeacherByUsernameOrEmail(identifier: string): TeacherUser | null {
  const norm = normalizeUsername(identifier);
  if (!norm) return null;
  const teachers = getAllTeachers();
  return teachers.find((t) => normalizeUsername(t.username) === norm || normalizeUsername(t.email) === norm) || null;
}

export function upsertTeacher(t: TeacherUser) {
  const teachers = getAllTeachers();
  const normUname = normalizeUsername(t.username);
  const normEmail = normalizeUsername(t.email);

  const idx = teachers.findIndex(
    (item) =>
      item.id === t.id ||
      (normUname && normalizeUsername(item.username) === normUname) ||
      (normEmail && normalizeUsername(item.email) === normEmail)
  );

  if (idx >= 0) {
    const stableId = teachers[idx].id || t.id;
    teachers[idx] = {
      ...teachers[idx],
      ...t,
      id: stableId,
      updatedAt: new Date().toISOString(),
    };
  } else {
    teachers.push(t);
  }
  saveAllTeachers(teachers);
}

export function deleteTeacher(id: string) {
  const teachers = getAllTeachers().filter((t) => t.id !== id);
  saveAllTeachers(teachers);
}

// Current authenticated user session (Super Admin, Admin, or Teacher)
export interface AuthSessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "teacher";
  mustChangePassword?: boolean;
  phone?: string;
  school?: string;
  subject?: string;
  avatar?: string;
}

export function getCurrentAuthUser(): AuthSessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!raw) return null;
    const user: AuthSessionUser = JSON.parse(raw);
    if (!user || typeof user !== "object") return null;

    if (!user.id) {
      if (user.id === LEGACY_DEFAULT_TEACHER_ID || user.username === "giaovien") {
        user.id = DEFAULT_TEACHER_ID;
      } else if (user.id === LEGACY_ROOT_SUPER_ADMIN_ID || user.username === "admin") {
        user.id = ROOT_SUPER_ADMIN_ID;
      } else {
        const matched = getTeacherByUsernameOrEmail(user.username || user.email);
        user.id = matched?.id || generateUuid();
      }
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    }
    return user;
  } catch {
    return null;
  }
}

export function setCurrentAuthUser(user: AuthSessionUser | null) {
  if (user) {
    if (!user.id) {
      if (user.role === "super_admin") {
        user.id = ROOT_SUPER_ADMIN_ID;
      } else if (user.username === "giaovien") {
        user.id = DEFAULT_TEACHER_ID;
      } else {
        const existingTeacher = getTeacherByUsernameOrEmail(user.username || user.email);
        user.id = existingTeacher?.id || generateUuid();
      }
    }

    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));

    // Ensure teacher registry record matches this user exactly so names and profiles never diverge
    if (user.role === "teacher") {
      const existing = getTeacherByUsernameOrEmail(user.username || user.email) || getTeacherById(user.id);
      if (existing) {
        existing.id = user.id;
        existing.name = user.name || existing.name;
        existing.email = user.email || existing.email;
        if (user.school) existing.school = user.school;
        if (user.subject) existing.subject = user.subject;
        if (user.phone) existing.phone = user.phone;
        if (user.avatar) existing.avatar = user.avatar;
        upsertTeacher(existing);
      }
    }
  } else {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
  window.dispatchEvent(new Event("app_auth_change"));
}

export function logoutCurrentUser() {
  setCurrentAuthUser(null);
  clearAuthLocalStorage("teacher");
  clearAuthSessionStorage();
  clearAuthCookies();
}
