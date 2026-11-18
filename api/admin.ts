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

function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-CSRF-Token, X-Requested-With, Accept, Content-Type"
  );
}

function getBearerToken(req: any): string | null {
  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof auth !== "string") return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function notifyTeacherDecision(payload: {
  type: "TEACHER_APPROVED" | "TEACHER_REJECTED";
  teacherEmail?: string | null;
  teacherName?: string | null;
  reason?: string | null;
}) {
  if (!payload.teacherEmail) return { sent: false };
  const resendKey = process.env.RESEND_API_KEY || "";
  const mailFrom = process.env.MAIL_FROM || "Hệ thống Trắc nghiệm <onboarding@resend.dev>";

  if (resendKey) {
    try {
      const isApproved = payload.type === "TEACHER_APPROVED";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: mailFrom,
          to: [payload.teacherEmail],
          subject: isApproved
            ? "[Đã phê duyệt] Tài khoản Giáo viên đã được kích hoạt"
            : "[Thông báo] Yêu cầu đăng ký tài khoản Giáo viên chưa được phê duyệt",
          html: isApproved
            ? `<div style="font-family: 'Times New Roman', serif;"><h3>Xin chào ${payload.teacherName || "Thầy/Cô"},</h3><p>Tài khoản giáo viên của bạn trên Hệ thống Tạo đề Trắc nghiệm Online đã được <strong>Quản trị viên phê duyệt</strong>. Bạn có thể đăng nhập và sử dụng đầy đủ các tính năng ngay bây giờ.</p></div>`
            : `<div style="font-family: 'Times New Roman', serif;"><h3>Xin chào ${payload.teacherName || "Thầy/Cô"},</h3><p>Yêu cầu đăng ký tài khoản giáo viên của bạn hiện chưa được phê duyệt.</p><p><strong>Lý do:</strong> ${payload.reason || "Không đáp ứng điều kiện xét duyệt"}</p></div>`,
        }),
      });
      if (resp.ok) return { sent: true };
    } catch {}
  }

  try {
    await fetch(`${SUPABASE_URL}/functions/v1/teacher-register-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        ...(SUPABASE_SERVICE_ROLE_KEY ? { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {}
  return { sent: false };
}

async function writeAuditLog(
  sb: any,
  actor: { id: string; email: string },
  entry: {
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    summary?: string | null;
    beforeData?: any;
    afterData?: any;
    metadata?: any;
  }
) {
  try {
    await sb.from("admin_activity_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId || null,
      target_label: entry.targetLabel || null,
      summary: entry.summary || null,
      before_data: entry.beforeData ?? null,
      after_data: entry.afterData ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.warn("[admin-api] writeAuditLog warning:", err);
  }
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Chưa xác thực phiên đăng nhập Quản trị viên." });
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) {
      return res.status(401).json({ ok: false, error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
    }

    const serviceClient = SUPABASE_SERVICE_ROLE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;

    const db = serviceClient || callerClient;

    // Server-side verification of SUPER_ADMIN (never trust client-supplied role)
    const callerEmail = (caller.email || "").trim().toLowerCase();
    let isAuthorizedSuperAdmin = callerEmail === SUPER_ADMIN_EMAIL || caller.app_metadata?.role === "super_admin";

    if (!isAuthorizedSuperAdmin) {
      try {
        const { data: rpcCheck } = await callerClient.rpc("is_super_admin", { _user_id: caller.id });
        if (rpcCheck === true) isAuthorizedSuperAdmin = true;
      } catch {}
    }

    if (!isAuthorizedSuperAdmin) {
      return res.status(403).json({
        ok: false,
        error: "Truy cập bị từ chối: Chỉ Super Admin mới có quyền thực hiện thao tác này.",
      });
    }

    const actor = { id: caller.id, email: callerEmail || SUPER_ADMIN_EMAIL };
    const body = req.body || {};
    const action = String(body.action || req.query?.action || "overview");

    switch (action) {
      case "overview": {
        const [profilesRes, regsRes, examsRes, foldersRes, subsRes] = await Promise.all([
          db.from("profiles").select("id, email, role, status, approval_status, is_deleted"),
          db.from("teacher_registrations").select("id, status"),
          db.from("exams").select("id, is_deleted, manual_closed"),
          db.from("exam_folders").select("id, is_deleted"),
          db.from("submissions").select("id"),
        ]);

        const profiles = (profilesRes.data || []).filter(
          (p: any) => !p.is_deleted && (p.email || "").toLowerCase() !== SUPER_ADMIN_EMAIL && p.role !== "super_admin"
        );
        const regs = regsRes.data || [];
        const exams = (examsRes.data || []).filter((e: any) => !e.is_deleted);
        const folders = (foldersRes.data || []).filter((f: any) => !f.is_deleted);
        const submissions = subsRes.data || [];

        const pendingIds = new Set(
          profiles
            .filter((p: any) => p.approval_status === "PENDING" || p.status === "pending")
            .map((p: any) => p.id)
        );
        regs.filter((r: any) => r.status === "PENDING").forEach((r: any) => pendingIds.add(r.id));

        const approvedCount = profiles.filter(
          (p: any) => (p.approval_status === "APPROVED" || p.status === "active") && p.status !== "locked"
        ).length;
        const lockedCount = profiles.filter(
          (p: any) => p.approval_status === "LOCKED" || p.status === "locked"
        ).length;
        const rejectedCount = profiles.filter(
          (p: any) => p.approval_status === "REJECTED" || p.status === "rejected"
        ).length;

        return res.status(200).json({
          ok: true,
          metrics: {
            totalTeachers: profiles.length,
            pendingCount: pendingIds.size,
            approvedCount,
            lockedCount,
            rejectedCount,
            totalExams: exams.length,
            totalFolders: folders.length,
            totalSubmissions: submissions.length,
          },
        });
      }

      case "list_registrations": {
        const [regsRes, profRes] = await Promise.all([
          db.from("teacher_registrations").select("*").order("created_at", { ascending: false }),
          db.from("profiles").select("*").order("created_at", { ascending: false }),
        ]);

        const regMap = new Map<string, any>();
        for (const r of regsRes.data || []) {
          regMap.set(r.teacher_id || r.id, r);
        }

        for (const p of profRes.data || []) {
          if ((p.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || p.role === "super_admin") continue;
          if (!regMap.has(p.id)) {
            regMap.set(p.id, {
              id: p.id,
              teacher_id: p.id,
              email: p.email,
              username: p.username || (p.email ? p.email.split("@")[0] : ""),
              full_name: p.full_name || "Giáo viên",
              phone: p.phone || "",
              school_name: p.school_name || "",
              subject_name: p.subject_name || "",
              status: p.approval_status || (p.status === "pending" ? "PENDING" : p.status === "rejected" ? "REJECTED" : "APPROVED"),
              rejection_reason: p.rejection_reason || null,
              reviewed_at: p.approved_at || p.rejected_at || null,
              created_at: p.created_at,
            });
          }
        }

        const list = Array.from(regMap.values()).sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        return res.status(200).json({ ok: true, registrations: list });
      }

      case "approve_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_approve_teacher", {
          p_teacher_id: teacherId,
        });

        let targetProfile: any = null;
        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể phê duyệt." });
          }
          const { data: before } = await serviceClient.from("profiles").select("*").eq("id", teacherId).maybeSingle();
          targetProfile = before;
          const nowIso = new Date().toISOString();
          await serviceClient
            .from("profiles")
            .update({
              status: "active",
              approval_status: "APPROVED",
              approved_at: nowIso,
              approved_by: actor.id,
              rejection_reason: null,
              is_deleted: false,
              updated_at: nowIso,
            })
            .eq("id", teacherId);
          await serviceClient
            .from("teacher_registrations")
            .update({
              status: "APPROVED",
              reviewed_by: actor.id,
              reviewed_at: nowIso,
              rejection_reason: null,
              updated_at: nowIso,
            })
            .eq("teacher_id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "APPROVE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: before?.full_name || before?.email,
            summary: `Phê duyệt tài khoản giáo viên ${before?.email || teacherId}`,
            beforeData: before,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, {
            ban_duration: "none",
            email_confirm: true,
          }).catch(() => {});
          if (!targetProfile) {
            const { data: prof } = await serviceClient.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
            targetProfile = prof;
          }
        } else {
          const { data: prof } = await db.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
          targetProfile = prof;
        }

        await notifyTeacherDecision({
          type: "TEACHER_APPROVED",
          teacherEmail: targetProfile?.email || body.email,
          teacherName: targetProfile?.full_name || body.fullName,
        });

        return res.status(200).json({ ok: true });
      }

      case "reject_teacher": {
        const teacherId = String(body.teacherId || "");
        const reason = String(body.reason || "").trim() || "Không đáp ứng điều kiện xét duyệt";
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_reject_teacher", {
          p_teacher_id: teacherId,
          p_reason: reason,
        });

        let targetProfile: any = null;
        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể từ chối." });
          }
          const { data: before } = await serviceClient.from("profiles").select("*").eq("id", teacherId).maybeSingle();
          targetProfile = before;
          if ((before?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL) {
            return res.status(403).json({ ok: false, error: "Không thể từ chối Super Admin." });
          }
          const nowIso = new Date().toISOString();
          await serviceClient
            .from("profiles")
            .update({
              status: "rejected",
              approval_status: "REJECTED",
              rejected_at: nowIso,
              rejected_by: actor.id,
              rejection_reason: reason,
              updated_at: nowIso,
            })
            .eq("id", teacherId);
          await serviceClient
            .from("teacher_registrations")
            .update({
              status: "REJECTED",
              rejection_reason: reason,
              reviewed_by: actor.id,
              reviewed_at: nowIso,
              updated_at: nowIso,
            })
            .eq("teacher_id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "REJECT_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: before?.full_name || before?.email,
            summary: `Từ chối đăng ký giáo viên: ${reason}`,
            beforeData: before,
          });
        } else {
          const { data: prof } = await db.from("profiles").select("email, full_name").eq("id", teacherId).maybeSingle();
          targetProfile = prof;
        }

        await notifyTeacherDecision({
          type: "TEACHER_REJECTED",
          teacherEmail: targetProfile?.email || body.email,
          teacherName: targetProfile?.full_name || body.fullName,
          reason,
        });

        return res.status(200).json({ ok: true });
      }

      case "list_teachers": {
        const includeDeleted = !!body.includeDeleted;
        const [profRes, examsRes, foldersRes] = await Promise.all([
          db.from("profiles").select("*").order("created_at", { ascending: false }),
          db.from("exams").select("id, created_by, is_deleted"),
          db.from("exam_folders").select("id, teacher_id, is_deleted"),
        ]);

        const examCounts = new Map<string, number>();
        for (const e of examsRes.data || []) {
          if (e.is_deleted || !e.created_by) continue;
          examCounts.set(e.created_by, (examCounts.get(e.created_by) || 0) + 1);
        }
        const folderCounts = new Map<string, number>();
        for (const f of foldersRes.data || []) {
          if (f.is_deleted || !f.teacher_id) continue;
          folderCounts.set(f.teacher_id, (folderCounts.get(f.teacher_id) || 0) + 1);
        }

        const teachers = (profRes.data || [])
          .filter((p: any) => {
            if ((p.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || p.role === "super_admin") return false;
            if (!includeDeleted && p.is_deleted) return false;
            return true;
          })
          .map((p: any) => ({
            ...p,
            exam_count: examCounts.get(p.id) || 0,
            folder_count: folderCounts.get(p.id) || 0,
          }));

        return res.status(200).json({ ok: true, teachers });
      }

      case "update_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_update_teacher", {
          p_teacher_id: teacherId,
          p_full_name: body.fullName ?? null,
          p_username: body.username ?? null,
          p_phone: body.phone ?? null,
          p_school_name: body.schoolName ?? null,
          p_subject_name: body.subjectName ?? null,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể cập nhật." });
          }
          const { data: before } = await serviceClient.from("profiles").select("*").eq("id", teacherId).maybeSingle();
          const nowIso = new Date().toISOString();
          await serviceClient
            .from("profiles")
            .update({
              full_name: body.fullName ?? before?.full_name,
              username: body.username ?? before?.username,
              phone: body.phone ?? before?.phone,
              school_name: body.schoolName ?? before?.school_name,
              subject_name: body.subjectName ?? before?.subject_name,
              updated_at: nowIso,
            })
            .eq("id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "UPDATE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: body.fullName || before?.email,
            summary: `Cập nhật thông tin giáo viên ${before?.email || teacherId}`,
            beforeData: before,
          });
        }

        return res.status(200).json({ ok: true });
      }

      case "lock_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: target } = await db.from("profiles").select("email, role").eq("id", teacherId).maybeSingle();
        if ((target?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || target?.role === "super_admin") {
          return res.status(403).json({ ok: false, error: "Không thể khóa tài khoản Super Admin!" });
        }

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_lock_teacher", {
          p_teacher_id: teacherId,
          p_reason: body.reason || null,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể khóa." });
          }
          const nowIso = new Date().toISOString();
          await serviceClient
            .from("profiles")
            .update({
              status: "locked",
              approval_status: "LOCKED",
              locked_at: nowIso,
              locked_by: actor.id,
              updated_at: nowIso,
            })
            .eq("id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "LOCK_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: target?.email,
            summary: `Khóa tài khoản giáo viên ${target?.email || teacherId}`,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
          await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
        }

        return res.status(200).json({ ok: true });
      }

      case "unlock_teacher": {
        const teacherId = String(body.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_unlock_teacher", {
          p_teacher_id: teacherId,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể mở khóa." });
          }
          const nowIso = new Date().toISOString();
          await serviceClient
            .from("profiles")
            .update({
              status: "active",
              approval_status: "APPROVED",
              locked_at: null,
              locked_by: null,
              updated_at: nowIso,
            })
            .eq("id", teacherId);
          await writeAuditLog(serviceClient, actor, {
            action: "UNLOCK_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            summary: `Mở khóa tài khoản giáo viên ${teacherId}`,
          });
        }

        if (serviceClient) {
          await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "none" }).catch(() => {});
        }

        return res.status(200).json({ ok: true });
      }

      case "delete_teacher": {
        const teacherId = String(body.teacherId || "");
        const preserveData = body.preserveData !== false;
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const { data: target } = await db.from("profiles").select("email, role").eq("id", teacherId).maybeSingle();
        if ((target?.email || "").toLowerCase() === SUPER_ADMIN_EMAIL || target?.role === "super_admin") {
          return res.status(403).json({ ok: false, error: "Không thể xóa tài khoản Super Admin!" });
        }

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_delete_teacher", {
          p_teacher_id: teacherId,
          p_preserve_data: preserveData,
        });

        if (rpcErr || !rpcRes?.ok) {
          if (!serviceClient) {
            return res.status(400).json({ ok: false, error: rpcErr?.message || rpcRes?.error || "Không thể xóa tài khoản." });
          }
          const nowIso = new Date().toISOString();
          if (preserveData) {
            await serviceClient
              .from("profiles")
              .update({
                is_deleted: true,
                deleted_at: nowIso,
                status: "locked",
                approval_status: "LOCKED",
                updated_at: nowIso,
              })
              .eq("id", teacherId);
            await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
            await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
          } else {
            const { data: teacherExams } = await serviceClient.from("exams").select("id").eq("created_by", teacherId);
            const examIds = (teacherExams || []).map((e: any) => e.id);
            if (examIds.length > 0) {
              await serviceClient.from("submissions").delete().in("exam_id", examIds);
              await serviceClient.from("exams").delete().in("id", examIds);
            }
            await serviceClient.from("exam_folders").delete().eq("teacher_id", teacherId);
            await serviceClient.from("teacher_registrations").delete().eq("teacher_id", teacherId);
            await serviceClient.from("user_roles").delete().eq("user_id", teacherId);
            await serviceClient.from("profiles").delete().eq("id", teacherId);
            await serviceClient.auth.admin.deleteUser(teacherId).catch(() => {});
          }
          await writeAuditLog(serviceClient, actor, {
            action: preserveData ? "ARCHIVE_TEACHER" : "DELETE_TEACHER",
            targetType: "teacher",
            targetId: teacherId,
            targetLabel: target?.email,
            summary: preserveData
              ? `Lưu trữ tài khoản ${target?.email || teacherId} (giữ nguyên đề thi và kết quả)`
              : `Xóa vĩnh viễn tài khoản ${target?.email || teacherId} và dữ liệu`,
          });
        } else if (serviceClient) {
          if (preserveData) {
            await serviceClient.auth.admin.updateUserById(teacherId, { ban_duration: "876000h" }).catch(() => {});
            await serviceClient.auth.admin.signOut(teacherId).catch(() => {});
          } else {
            await serviceClient.auth.admin.deleteUser(teacherId).catch(() => {});
          }
        }

        return res.status(200).json({ ok: true, preserveData });
      }

      case "get_teacher_data": {
        const teacherId = String(body.teacherId || req.query?.teacherId || "");
        if (!teacherId) return res.status(400).json({ ok: false, error: "Thiếu ID giáo viên." });

        const [profRes, foldersRes, examsRes] = await Promise.all([
          db.from("profiles").select("*").eq("id", teacherId).maybeSingle(),
          db.from("exam_folders").select("*").eq("teacher_id", teacherId).order("name", { ascending: true }),
          db.from("exams").select("*").eq("created_by", teacherId).order("created_at", { ascending: false }),
        ]);

        const exams = (examsRes.data || []).filter((e: any) => !e.is_deleted);
        const folders = (foldersRes.data || []).filter((f: any) => !f.is_deleted);
        const examIds = exams.map((e: any) => e.id);

        let submissions: any[] = [];
        if (examIds.length > 0) {
          const { data: subs } = await db
            .from("submissions")
            .select("*")
            .in("exam_id", examIds)
            .order("submitted_at", { ascending: false });
          submissions = subs || [];
        }

        const subjects = Array.from(
          new Set([profRes.data?.subject_name, ...exams.map((e: any) => e.subject_name)].filter(Boolean))
        );
        const schools = Array.from(
          new Set([profRes.data?.school_name, ...exams.map((e: any) => e.school_name)].filter(Boolean))
        );

        return res.status(200).json({
          ok: true,
          teacher: profRes.data || null,
          folders,
          exams,
          submissions,
          subjects,
          schools,
        });
      }

      case "save_exam": {
        const exam = body.exam || {};
        if (!exam.title) {
          return res.status(400).json({ ok: false, error: "Tiêu đề đề thi không được để trống." });
        }

        const isUpdate = Boolean(exam.id);
        let beforeData: any = null;
        if (isUpdate) {
          const { data: oldEx } = await db.from("exams").select("*").eq("id", exam.id).maybeSingle();
          beforeData = oldEx;
        }

        const payload: Record<string, any> = {
          title: exam.title,
          duration_minutes: Number(exam.duration_minutes) || 45,
          subject_name: exam.subject_name ?? null,
          school_name: exam.school_name ?? null,
          teacher_name: exam.teacher_name ?? beforeData?.teacher_name ?? null,
          folder_id: exam.folder_id ?? null,
          manual_closed: !!exam.manual_closed,
          allow_review: exam.allow_review !== false,
          instant_feedback: !!exam.instant_feedback,
          auto_submit_on_close: exam.auto_submit_on_close !== false,
          display_mode: exam.display_mode || "standard",
          open_at: exam.open_at || null,
          close_at: exam.close_at || null,
          scoring: exam.scoring ?? beforeData?.scoring ?? {},
          scoring_mode: exam.scoring_mode || beforeData?.scoring_mode || "equal",
          shuffle_questions: !!exam.shuffle_questions,
          shuffle_options: !!exam.shuffle_options,
          questions: exam.questions ?? beforeData?.questions ?? { partI: [], partII: [], partIII: [] },
          lock_mode: exam.lock_mode ?? beforeData?.lock_mode ?? {},
          team_config: exam.team_config ?? beforeData?.team_config ?? {},
        };

        if (!isUpdate && exam.created_by) {
          payload.created_by = exam.created_by;
        }

        let saved: any = null;
        if (isUpdate && beforeData) {
          const { data, error } = await db.from("exams").update(payload).eq("id", exam.id).select("*").single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          saved = data;
        } else {
          if (exam.id) payload.id = exam.id;
          const { data, error } = await db.from("exams").insert(payload).select("*").single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          saved = data;
        }

        await writeAuditLog(db, actor, {
          action: isUpdate ? "UPDATE_EXAM" : "CREATE_EXAM",
          targetType: "exam",
          targetId: saved?.id || exam.id,
          targetLabel: saved?.title || exam.title,
          summary: `${isUpdate ? "Chỉnh sửa" : "Tạo mới"} đề thi "${saved?.title || exam.title}"`,
        });

        return res.status(200).json({ ok: true, exam: saved });
      }

      case "delete_exam": {
        const examId = String(body.examId || "");
        const hardDelete = !!body.hardDelete;
        if (!examId) return res.status(400).json({ ok: false, error: "Thiếu ID đề thi." });

        const { data: rpcRes, error: rpcErr } = await callerClient.rpc("admin_delete_exam", {
          p_exam_id: examId,
          p_hard_delete: hardDelete,
        });

        if (rpcErr || !rpcRes?.ok) {
          const { count: subCount } = await db
            .from("submissions")
            .select("id", { count: "exact", head: true })
            .eq("exam_id", examId);
          const { data: ex } = await db.from("exams").select("title").eq("id", examId).maybeSingle();

          if (!hardDelete && (subCount || 0) > 0) {
            await db
              .from("exams")
              .update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                deleted_by: actor.id,
                manual_closed: true,
              })
              .eq("id", examId);
          } else {
            if ((subCount || 0) > 0) {
              await db.from("submissions").delete().eq("exam_id", examId);
            }
            await db.from("exams").delete().eq("id", examId);
          }

          await writeAuditLog(db, actor, {
            action: "DELETE_EXAM",
            targetType: "exam",
            targetId: examId,
            targetLabel: ex?.title || examId,
            summary: `Xóa đề thi "${ex?.title || examId}" (${subCount || 0} bài nộp)`,
          });
        }

        return res.status(200).json({ ok: true });
      }

      case "save_folder": {
        const folder = body.folder || {};
        if (!folder.name?.trim()) {
          return res.status(400).json({ ok: false, error: "Tên thư mục không được để trống." });
        }
        const nowIso = new Date().toISOString();
        if (folder.id) {
          const { data, error } = await db
            .from("exam_folders")
            .update({
              name: folder.name.trim(),
              description: folder.description ?? null,
              color: folder.color || "sky",
              icon: folder.icon || "folder",
              parent_id: folder.parent_id ?? null,
              updated_at: nowIso,
            })
            .eq("id", folder.id)
            .select("*")
            .single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          await writeAuditLog(db, actor, {
            action: "UPDATE_FOLDER",
            targetType: "folder",
            targetId: folder.id,
            targetLabel: folder.name,
            summary: `Cập nhật thư mục "${folder.name}"`,
          });
          return res.status(200).json({ ok: true, folder: data });
        } else {
          const { data, error } = await db
            .from("exam_folders")
            .insert({
              name: folder.name.trim(),
              description: folder.description ?? null,
              color: folder.color || "sky",
              icon: folder.icon || "folder",
              parent_id: folder.parent_id ?? null,
              teacher_id: folder.teacher_id ?? null,
              created_at: nowIso,
              updated_at: nowIso,
            })
            .select("*")
            .single();
          if (error) return res.status(400).json({ ok: false, error: error.message });
          await writeAuditLog(db, actor, {
            action: "CREATE_FOLDER",
            targetType: "folder",
            targetId: data?.id,
            targetLabel: folder.name,
            summary: `Tạo thư mục "${folder.name}" cho giáo viên`,
          });
          return res.status(200).json({ ok: true, folder: data });
        }
      }

      case "delete_folder": {
        const folderId = String(body.folderId || "");
        if (!folderId) return res.status(400).json({ ok: false, error: "Thiếu ID thư mục." });

        const { data: target } = await db.from("exam_folders").select("*").eq("id", folderId).maybeSingle();
        await db.from("exam_folders").update({ parent_id: target?.parent_id ?? null }).eq("parent_id", folderId);
        await db.from("exams").update({ folder_id: null }).eq("folder_id", folderId);
        const { error } = await db.from("exam_folders").delete().eq("id", folderId);
        if (error) return res.status(400).json({ ok: false, error: error.message });

        await writeAuditLog(db, actor, {
          action: "DELETE_FOLDER",
          targetType: "folder",
          targetId: folderId,
          targetLabel: target?.name || folderId,
          summary: `Xóa thư mục "${target?.name || folderId}" (giữ nguyên toàn bộ đề thi bên trong)`,
        });
        return res.status(200).json({ ok: true });
      }

      case "list_exams_system": {
        const [examsRes, subsRes] = await Promise.all([
          db.from("exams").select("*").order("created_at", { ascending: false }),
          db.from("submissions").select("id, exam_id"),
        ]);
        const counts: Record<string, number> = {};
        for (const s of subsRes.data || []) {
          counts[s.exam_id] = (counts[s.exam_id] || 0) + 1;
        }
        const exams = (examsRes.data || []).filter((e: any) => !e.is_deleted);
        return res.status(200).json({ ok: true, exams, submissionCounts: counts });
      }

      case "list_activity_logs": {
        const limit = Math.min(Number(body.limit) || 200, 500);
        const { data, error } = await db
          .from("admin_activity_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error) return res.status(200).json({ ok: true, logs: [] });
        return res.status(200).json({ ok: true, logs: data || [] });
      }

      case "change_super_admin_password": {
        const newPassword = String(body.newPassword || "");
        if (newPassword.length < 6 || newPassword === "123456") {
          return res.status(400).json({
            ok: false,
            error: "Mật khẩu mới phải từ 6 ký tự trở lên và không được là 123456.",
          });
        }
        if (serviceClient) {
          const { error: updErr } = await serviceClient.auth.admin.updateUserById(caller.id, {
            password: newPassword,
          });
          if (updErr) return res.status(400).json({ ok: false, error: updErr.message });
        } else {
          const { error: updErr } = await callerClient.auth.updateUser({ password: newPassword });
          if (updErr) return res.status(400).json({ ok: false, error: updErr.message });
        }
        await db
          .from("profiles")
          .update({ must_change_password: false, updated_at: new Date().toISOString() })
          .eq("id", caller.id);
        await writeAuditLog(db, actor, {
          action: "CHANGE_SUPER_ADMIN_PASSWORD",
          targetType: "system",
          targetId: caller.id,
          targetLabel: actor.email,
          summary: "Super Admin đổi mật khẩu tài khoản quản trị.",
        });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ ok: false, error: `Action không được hỗ trợ: ${action}` });
    }
  } catch (err: any) {
    console.error("[admin-api] unexpected error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Lỗi máy chủ nội bộ." });
  }
}
