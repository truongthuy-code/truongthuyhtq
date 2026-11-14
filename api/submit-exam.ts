import { createClient } from "@supabase/supabase-js";
import { findSampleExam, getSampleExamByCode, getSampleExamById } from "../src/lib/sampleExams";
import { DEFAULT_SCORING, gradeExam, isScale100Scoring, roundFinalScore } from "../src/lib/grading";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://zhixpglctyfffpwamixv.supabase.co";

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const SUPABASE_KEY =
  SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

const SYSTEM_BRIDGE = {
  email: "system_bridge_admin@system.local",
  password: "BridgeAdmin@Secret2026",
};

let serverSupabaseClient: any = null;

async function getServerSupabase() {
  if (SUPABASE_SERVICE_KEY) {
    if (!serverSupabaseClient) {
      serverSupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return serverSupabaseClient;
  }

  if (!serverSupabaseClient) {
    serverSupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { error } = await serverSupabaseClient.auth.signInWithPassword(SYSTEM_BRIDGE);
    if (error) {
      console.warn("[submit-exam] System bridge login warning:", error.message);
    }
  }
  return serverSupabaseClient;
}

const isUuid = (str: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || "").trim());

function parseQuestionsObject(rawQs: any) {
  let qs = rawQs || {};
  if (typeof qs === "string") {
    try {
      qs = JSON.parse(qs);
    } catch {
      qs = {};
    }
  }
  if (qs && typeof qs === "object" && "questions" in qs && !qs.partI && !qs.partII && !qs.partIII) {
    qs = qs.questions;
    if (typeof qs === "string") {
      try {
        qs = JSON.parse(qs);
      } catch {
        qs = {};
      }
    }
  }
  if (Array.isArray(qs)) {
    return {
      partI: qs.filter((q: any) => q && (q._part === 1 || q.type === "mc" || (Array.isArray(q.options) && q.options.length > 0))),
      partII: qs.filter((q: any) => q && (q._part === 2 || q.type === "tf" || (Array.isArray(q.items) && q.items.length > 0))),
      partIII: qs.filter((q: any) => q && (q._part === 3 || q.type === "sa" || (!q.options?.length && !q.items?.length && q.type !== "mc" && q.type !== "tf"))),
    };
  }
  return {
    partI: Array.isArray(qs.partI) ? qs.partI : Array.isArray(qs.part1) ? qs.part1 : Array.isArray(qs.PartI) ? qs.PartI : [],
    partII: Array.isArray(qs.partII) ? qs.partII : Array.isArray(qs.part2) ? qs.part2 : Array.isArray(qs.PartII) ? qs.PartII : [],
    partIII: Array.isArray(qs.partIII) ? qs.partIII : Array.isArray(qs.part3) ? qs.part3 : Array.isArray(qs.PartIII) ? qs.PartIII : [],
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, authorization"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    if (!body && typeof req.on === "function") {
      body = await new Promise((resolve) => {
        let raw = "";
        req.on("data", (c: any) => (raw += c));
        req.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({});
          }
        });
        req.on("error", () => resolve({}));
      });
    }

    const { action, examId, examCode } = body || {};
    if (!examId && !examCode) {
      return res.status(400).json({ error: "Missing examId or examCode" });
    }

    // Check sample exam first
    const sample =
      (examId ? findSampleExam(examId) || getSampleExamById(examId) || getSampleExamByCode(examId) : null) ||
      (examCode ? findSampleExam(examCode) || getSampleExamById(examCode) || getSampleExamByCode(examCode) : null);

    let targetUuid = isUuid(examId) ? String(examId).trim() : isUuid(examCode) ? String(examCode).trim() : "";

    if (!sample && !targetUuid) {
      const code = String(examCode || examId || "").trim();
      const lookupSb = createClient(SUPABASE_URL, SUPABASE_KEY);
      for (const k of [`assign_code:${code}`, `assign_code:${code.toUpperCase()}`]) {
        const { data: sch } = await lookupSb.from("schools").select("name").eq("name_key", k).maybeSingle();
        if (sch?.name) {
          try {
            const parsed = JSON.parse(sch.name);
            if (parsed?.examId && isUuid(parsed.examId)) {
              targetUuid = parsed.examId;
              break;
            }
          } catch {}
        }
      }
    }

    // Query exam row
    let examRow: any = sample || null;
    if (!examRow && targetUuid) {
      const selectCols =
        action === "get_scoring"
          ? "id, scoring, display_mode"
          : "id, questions, scoring, lock_mode, open_at, close_at, manual_closed";

      const authHeader = req.headers?.authorization || req.headers?.Authorization;
      if (authHeader) {
        try {
          const userSb = createClient(SUPABASE_URL, SUPABASE_KEY, {
            global: { headers: { Authorization: String(authHeader) } },
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data } = await userSb.from("exams").select(selectCols).eq("id", targetUuid).maybeSingle();
          if (data) examRow = data;
        } catch {}
      }

      if (!examRow) {
        const sb = await getServerSupabase();
        const { data } = await sb.from("exams").select(selectCols).eq("id", targetUuid).maybeSingle();
        if (data) examRow = data;
      }
    }

    // Action 1: lightweight scoring config lookup (safe - exposes no answers)
    if (action === "get_scoring") {
      return res.json({ scoring: examRow?.scoring || null });
    }

    if (!examRow) {
      return res.json({ fallback: true, reason: "exam_not_accessible" });
    }

    const {
      studentName,
      studentClass,
      answers = {},
      violations = [],
      violationCount = 0,
      startedAt = null,
      durationSeconds = null,
    } = body || {};

    if (!String(studentName || "").trim() || !String(studentClass || "").trim()) {
      return res.status(400).json({ error: "student_name and student_class required" });
    }

    if (examRow.open_at && new Date(examRow.open_at).getTime() > Date.now()) {
      return res.status(400).json({ error: "Đề thi chưa được mở" });
    }

    const parsedQuestions = parseQuestionsObject(examRow.questions);
    const activeScoring = examRow.scoring || DEFAULT_SCORING;
    const gradeResult = gradeExam(parsedQuestions as any, answers, activeScoring);

    let finalScore = gradeResult.score;
    const lock = examRow.lock_mode || {};
    if (lock.enabled && lock.penalty && Number(violationCount) > 0) {
      const penalty = (Number(lock.penaltyPerViolation) || 0) * Number(violationCount);
      finalScore = roundFinalScore(Math.max(0, finalScore - penalty));
    }

    // For sample exams or if no service key, return computed grade cleanly
    if (sample || !SUPABASE_SERVICE_KEY) {
      // If no SUPABASE_SERVICE_KEY, client uses Supabase RPC submit_student_exam
      // unless Scale-100 RPC hasn't been migrated yet — let's try bridge insert or return fallback
      if (sample) {
        return res.json({
          id: `sample_${Date.now()}`,
          submission: {
            student_name: String(studentName).trim(),
            student_class: String(studentClass).trim(),
            score: finalScore,
            max_score: gradeResult.maxScore,
            correct_count: gradeResult.correct,
            wrong_count: gradeResult.wrong,
            scoring_snapshot: activeScoring,
            part2_summary: gradeResult.partIISummary,
          },
          breakdown: gradeResult.breakdown,
          partIISummary: gradeResult.partIISummary,
          scoringSnapshot: activeScoring,
          isScale100: isScale100Scoring(activeScoring),
        });
      }
      return res.json({
        fallback: true,
        reason: "no_service_role_key",
        computed: {
          score: finalScore,
          max_score: gradeResult.maxScore,
          correct_count: gradeResult.correct,
          wrong_count: gradeResult.wrong,
          breakdown: gradeResult.breakdown,
          partIISummary: gradeResult.partIISummary,
          scoringSnapshot: activeScoring,
        },
      });
    }

    const sb = await getServerSupabase();
    const baseRow: Record<string, any> = {
      exam_id: targetUuid,
      student_name: String(studentName).trim(),
      student_class: String(studentClass).trim(),
      answers,
      score: finalScore,
      max_score: gradeResult.maxScore,
      correct_count: gradeResult.correct,
      wrong_count: gradeResult.wrong,
      violation_count: Number(violationCount) || 0,
      violations: Array.isArray(violations) ? violations : [],
      started_at: startedAt || null,
      duration_seconds: typeof durationSeconds === "number" ? durationSeconds : null,
      scoring_snapshot: activeScoring,
      part2_summary: gradeResult.partIISummary,
    };

    let { data: inserted, error: insErr } = await sb
      .from("submissions")
      .insert(baseRow)
      .select("*")
      .single();

    if (
      insErr &&
      (insErr.code === "42703" ||
        insErr.message?.includes("scoring_snapshot") ||
        insErr.message?.includes("part2_summary"))
    ) {
      delete baseRow.scoring_snapshot;
      delete baseRow.part2_summary;
      const retry = await sb.from("submissions").insert(baseRow).select("*").single();
      inserted = retry.data;
      insErr = retry.error;
    }

    if (insErr || !inserted) {
      console.warn("[submit-exam] insert fallback:", insErr?.message);
      return res.json({
        fallback: true,
        reason: insErr?.message || "insert_failed",
        computed: {
          score: finalScore,
          max_score: gradeResult.maxScore,
          correct_count: gradeResult.correct,
          wrong_count: gradeResult.wrong,
          breakdown: gradeResult.breakdown,
          partIISummary: gradeResult.partIISummary,
          scoringSnapshot: activeScoring,
        },
      });
    }

    return res.json({
      id: inserted.id,
      submission: {
        ...inserted,
        scoring_snapshot: inserted.scoring_snapshot || activeScoring,
        part2_summary: inserted.part2_summary || gradeResult.partIISummary,
      },
      breakdown: gradeResult.breakdown,
      partIISummary: gradeResult.partIISummary,
      scoringSnapshot: activeScoring,
      isScale100: isScale100Scoring(activeScoring),
    });
  } catch (err: any) {
    console.error("[submit-exam] error:", err);
    return res.json({ fallback: true, reason: err?.message || "unexpected_error" });
  }
}
