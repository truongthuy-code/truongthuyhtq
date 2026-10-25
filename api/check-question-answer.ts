import { createClient } from "@supabase/supabase-js";
import { SAMPLE_EXAMS, findSampleExam, getSampleExamById, getSampleExamByCode } from "../src/lib/sampleExams";

// Multi-environment Supabase configuration
// Supports Vercel production environment variables, local .env, and built-in fallback
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
      console.warn("System bridge login warning:", error.message);
    }
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
    if (!examId && !examCode) {
      return res.status(400).json({ error: "Missing examId or examCode" });
    }

    const isUuid = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || "").trim());

    let examData: any = null;

    // 1. Try finding in sample exams first
    let sample =
      (examId ? findSampleExam(examId) || getSampleExamById(examId) || getSampleExamByCode(examId) : null) ||
      (examCode ? findSampleExam(examCode) || getSampleExamById(examCode) || getSampleExamByCode(examCode) : null);

    if (!sample && questionId) {
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
      // 2. Fetch from Supabase exams table using system bridge or service role
      try {
        const sb = await getServerSupabase();
        let targetUuid = isUuid(examId) ? examId : (isUuid(examCode) ? examCode : "");

        const rawCodeCandidates = Array.from(
          new Set(
            [
              String(examId || "").trim(),
              String(examCode || "").trim(),
            ].filter(Boolean)
          )
        );

        // If not UUID, look up code in schools registry or team_config
        if (!targetUuid && rawCodeCandidates.length > 0) {
          const keysToTry: string[] = [];
          for (const c of rawCodeCandidates) {
            keysToTry.push(`assign_code:${c}`);
            keysToTry.push(`assign_code:${c.toUpperCase()}`);
            keysToTry.push(`assign_code:${c.toLowerCase()}`);
            const cleanNum = c.replace(/[^0-9]/g, "");
            if (cleanNum) {
              keysToTry.push(`assign_code:${cleanNum}`);
              keysToTry.push(`assign_code:${cleanNum.replace(/^0+/, "")}`);
            }
          }

          const uniqueKeys = Array.from(new Set(keysToTry));
          for (const k of uniqueKeys) {
            const { data: sch } = await sb
              .from("schools")
              .select("name")
              .eq("name_key", k)
              .maybeSingle();
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

        if (!targetUuid && rawCodeCandidates.length > 0) {
          for (const c of rawCodeCandidates) {
            const { data: exRow } = await sb
              .from("exams")
              .select("id")
              .filter("team_config->>primary_code", "eq", c.toUpperCase())
              .maybeSingle();
            if (exRow?.id && isUuid(exRow.id)) {
              targetUuid = exRow.id;
              break;
            }
          }
        }

        if (targetUuid) {
          let { data } = await sb
            .from("exams")
            .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
            .eq("id", targetUuid)
            .single();

          if (!data) {
            // Retry re-auth once in case session expired
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
        console.warn("Error fetching exam from Supabase in handler:", err?.message);
      }
    }

    // 3. Fallback to client-provided fallbackQuestion if examData is not in DB and question contains answer
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

    let p1: any[] = [];
    let p2: any[] = [];
    let p3: any[] = [];

    if (Array.isArray(qs)) {
      p1 = qs.filter((q: any) => q.type === "mc" || q._part === 1 || (Array.isArray(q.options) && q.options.length > 0));
      p2 = qs.filter((q: any) => q.type === "tf" || q._part === 2 || (Array.isArray(q.items) && q.items.length > 0));
      p3 = qs.filter((q: any) => q.type === "sa" || q._part === 3 || (!q.options && !q.items));
    } else {
      p1 = Array.isArray(qs.partI) ? qs.partI : Array.isArray(qs.part1) ? qs.part1 : Array.isArray(qs.PartI) ? qs.PartI : Array.isArray(qs.part_1) ? qs.part_1 : [];
      p2 = Array.isArray(qs.partII) ? qs.partII : Array.isArray(qs.part2) ? qs.part2 : Array.isArray(qs.PartII) ? qs.PartII : Array.isArray(qs.part_2) ? qs.part_2 : [];
      p3 = Array.isArray(qs.partIII) ? qs.partIII : Array.isArray(qs.part3) ? qs.part3 : Array.isArray(qs.PartIII) ? qs.PartIII : Array.isArray(qs.part_3) ? qs.part_3 : [];
    }

    // Helper text normalizer for content-based matching
    const normalizeContent = (s: any) =>
      String(s || "")
        .replace(/<[^>]*>/g, "")
        .replace(/⟦MATH:(.*?)⟧/gs, "$1")
        .replace(/[\$\\\{\}\(\)\[\]_\^\s\.,:;?!-]/g, "")
        .toLowerCase();

    const cleanId = (s: any) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .replace(/^(p[123]_|part[123]_|q_|q)/i, "");

    const targetId = String(questionId || "").trim().toLowerCase();
    const targetCleanId = cleanId(targetId);
    const targetTextClean = normalizeContent(fallbackQuestion?.text || "");

    // Strategy to match a question in a given part array
    const findInPart = (partArr: any[], prefix: string, partNum: number, globalOffset: number) => {
      // 1. Direct ID match
      let found = partArr.find((q: any) => {
        if (!q) return false;
        const qid = String(q.id || "").trim().toLowerCase();
        return qid && qid === targetId;
      });
      if (found) return found;

      // 2. Normalized ID match (e.g. q15 vs q_15 vs 15)
      if (targetCleanId) {
        found = partArr.find((q: any) => {
          if (!q) return false;
          const qid = cleanId(q.id);
          return qid && qid === targetCleanId;
        });
        if (found) return found;
      }

      // 3. Index within part / prefix match
      found = partArr.find((q: any, i: number) => {
        if (!q) return false;
        // e.g. p2_q_1, p2_1
        if (targetId === `${prefix}_q_${i + 1}` || targetId === `${prefix}_${i + 1}`) return true;
        // If targetId is q_1 / q1 and fallback specifies this part
        if (fallbackQuestion?._part === partNum && (targetId === `q_${i + 1}` || targetId === `q${i + 1}`)) return true;
        // Global question index (e.g. question 15 in whole exam)
        const globalIdx = globalOffset + i + 1;
        if (targetId === `q_${globalIdx}` || targetId === `q${globalIdx}` || targetCleanId === String(globalIdx)) return true;
        return false;
      });
      if (found) return found;

      // 4. Content / Stem Text match (bulletproof for shuffled exams or missing IDs)
      if (targetTextClean && targetTextClean.length >= 8) {
        found = partArr.find((q: any) => {
          if (!q) return false;
          const qTextClean = normalizeContent(q.text);
          if (!qTextClean) return false;
          if (qTextClean === targetTextClean) return true;
          if (qTextClean.length >= 16 && targetTextClean.length >= 16) {
            if (qTextClean.includes(targetTextClean.slice(0, 25)) || targetTextClean.includes(qTextClean.slice(0, 25))) {
              return true;
            }
          }
          return false;
        });
        if (found) return found;
      }

      return null;
    };

    // Calculate part offsets for global index matching
    const globalOffsetP1 = 0;
    const globalOffsetP2 = p1.length;
    const globalOffsetP3 = p1.length + p2.length;

    let matchedPart = 0;
    let matchedQ: any = null;

    // Check preferred part if fallbackQuestion indicates part
    if (fallbackQuestion?._part === 1 || fallbackQuestion?.type === "mc") {
      matchedQ = findInPart(p1, "p1", 1, globalOffsetP1);
      if (matchedQ) matchedPart = 1;
    } else if (fallbackQuestion?._part === 2 || fallbackQuestion?.type === "tf") {
      matchedQ = findInPart(p2, "p2", 2, globalOffsetP2);
      if (matchedQ) matchedPart = 2;
    } else if (fallbackQuestion?._part === 3 || fallbackQuestion?.type === "sa") {
      matchedQ = findInPart(p3, "p3", 3, globalOffsetP3);
      if (matchedQ) matchedPart = 3;
    }

    if (!matchedQ) {
      matchedQ = findInPart(p1, "p1", 1, globalOffsetP1);
      if (matchedQ) matchedPart = 1;
    }
    if (!matchedQ) {
      matchedQ = findInPart(p2, "p2", 2, globalOffsetP2);
      if (matchedQ) matchedPart = 2;
    }
    if (!matchedQ) {
      matchedQ = findInPart(p3, "p3", 3, globalOffsetP3);
      if (matchedQ) matchedPart = 3;
    }

    if (!matchedQ) {
      return res.status(404).json({ error: "Không tìm thấy câu hỏi trong đề" });
    }

    // Part I: MC
    if (matchedPart === 1) {
      const qAns = String(matchedQ.answer ?? "").trim().toUpperCase();
      const sAns = String(answer ?? "").trim().toUpperCase();
      const isCorrect = qAns !== "" && sAns === qAns;
      return res.json({
        type: "mc",
        correct: isCorrect,
        answer: qAns || matchedQ.answer,
        explanation: matchedQ.explanation || "",
      });
    }

    // Part II: TF
    if (matchedPart === 2) {
      const items = Array.isArray(matchedQ.items) ? matchedQ.items : [];
      let okItems = 0;
      const chosen = answer || {};
      const evaluatedItems = items.map((it: any) => {
        let studentVal: boolean | null = null;
        if (Array.isArray(chosen)) {
          studentVal = chosen.includes(it.key);
        } else if (typeof chosen === "object" && chosen !== null) {
          const matchedKey = Object.keys(chosen).find(
            (k) => String(k).trim().toLowerCase() === String(it.key).trim().toLowerCase()
          );
          if (matchedKey && typeof chosen[matchedKey] === "boolean") {
            studentVal = chosen[matchedKey];
          }
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
        explanation: matchedQ.explanation || "",
      });
    }

    // Part III: SA
    if (matchedPart === 3) {
      const stripMath = (t: string) =>
        String(t || "")
          .replace(/⟦MATH:(.*?)⟧/gs, "$1")
          .replace(/\\left|\\right|\\displaystyle/g, "")
          .replace(/<[^>]*>/g, "")
          .replace(/[$(){}\[\]]/g, "")
          .trim()
          .toLowerCase();

      const correctAns = stripMath(matchedQ.answer || "");
      const given = stripMath(String(answer ?? ""));
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
        answer: matchedQ.answer,
        explanation: matchedQ.explanation || "",
      });
    }

    return res.status(404).json({ error: "Không tìm thấy câu hỏi trong đề" });
  } catch (err: any) {
    console.error("check-question-answer handler error:", err);
    return res.status(500).json({ error: "Lỗi hệ thống khi kiểm tra đáp án" });
  }
}
