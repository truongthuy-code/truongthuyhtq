import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { SAMPLE_EXAMS, findSampleExam, getSampleExamById, getSampleExamByCode } from "../src/lib/sampleExams";
import { decryptExamPassword } from "../src/lib/examSecurity";

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
    const { examId, password, examCode } = req.body || {};
    if (!examId) {
      return res.status(400).json({ success: false, valid: false, message: "Thiếu ID đề thi" });
    }

    const inputPassword = String(password || "").trim();

    const isUuid = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || "").trim());

    let examData: any = null;

    // 1. Kiểm tra đề mẫu trước
    const sample =
      findSampleExam(examId) ||
      getSampleExamById(examId) ||
      getSampleExamByCode(examId) ||
      (examCode ? findSampleExam(examCode) || getSampleExamByCode(examCode) : null);

    if (sample) {
      examData = sample;
    } else {
      // 2. Tra cứu đề thi từ Supabase bằng tài khoản hệ thống an toàn
      try {
        const sb = await getServerSupabase();
        let targetUuid = isUuid(examId) ? examId : "";

        if (!targetUuid && (examCode || examId)) {
          const codeToTry = examCode || examId;
          const { data: sch } = await sb
            .from("schools")
            .select("value")
            .eq("id", `exam_code_${String(codeToTry).toUpperCase()}`)
            .maybeSingle();

          if (sch?.value && isUuid(sch.value)) {
            targetUuid = sch.value;
          }
        }

        if (targetUuid) {
          const { data, error } = await sb
            .from("exams")
            .select("id,title,lock_mode")
            .eq("id", targetUuid)
            .maybeSingle();

          if (!error && data) {
            examData = data;
          }
        }
      } catch (err) {
        console.warn("Supabase fetch in verify-exam-password:", err);
      }
    }

    // Nếu không tìm thấy đề trên server
    if (!examData) {
      return res.status(404).json({ success: false, valid: false, message: "Không tìm thấy đề thi" });
    }

    const lockMode = examData.lock_mode || {};
    const requirePass = !!(lockMode.has_password || lockMode.require_password || examData.has_password);

    // Trường hợp 1: Đề thi không có mật khẩu -> luôn cho phép
    if (!requirePass) {
      return res.status(200).json({ success: true, valid: true });
    }

    // Trường hợp 2: Đề thi có mật khẩu -> kiểm tra khớp mật khẩu
    const inputHash = crypto.createHash("sha256").update(inputPassword).digest("hex");
    const storedHash = lockMode.password_hash;
    let isMatch = false;

    if (storedHash && inputHash === storedHash) {
      isMatch = true;
    } else if (lockMode.encrypted_password) {
      const decrypted = decryptExamPassword(lockMode.encrypted_password, examData.id || examId);
      if (decrypted && decrypted.trim() === inputPassword) {
        isMatch = true;
      }
    }

    if (isMatch) {
      return res.status(200).json({
        success: true,
        valid: true,
        message: "Xác thực mật khẩu thành công",
      });
    }

    return res.status(200).json({
      success: false,
      valid: false,
      message: "Mật khẩu không chính xác. Vui lòng thử lại",
    });
  } catch (error: any) {
    console.error("Error in verify-exam-password handler:", error);
    return res.status(500).json({
      success: false,
      valid: false,
      message: "Lỗi máy chủ khi kiểm tra mật khẩu",
    });
  }
}
