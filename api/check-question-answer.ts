import { createClient } from "@supabase/supabase-js";
import { findSampleExam, getSampleExamById, getSampleExamByCode } from "../src/lib/sampleExams";

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
    const { examId, questionId, answer } = req.body || {};
    if (!examId || !questionId) {
      return res.status(400).json({ error: "Missing examId or questionId" });
    }

    let examData: any = null;

    // 1. Try finding in sample exams first
    const sample = findSampleExam(examId) || getSampleExamById(examId) || getSampleExamByCode(examId);
    if (sample) {
      examData = sample;
    } else {
      // 2. Fetch from Supabase exams table using system bridge
      try {
        const sb = await getServerSupabase();
        let { data, error } = await sb
          .from("exams")
          .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
          .eq("id", examId)
          .single();

        if (error || !data) {
          serverSupabaseClient = null;
          const freshSb = await getServerSupabase();
          const retry = await freshSb
            .from("exams")
            .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
            .eq("id", examId)
            .single();
          data = retry.data;
        }

        if (data) {
          examData = data;
        }
      } catch (err: any) {
        console.warn("Error fetching exam from Supabase in serverless function:", err?.message);
      }
    }

    if (!examData) {
      return res.status(404).json({ error: "Không tìm thấy đề thi" });
    }

    if (!examData.instant_feedback) {
      return res.status(403).json({ error: "Tính năng phản hồi tức thì không được bật cho đề này" });
    }

    const qs = examData.questions || {};
    const p1 = Array.isArray(qs.partI) ? qs.partI : [];
    const p2 = Array.isArray(qs.partII) ? qs.partII : [];
    const p3 = Array.isArray(qs.partIII) ? qs.partIII : [];

    // Part I: MC
    const q1 = p1.find((q: any) => q.id === questionId);
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
    const q2 = p2.find((q: any) => q.id === questionId);
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
    const q3 = p3.find((q: any) => q.id === questionId);
    if (q3) {
      const cAns = String(q3.answer ?? "").trim().toLowerCase();
      const gAns = String(answer ?? "").trim().toLowerCase();
      let isCorrect = cAns === gAns;
      if (!isCorrect) {
        const nc = parseFloat(cAns.replace(",", "."));
        const ng = parseFloat(gAns.replace(",", "."));
        if (!isNaN(nc) && !isNaN(ng) && Math.abs(nc - ng) < 1e-6) {
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

    return res.status(404).json({ error: "Không tìm thấy câu hỏi" });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
}
