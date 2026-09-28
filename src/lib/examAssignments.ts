import { supabase } from "@/integrations/supabase/client";

export interface ExamAssignment {
  id: string;
  examId: string;
  code: string;
  className: string;
  title: string;
  teacherName?: string;
  schoolName?: string;
  subjectName?: string;
  durationMinutes?: number;
  openAt?: string | null;
  closeAt?: string | null;
  createdAt: string;
  createdBy?: string;
}

const STORAGE_KEY = "qc_exam_assignments_v1";

// Non-confusing characters for clean human-readable codes (no 0/O, 1/I, 5/S)
const CODE_CHARS = "2346789ABCDEFGHJKLMNPQRTUVWXYZ";

/**
 * Generate a random, easy-to-read code of specified length
 */
export function generateRandomCode(length = 6): string {
  let res = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * CODE_CHARS.length);
    res += CODE_CHARS[idx];
  }
  return res;
}

/**
 * Generate a class-specific code or exam code
 * e.g. "12A1-K8P2" or "A1K8P2" or "TIN12-7A3K9"
 */
export function generateAssignmentCode(className?: string, prefix?: string): string {
  const randomPart = generateRandomCode(5);
  if (className && className.trim()) {
    const cleanClass = className.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
    if (cleanClass) {
      return `${cleanClass}-${randomPart}`;
    }
  }
  if (prefix && prefix.trim()) {
    const cleanPrefix = prefix.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
    if (cleanPrefix) {
      return `${cleanPrefix}-${randomPart}`;
    }
  }
  return generateRandomCode(6);
}

/**
 * Generate a deterministic primary code from exam ID
 * Guaranteed to be repeatable for any exam that doesn't have an explicit custom code
 */
export function getDeterministicPrimaryCode(examId: string, subjectName?: string): string {
  if (!examId) return generateRandomCode(6);
  // Hash the UUID into numbers
  let hash = 0x55555555;
  for (let i = 0; i < examId.length; i++) {
    hash ^= examId.charCodeAt(i);
    hash = (hash << 5) - hash + examId.charCodeAt(i);
    hash &= hash;
  }
  const absHash = Math.abs(hash);
  let code = "";
  let temp = absHash;
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[temp % CODE_CHARS.length];
    temp = Math.floor(temp / CODE_CHARS.length);
  }

  // Prepend subject hint if available
  let prefix = "EX";
  if (subjectName) {
    const sub = subjectName.trim().toUpperCase();
    if (sub.includes("TOÁN") || sub.includes("TOAN")) prefix = "TOAN";
    else if (sub.includes("LÝ") || sub.includes("LY") || sub.includes("VẬT LÝ")) prefix = "LY";
    else if (sub.includes("HÓA") || sub.includes("HOA")) prefix = "HOA";
    else if (sub.includes("SINH")) prefix = "SINH";
    else if (sub.includes("TIN")) prefix = "TIN";
    else if (sub.includes("ANH") || sub.includes("TIẾNG ANH")) prefix = "ANH";
    else if (sub.includes("VĂN") || sub.includes("VAN")) prefix = "VAN";
    else if (sub.includes("SỬ") || sub.includes("SU")) prefix = "SU";
    else if (sub.includes("ĐỊA") || sub.includes("DIA")) prefix = "DIA";
    else if (sub.includes("GDCD") || sub.includes("KINH TẾ")) prefix = "GD";
  }

  return `${prefix}-${code}`;
}

/**
 * Get the public origin for student exam URLs
 */
export function getExamPublicOrigin(): string {
  const PUBLISHED_ORIGIN = "https://thuy-tracnghiem.lovable.app";
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isPreview =
    host.includes("id-preview--") ||
    host.endsWith(".lovable.dev") ||
    host.endsWith(".sandbox.lovable.dev") ||
    host === "localhost" ||
    host === "127.0.0.1";
  return isPreview ? PUBLISHED_ORIGIN : window.location.origin;
}

/**
 * Get the full student share URL for an exam and code
 */
export function getExamShareUrl(examId: string, code?: string): string {
  const origin = getExamPublicOrigin();
  if (code && code.trim()) {
    return `${origin}/take/${examId}?code=${encodeURIComponent(code.trim())}`;
  }
  return `${origin}/take/${examId}`;
}

/**
 * Get primary code of an exam
 */
export function getExamPrimaryCode(exam: any): string {
  if (!exam) return "";
  const teamCfg = exam.team_config || {};
  if (teamCfg.primary_code && typeof teamCfg.primary_code === "string") {
    return teamCfg.primary_code;
  }
  return getDeterministicPrimaryCode(exam.id, exam.subject_name);
}

/**
 * Get local assignments cache
 */
function getLocalAssignments(): ExamAssignment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save to local assignments cache
 */
function saveLocalAssignments(list: ExamAssignment[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("Failed to save local assignments:", e);
  }
}

/**
 * Retrieve all assignments for a specific exam
 */
export async function getAssignmentsForExam(examId: string, examObj?: any): Promise<ExamAssignment[]> {
  const results: ExamAssignment[] = [];
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();

  // 1. From passed or fetched exam object in Supabase
  let currentExam = examObj;
  if (!currentExam) {
    try {
      const { data } = await supabase.from("exams").select("*").eq("id", examId).maybeSingle();
      currentExam = data;
    } catch {}
  }

  if (currentExam) {
    const teamCfg = currentExam.team_config || {};
    if (Array.isArray(teamCfg.assignments)) {
      teamCfg.assignments.forEach((a: any) => {
        if (a && a.id && a.code && !seenIds.has(a.id)) {
          seenIds.add(a.id);
          seenCodes.add(a.code.toUpperCase());
          results.push({
            id: a.id,
            examId: a.examId || examId,
            code: a.code.toUpperCase(),
            className: a.className || "Chung",
            title: a.title || currentExam.title,
            teacherName: a.teacherName || currentExam.teacher_name,
            schoolName: a.schoolName || currentExam.school_name,
            subjectName: a.subjectName || currentExam.subject_name,
            durationMinutes: a.durationMinutes || currentExam.duration_minutes,
            openAt: a.openAt ?? currentExam.open_at,
            closeAt: a.closeAt ?? currentExam.close_at,
            createdAt: a.createdAt || new Date().toISOString(),
            createdBy: a.createdBy || currentExam.created_by,
          });
        }
      });
    }
  }

  // 2. From local storage
  const localList = getLocalAssignments().filter((a) => a.examId === examId);
  localList.forEach((a) => {
    if (!seenIds.has(a.id) && !seenCodes.has(a.code.toUpperCase())) {
      seenIds.add(a.id);
      seenCodes.add(a.code.toUpperCase());
      results.push(a);
    }
  });

  // Sort by createdAt descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

/**
 * Create a new assignment (lượt giao bài) for an exam
 */
export async function createAssignment(params: {
  exam: any;
  className?: string;
  customCode?: string;
}): Promise<ExamAssignment> {
  const { exam, className = "Chung" } = params;
  let code = (params.customCode || "").trim().toUpperCase();

  if (!code) {
    code = generateAssignmentCode(className, exam.subject_name || "EX");
  }

  const newAssignment: ExamAssignment = {
    id: `assign_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    examId: exam.id,
    code,
    className: className.trim() || "Chung",
    title: exam.title,
    teacherName: exam.teacher_name,
    schoolName: exam.school_name,
    subjectName: exam.subject_name,
    durationMinutes: exam.duration_minutes,
    openAt: exam.open_at,
    closeAt: exam.close_at,
    createdAt: new Date().toISOString(),
    createdBy: exam.created_by,
  };

  // 1. Update in local storage
  const currentLocal = getLocalAssignments();
  saveLocalAssignments([newAssignment, ...currentLocal]);

  // 2. Persist to Supabase in exams.team_config.assignments
  try {
    const { data: latestExam } = await supabase.from("exams").select("team_config").eq("id", exam.id).maybeSingle();
    const existingTeamCfg = (latestExam?.team_config as any) || exam.team_config || {};
    const existingAssignments = Array.isArray(existingTeamCfg.assignments) ? existingTeamCfg.assignments : [];

    const updatedAssignments = [newAssignment, ...existingAssignments.filter((a: any) => a.id !== newAssignment.id)];

    const updatedTeamConfig = {
      ...existingTeamCfg,
      assignments: updatedAssignments,
    };

    await supabase
      .from("exams")
      .update({ team_config: updatedTeamConfig as any } as any)
      .eq("id", exam.id);
  } catch (e) {
    console.error("Failed to persist assignment to Supabase:", e);
  }

  return newAssignment;
}

/**
 * Delete an assignment
 */
export async function deleteAssignment(examId: string, assignmentId: string): Promise<boolean> {
  try {
    // 1. Remove from local storage
    const currentLocal = getLocalAssignments().filter((a) => a.id !== assignmentId);
    saveLocalAssignments(currentLocal);

    // 2. Remove from Supabase
    const { data: latestExam } = await supabase.from("exams").select("team_config").eq("id", examId).maybeSingle();
    if (latestExam) {
      const existingTeamCfg = (latestExam.team_config as any) || {};
      const existingAssignments = Array.isArray(existingTeamCfg.assignments) ? existingTeamCfg.assignments : [];
      const updatedAssignments = existingAssignments.filter((a: any) => a.id !== assignmentId);

      await supabase
        .from("exams")
        .update({
          team_config: { ...existingTeamCfg, assignments: updatedAssignments } as any,
        } as any)
        .eq("id", examId);
    }
    return true;
  } catch (e) {
    console.error("Failed to delete assignment:", e);
    return false;
  }
}

/**
 * Look up an exam or assignment by Code
 * Supports:
 * - Specific assignment codes (e.g. "12A1-K8P2")
 * - Primary exam codes (e.g. "TIN12-7A3K9", "EX-8B4X2")
 * - Raw exam UUID
 * - Full take URLs (pasted into input)
 */
export async function findAssignmentOrExamByCode(inputRaw: string): Promise<{
  success: boolean;
  error?: string;
  exam?: any;
  assignment?: ExamAssignment;
}> {
  const raw = (inputRaw || "").trim();
  if (!raw) {
    return { success: false, error: "Vui lòng nhập mã bài thi" };
  }

  // If a full URL was pasted, extract the code or exam ID
  let code = raw.toUpperCase();
  if (raw.includes("/take/")) {
    const urlMatch = raw.match(/\/take\/([a-zA-Z0-9-]+)/);
    const codeMatch = raw.match(/[?&]code=([^&#]+)/);
    if (codeMatch) {
      code = decodeURIComponent(codeMatch[1]).toUpperCase();
    } else if (urlMatch) {
      const directId = urlMatch[1];
      try {
        const { data: ex } = await supabase.from("exams").select("*").eq("id", directId).maybeSingle();
        if (ex) {
          return { success: true, exam: ex };
        }
      } catch {}
    }
  }

  // 1. Check local assignments cache
  const localList = getLocalAssignments();
  const localFound = localList.find((a) => a.code.toUpperCase() === code);
  if (localFound) {
    try {
      const { data: ex } = await supabase.from("exams").select("*").eq("id", localFound.examId).maybeSingle();
      if (ex) {
        return { success: true, exam: ex, assignment: localFound };
      }
    } catch {}
  }

  // 2. Direct UUID lookup in Supabase
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    try {
      const { data: ex } = await supabase.from("exams").select("*").eq("id", raw).maybeSingle();
      if (ex) {
        return { success: true, exam: ex };
      }
    } catch {}
  }

  // 3. Query all exams in Supabase to find by assignment code or primary code
  try {
    const { data: exams, error } = await supabase
      .from("exams")
      .select("id, title, duration_minutes, teacher_name, school_name, subject_name, open_at, close_at, manual_closed, display_mode, team_config, created_at, created_by, questions")
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: "Lỗi kết nối cơ sở dữ liệu: " + error.message };
    }

    if (exams && exams.length > 0) {
      for (const ex of exams) {
        const teamCfg = (ex.team_config as any) || {};

        // A. Check stored assignments
        if (Array.isArray(teamCfg.assignments)) {
          const matched = teamCfg.assignments.find(
            (a: any) => a && typeof a.code === "string" && a.code.toUpperCase() === code
          );
          if (matched) {
            return {
              success: true,
              exam: ex,
              assignment: {
                id: matched.id,
                examId: ex.id,
                code: matched.code.toUpperCase(),
                className: matched.className || "Chung",
                title: matched.title || ex.title,
                teacherName: matched.teacherName || ex.teacher_name,
                schoolName: matched.schoolName || ex.school_name,
                subjectName: matched.subjectName || ex.subject_name,
                durationMinutes: matched.durationMinutes || ex.duration_minutes,
                openAt: matched.openAt ?? ex.open_at,
                closeAt: matched.closeAt ?? ex.close_at,
                createdAt: matched.createdAt || ex.created_at,
              },
            };
          }
        }

        // B. Check primary code
        const primaryCode = teamCfg.primary_code
          ? String(teamCfg.primary_code).toUpperCase()
          : getDeterministicPrimaryCode(ex.id, ex.subject_name).toUpperCase();

        if (primaryCode === code) {
          return { success: true, exam: ex };
        }

        // C. Check code without prefix (e.g. student typed just the 5-6 random digits)
        const parts = primaryCode.split("-");
        if (parts.length > 1 && parts[1] === code) {
          return { success: true, exam: ex };
        }
      }
    }
  } catch (err: any) {
    console.error("Error querying exam by code:", err);
  }

  return {
    success: false,
    error: `Không tìm thấy bài thi có mã "${raw}". Vui lòng kiểm tra lại mã do giáo viên cung cấp.`,
  };
}
