import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_PROJECT_REF = "zhixpglctyfffpwamixv";
const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT_REF}.supabase.co`;
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

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

function cleanEnvValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let val = raw.trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  if (!val || val === "undefined" || val === "null") return "";
  return val;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function isApiKeyGatewayError(errOrMsg: unknown): boolean {
  const status = typeof errOrMsg === "object" && errOrMsg !== null ? Number((errOrMsg as any).status) : 0;
  const msg =
    typeof errOrMsg === "string"
      ? errOrMsg
      : typeof errOrMsg === "object" && errOrMsg !== null
        ? String((errOrMsg as any).message || (errOrMsg as any).error_description || (errOrMsg as any).msg || "")
        : "";
  const lower = msg.toLowerCase();
  if (status === 401 && !lower.includes("invalid login credentials")) return true;
  return (
    lower.includes("invalid api key") ||
    lower.includes("no api key found") ||
    lower.includes("invalid jwt") ||
    lower.includes("apikey")
  );
}

export function resolveAuthRegisterEnv(env: Record<string, string | undefined> = process.env) {
  const warnings: string[] = [];
  const rawUrl =
    cleanEnvValue(env.VITE_SUPABASE_URL) ||
    cleanEnvValue(env.SUPABASE_URL) ||
    cleanEnvValue(env.NEXT_PUBLIC_SUPABASE_URL);

  const supabaseUrl =
    rawUrl && /^https?:\/\/[^/\s]+/i.test(rawUrl) ? rawUrl.replace(/\/+$/, "") : DEFAULT_SUPABASE_URL;

  const urlMatch = supabaseUrl.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  const projectRef = urlMatch?.[1] || "";

  const rawAnon =
    cleanEnvValue(env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    cleanEnvValue(env.VITE_SUPABASE_ANON_KEY) ||
    cleanEnvValue(env.SUPABASE_PUBLISHABLE_KEY) ||
    cleanEnvValue(env.SUPABASE_ANON_KEY);

  let anonKey = rawAnon;
  let anonInvalidReason: string | null = null;

  if (!anonKey) {
    anonInvalidReason = "missing";
  } else if (/\s/.test(anonKey)) {
    anonInvalidReason = "whitespace_in_anon_key";
  } else if (anonKey.startsWith("sb_secret_") || anonKey.startsWith("sbp_")) {
    anonInvalidReason = "secret_or_pat_in_anon_key";
  } else if (anonKey.startsWith("eyJ")) {
    const payload = decodeJwtPayload(anonKey);
    if (!payload) {
      anonInvalidReason = "malformed_anon_jwt";
    } else if (payload.role === "service_role") {
      anonInvalidReason = "service_role_in_anon_key";
    } else if (projectRef && payload.ref && payload.ref !== projectRef) {
      anonInvalidReason = `anon_key_project_mismatch(${payload.ref}!=${projectRef})`;
    }
  } else if (!anonKey.startsWith("sb_publishable_")) {
    anonInvalidReason = "unrecognized_anon_key_format";
  }

  if (anonInvalidReason) {
    if (anonInvalidReason !== "missing") {
      warnings.push(`Ignored invalid anon key (${anonInvalidReason}); using verified project anon key.`);
    }
    anonKey =
      projectRef === DEFAULT_SUPABASE_PROJECT_REF || !projectRef
        ? DEFAULT_SUPABASE_ANON_KEY
        : rawAnon || DEFAULT_SUPABASE_ANON_KEY;
  }

  const rawService =
    cleanEnvValue(env.SUPABASE_SERVICE_ROLE_KEY) || cleanEnvValue(env.SUPABASE_SERVICE_KEY);
  let serviceRoleKey = "";

  if (rawService) {
    if (/\s/.test(rawService)) {
      warnings.push("Ignored SUPABASE_SERVICE_ROLE_KEY containing whitespace/newlines.");
    } else if (rawService.startsWith("sb_publishable_") || rawService.startsWith("sbp_")) {
      warnings.push("Ignored SUPABASE_SERVICE_ROLE_KEY with publishable/PAT prefix.");
    } else if (rawService.startsWith("eyJ")) {
      const payload = decodeJwtPayload(rawService);
      if (!payload) {
        warnings.push("Ignored malformed JWT in SUPABASE_SERVICE_ROLE_KEY.");
      } else if (payload.role && payload.role !== "service_role") {
        warnings.push(`Ignored SUPABASE_SERVICE_ROLE_KEY with wrong JWT role (${payload.role}).`);
      } else if (projectRef && payload.ref && payload.ref !== projectRef) {
        warnings.push(`Ignored SUPABASE_SERVICE_ROLE_KEY for mismatched project (${payload.ref}!=${projectRef}).`);
      } else {
        serviceRoleKey = rawService;
      }
    } else if (rawService.startsWith("sb_secret_")) {
      serviceRoleKey = rawService;
    } else {
      warnings.push("Ignored unrecognized SUPABASE_SERVICE_ROLE_KEY format.");
    }
  }

  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    projectRef,
    warnings,
  };
}

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-CSRF-Token, X-Requested-With, Accept, Content-Type"
  );
}

async function sendSuperAdminNotification(
  supabaseUrl: string,
  anonKey: string,
  payload: {
    teacherName: string;
    teacherEmail: string;
    username: string;
    schoolName: string;
    subjectName: string;
    phone: string;
  }
) {
  const adminEmail = cleanEnvValue(process.env.ADMIN_NOTIFICATION_EMAIL) || SUPER_ADMIN_EMAIL;
  const resendKey = cleanEnvValue(process.env.RESEND_API_KEY);
  const mailFrom = cleanEnvValue(process.env.MAIL_FROM) || "Hệ thống Trắc nghiệm <onboarding@resend.dev>";

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

  // 2. Try Supabase Edge Function teacher-register-notify as backup (using valid anon key bearer)
  try {
    const fnResp = await fetch(`${supabaseUrl}/functions/v1/teacher-register-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        eventType: "TEACHER_REGISTERED",
        type: "TEACHER_REGISTERED",
        teacherName: payload.teacherName,
        teacherEmail: payload.teacherEmail,
        teacherUsername: payload.username,
        username: payload.username,
        teacherSchool: payload.schoolName,
        schoolName: payload.schoolName,
        teacherSubject: payload.subjectName,
        subjectName: payload.subjectName,
        teacherPhone: payload.phone,
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
    const { supabaseUrl, anonKey, serviceRoleKey, projectRef, warnings } = resolveAuthRegisterEnv(
      process.env
    );
    if (warnings.length > 0) {
      console.warn("[auth-register] env sanitization:", warnings.join(" | "));
    }

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
    let serviceRoleFailedWithKeyError = false;

    if (serviceRoleKey) {
      const adminSb = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Check existing email in profiles
      const { data: existingProfile, error: existingProfileErr } = await adminSb
        .from("profiles")
        .select("id, email, approval_status")
        .ilike("email", email)
        .maybeSingle();

      if (existingProfileErr && isApiKeyGatewayError(existingProfileErr)) {
        console.warn(
          "[auth-register] SUPABASE_SERVICE_ROLE_KEY failed API key check on profiles; falling back to anon_signup:",
          existingProfileErr.message
        );
        serviceRoleFailedWithKeyError = true;
      } else if (existingProfile) {
        return res.status(409).json({
          ok: false,
          error:
            existingProfile.approval_status === "PENDING"
              ? "Email này đã được đăng ký và đang chờ Quản trị viên phê duyệt."
              : "Email này đã tồn tại trên hệ thống. Vui lòng đăng nhập hoặc dùng email khác.",
        });
      }

      if (!serviceRoleFailedWithKeyError) {
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

        if (createErr && isApiKeyGatewayError(createErr)) {
          console.warn(
            "[auth-register] SUPABASE_SERVICE_ROLE_KEY failed Auth admin.createUser; falling back to anon_signup:",
            createErr.message
          );
          serviceRoleFailedWithKeyError = true;
        } else if (createErr || !userRes?.user?.id) {
          const msg = createErr?.message || "Không thể tạo tài khoản.";
          if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
            return res.status(409).json({
              ok: false,
              error: "Email này đã được đăng ký trên hệ thống.",
            });
          }
          return res.status(400).json({ ok: false, error: msg });
        } else {
          persistenceMode = "service_role";
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
              user_id: createdUserId,
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
            { onConflict: "user_id" }
          );
        }
      }
    }

    if (!serviceRoleKey || serviceRoleFailedWithKeyError) {
      // Ephemeral anon client signup (SQL handle_new_user trigger enforces role='teacher' & status='PENDING')
      persistenceMode = "anon_signup";
      let activeAnonKey = anonKey;
      let anonSb = createClient(supabaseUrl, activeAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      let { data: signUpData, error: signUpErr } = await anonSb.auth.signUp({
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

      if (
        signUpErr &&
        isApiKeyGatewayError(signUpErr) &&
        (projectRef === DEFAULT_SUPABASE_PROJECT_REF || !projectRef) &&
        activeAnonKey !== DEFAULT_SUPABASE_ANON_KEY
      ) {
        console.warn("[auth-register] Retrying anon signup with verified default project anon key.");
        activeAnonKey = DEFAULT_SUPABASE_ANON_KEY;
        anonSb = createClient(DEFAULT_SUPABASE_URL, activeAnonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const retryRes = await anonSb.auth.signUp({
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
        signUpData = retryRes.data;
        signUpErr = retryRes.error;
      }

      if (signUpErr) {
        const msg = signUpErr.message || "Không thể đăng ký tài khoản.";
        if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered")) {
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

    const notification = await sendSuperAdminNotification(supabaseUrl, anonKey, {
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
