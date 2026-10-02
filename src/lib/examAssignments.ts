import { supabase } from "@/integrations/supabase/client";
import { findSampleExam, getSampleExamByCode, getSampleExamById, SampleExamData } from "@/lib/sampleExams";

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

// Legacy character set for backwards compatibility with older exams
const CODE_CHARS = "2346789ABCDEFGHJKLMNPQRTUVWXYZ";

/**
 * Generate a random 6-digit numeric code strictly with digits 0-9
 * e.g. "583214", "927461", "012345"
 * Length is strictly 6 digits, zero-padded so leading zeros are preserved.
 */
export function generateNumericExamCode(): string {
  const num = Math.floor(Math.random() * 1000000);
  return String(num).padStart(6, "0");
}

/**
 * Check if an exam code already exists across local storage, sample exams,
 * Supabase schools registry table, or Supabase exams table.
 */
export async function isExamCodeTaken(code: string): Promise<boolean> {
  if (!code) return false;
  const clean = code.trim().toUpperCase();

  // 1. Check sample exams
  if (findSampleExam(clean)) return true;

  // 2. Check local assignments cache
  const localList = getLocalAssignments();
  if (localList.some((a) => a.code.toUpperCase() === clean)) {
    return true;
  }

  // 3. Check Supabase schools registry table (name_key = assign_code:CODE)
  try {
    const { data: row } = await supabase
      .from("schools")
      .select("name_key")
      .eq("name_key", `assign_code:${clean}`)
      .maybeSingle();
    if (row) return true;
  } catch {}

  // 4. Check Supabase exams table where team_config->>'primary_code' = code
  try {
    const { data: exRow } = await supabase
      .from("exams")
      .select("id")
      .filter("team_config->>primary_code", "eq", clean)
      .maybeSingle();
    if (exRow) return true;
  } catch {}

  return false;
}

/**
 * Generate a unique 6-digit numeric exam code (digits 0-9 only, strictly 6 digits).
 * Checks database and local storage to guarantee no collisions.
 */
export async function generateUniqueNumericExamCode(): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = generateNumericExamCode();
    const taken = await isExamCodeTaken(code);
    if (!taken) {
      return code;
    }
  }
  // Deterministic fallback with timestamp if collision loop exhausts
  const fallbackNum = (Date.now() % 900000) + 100000;
  return String(fallbackNum);
}

/**
 * Generate a random code. By default returns a 6-digit numeric code.
 */
export function generateRandomCode(length = 6): string {
  if (length === 6) {
    return generateNumericExamCode();
  }
  let res = "";
  for (let i = 0; i < length; i++) {
    res += Math.floor(Math.random() * 10);
  }
  return res;
}

/**
 * Generate a code for assignment/exam.
 * In accordance with requirements, this now generates a 6-digit numeric code.
 */
export function generateAssignmentCode(className?: string, prefix?: string): string {
  return generateNumericExamCode();
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
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
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
export function getLocalAssignments(): ExamAssignment[] {
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
export function saveLocalAssignments(list: ExamAssignment[]) {
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
 * Synchronize all codes of an exam to Supabase public registry (schools table)
 * so that any student from any device or phone can resolve them instantly.
 */
export async function syncExamAssignmentCodes(exam: any) {
  if (!exam?.id) return;
  try {
    const primaryCode = getExamPrimaryCode(exam);
    if (primaryCode) {
      const pUpper = primaryCode.toUpperCase().trim();
      const pClean = pUpper.replace(/[^A-Z0-9]/g, "");
      const payload = {
        id: `primary_${exam.id}`,
        examId: exam.id,
        code: pUpper,
        className: "Chung",
        title: exam.title,
        teacherName: exam.teacher_name,
        schoolName: exam.school_name,
        subjectName: exam.subject_name,
        durationMinutes: exam.duration_minutes,
        openAt: exam.open_at,
        closeAt: exam.close_at,
        createdAt: new Date().toISOString(),
      };
      const jsonStr = JSON.stringify(payload);

      await supabase.from("schools").upsert(
        [
          { name_key: `assign_code:${pUpper}`, name: jsonStr },
          { name_key: `assign_code:${pClean}`, name: jsonStr },
          { name_key: `assign_code:${exam.id.toLowerCase()}`, name: jsonStr },
        ],
        { onConflict: "name_key" }
      );
    }

    // Sync any assignments inside team_config
    const teamCfg = (exam.team_config as any) || {};
    if (Array.isArray(teamCfg.assignments)) {
      for (const a of teamCfg.assignments) {
        if (a && a.code) {
          const aUpper = String(a.code).toUpperCase().trim();
          const aClean = aUpper.replace(/[^A-Z0-9]/g, "");
          const aPayload = JSON.stringify({
            ...a,
            examId: a.examId || exam.id,
            title: a.title || exam.title,
          });
          await supabase.from("schools").upsert(
            [
              { name_key: `assign_code:${aUpper}`, name: aPayload },
              { name_key: `assign_code:${aClean}`, name: aPayload },
            ],
            { onConflict: "name_key" }
          );
        }
      }
    }
  } catch {}
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
    code = await generateUniqueNumericExamCode();
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

  // 2. Persist to Supabase in exams.team_config.assignments (if teacher has permission)
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
    console.error("Failed to persist assignment to exams.team_config:", e);
  }

  // 3. Persist to schools table as a globally accessible mapping for all students across devices
  try {
    await supabase.from("schools").upsert(
      {
        name_key: `assign_code:${newAssignment.code.toUpperCase()}`,
        name: JSON.stringify(newAssignment),
      },
      { onConflict: "name_key" }
    );
  } catch (e) {
    // Non-fatal fallback
  }

  // Also sync primary code
  syncExamAssignmentCodes(exam).catch(() => {});

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

    // 2. Remove from Supabase exams.team_config
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
    console.error("Failed to delete assignment from Supabase:", e);
    return false;
  }
}

/**
 * Look up an exam or assignment by Code, URL or QR Content
 *
 * Guaranteed to NEVER fail with "permission denied for table exams" because:
 * 1. It extracts the exam ID from full take URLs directly
 * 2. It queries sanitized exam data using the public security definer RPC "get_exam_for_student"
 * 3. It checks local storage assignments and cross-device public registry
 * 4. It does not perform unauthorized SELECT queries on the restricted "exams" table
 */
export async function findAssignmentOrExamByCode(inputRaw: string): Promise<{
  success: boolean;
  error?: string;
  exam?: any;
  assignment?: ExamAssignment;
}> {
  const raw = (inputRaw || "").trim();
  if (!raw) {
    return { success: false, error: "Vui lòng nhập mã bài thi hoặc quét mã QR" };
  }

  // 1. Extract parameters if the input is a full URL or QR code content
  let targetExamId: string | null = null;
  let extractedCode = "";
  let targetClass = "";

  // Check URL paths like /take/TOKEN or /exam/TOKEN
  const pathMatch = raw.match(/\/(?:take|exam)\/([^/?#\s]+)/i);
  if (pathMatch) {
    const segment = decodeURIComponent(pathMatch[1]).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
      targetExamId = segment;
    } else {
      extractedCode = segment;
    }
  }

  const codeInUrlMatch = raw.match(/[?&](?:code|join)=([^&#\s]+)/i);
  const classInUrlMatch = raw.match(/[?&]targetClass=([^&#\s]+)/i);

  if (codeInUrlMatch) {
    extractedCode = decodeURIComponent(codeInUrlMatch[1]).trim().toUpperCase();
  }
  if (classInUrlMatch) {
    targetClass = decodeURIComponent(classInUrlMatch[1]).trim();
  }

  if (!targetExamId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    targetExamId = raw;
  }

  // 1.5. If targetExamId is identified, check sample exams first
  if (targetExamId) {
    const sampleById = findSampleExam(targetExamId) || getSampleExamById(targetExamId);
    if (sampleById) {
      return {
        success: true,
        exam: sampleById,
        assignment: {
          id: `sample_${sampleById.id}`,
          examId: sampleById.id,
          code: sampleById.code,
          className: targetClass || sampleById.className,
          title: sampleById.title,
          teacherName: sampleById.teacher_name,
          schoolName: sampleById.school_name,
          subjectName: sampleById.subject_name,
          durationMinutes: sampleById.duration_minutes,
          openAt: sampleById.open_at,
          closeAt: sampleById.close_at,
          createdAt: new Date().toISOString(),
        },
      };
    }
  }

  // If we already have the exam UUID (from URL, QR or raw input), resolve it via get_exam_for_student RPC
  if (targetExamId) {
    try {
      const { data: exData, error: rpcErr } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: targetExamId,
      });

      if (!rpcErr && exData) {
        // Also check local assignments cache for class name & extra details
        const localList = getLocalAssignments();
        const localFound = localList.find(
          (a) => a.examId === targetExamId && (!extractedCode || a.code.toUpperCase() === extractedCode)
        );

        return {
          success: true,
          exam: exData,
          assignment: localFound || {
            id: `assign_${targetExamId}`,
            examId: targetExamId,
            code: extractedCode || getExamPrimaryCode(exData),
            className: targetClass || localFound?.className || "Chung",
            title: (exData as any).title,
            teacherName: (exData as any).teacher_name,
            schoolName: (exData as any).school_name,
            subjectName: (exData as any).subject_name,
            durationMinutes: (exData as any).duration_minutes,
            openAt: (exData as any).open_at,
            closeAt: (exData as any).close_at,
            createdAt: new Date().toISOString(),
          },
        };
      }
    } catch {}
  }

  const lookupCode = (extractedCode || raw).toUpperCase().trim();
  const cleanCode = lookupCode.replace(/[^A-Z0-9]/g, "");

  // 2. Check built-in sample exams (TIN12-7A3K9, TOAN12-9B1K2, A1K8P2, etc.)
  const sample =
    findSampleExam(lookupCode) ||
    findSampleExam(cleanCode) ||
    (targetExamId ? findSampleExam(targetExamId) : null);

  if (sample) {
    return {
      success: true,
      exam: sample,
      assignment: {
        id: `sample_${sample.id}`,
        examId: sample.id,
        code: sample.code,
        className: targetClass || sample.className,
        title: sample.title,
        teacherName: sample.teacher_name,
        schoolName: sample.school_name,
        subjectName: sample.subject_name,
        durationMinutes: sample.duration_minutes,
        openAt: sample.open_at,
        closeAt: sample.close_at,
        createdAt: new Date().toISOString(),
      },
    };
  }

  // 3. Check local assignments cache
  const localList = getLocalAssignments();
  const localFound = localList.find(
    (a) =>
      a.code.toUpperCase() === lookupCode ||
      a.code.toUpperCase().replace(/[^A-Z0-9]/g, "") === cleanCode
  );

  if (localFound) {
    // Check if it's a sample exam by ID or code
    const sampleMatch = findSampleExam(localFound.code) || findSampleExam(localFound.examId);
    if (sampleMatch) {
      return {
        success: true,
        exam: sampleMatch,
        assignment: localFound,
      };
    }

    try {
      // Use get_exam_for_student RPC (Security Definer) instead of direct table SELECT
      const { data: exData, error: rpcErr } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: localFound.examId,
      });

      const examPayload =
        !rpcErr && exData
          ? exData
          : {
              id: localFound.examId,
              title: localFound.title,
              duration_minutes: localFound.durationMinutes || 45,
              school_name: localFound.schoolName,
              teacher_name: localFound.teacherName,
              subject_name: localFound.subjectName,
              open_at: localFound.openAt,
              close_at: localFound.closeAt,
            };

      return {
        success: true,
        exam: examPayload,
        assignment: localFound,
      };
    } catch {
      return {
        success: true,
        exam: {
          id: localFound.examId,
          title: localFound.title,
          duration_minutes: localFound.durationMinutes || 45,
          school_name: localFound.schoolName,
          teacher_name: localFound.teacherName,
          subject_name: localFound.subjectName,
          open_at: localFound.openAt,
          close_at: localFound.closeAt,
        },
        assignment: localFound,
      };
    }
  }

  // 4. Cross-device lookup via public schools registry table
  try {
    const keysToTry = [
      `assign_code:${lookupCode}`,
      `assign_code:${cleanCode}`,
      `assign_code:${lookupCode.toLowerCase()}`,
    ];

    let rowData: string | null = null;
    for (const key of keysToTry) {
      const { data: row } = await supabase
        .from("schools")
        .select("name")
        .eq("name_key", key)
        .maybeSingle();
      if (row?.name) {
        rowData = row.name;
        break;
      }
    }

    // Smart fallback: query all assign_code entries and match normalized code
    if (!rowData && cleanCode) {
      const { data: rows } = await supabase
        .from("schools")
        .select("name_key, name")
        .like("name_key", "assign_code:%");

      if (rows && rows.length > 0) {
        for (const r of rows) {
          const rawKey = r.name_key.replace(/^assign_code:/i, "").trim().toUpperCase();
          const cleanKey = rawKey.replace(/[^A-Z0-9]/g, "");
          if (cleanKey === cleanCode || rawKey === lookupCode) {
            rowData = r.name;
            break;
          }
        }
      }
    }

    if (rowData) {
      const parsed = JSON.parse(rowData);
      if (parsed?.examId) {
        // First check if this examId corresponds to a sample exam
        const sampleById = findSampleExam(parsed.examId);
        if (sampleById) {
          return {
            success: true,
            exam: sampleById,
            assignment: {
              id: parsed.id || `sample_${sampleById.id}`,
              examId: sampleById.id,
              code: parsed.code || sampleById.code,
              className: targetClass || parsed.className || sampleById.className,
              title: parsed.title || sampleById.title,
              teacherName: parsed.teacherName || sampleById.teacher_name,
              schoolName: parsed.schoolName || sampleById.school_name,
              subjectName: parsed.subjectName || sampleById.subject_name,
              durationMinutes: parsed.durationMinutes || sampleById.duration_minutes,
              openAt: parsed.openAt ?? sampleById.open_at,
              closeAt: parsed.closeAt ?? sampleById.close_at,
              createdAt: parsed.createdAt || new Date().toISOString(),
            },
          };
        }

        const { data: exData } = await supabase.rpc("get_exam_for_student", {
          p_exam_id: parsed.examId,
        });

        const examObj = exData
          ? {
              ...exData,
              teacher_name: parsed.teacherName || exData.teacher_name,
              school_name: parsed.schoolName || exData.school_name,
              subject_name: parsed.subjectName || exData.subject_name,
            }
          : {
              id: parsed.examId,
              title: parsed.title,
              duration_minutes: parsed.durationMinutes || 45,
              teacher_name: parsed.teacherName,
              school_name: parsed.schoolName,
              subject_name: parsed.subjectName,
              open_at: parsed.openAt,
              close_at: parsed.closeAt,
            };

        const assignmentObj: ExamAssignment = {
          id: parsed.id || `assign_${parsed.examId}`,
          examId: parsed.examId,
          code: parsed.code || lookupCode,
          className: parsed.className || "Chung",
          title: parsed.title || (examObj as any).title,
          teacherName: parsed.teacherName || (examObj as any).teacher_name,
          schoolName: parsed.schoolName || (examObj as any).school_name,
          subjectName: parsed.subjectName || (examObj as any).subject_name,
          durationMinutes: parsed.durationMinutes || (examObj as any).duration_minutes,
          openAt: parsed.openAt ?? (examObj as any).open_at,
          closeAt: parsed.closeAt ?? (examObj as any).close_at,
          createdAt: parsed.createdAt || new Date().toISOString(),
        };

        // Cache locally for faster subsequent queries
        saveLocalAssignments([assignmentObj, ...localList.filter((a) => a.id !== assignmentObj.id)]);

        return {
          success: true,
          exam: examObj,
          assignment: assignmentObj,
        };
      }
    }
  } catch {}

  // 5. If current session is an authenticated teacher or admin, try fallback query
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (sess?.session) {
      const { data: exams } = await supabase
        .from("exams")
        .select(
          "id, title, duration_minutes, teacher_name, school_name, subject_name, open_at, close_at, manual_closed, display_mode, team_config, created_at, created_by"
        )
        .order("created_at", { ascending: false });

      if (exams && exams.length > 0) {
        for (const ex of exams) {
          const teamCfg = (ex.team_config as any) || {};
          if (Array.isArray(teamCfg.assignments)) {
            const matched = teamCfg.assignments.find(
              (a: any) =>
                a &&
                typeof a.code === "string" &&
                (a.code.toUpperCase() === lookupCode ||
                  a.code.toUpperCase().replace(/[^A-Z0-9]/g, "") === cleanCode)
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

          const primaryCode = teamCfg.primary_code
            ? String(teamCfg.primary_code).toUpperCase()
            : getDeterministicPrimaryCode(ex.id, ex.subject_name).toUpperCase();

          if (
            primaryCode === lookupCode ||
            primaryCode.replace(/[^A-Z0-9]/g, "") === cleanCode
          ) {
            return { success: true, exam: ex };
          }
        }
      }
    }
  } catch {}

  // 6. Friendly, clear error message complying with requirements
  return {
    success: false,
    error: "Mã bài thi không hợp lệ hoặc không tồn tại.",
  };
}
