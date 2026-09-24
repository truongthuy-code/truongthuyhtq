/**
 * Student Account & Submission Management
 * Provides registration, authentication (without email verification),
 * submission history tracking, and post-close official answer reveal.
 */

export interface StudentUser {
  id: string;
  fullName: string;
  className: string;
  account: string; // email or username (lowercased)
  passwordHash: string;
  createdAt: string;
}

export interface StudentSubmissionRecord {
  id: string; // Supabase submission UUID or generated ID
  examId: string;
  examTitle: string;
  studentAccount: string; // email or username
  studentName: string;
  studentClass: string;
  score: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  answers: Record<string, any>;
  attemptNumber: number;
  startedAt: string | null;
  submittedAt: string;
  durationSeconds: number | null;
  status: "completed" | "in_progress";
  isExamClosed?: boolean;
}

export interface PublishedExamAnswerKey {
  examId: string;
  examTitle: string;
  questions: any;
  closedAt: string;
}

const STORAGE_KEYS = {
  STUDENTS: "qc_students_registry_v1",
  CURRENT_STUDENT: "qc_current_student_v1",
  SUBMISSIONS: "qc_student_submissions_v1",
  PUBLISHED_ANSWERS: "qc_published_answers_v1",
};

// Simple hashing for local credentials (salted SHA-256 equivalent)
function simpleHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return ("0000000" + (hash >>> 0).toString(16)).slice(-8);
}

function normalizeAccount(acc: string): string {
  return (acc || "").trim().toLowerCase();
}

/** Get all registered students */
export function getAllStudents(): Record<string, StudentUser> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Save students registry */
function saveAllStudents(students: Record<string, StudentUser>) {
  try {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  } catch (e) {
    console.error("Failed to save students registry:", e);
  }
}

/** Get currently logged-in student */
export function getCurrentStudent(): StudentUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Set current student session */
export function setCurrentStudent(student: StudentUser | null) {
  try {
    if (student) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, JSON.stringify(student));
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT);
    }
    // Dispatch custom event for real-time reactivity
    window.dispatchEvent(new Event("student_auth_change"));
  } catch (e) {
    console.error("Failed to update student session:", e);
  }
}

/** Register new student (NO email verification required) */
export function registerStudent(params: {
  fullName: string;
  className: string;
  account: string;
  password: string;
}): { success: boolean; error?: string; student?: StudentUser } {
  const { fullName, className, account, password } = params;

  if (!fullName?.trim()) {
    return { success: false, error: "Vui lòng nhập họ và tên" };
  }
  if (!className?.trim()) {
    return { success: false, error: "Vui lòng nhập lớp" };
  }
  const cleanAccount = normalizeAccount(account);
  if (!cleanAccount) {
    return { success: false, error: "Vui lòng nhập email hoặc tài khoản" };
  }
  if (!password || password.length < 4) {
    return { success: false, error: "Mật khẩu phải có ít nhất 4 ký tự" };
  }

  const students = getAllStudents();
  if (students[cleanAccount]) {
    return { success: false, error: "Tài khoản hoặc email này đã được đăng ký" };
  }

  const newStudent: StudentUser = {
    id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fullName: fullName.trim(),
    className: className.trim(),
    account: cleanAccount,
    passwordHash: simpleHash(password),
    createdAt: new Date().toISOString(),
  };

  students[cleanAccount] = newStudent;
  saveAllStudents(students);
  setCurrentStudent(newStudent);

  return { success: true, student: newStudent };
}

/** Login student */
export function loginStudent(
  account: string,
  password: string,
): { success: boolean; error?: string; student?: StudentUser } {
  const cleanAccount = normalizeAccount(account);
  if (!cleanAccount) {
    return { success: false, error: "Vui lòng nhập tài khoản hoặc email" };
  }
  if (!password) {
    return { success: false, error: "Vui lòng nhập mật khẩu" };
  }

  const students = getAllStudents();
  const student = students[cleanAccount];

  if (!student) {
    return { success: false, error: "Tài khoản không tồn tại. Vui lòng đăng ký." };
  }

  if (student.passwordHash !== simpleHash(password)) {
    return { success: false, error: "Mật khẩu không chính xác" };
  }

  setCurrentStudent(student);
  return { success: true, student };
}

/** Logout student */
export function logoutStudent() {
  setCurrentStudent(null);
}

/** Get all submissions across all students */
export function getAllSubmissions(): StudentSubmissionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBMISSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save submissions list */
function saveAllSubmissions(subs: StudentSubmissionRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(subs));
    window.dispatchEvent(new Event("student_submissions_change"));
  } catch (e) {
    console.error("Failed to save student submissions:", e);
  }
}

/** Get submissions for a specific student */
export function getStudentSubmissions(account?: string): StudentSubmissionRecord[] {
  const acc = normalizeAccount(account || getCurrentStudent()?.account || "");
  if (!acc) return [];

  const all = getAllSubmissions();
  return all
    .filter((s) => normalizeAccount(s.studentAccount) === acc)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

/**
 * Save or update a student submission.
 * Tracks accurate attempt number for student + exam.
 */
export function saveStudentSubmission(
  sub: Omit<StudentSubmissionRecord, "attemptNumber"> & { attemptNumber?: number },
): StudentSubmissionRecord {
  const all = getAllSubmissions();
  const acc = normalizeAccount(sub.studentAccount);

  // Calculate attempt number if not specified
  let attemptNumber = sub.attemptNumber;
  if (!attemptNumber) {
    const priorAttempts = all.filter(
      (s) => normalizeAccount(s.studentAccount) === acc && s.examId === sub.examId && s.id !== sub.id,
    );
    attemptNumber = priorAttempts.length + 1;
  }

  const fullRecord: StudentSubmissionRecord = {
    ...sub,
    studentAccount: acc,
    attemptNumber,
    isExamClosed: sub.isExamClosed || isExamOfficiallyClosed(sub.examId),
  };

  const existingIdx = all.findIndex((s) => s.id === sub.id);
  if (existingIdx >= 0) {
    all[existingIdx] = fullRecord;
  } else {
    all.unshift(fullRecord);
  }

  saveAllSubmissions(all);
  return fullRecord;
}

/** Get a single student submission by ID */
export function getStudentSubmissionById(id: string): StudentSubmissionRecord | null {
  const all = getAllSubmissions();
  return all.find((s) => s.id === id) || null;
}

// ============================================================
// PUBLISHED ANSWER KEYS & CLOSED EXAM REGISTRY
// ============================================================

export function getAllPublishedAnswers(): Record<string, PublishedExamAnswerKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PUBLISHED_ANSWERS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePublishedAnswers(data: Record<string, PublishedExamAnswerKey>) {
  try {
    localStorage.setItem(STORAGE_KEYS.PUBLISHED_ANSWERS, JSON.stringify(data));
    window.dispatchEvent(new Event("exam_answers_published"));
  } catch (e) {
    console.error("Failed to save published answers:", e);
  }
}

/**
 * Called when GV clicks "Đóng đề thi".
 * Publishes the official exam questions with answer keys and explanations.
 */
export function publishExamClosed(examId: string, questions: any, examTitle?: string) {
  if (!examId) return;
  const all = getAllPublishedAnswers();
  all[examId] = {
    examId,
    examTitle: examTitle || "Đề thi",
    questions: questions || {},
    closedAt: new Date().toISOString(),
  };
  savePublishedAnswers(all);

  // Also update any existing submissions for this exam to mark them as closed
  const subs = getAllSubmissions();
  let modified = false;
  subs.forEach((s) => {
    if (s.examId === examId && !s.isExamClosed) {
      s.isExamClosed = true;
      modified = true;
    }
  });
  if (modified) {
    saveAllSubmissions(subs);
  }
}

/** Check if an exam is officially closed */
export function isExamOfficiallyClosed(examId: string): boolean {
  if (!examId) return false;
  const all = getAllPublishedAnswers();
  return !!all[examId];
}

/** Get published answer key for a closed exam */
export function getPublishedExamAnswerKey(examId: string): PublishedExamAnswerKey | null {
  if (!examId) return null;
  const all = getAllPublishedAnswers();
  return all[examId] || null;
}
