/**
 * Teacher Account Registry & Management System
 * Provides authentication, profile management, password hashing,
 * admin initialization, and role isolation for Teachers and the single Admin account.
 */

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
  role: "admin";
  passwordHash: string;
}

const STORAGE_KEYS = {
  TEACHERS: "qc_teachers_registry_v2",
  ADMIN: "qc_admin_account_v2",
  CURRENT_USER: "qc_current_auth_user_v2",
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

export function normalizeUsername(u: string): string {
  return (u || "").trim().toLowerCase();
}

/** Initial default admin account credentials: admin / Admin@123 */
const DEFAULT_ADMIN: AdminUser = {
  id: "admin-system-root-001",
  username: "admin",
  name: "Quản trị viên Hệ thống",
  email: "admin@quizcheck.edu.vn",
  role: "admin",
  passwordHash: hashPassword("Admin@123"),
};

/** Initial default demo teacher account: giaovien / 123456 */
const DEFAULT_TEACHER: TeacherUser = {
  id: "teacher-default-001",
  username: "giaovien",
  name: "Trương Thị Bích Thủy",
  email: "thuy.tb@lqd.edu.vn",
  phone: "0901234567",
  school: "THPT Lê Quý Đôn",
  subject: "Tin học",
  status: "active",
  passwordHash: hashPassword("123456"),
  createdAt: new Date().toISOString(),
};

export function getAdminAccount(): AdminUser {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ADMIN);
    if (raw) return JSON.parse(raw);
  } catch {}
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(DEFAULT_ADMIN));
  return DEFAULT_ADMIN;
}

export function saveAdminAccount(adm: AdminUser) {
  localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(adm));
}

export function getAllTeachers(): TeacherUser[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TEACHERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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
  const teachers = getAllTeachers();
  return teachers.find((t) => t.id === id) || null;
}

export function getTeacherByUsernameOrEmail(identifier: string): TeacherUser | null {
  const norm = normalizeUsername(identifier);
  const teachers = getAllTeachers();
  return teachers.find((t) => normalizeUsername(t.username) === norm || normalizeUsername(t.email) === norm) || null;
}

export function upsertTeacher(t: TeacherUser) {
  const teachers = getAllTeachers();
  const idx = teachers.findIndex((item) => item.id === t.id);
  if (idx >= 0) {
    teachers[idx] = { ...t, updatedAt: new Date().toISOString() };
  } else {
    teachers.push(t);
  }
  saveAllTeachers(teachers);
}

export function deleteTeacher(id: string) {
  const teachers = getAllTeachers().filter((t) => t.id !== id);
  saveAllTeachers(teachers);
}

// Current authenticated user session (Teacher or Admin)
export interface AuthSessionUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "teacher";
  phone?: string;
  school?: string;
  subject?: string;
  avatar?: string;
}

export function getCurrentAuthUser(): AuthSessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCurrentAuthUser(user: AuthSessionUser | null) {
  if (user) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
  }
  window.dispatchEvent(new Event("app_auth_change"));
}

export function logoutCurrentUser() {
  setCurrentAuthUser(null);
}
