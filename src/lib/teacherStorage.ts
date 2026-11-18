/**
 * Teacher & Single Super Admin Account Registry & Management System
 * Provides authentication state helpers, password hashing,
 * single Super Admin integrity (bichthuylqd@gmail.com), and teacher approval states.
 */
import { clearAuthLocalStorage, clearAuthSessionStorage, clearAuthCookies } from "./authCleanup";
import { supabase } from "@/integrations/supabase/client";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "LOCKED";

export interface TeacherUser {
  id: string;
  username: string;
  name: string;
  email: string;
  phone?: string;
  school: string;
  subject: string;
  avatar?: string;
  status: "active" | "locked" | "pending" | "rejected";
  approvalStatus?: ApprovalStatus;
  rejectionReason?: string;
  passwordHash: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "super_admin";
  passwordHash: string;
  mustChangePassword?: boolean;
  status: "active";
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

// Simple deterministic hash for local offline/Vitest test verification
export function hashPassword(plain: string): string {
  const salted = `__QC_SEC_SALT_2026_${plain}_SALT__`;
  let h1 = 0x811c9dc5;
  let h2 = 0x55aa55aa;
  for (let i = 0; i < salted.length; i++) {
    const code = salted.charCodeAt(i);
    h1 ^= code;
    h1 += (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24);
    h2 ^= code * 31;
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

/** Single Authoritative Super Admin Constants */
export const SUPER_ADMIN_EMAIL = "bichthuylqd@gmail.com";
export const SUPER_ADMIN_USERNAME = "bichthuylqd";
export const ROOT_SUPER_ADMIN_ID = "b9e61e93-caa6-4e72-a534-55072d943ad2";
export const LEGACY_ROOT_SUPER_ADMIN_ID = "00000000-0000-4000-8000-000000000000";
export const LEGACY_ROOT_SUPER_ADMIN_STRING_ID = "super-admin-system-root-001";
export const DEFAULT_ROOT_ADMIN_PASSWORD_HASH = hashPassword("123456");

export const DEFAULT_ROOT_ADMIN: AdminUser = {
  id: ROOT_SUPER_ADMIN_ID,
  username: SUPER_ADMIN_USERNAME,
  name: "Trương Thị Bích Thủy",
  email: SUPER_ADMIN_EMAIL,
  role: "super_admin",
  passwordHash: DEFAULT_ROOT_ADMIN_PASSWORD_HASH,
  mustChangePassword: true,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Default demo teacher ID for offline tests */
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
  approvalStatus: "APPROVED",
  passwordHash: hashPassword("123456"),
  createdAt: new Date().toISOString(),
};

export function isSuperAdminEmail(email?: string | null): boolean {
  return (email || "").trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isReservedAdminIdentifier(identifier?: string | null): boolean {
  const norm = normalizeUsername(identifier || "");
  if (!norm) return false;
  return (
    norm === SUPER_ADMIN_EMAIL ||
    norm === SUPER_ADMIN_USERNAME ||
    norm === "admin@admin.com" ||
    norm === "admin" ||
    norm === "super_admin" ||
    norm === "superadmin" ||
    norm === "root"
  );
}

/**
 * Returns the single Super Admin record.
 * Guarantees idempotency (exactly 1 Super Admin) and preserves changed passwords.
 */
export function getAllAdmins(): AdminUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ADMINS_LIST);
    if (raw) {
      const parsed: AdminUser[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const root = parsed.find(
          (a) =>
            a.id === ROOT_SUPER_ADMIN_ID ||
            a.id === LEGACY_ROOT_SUPER_ADMIN_ID ||
            a.id === LEGACY_ROOT_SUPER_ADMIN_STRING_ID ||
            normalizeUsername(a.email) === SUPER_ADMIN_EMAIL ||
            normalizeUsername(a.username) === SUPER_ADMIN_USERNAME ||
            a.role === "super_admin"
        );

        const base = root || DEFAULT_ROOT_ADMIN;
        const hasDefaultPassword = !base.passwordHash || base.passwordHash === DEFAULT_ROOT_ADMIN_PASSWORD_HASH;
        const normalizedRoot: AdminUser = {
          ...base,
          id: isUuid(base.id) && base.id !== LEGACY_ROOT_SUPER_ADMIN_ID ? base.id : ROOT_SUPER_ADMIN_ID,
          username: SUPER_ADMIN_USERNAME,
          name: base.name || "Trương Thị Bích Thủy",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
          status: "active",
          mustChangePassword: hasDefaultPassword ? base.mustChangePassword ?? true : !!base.mustChangePassword,
          passwordHash: base.passwordHash || DEFAULT_ROOT_ADMIN.passwordHash,
        };

        const singleList = [normalizedRoot];
        localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(singleList));
        localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(normalizedRoot));
        return singleList;
      }
    }
  } catch {}

  const initial = [{ ...DEFAULT_ROOT_ADMIN }];
  try {
    localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(initial));
    localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(initial[0]));
  } catch {}
  return initial;
}

export function saveAllAdmins(admins: AdminUser[]) {
  const root =
    admins.find((a) => a.id === ROOT_SUPER_ADMIN_ID || normalizeUsername(a.email) === SUPER_ADMIN_EMAIL) ||
    admins[0] ||
    DEFAULT_ROOT_ADMIN;

  const normalizedRoot: AdminUser = {
    ...root,
    email: SUPER_ADMIN_EMAIL,
    username: SUPER_ADMIN_USERNAME,
    role: "super_admin",
    status: "active",
  };

  const singleList = [normalizedRoot];
  localStorage.setItem(STORAGE_KEYS.ADMINS_LIST, JSON.stringify(singleList));
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(normalizedRoot));
  window.dispatchEvent(new Event("admin_registry_changed"));
}

export function getRootAdmin(): AdminUser {
  const admins = getAllAdmins();
  return admins[0] || DEFAULT_ROOT_ADMIN;
}

export function getAdminAccount(): AdminUser {
  return getRootAdmin();
}

export function saveAdminAccount(adm: Partial<AdminUser> & { id?: string }) {
  const current = getRootAdmin();
  const next: AdminUser = {
    ...current,
    ...adm,
    email: SUPER_ADMIN_EMAIL,
    username: SUPER_ADMIN_USERNAME,
    role: "super_admin",
    status: "active",
    updatedAt: new Date().toISOString(),
  };
  saveAllAdmins([next]);
}

export function getAdminById(id: string): AdminUser | null {
  const root = getRootAdmin();
  return root.id === id || id === ROOT_SUPER_ADMIN_ID ? root : null;
}

export function getAdminByUsernameOrEmail(identifier: string): AdminUser | null {
  const norm = normalizeUsername(identifier);
  if (!norm) return null;
  const root = getRootAdmin();
  if (normalizeUsername(root.email) === norm || normalizeUsername(root.username) === norm) {
    return root;
  }
  return null;
}

/**
 * Escalation Lock: System strictly allows ONLY ONE SUPER_ADMIN (bichthuylqd@gmail.com).
 * Rejects creating any additional admin or super_admin account.
 */
export function upsertAdmin(adm: Partial<AdminUser> & { id: string; username: string; email: string }): {
  ok: boolean;
  message?: string;
} {
  const normEmail = normalizeUsername(adm.email);
  const root = getRootAdmin();

  if (adm.id !== root.id && normEmail !== SUPER_ADMIN_EMAIL) {
    return {
      ok: false,
      message: `Hệ thống chỉ cho phép duy nhất 01 tài khoản Super Admin (${SUPER_ADMIN_EMAIL}). Không thể tạo thêm quản trị viên khác.`,
    };
  }

  saveAdminAccount({
    ...root,
    ...adm,
    email: SUPER_ADMIN_EMAIL,
    username: SUPER_ADMIN_USERNAME,
    role: "super_admin",
    status: "active",
  });
  return { ok: true };
}

export function deleteAdmin(_id: string): { ok: boolean; message?: string } {
  return {
    ok: false,
    message: "Tuyệt đối không thể xóa hoặc vô hiệu hóa tài khoản Super Admin duy nhất của hệ thống!",
  };
}

/** Update Super Admin's local password state and clear mustChangePassword flag */
export function changeAdminPassword(
  adminId: string,
  newPasswordPlain: string
): { ok: boolean; message?: string } {
  const root = getRootAdmin();
  if (adminId !== root.id && adminId !== ROOT_SUPER_ADMIN_ID) {
    return { ok: false, message: "Không tìm thấy tài khoản Super Admin!" };
  }

  if (!newPasswordPlain || newPasswordPlain.length < 6 || newPasswordPlain === "123456") {
    return { ok: false, message: "Mật khẩu mới phải từ 6 ký tự trở lên và khác 123456!" };
  }

  const next: AdminUser = {
    ...root,
    passwordHash: hashPassword(newPasswordPlain),
    mustChangePassword: false,
    updatedAt: new Date().toISOString(),
  };

  saveAllAdmins([next]);

  const authUser = getCurrentAuthUser();
  if (authUser && (authUser.id === adminId || isSuperAdminEmail(authUser.email))) {
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
        const normalized = parsed
          .filter((t) => !isSuperAdminEmail(t?.email))
          .map((t) => {
            if (t.id === LEGACY_DEFAULT_TEACHER_ID) {
              changed = true;
              return { ...t, id: DEFAULT_TEACHER_ID };
            }
            if (!t.id) {
              changed = true;
              return { ...t, id: generateUuid() };
            }
            if (!t.approvalStatus) {
              changed = true;
              return {
                ...t,
                approvalStatus: (t.status === "locked"
                  ? "LOCKED"
                  : t.status === "pending"
                    ? "PENDING"
                    : t.status === "rejected"
                      ? "REJECTED"
                      : "APPROVED") as ApprovalStatus,
              };
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
  return (
    teachers.find((t) => t.id === id || (id === LEGACY_DEFAULT_TEACHER_ID && t.id === DEFAULT_TEACHER_ID)) ||
    null
  );
}

export function getTeacherByUsernameOrEmail(identifier: string): TeacherUser | null {
  const norm = normalizeUsername(identifier);
  if (!norm) return null;
  const teachers = getAllTeachers();
  const found = teachers.find(
    (t) =>
      normalizeUsername(t.username) === norm ||
      normalizeUsername(t.email) === norm ||
      (t.email && normalizeUsername(t.email.split("@")[0]) === norm) ||
      (norm.includes("@") && normalizeUsername(t.username) === norm.split("@")[0])
  );
  if (found) return found;

  if (
    norm === "giaovien" ||
    norm === "giaovien@school.edu.vn" ||
    norm === "thuy.tb" ||
    norm === "thuy.tb@pbc.danang.edu.vn"
  ) {
    return teachers.find((t) => t.id === DEFAULT_TEACHER_ID) || DEFAULT_TEACHER;
  }

  return null;
}

export async function fetchTeacherByUsernameOrEmail(identifier: string): Promise<TeacherUser | null> {
  const norm = normalizeUsername(identifier);
  if (!norm) return null;

  const local = getTeacherByUsernameOrEmail(identifier);
  if (local) return local;

  try {
    const isEmail = norm.includes("@");
    let query = supabase
      .from("profiles")
      .select("id, email, username, full_name, phone, school_name, subject_name, status, approval_status, rejection_reason, created_at");

    if (isEmail) {
      query = query.ilike("email", norm);
    } else {
      query = query.or(`username.ilike.${norm},email.ilike.${norm}@%`);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error || !data) return null;

    const email = data.email || "";
    const username = data.username || (email ? email.split("@")[0] : norm);
    const approvalStatus = ((data as any).approval_status || "APPROVED") as ApprovalStatus;
    const statusMap: Record<ApprovalStatus, TeacherUser["status"]> = {
      PENDING: "pending",
      REJECTED: "rejected",
      LOCKED: "locked",
      APPROVED: "active",
    };

    return {
      id: data.id,
      username,
      name: data.full_name || username || "Giáo viên",
      email: data.email || `${norm}@school.edu.vn`,
      phone: data.phone || "",
      school: data.school_name || "Trường THPT",
      subject: data.subject_name || "Tin học",
      status: statusMap[approvalStatus] || ((data.status as TeacherUser["status"]) || "active"),
      approvalStatus,
      rejectionReason: (data as any).rejection_reason || undefined,
      passwordHash: "",
      createdAt: data.created_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function upsertTeacher(t: TeacherUser) {
  if (isSuperAdminEmail(t.email)) return;
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

// Current authenticated user session (Super Admin or Approved Teacher)
export interface AuthSessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "super_admin" | "admin" | "teacher";
  approvalStatus?: ApprovalStatus;
  rejectionReason?: string | null;
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

    if (isSuperAdminEmail(user.email) || user.role === "super_admin") {
      if (user.role !== "super_admin" || user.email !== SUPER_ADMIN_EMAIL) {
        user.role = "super_admin";
        user.email = SUPER_ADMIN_EMAIL;
        user.approvalStatus = "APPROVED";
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
      }
      return user;
    }

    if (!user.id) {
      if (user.username === "giaovien") {
        user.id = DEFAULT_TEACHER_ID;
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
      if (user.role === "super_admin" || isSuperAdminEmail(user.email)) {
        user.id = ROOT_SUPER_ADMIN_ID;
      } else if (user.username === "giaovien") {
        user.id = DEFAULT_TEACHER_ID;
      } else {
        const existingTeacher = getTeacherByUsernameOrEmail(user.username || user.email);
        user.id = existingTeacher?.id || generateUuid();
      }
    }

    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));

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
        if (user.approvalStatus) existing.approvalStatus = user.approvalStatus;
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
