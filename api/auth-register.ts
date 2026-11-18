import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://zhixpglctyfffpwamixv.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPER_ADMIN_EMAIL = "bichthuylqd@gmail.com";

const RESERVED_IDENTIFIERS = new Set([
  SUPER_ADMIN_EMAIL,
  "admin@admin.com",
  "admin",
  "super_admin",
  "superadmin",
  "root",
  "system_bridge_admin@system.local",
]);

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-CSRF-Token, X-Requested-With, Accept, Content-Type"
  );
}

async function sendSuperAdminNotification(payload: {
  teacherName: string;
  teacherEmail: string;
  username: string;
  schoolName: string;
  subjectName: string;
  phone: string;
}) {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || SUPER_ADMIN_EMAIL;
  const resendKey = process.env.RESEND_API_KEY || "";
  const mailFrom = process.env.MAIL_FROM || "Hệ thống Trắc nghiệm <onboarding@resend.dev>";

  // 1. Try direct Resend API if configured on Vercel / Node server
  if (resendKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: mailFrom,
          to: [adminEmail],
          subject: `[Chờ phê duyệt] Giáo viên mới đăng ký: ${payload.teacherName}`,
          html: `
            <div style="font-family: 'Times New Roman', Times, serif; color: #111827; line-height: 1.6; max-width: 600px;">
              <h2 style="margin-bottom: 12px; color: #1e3a8a;">Thông báo đăng ký tài khoản Giáo viên mới</h2>
              <p>Hệ thống Trắc nghiệm Online vừa nhận được yêu cầu đăng ký tài khoản mới đang chờ Super Admin phê duyệt:</p>
              <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Họ và tên</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.teacherName}</td></tr>
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Email</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.teacherEmail}</td></tr>
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Tên đăng nhập</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.username}</td></tr>
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Trường học</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.schoolName || "Chưa cập nhật"}</td></tr>
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Môn giảng dạy</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.subjectName}</td></tr>
                <tr><td style="padding: 6px 8px; border: 1px solid #e5e7eb; font-weight: bold;">Số điện thoại</td><td style="padding: 6px 8px; border: 1px solid #e5e7eb;">${payload.phone || "Chưa cập nhật"}</td></tr>
              </table>
              <p>Vui lòng đăng nhập khu vực Quản trị (Super Admin) để <strong>Phê duyệt</strong> hoặc <strong>Từ chối</strong> tài khoản này.</p>
            </div>
          `,
        }),
      });
      if (resp.ok) {
        return { sent: true, channel: "resend" };
      }
    } catch (err) {
      console.warn("[auth-register] Resend notification failed:", err);
    }
  }

  // 2. Try Supabase Edge Function teacher-register-notify as backup
  try {
    const fnResp = await fetch(`${SUPABASE_URL}/functions/v1/teacher-register-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        ...(SUPABASE_SERVICE_ROLE_KEY ? { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      },
      body: JSON.stringify({
        type: "TEACHER_REGISTERED",
        teacherName: payload.teacherName,
        teacherEmail: payload.teacherEmail,
        username: payload.username,
        schoolName: payload.schoolName,
        subjectName: payload.subjectName,
        phone: payload.phone,
      }),
    });
    if (fnResp.ok) {
      const json = await fnResp.json().catch(() => ({}));
      return { sent: !!json?.sent, channel: "edge-function", reason: json?.reason };
    }
  } catch {}

  return { sent: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword ?? body.password ?? "");
    const fullName = String(body.fullName || "").trim();
    const username = String(body.username || email.split("@")[0] || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const schoolName = String(body.schoolName || "").trim() || "Trường THPT";
    const subjectName = String(body.subjectName || "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Vui lòng nhập địa chỉ email hợp lệ." });
    }
    if (!fullName) {
      return res.status(400).json({ ok: false, error: "Vui lòng nhập họ và tên giáo viên." });
    }
    if (!username || username.length < 3) {
      return res.status(400).json({ ok: false, error: "Tên đăng nhập phải có ít nhất 3 ký tự." });
    }
    if (!subjectName) {
      return res.status(400).json({ ok: false, error: "Vui lòng chọn môn học giảng dạy." });
    }
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: "Mật khẩu phải có tối thiểu 6 ký tự." });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: "Mật khẩu xác nhận không trùng khớp." });
    }

    // Security lock: block reserved admin emails/usernames and any client role injection
    if (RESERVED_IDENTIFIERS.has(email) || RESERVED_IDENTIFIERS.has(username)) {
      return res.status(403).json({
        ok: false,
        error: "Không được phép đăng ký bằng email hoặc tên đăng nhập dành riêng cho Quản trị viên.",
      });
    }
    if (body.role && !["teacher"].includes(String(body.role).toLowerCase())) {
      return res.status(403).json({
        ok: false,
        error: "Không được phép tự gán quyền Quản trị viên khi đăng ký.",
      });
    }

    let createdUserId: string | null = null;
    let persistenceMode: "service_role" | "anon_signup" = "anon_signup";

    if (SUPABASE_SERVICE_ROLE_KEY) {
      persistenceMode = "service_role";
      const adminSb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Check existing email in profiles
      const { data: existingProfile } = await adminSb
        .from("profiles")
        .select("id, email, approval_status")
        .ilike("email", email)
        .maybeSingle();

      if (existingProfile) {
        return res.status(409).json({
          ok: false,
          error:
            existingProfile.approval_status === "PENDING"
              ? "Email này đã được đăng ký và đang chờ Quản trị viên phê duyệt."
              : "Email này đã tồn tại trên hệ thống. Vui lòng đăng nhập hoặc dùng email khác.",
        });
      }

      const { data: userRes, error: createErr } = await adminSb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: "teacher" },
        user_metadata: {
          full_name: fullName,
          username,
          phone,
          school_name: schoolName,
          subject_name: subjectName,
        },
      });

      if (createErr || !userRes?.user?.id) {
        const msg = createErr?.message || "Không thể tạo tài khoản.";
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
          return res.status(409).json({
            ok: false,
            error: "Email này đã được đăng ký trên hệ thống.",
          });
        }
        return res.status(400).json({ ok: false, error: msg });
      }

      createdUserId = userRes.user.id;
      const nowIso = new Date().toISOString();

      await adminSb.from("profiles").upsert(
        {
          id: createdUserId,
          email,
          username,
          full_name: fullName,
          phone,
          school_name: schoolName,
          subject_name: subjectName,
          role: "teacher",
          status: "pending",
          approval_status: "PENDING",
          profile_completed: true,
          must_change_password: false,
          updated_at: nowIso,
        },
        { onConflict: "id" }
      );

      await adminSb.from("user_roles").upsert(
        { user_id: createdUserId, role: "teacher" },
        { onConflict: "user_id,role" }
      );

      await adminSb.from("teacher_registrations").upsert(
        {
          teacher_id: createdUserId,
          email,
          username,
          full_name: fullName,
          phone,
          school_name: schoolName,
          subject_name: subjectName,
          status: "PENDING",
          created_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "teacher_id" }
      );
    } else {
      // Ephemeral anon client signup (safe when SUPABASE_SERVICE_ROLE_KEY is absent in preview)
      const anonSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: signUpData, error: signUpErr } = await anonSb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            username,
            phone,
            school_name: schoolName,
            subject_name: subjectName,
          },
        },
      });

      if (signUpErr) {
        const msg = signUpErr.message || "Không thể đăng ký tài khoản.";
        if (msg.toLowerCase().includes("already")) {
          return res.status(409).json({
            ok: false,
            error: "Email này đã được đăng ký trước đó.",
          });
        }
        return res.status(400).json({ ok: false, error: msg });
      }

      createdUserId = signUpData?.user?.id || null;
      // Ensure NO session remains on anon client
      await anonSb.auth.signOut().catch(() => {});
    }

    const notification = await sendSuperAdminNotification({
      teacherName: fullName,
      teacherEmail: email,
      username,
      schoolName,
      subjectName,
      phone,
    });

    return res.status(201).json({
      ok: true,
      userId: createdUserId,
      status: "PENDING",
      approval_status: "PENDING",
      persistenceMode,
      notification,
      message:
        "Đăng ký tài khoản thành công! Tài khoản của bạn đang ở trạng thái Chờ phê duyệt và đã được gửi thông báo tới Quản trị viên.",
    });
  } catch (err: any) {
    console.error("[auth-register] unexpected error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Lỗi máy chủ khi xử lý đăng ký giáo viên.",
    });
  }
}
