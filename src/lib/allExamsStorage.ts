import { supabase } from "@/integrations/supabase/client";
import { ensureSupabaseSession, withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";
import { SAMPLE_EXAMS, SampleExamData } from "@/lib/sampleExams";
import { getLocalAssignments, ExamAssignment } from "@/lib/examAssignments";
import { getAllTeachers, TeacherUser } from "@/lib/teacherStorage";

export interface SystemExam {
  id: string;
  title: string;
  duration_minutes: number;
  created_at: string;
  created_by?: string | null;
  teacher_name?: string;
  school_name?: string;
  subject_name?: string;
  questions?: any;
  manual_closed?: boolean;
  display_mode?: "standard" | "quizizz" | "team";
  original_file_url?: string | null;
  original_file_name?: string | null;
  original_file_path?: string | null;
  scoring?: any;
  allow_review?: boolean;
  open_at?: string | null;
  close_at?: string | null;
  team_config?: any;
  auto_submit_on_close?: boolean;
  instant_feedback?: boolean;
  lock_mode?: any;
  is_sample?: boolean;
}

const STORAGE_KEY = "qc_all_exams_registry_v1";

/**
 * Read all locally persisted exams
 */
export function getLocalStoredExams(): SystemExam[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persist all locally stored exams
 */
export function setLocalStoredExams(exams: SystemExam[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    window.dispatchEvent(new Event("all_exams_changed"));
  } catch (e) {
    console.error("Failed to persist system exams locally:", e);
  }
}

/**
 * Save or update a single exam in local cache
 */
export function saveUnifiedExam(exam: SystemExam) {
  const current = getLocalStoredExams();
  const idx = current.findIndex((e) => e.id === exam.id);
  let next: SystemExam[];
  if (idx >= 0) {
    next = [...current];
    next[idx] = { ...next[idx], ...exam };
  } else {
    next = [exam, ...current];
  }
  setLocalStoredExams(next);
}

/**
 * Delete an exam from local cache
 */
export function deleteUnifiedExamFromLocal(examId: string) {
  const current = getLocalStoredExams();
  const next = current.filter((e) => e.id !== examId);
  setLocalStoredExams(next);
}

/**
 * Fetch all exams across the system for Super Admin.
 * Combines:
 * 1. Supabase database records (cloud)
 * 2. Local assignments cache (teacher-created assignments)
 * 3. Local system exam registry
 * 4. Sample verified exams
 *
 * Ensures Super Admin sees 100% of all exams from all teachers with no empty states!
 */
export async function fetchAllExamsForAdmin(adminUser?: any): Promise<SystemExam[]> {
  // 1. Ensure Supabase auth session for admin@admin.com
  await ensureSupabaseSession(adminUser);

  const examMap = new Map<string, SystemExam>();
  const teachers = getAllTeachers();
  const teacherMap = new Map<string, TeacherUser>();
  teachers.forEach((t) => {
    teacherMap.set(t.id, t);
    if (t.username) teacherMap.set(t.username.toLowerCase(), t);
    if (t.email) teacherMap.set(t.email.toLowerCase(), t);
  });

  // 2. Fetch from Supabase
  try {
    const { data: dbExams, error: dbErr } = await supabase
      .from("exams")
      .select(
        "id,title,duration_minutes,created_at,questions,original_file_url,original_file_name,original_file_path,scoring,allow_review,open_at,close_at,manual_closed,display_mode,team_config,created_by,teacher_name,school_name,subject_name,instant_feedback,lock_mode,auto_submit_on_close"
      )
      .order("created_at", { ascending: false });

    if (!dbErr && Array.isArray(dbExams)) {
      dbExams.forEach((e: any) => {
        let tName = e.teacher_name;
        let sName = e.school_name;
        let subName = e.subject_name;

        // Fallback to teacher lookup if missing
        if ((!tName || tName === "Giáo viên") && e.created_by) {
          const t = teacherMap.get(e.created_by);
          if (t) {
            tName = t.name;
            sName = sName || t.school;
            subName = subName || t.subject;
          }
        }

        examMap.set(e.id, {
          ...e,
          teacher_name: tName || "Giáo viên",
          school_name: sName || "",
          subject_name: subName || "Chưa phân loại",
        });
      });
    }
  } catch (err) {
    console.warn("Error fetching exams from Supabase for admin:", err);
  }

  // 2.5. Fetch all registered teacher exams from Supabase public registry (schools table)
  // Ensures Admin can view, edit, and manage all exams created by all teachers
  try {
    const { data: schRows } = await supabase
      .from("schools")
      .select("name_key, name")
      .like("name_key", "assign_code:%");

    if (schRows && schRows.length > 0) {
      const missingExamIds = new Set<string>();
      const metaMap = new Map<string, any>();

      for (const s of schRows) {
        try {
          const p = JSON.parse(s.name);
          if (p.examId && isUuid(p.examId) && !examMap.has(p.examId)) {
            missingExamIds.add(p.examId);
            if (!metaMap.has(p.examId)) {
              metaMap.set(p.examId, p);
            }
          }
        } catch {}
      }

      if (missingExamIds.size > 0) {
        // Immediate baseline registration to guarantee 100% presence
        for (const [examId, meta] of metaMap.entries()) {
          if (!examMap.has(examId)) {
            examMap.set(examId, {
              id: examId,
              title: meta.title || "Bài thi",
              teacher_name: meta.teacherName || "Giáo viên",
              school_name: meta.schoolName || "",
              subject_name: meta.subjectName || "Chưa phân loại",
              duration_minutes: meta.durationMinutes || 45,
              open_at: meta.openAt ?? null,
              close_at: meta.closeAt ?? null,
              created_at: meta.createdAt || new Date().toISOString(),
              manual_closed: false,
              display_mode: "standard",
              questions: [],
            });
          }
        }

        // Fetch full exam content with questions via public get_exam_for_student RPC
        const fetchedExams = await Promise.all(
          Array.from(missingExamIds).map(async (examId) => {
            try {
              const { data: exData, error: exErr } = await supabase.rpc("get_exam_for_student", {
                p_exam_id: examId,
              });
              if (!exErr && exData) {
                const meta = metaMap.get(examId) || {};
                return {
                  ...meta,
                  ...exData,
                  id: examId,
                  teacher_name: meta.teacherName || (exData as any).teacher_name || "Giáo viên",
                  school_name: meta.schoolName || (exData as any).school_name || "",
                  subject_name: meta.subjectName || (exData as any).subject_name || "Chưa phân loại",
                  created_at: meta.createdAt || (exData as any).created_at || new Date().toISOString(),
                };
              }
            } catch {}
            return null;
          })
        );

        for (const fe of fetchedExams) {
          if (fe && fe.id) {
            examMap.set(fe.id, fe);
          }
        }
      }
    }
  } catch (err) {
    console.warn("Error resolving cross-teacher exams for admin:", err);
  }

  // 3. Merge with local exams registry
  const localList = getLocalStoredExams();
  localList.forEach((e) => {
    if (!examMap.has(e.id)) {
      examMap.set(e.id, e);
    } else {
      // Supabase record has priority, but preserve any local fields if missing
      const existing = examMap.get(e.id)!;
      examMap.set(e.id, {
        ...e,
        ...existing,
        questions: existing.questions || e.questions,
      });
    }
  });

  // 4. Merge with local assignments cache (if an exam was saved locally by a teacher)
  const assignments = getLocalAssignments();
  assignments.forEach((a) => {
    if (a.examId && !examMap.has(a.examId)) {
      examMap.set(a.examId, {
        id: a.examId,
        title: a.title,
        duration_minutes: a.durationMinutes || 45,
        created_at: a.createdAt,
        created_by: a.createdBy,
        teacher_name: a.teacherName || "Giáo viên",
        school_name: a.schoolName || "",
        subject_name: a.subjectName || "Chưa phân loại",
        manual_closed: false,
        display_mode: "standard",
        open_at: a.openAt,
        close_at: a.closeAt,
      });
    }
  });

  // 5. Merge sample exams for completeness and testing
  SAMPLE_EXAMS.forEach((s) => {
    if (!examMap.has(s.id)) {
      examMap.set(s.id, {
        id: s.id,
        title: s.title,
        duration_minutes: s.duration_minutes,
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: "system_sample",
        teacher_name: s.teacher_name,
        school_name: s.school_name,
        subject_name: s.subject_name,
        questions: s.questions,
        manual_closed: s.manual_closed,
        display_mode: s.display_mode,
        open_at: s.open_at,
        close_at: s.close_at,
        allow_review: s.allow_review,
        auto_submit_on_close: s.auto_submit_on_close,
        scoring: s.scoring,
        is_sample: true,
      });
    }
  });

  const combined = Array.from(examMap.values());
  // Sort descending by created_at
  combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Cache back to local registry so offline works too
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(combined));
  } catch {}

  return combined;
}

/**
 * Super Admin delete exam: Deletes both from Supabase (with cascade submissions)
 * and local registry.
 */
export async function deleteExamAsSuperAdmin(examId: string, user?: any): Promise<{ ok: boolean; message?: string }> {
  try {
    // 1. Delete from Supabase
    await withSupabaseAuthRetry(async () => {
      await supabase.from("submissions").delete().eq("exam_id", examId);
      await supabase.from("schools").delete().eq("name_key", `assign_code:${examId}`);
      await supabase.from("schools").delete().like("name", `%"examId":"${examId}"%`);
      return await supabase.from("exams").delete().eq("id", examId);
    }, user);
  } catch (err: any) {
    console.warn("Supabase delete exam note:", err);
  }

  // 2. Delete from local registry
  deleteUnifiedExamFromLocal(examId);

  // 3. Remove from local assignments
  try {
    const assigns = getLocalAssignments().filter((a) => a.examId !== examId);
    localStorage.setItem("qc_exam_assignments_v1", JSON.stringify(assigns));
  } catch {}

  return { ok: true };
}

/**
 * Super Admin toggle lock/closed state on an exam
 */
export async function toggleExamLockAsSuperAdmin(exam: SystemExam, user?: any): Promise<{ ok: boolean; nextState: boolean }> {
  const nextState = !exam.manual_closed;
  try {
    await withSupabaseAuthRetry(async () => {
      return await supabase.from("exams").update({ manual_closed: nextState } as any).eq("id", exam.id);
    }, user);
  } catch (err) {
    console.warn("Supabase update exam status note:", err);
  }

  saveUnifiedExam({
    ...exam,
    manual_closed: nextState,
  });

  return { ok: true, nextState };
}

export interface ParsedQuestionSet {
  partI: Array<{
    id: string;
    text: string;
    options: Array<{ key: string; text: string }>;
    answer?: string;
    explanation?: string;
    level?: number;
  }>;
  partII: Array<{
    id: string;
    text: string;
    items: Array<{ key: string; text: string; correct?: boolean }>;
    explanation?: string;
    level?: number;
  }>;
  partIII: Array<{
    id: string;
    text: string;
    answer?: string;
    explanation?: string;
    level?: number;
  }>;
}

export function getParsedQuestions(questions: any): ParsedQuestionSet {
  const result: ParsedQuestionSet = { partI: [], partII: [], partIII: [] };
  if (!questions) return result;

  let raw = questions;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return result;
    }
  }

  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.partI)) result.partI = raw.partI;
    if (Array.isArray(raw.partII)) result.partII = raw.partII;
    if (Array.isArray(raw.partIII)) result.partIII = raw.partIII;

    // If it's already structured, return
    if (result.partI.length > 0 || result.partII.length > 0 || result.partIII.length > 0) {
      return result;
    }

    // If it's an array of questions
    if (Array.isArray(raw)) {
      raw.forEach((q, idx) => {
        if (!q) return;
        const part = String(q.part || "").toUpperCase();
        if (part === "II" || part === "2" || Array.isArray(q.items)) {
          result.partII.push({
            id: q.id || `p2_${idx}`,
            text: q.text || q.question || "",
            items: Array.isArray(q.items) ? q.items : [],
            explanation: q.explanation,
            level: q.level,
          });
        } else if (part === "III" || part === "3" || (!q.options && q.answer)) {
          result.partIII.push({
            id: q.id || `p3_${idx}`,
            text: q.text || q.question || "",
            answer: q.answer || "",
            explanation: q.explanation,
            level: q.level,
          });
        } else {
          result.partI.push({
            id: q.id || `p1_${idx}`,
            text: q.text || q.question || "",
            options: Array.isArray(q.options) ? q.options : [],
            answer: q.answer || "",
            explanation: q.explanation,
            level: q.level,
          });
        }
      });
    }
  }

  return result;
}
