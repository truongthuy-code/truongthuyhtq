import { createClient } from "@supabase/supabase-js";
import { SAMPLE_EXAMS, findSampleExam, getSampleExamById, getSampleExamByCode } from "../src/lib/sampleExams";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://zhixpglctyfffpwamixv.supabase.co";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

const SYSTEM_BRIDGE = {
  email: "system_bridge_admin@system.local",
  password: "BridgeAdmin@Secret2026",
};

let serverSupabaseClient: any = null;

async function getServerSupabase() {
  if (!serverSupabaseClient) {
    serverSupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    await serverSupabaseClient.auth.signInWithPassword(SYSTEM_BRIDGE);
  }
  return serverSupabaseClient;
}

export default async function handler(req: any, res: any) {
  // CORS support
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { examId, questionId, answer, examCode, fallbackQuestion } = req.body || {};
    if (!examId || !questionId) {
      return res.status(400).json({ error: "Missing examId or questionId" });
    }

    const isUuid = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || "").trim());

    let examData: any = null;

    // 1. Try finding in sample exams first
    let sample =
      findSampleExam(examId) ||
      getSampleExamById(examId) ||
      getSampleExamByCode(examId) ||
      (examCode ? findSampleExam(examCode) || getSampleExamByCode(examCode) : null);

    if (!sample) {
      for (const s of SAMPLE_EXAMS) {
        const p1 = s.questions?.partI || [];
        const p2 = s.questions?.partII || [];
        const p3 = s.questions?.partIII || [];
        if (
          p1.some((q: any) => q.id === questionId) ||
          p2.some((q: any) => q.id === questionId) ||
          p3.some((q: any) => q.id === questionId)
        ) {
          sample = s;
          break;
        }
      }
    }

    if (sample) {
      examData = sample;
    } else {
      // 2. Fetch from Supabase exams table using system bridge
      try {
        const sb = await getServerSupabase();
        let targetUuid = isUuid(examId) ? examId : "";

        const codeToTry = !targetUuid ? examId : examCode;
        if (!targetUuid && codeToTry) {
          const { data: sch } = await sb
            .from("schools")
            .select("name")
            .eq("name_key", `assign_code:${codeToTry}`)
            .maybeSingle();
          if (sch?.name) {
            try {
              const parsed = JSON.parse(sch.name);
              if (parsed?.examId && isUuid(parsed.examId)) targetUuid = parsed.examId;
            } catch {}
          }
        }

        if (!targetUuid && codeToTry) {
          const { data: exRow } = await sb
            .from("exams")
            .select("id")
            .filter("team_config->>primary_code", "eq", codeToTry)
            .maybeSingle();
          if (exRow?.id && isUuid(exRow.id)) targetUuid = exRow.id;
        }

        if (targetUuid) {
          let { data } = await sb
            .from("exams")
            .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
            .eq("id", targetUuid)
            .single();

          if (!data) {
            serverSupabaseClient = null;
            const freshSb = await getServerSupabase();
            const retry = await freshSb
              .from("exams")
              .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
              .eq("id", targetUuid)
              .single();
            data = retry.data;
          }

          if (data) {
            examData = data;
          }
        }
      } catch (err: any) {
        console.warn("Error fetching exam from Supabase in serverless function:", err?.message);
      }
    }

    // 3. Fallback to client-provided fallbackQuestion
    if (!examData && fallbackQuestion && (fallbackQuestion.answer !== undefined || fallbackQuestion.items)) {
      const fbQ = fallbackQuestion;
      examData = {
        id: examId,
        questions: {
          partI: fbQ._part === 1 || fbQ.type === "mc" ? [fbQ] : [],
          partII: fbQ._part === 2 || fbQ.type === "tf" ? [fbQ] : [],
          partIII: fbQ._part === 3 || fbQ.type === "sa" ? [fbQ] : [],
        },
      };
    }

    if (!examData) {
      return res.status(404).json({ error: "Không tìm thấy đề thi" });
    }

    let qs = examData.questions || {};
    if (typeof qs === "string") {
      try {
        qs = JSON.parse(qs);
      } catch {
        qs = {};
      }
    }
    if (qs.questions && !qs.partI && !qs.partII && !qs.partIII) {
      qs = qs.questions;
      if (typeof qs === "string") {
        try {
          qs = JSON.parse(qs);
        } catch {
          qs = {};
        }
      }
    }

    let p1 = Array.isArray(qs.partI) ? qs.partI : Array.isArray(qs.part1) ? qs.part1 : Array.isArray(qs.PartI) ? qs.PartI : [];
    let p2 = Array.isArray(qs.partII) ? qs.partII : Array.isArray(qs.part2) ? qs.part2 : Array.isArray(qs.PartII) ? qs.PartII : [];
    let p3 = Array.isArray(qs.partIII) ? qs.partIII : Array.isArray(qs.part3) ? qs.part3 : Array.isArray(qs.PartIII) ? qs.PartIII : [];

    if (Array.isArray(qs)) {
      p1 = qs.filter((q: any) => q.type === "mc" || q._part === 1);
      p2 = qs.filter((q: any) => q.type === "tf" || q._part === 2);
      p3 = qs.filter((q: any) => q.type === "sa" || q._part === 3);
    }

    const matchQ = (q: any, i: number, prefix: string) => {
      if (!q) return false;
      const qid = String(q.id || "").toLowerCase();
      const targetId = String(questionId || "").toLowerCase();
      if (qid && qid === targetId) return true;
      if (targetId === `${prefix}_q_${i + 1}` || targetId === `q_${i + 1}`) return true;
      if (qid && qid.replace(new RegExp(`^${prefix}_`), "") === targetId.replace(new RegExp(`^${prefix}_`), "")) return true;
      return false;
    };

    // Part I: MC
    const q1 = p1.find((q: any, i: number) => matchQ(q, i, "p1"));
    if (q1) {
      const isCorrect = String(answer ?? "").trim().toUpperCase() === String(q1.answer ?? "").trim().toUpperCase();
      return res.json({
        type: "mc",
        correct: isCorrect,
        answer: q1.answer,
        explanation: q1.explanation || "",
      });
    }

    // Part II: TF
    const q2 = p2.find((q: any, i: number) => matchQ(q, i, "p2"));
    if (q2) {
      const items = Array.isArray(q2.items) ? q2.items : [];
      let okItems = 0;
      const chosen = answer || {};
      const evaluatedItems = items.map((it: any) => {
        let studentVal: boolean | null = null;
        if (Array.isArray(chosen)) {
          studentVal = chosen.includes(it.key);
        } else if (typeof chosen === "object" && chosen !== null) {
          if (typeof chosen[it.key] === "boolean") studentVal = chosen[it.key];
        }
        const correctVal = !!it.correct;
        const isItemOk = studentVal !== null && studentVal === correctVal;
        if (isItemOk) okItems++;
        return {
          key: it.key,
          correct: correctVal,
          student: studentVal,
        };
      });
      const isCorrect = items.length > 0 && okItems === items.length;
      return res.json({
        type: "tf",
        correct: isCorrect,
        okItems,
        totalItems: items.length,
        items: evaluatedItems,
        explanation: q2.explanation || "",
      });
    }

    // Part III: SA
    const q3 = p3.find((q: any, i: number) => matchQ(q, i, "p3"));
    if (q3) {
      const strip = (t: string) => (t || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
      const correctAns = strip(q3.answer || "");
      const given = strip(String(answer ?? ""));
      let isCorrect = given !== "" && given === correctAns;
      if (!isCorrect && given !== "" && correctAns !== "") {
        const numGiven = parseFloat(given.replace(",", "."));
        const numAns = parseFloat(correctAns.replace(",", "."));
        if (!isNaN(numGiven) && !isNaN(numAns) && Math.abs(numGiven - numAns) < 1e-6) {
          isCorrect = true;
        }
      }
      return res.json({
        type: "sa",
        correct: isCorrect,
        answer: q3.answer,
        explanation: q3.explanation || "",
      });
    }

    return res.status(404).json({ error: "Không tìm thấy câu hỏi trong đề" });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
}
