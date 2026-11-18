import { supabase } from "@/integrations/supabase/client";
import {
  ApprovalStatus,
  getAllTeachers,
  upsertTeacher,
  deleteTeacher as deleteLocalTeacher,
  SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
  changeAdminPassword,
  getRootAdmin,
  hashPassword,
  saveAdminAccount,
  isUuid,
} from "@/lib/teacherStorage";
import {
  fetchAllExamsForAdmin,
  saveUnifiedExam,
  deleteUnifiedExamFromLocal,
  SystemExam,
} from "@/lib/allExamsStorage";
import {
  ExamFolder,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
} from "@/lib/folderStorage";
import { getLocalAssignments } from "@/lib/examAssignments";
import { normalizeSubmissionToScale10 } from "@/lib/grading";

export interface AdminOverviewMetrics {
  totalTeachers: number;
  pendingCount: number;
  approvedCount: number;
  lockedCount: number;
  rejectedCount: number;
  totalExams: number;
  totalFolders: number;
  totalSubmissions: number;
}

export interface AdminRegistrationRecord {
  id: string;
  teacher_id: string;
  email: string;
  username: string;
  full_name: string;
  phone: string;
  school_name: string;
  subject_name: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejection_reason?: string | null;
  reviewed_at?: string | null;
  created_at: string;
}

export interface AdminTeacherRecord {
  id: string;
  email: string;
  username: string;
  full_name: string;
  phone: string;
  school_name: string;
  subject_name: string;
  status: "active" | "locked" | "pending" | "rejected";
  approval_status: ApprovalStatus;
  rejection_reason?: string | null;
  is_deleted?: boolean;
  created_at: string;
  exam_count: number;
  folder_count: number;
}

export interface AdminActivityLogRecord {
  id: string;
  actor_id?: string | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  target_label?: string | null;
  summary?: string | null;
  before_data?: any;
  after_data?: any;
  metadata?: any;
  created_at: string;
}

export interface TeacherDataBundle {
  teacher: AdminTeacherRecord | null;
  folders: ExamFolder[];
  exams: SystemExam[];
  submissions: any[];
  subjects: string[];
  schools: string[];
}

async function getAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

async function callAdminApi<T = any>(action: string, payload: Record<string, any> = {}): Promise<T | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const resp = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403 || (resp.status >= 400 && data?.error)) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }
      return null;
    }
    return data as T;
  } catch (err: any) {
    // Re-throw explicit API permission/validation errors; swallow network errors for RPC/local fallback
    if (err?.message && !err.message.includes("Failed to fetch") && !err.message.includes("NetworkError")) {
      throw err;
    }
    return null;
  }
}

function toApprovalStatus(rawApproval?: string | null, rawStatus?: string | null): ApprovalStatus {
  const a = String(rawApproval || "").toUpperCase();
  if (a === "PENDING" || a === "APPROVED" || a === "REJECTED" || a === "LOCKED") return a;
  const s = String(rawStatus || "").toLowerCase();
  if (s === "pending") return "PENDING";
  if (s === "rejected") return "REJECTED";
  if (s === "locked") return "LOCKED";
  return "APPROVED";
}

function mapTeacherStatus(approval: ApprovalStatus): AdminTeacherRecord["status"] {
  if (approval === "PENDING") return "pending";
  if (approval === "REJECTED") return "rejected";
  if (approval === "LOCKED") return "locked";
  return "active";
}

export async function fetchAdminTeachers(includeDeleted = false): Promise<AdminTeacherRecord[]> {
  const map = new Map<string, AdminTeacherRecord>();

  // 1. Server API / Supabase profiles
  try {
    const apiRes = await callAdminApi<{ ok: boolean; teachers: any[] }>("list_teachers", { includeDeleted });
    if (apiRes?.ok && Array.isArray(apiRes.teachers)) {
      for (const p of apiRes.teachers) {
        if (isSuperAdminEmail(p.email)) continue;
        const appStatus = toApprovalStatus(p.approval_status, p.status);
        map.set(p.id, {
          id: p.id,
          email: p.email || "",
          username: p.username || (p.email ? p.email.split("@")[0] : ""),
          full_name: p.full_name || "Giáo viên",
          phone: p.phone || "",
          school_name: p.school_name || "",
          subject_name: p.subject_name || "",
          status: mapTeacherStatus(appStatus),
          approval_status: appStatus,
          rejection_reason: p.rejection_reason || null,
          is_deleted: !!p.is_deleted,
          created_at: p.created_at || new Date().toISOString(),
          exam_count: Number(p.exam_count || 0),
          folder_count: Number(p.folder_count || 0),
        });
      }
    }
  } catch {}

  // 2. Direct Supabase query fallback if /api/admin returned empty
  if (map.size === 0) {
    try {
      const { data: profs } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      for (const p of profs || []) {
        if (isSuperAdminEmail(p.email) || p.role === "super_admin") continue;
        if (!includeDeleted && (p as any).is_deleted) continue;
        const appStatus = toApprovalStatus((p as any).approval_status, p.status);
        map.set(p.id, {
          id: p.id,
          email: p.email || "",
          username: p.username || (p.email ? p.email.split("@")[0] : ""),
          full_name: p.full_name || "Giáo viên",
          phone: p.phone || "",
          school_name: p.school_name || "",
          subject_name: p.subject_name || "",
          status: mapTeacherStatus(appStatus),
          approval_status: appStatus,
          rejection_reason: (p as any).rejection_reason || null,
          is_deleted: !!(p as any).is_deleted,
          created_at: p.created_at || new Date().toISOString(),
          exam_count: 0,
          folder_count: 0,
        });
      }
    } catch {}
  }

  // 3. Merge local teacher registry (offline / test entries not yet on Supabase)
  const localTeachers = getAllTeachers();
  for (const t of localTeachers) {
    if (isSuperAdminEmail(t.email)) continue;
    if (!map.has(t.id)) {
      const appStatus = toApprovalStatus(t.approvalStatus, t.status);
      map.set(t.id, {
        id: t.id,
        email: t.email,
        username: t.username,
        full_name: t.name,
        phone: t.phone || "",
        school_name: t.school || "",
        subject_name: t.subject || "",
        status: mapTeacherStatus(appStatus),
        approval_status: appStatus,
        rejection_reason: t.rejectionReason || null,
        is_deleted: false,
        created_at: t.createdAt || new Date().toISOString(),
        exam_count: 0,
        folder_count: 0,
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function fetchAdminRegistrations(): Promise<AdminRegistrationRecord[]> {
  const regMap = new Map<string, AdminRegistrationRecord>();

  try {
    const apiRes = await callAdminApi<{ ok: boolean; registrations: any[] }>("list_registrations");
    if (apiRes?.ok && Array.isArray(apiRes.registrations)) {
      for (const r of apiRes.registrations) {
        if (isSuperAdminEmail(r.email)) continue;
        const uid = r.user_id || r.teacher_id || r.id;
        const status = String(r.status || "PENDING").toUpperCase() as AdminRegistrationRecord["status"];
        regMap.set(uid, {
          id: r.id,
          teacher_id: uid,
          email: r.email || "",
          username: r.username || (r.email ? r.email.split("@")[0] : ""),
          full_name: r.full_name || "Giáo viên",
          phone: r.phone || "",
          school_name: r.school_name || "",
          subject_name: r.subject_name || "",
          status: status === "APPROVED" || status === "REJECTED" ? status : "PENDING",
          rejection_reason: r.rejection_reason || null,
          reviewed_at: r.reviewed_at || null,
          created_at: r.created_at || new Date().toISOString(),
        });
      }
    }
  } catch {}

  if (regMap.size === 0) {
    try {
      const { data: regs } = await (supabase as any)
        .from("teacher_registrations")
        .select("*")
        .order("created_at", { ascending: false });
      for (const r of regs || []) {
        if (isSuperAdminEmail(r.email)) continue;
        const uid = r.user_id || r.teacher_id || r.id;
        regMap.set(uid, {
          id: r.id,
          teacher_id: uid,
          email: r.email || "",
          username: r.username || "",
          full_name: r.full_name || "Giáo viên",
          phone: r.phone || "",
          school_name: r.school_name || "",
          subject_name: r.subject_name || "",
          status: (r.status || "PENDING") as any,
          rejection_reason: r.rejection_reason || null,
          reviewed_at: r.reviewed_at || null,
          created_at: r.created_at || new Date().toISOString(),
        });
      }
    } catch {}
  }

  // Merge pending/rejected/approved teachers from local registry
  const teachers = await fetchAdminTeachers();
  for (const t of teachers) {
    if (!regMap.has(t.id)) {
      const st =
        t.approval_status === "PENDING"
          ? "PENDING"
          : t.approval_status === "REJECTED"
            ? "REJECTED"
            : "APPROVED";
      regMap.set(t.id, {
        id: t.id,
        teacher_id: t.id,
        email: t.email,
        username: t.username,
        full_name: t.full_name,
        phone: t.phone,
        school_name: t.school_name,
        subject_name: t.subject_name,
        status: st,
        rejection_reason: t.rejection_reason || null,
        created_at: t.created_at,
      });
    }
  }

  return Array.from(regMap.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function fetchAdminOverview(): Promise<AdminOverviewMetrics> {
  const [teachers, exams, folders] = await Promise.all([
    fetchAdminTeachers(),
    fetchSystemExamsForAdmin(),
    getFolders(undefined, true),
  ]);

  let totalSubmissions = 0;
  try {
    const apiRes = await callAdminApi<{ ok: boolean; metrics: AdminOverviewMetrics }>("overview");
    if (apiRes?.ok && apiRes.metrics) {
      return {
        ...apiRes.metrics,
        totalTeachers: Math.max(apiRes.metrics.totalTeachers, teachers.length),
        totalExams: Math.max(apiRes.metrics.totalExams, exams.length),
        totalFolders: Math.max(apiRes.metrics.totalFolders, folders.length),
      };
    }
  } catch {}

  try {
    const { count } = await supabase.from("submissions").select("id", { count: "exact", head: true });
    totalSubmissions = count || 0;
  } catch {}

  return {
    totalTeachers: teachers.length,
    pendingCount: teachers.filter((t) => t.approval_status === "PENDING").length,
    approvedCount: teachers.filter((t) => t.approval_status === "APPROVED").length,
    lockedCount: teachers.filter((t) => t.approval_status === "LOCKED").length,
    rejectedCount: teachers.filter((t) => t.approval_status === "REJECTED").length,
    totalExams: exams.length,
    totalFolders: folders.length,
    totalSubmissions,
  };
}

export async function approveTeacherAccount(
  teacherId: string,
  meta?: { email?: string; fullName?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("approve_teacher", {
      teacherId,
      email: meta?.email,
      fullName: meta?.fullName,
    });
    if (apiRes && !apiRes.ok) {
      return { ok: false, error: apiRes.error };
    }
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any).rpc("admin_approve_teacher", { p_user_id: teacherId }).catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể phê duyệt tài khoản." };
  }

  const local = getAllTeachers().find((t) => t.id === teacherId);
  if (local) {
    upsertTeacher({
      ...local,
      status: "active",
      approvalStatus: "APPROVED",
      rejectionReason: undefined,
    });
  }
  return { ok: true };
}

export async function rejectTeacherAccount(
  teacherId: string,
  reason: string,
  meta?: { email?: string; fullName?: string }
): Promise<{ ok: boolean; error?: string }> {
  const cleanReason = reason.trim() || "Không đáp ứng điều kiện xét duyệt";
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("reject_teacher", {
      teacherId,
      reason: cleanReason,
      email: meta?.email,
      fullName: meta?.fullName,
    });
    if (apiRes && !apiRes.ok) {
      return { ok: false, error: apiRes.error };
    }
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any)
        .rpc("admin_reject_teacher", { p_user_id: teacherId, p_reason: cleanReason })
        .catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể từ chối đăng ký." };
  }

  const local = getAllTeachers().find((t) => t.id === teacherId);
  if (local) {
    upsertTeacher({
      ...local,
      status: "rejected",
      approvalStatus: "REJECTED",
      rejectionReason: cleanReason,
    });
  }
  return { ok: true };
}

export async function updateTeacherProfileByAdmin(
  teacherId: string,
  updates: {
    fullName: string;
    username: string;
    phone?: string;
    schoolName?: string;
    subjectName?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("update_teacher", {
      teacherId,
      ...updates,
    });
    if (apiRes && !apiRes.ok) return { ok: false, error: apiRes.error };
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any)
        .rpc("admin_update_teacher", {
          p_user_id: teacherId,
          p_full_name: updates.fullName,
          p_username: updates.username,
          p_phone: updates.phone || "",
          p_school_name: updates.schoolName || "",
          p_subject_name: updates.subjectName || "",
        })
        .catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể cập nhật thông tin giáo viên." };
  }

  const local = getAllTeachers().find((t) => t.id === teacherId);
  if (local) {
    upsertTeacher({
      ...local,
      name: updates.fullName,
      username: updates.username,
      phone: updates.phone || "",
      school: updates.schoolName || "",
      subject: updates.subjectName || "",
    });
  }
  return { ok: true };
}

export async function lockTeacherAccount(
  teacherId: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("lock_teacher", {
      teacherId,
      reason,
    });
    if (apiRes && !apiRes.ok) return { ok: false, error: apiRes.error };
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any)
        .rpc("admin_lock_teacher", { p_user_id: teacherId, p_reason: reason || null })
        .catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể khóa tài khoản." };
  }

  const local = getAllTeachers().find((t) => t.id === teacherId);
  if (local) {
    upsertTeacher({ ...local, status: "locked", approvalStatus: "LOCKED" });
  }
  return { ok: true };
}

export async function unlockTeacherAccount(teacherId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("unlock_teacher", {
      teacherId,
    });
    if (apiRes && !apiRes.ok) return { ok: false, error: apiRes.error };
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any).rpc("admin_unlock_teacher", { p_user_id: teacherId }).catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể mở khóa tài khoản." };
  }

  const local = getAllTeachers().find((t) => t.id === teacherId);
  if (local) {
    upsertTeacher({ ...local, status: "active", approvalStatus: "APPROVED" });
  }
  return { ok: true };
}

export async function deleteTeacherAccount(
  teacherId: string,
  preserveData: boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("delete_teacher", {
      teacherId,
      preserveData,
    });
    if (apiRes && !apiRes.ok) return { ok: false, error: apiRes.error };
    if (!apiRes && isUuid(teacherId)) {
      await (supabase as any)
        .rpc("admin_delete_teacher", { p_user_id: teacherId, p_preserve_data: preserveData })
        .catch(() => {});
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể xóa tài khoản." };
  }

  if (preserveData) {
    const local = getAllTeachers().find((t) => t.id === teacherId);
    if (local) {
      upsertTeacher({ ...local, status: "locked", approvalStatus: "LOCKED" });
    }
  } else {
    deleteLocalTeacher(teacherId);
  }
  return { ok: true };
}

export async function fetchSystemExamsForAdmin(): Promise<{
  exams: SystemExam[];
  submissionCounts: Record<string, number>;
}> {
  const counts: Record<string, number> = {};
  let merged: SystemExam[] = [];

  try {
    const apiRes = await callAdminApi<{
      ok: boolean;
      exams: SystemExam[];
      submissionCounts: Record<string, number>;
    }>("list_exams_system");
    if (apiRes?.ok && Array.isArray(apiRes.exams)) {
      merged = apiRes.exams;
      Object.assign(counts, apiRes.submissionCounts || {});
    }
  } catch {}

  if (merged.length === 0) {
    merged = await fetchAllExamsForAdmin();
    try {
      const { data: subs } = await supabase.from("submissions").select("exam_id");
      for (const s of subs || []) {
        counts[s.exam_id] = (counts[s.exam_id] || 0) + 1;
      }
    } catch {}
  } else {
    const localExams = await fetchAllExamsForAdmin();
    const seen = new Set(merged.map((e) => e.id));
    for (const le of localExams) {
      if (!seen.has(le.id)) merged.push(le);
    }
  }

  return {
    exams: merged.filter((e: any) => !e.is_deleted),
    submissionCounts: counts,
  };
}

export async function fetchTeacherDataBundle(teacherId: string): Promise<TeacherDataBundle> {
  const allTeachers = await fetchAdminTeachers(true);
  const matchedTeacher = allTeachers.find((t) => t.id === teacherId) || null;

  try {
    const apiRes = await callAdminApi<{
      ok: boolean;
      teacher: any;
      folders: ExamFolder[];
      exams: SystemExam[];
      submissions: any[];
      subjects: string[];
      schools: string[];
    }>("get_teacher_data", { teacherId });

    if (apiRes?.ok) {
      const examMap = new Map(apiRes.exams.map((e) => [e.id, e]));
      const normSubs = (apiRes.submissions || []).map((s) =>
        normalizeSubmissionToScale10(s, examMap.get(s.exam_id))
      );
      return {
        teacher: matchedTeacher,
        folders: apiRes.folders || [],
        exams: apiRes.exams || [],
        submissions: normSubs,
        subjects: apiRes.subjects || [],
        schools: apiRes.schools || [],
      };
    }
  } catch {}

  // Fallback to combined Supabase + local cache queries
  const [{ exams: allExams }, allFolders] = await Promise.all([
    fetchSystemExamsForAdmin(),
    getFolders(teacherId, true),
  ]);

  const teacherExams = allExams.filter((e) => {
    if (e.created_by === teacherId) return true;
    if (
      matchedTeacher &&
      e.teacher_name &&
      e.teacher_name.trim().toLowerCase() === matchedTeacher.full_name.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  });

  const teacherFolders = allFolders.filter((f) => !f.teacher_id || f.teacher_id === teacherId);

  let submissions: any[] = [];
  const examIds = teacherExams.map((e) => e.id).filter(isUuid);
  if (examIds.length > 0) {
    try {
      const { data: subs } = await supabase
        .from("submissions")
        .select("*")
        .in("exam_id", examIds)
        .order("submitted_at", { ascending: false });
      const examMap = new Map(teacherExams.map((e) => [e.id, e]));
      submissions = (subs || []).map((s) => normalizeSubmissionToScale10(s, examMap.get(s.exam_id)));
    } catch {}
  }

  const subjects = Array.from(
    new Set([matchedTeacher?.subject_name, ...teacherExams.map((e) => e.subject_name)].filter(Boolean) as string[])
  );
  const schools = Array.from(
    new Set([matchedTeacher?.school_name, ...teacherExams.map((e) => e.school_name)].filter(Boolean) as string[])
  );

  return {
    teacher: matchedTeacher,
    folders: teacherFolders,
    exams: teacherExams,
    submissions,
    subjects,
    schools,
  };
}

export async function saveExamByAdmin(exam: Partial<SystemExam>): Promise<{ ok: boolean; exam?: SystemExam; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; exam: SystemExam; error?: string }>("save_exam", { exam });
    if (apiRes?.ok && apiRes.exam) {
      saveUnifiedExam(apiRes.exam);
      return { ok: true, exam: apiRes.exam };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể lưu đề thi." };
  }

  if (exam.id && isUuid(exam.id)) {
    const { data, error } = await supabase
      .from("exams")
      .update({
        title: exam.title,
        duration_minutes: exam.duration_minutes,
        subject_name: exam.subject_name,
        school_name: exam.school_name,
        folder_id: exam.folder_id ?? null,
        manual_closed: !!exam.manual_closed,
        allow_review: exam.allow_review !== false,
        instant_feedback: !!exam.instant_feedback,
        display_mode: exam.display_mode || "standard",
        open_at: exam.open_at || null,
        close_at: exam.close_at || null,
        questions: exam.questions,
      } as any)
      .eq("id", exam.id)
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    if (data) saveUnifiedExam(data as any);
    return { ok: true, exam: data as any };
  }

  if (exam.id) {
    saveUnifiedExam(exam as SystemExam);
    return { ok: true, exam: exam as SystemExam };
  }

  return { ok: false, error: "Thiếu thông tin đề thi." };
}

export async function deleteExamByAdmin(
  examId: string,
  hardDelete = false
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("delete_exam", {
      examId,
      hardDelete,
    });
    if (apiRes && !apiRes.ok) return { ok: false, error: apiRes.error };
    if (!apiRes && isUuid(examId)) {
      const { error } = await (supabase as any).rpc("admin_delete_exam", {
        p_exam_id: examId,
        p_hard_delete: hardDelete,
      });
      if (error) {
        if (hardDelete) {
          await supabase.from("submissions").delete().eq("exam_id", examId);
          await supabase.from("exams").delete().eq("id", examId);
        } else {
          await supabase.from("exams").update({ manual_closed: true, is_deleted: true } as any).eq("id", examId);
        }
      }
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể xóa đề thi." };
  }

  deleteUnifiedExamFromLocal(examId);
  return { ok: true };
}

export async function toggleExamLockByAdmin(exam: SystemExam): Promise<{ ok: boolean; nextState: boolean; error?: string }> {
  const nextState = !exam.manual_closed;
  const res = await saveExamByAdmin({ ...exam, manual_closed: nextState });
  if (!res.ok) return { ok: false, nextState: !!exam.manual_closed, error: res.error };
  return { ok: true, nextState };
}

export async function saveFolderByAdmin(folder: {
  id?: string;
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  parent_id?: string | null;
  teacher_id?: string | null;
}): Promise<{ ok: boolean; folder?: ExamFolder; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; folder: ExamFolder; error?: string }>("save_folder", {
      folder,
    });
    if (apiRes?.ok && apiRes.folder) {
      return { ok: true, folder: apiRes.folder };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể lưu thư mục." };
  }

  try {
    if (folder.id) {
      const updated = await updateFolder(
        folder.id,
        {
          name: folder.name,
          description: folder.description,
          color: folder.color,
          icon: folder.icon,
          parent_id: folder.parent_id,
        },
        folder.teacher_id,
        true
      );
      return { ok: true, folder: updated };
    } else {
      const created = await createFolder({
        name: folder.name,
        description: folder.description,
        color: folder.color,
        icon: folder.icon,
        parent_id: folder.parent_id,
        teacher_id: folder.teacher_id,
        isAdmin: true,
      });
      return { ok: true, folder: created };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể lưu thư mục." };
  }
}

export async function deleteFolderByAdmin(
  folderId: string,
  teacherId?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("delete_folder", { folderId });
    if (apiRes?.ok) return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể xóa thư mục." };
  }

  try {
    await deleteFolder(folderId, teacherId, true);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Không thể xóa thư mục." };
  }
}

export async function fetchAdminActivityLogs(limit = 200): Promise<AdminActivityLogRecord[]> {
  const normalizeLog = (row: any): AdminActivityLogRecord => ({
    ...row,
    actor_id: row.admin_id || row.actor_id || null,
    actor_email: row.admin_email || row.actor_email || SUPER_ADMIN_EMAIL,
    summary: row.detail || row.summary || "",
  });

  try {
    const apiRes = await callAdminApi<{ ok: boolean; logs: AdminActivityLogRecord[] }>("list_activity_logs", {
      limit,
    });
    if (apiRes?.ok && Array.isArray(apiRes.logs)) {
      return apiRes.logs.map(normalizeLog);
    }
  } catch {}

  try {
    const { data } = await (supabase as any)
      .from("admin_activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data || []).map(normalizeLog);
  } catch {
    return [];
  }
}

export async function changeSuperAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!newPassword || newPassword.length < 6 || newPassword === "123456") {
    return { ok: false, error: "Mật khẩu mới phải từ 6 ký tự trở lên và không được dùng 123456." };
  }

  const token = await getAccessToken();
  if (token) {
    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email: SUPER_ADMIN_EMAIL,
      password: currentPassword,
    });
    if (reAuthErr) {
      return { ok: false, error: "Mật khẩu hiện tại không chính xác." };
    }

    const apiRes = await callAdminApi<{ ok: boolean; error?: string }>("change_super_admin_password", {
      newPassword,
    }).catch((e) => ({ ok: false, error: e?.message }));

    if (apiRes && !apiRes.ok) {
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) return { ok: false, error: updErr.message };
    }

    await (supabase as any).rpc("complete_super_admin_first_password_change").catch(() => {});
  } else {
    const root = getRootAdmin();
    if (root.passwordHash !== hashPassword(currentPassword)) {
      return { ok: false, error: "Mật khẩu hiện tại không chính xác." };
    }
  }

  const root = getRootAdmin();
  changeAdminPassword(root.id, newPassword);
  saveAdminAccount({ ...root, passwordHash: hashPassword(newPassword), mustChangePassword: false });
  return { ok: true };
}

export function getExamCodeBadgeForAdmin(exam: SystemExam): string {
  const cfg = (exam.team_config as any) || {};
  if (cfg.primary_code) return String(cfg.primary_code);
  const localAssign = getLocalAssignments().find((a) => a.examId === exam.id);
  return localAssign?.code || "Chưa gán mã";
}
