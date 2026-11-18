import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPER_ADMIN_EMAIL = "bichthuylqd@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      eventType = "TEACHER_REGISTERED",
      teacherName,
      teacherEmail,
      teacherUsername,
      teacherPhone,
      teacherSchool,
      teacherSubject,
      rejectionReason,
      appUrl,
    } = body || {};

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("MAIL_FROM") || "Hệ thống Trắc nghiệm Online <onboarding@resend.dev>";

    if (!resendApiKey) {
      return new Response(
        JSON.stringify({
          sent: false,
          skipped: true,
          reason: "RESEND_API_KEY chưa được cấu hình trên Supabase Secrets",
          recipient: eventType === "TEACHER_REGISTERED" ? SUPER_ADMIN_EMAIL : teacherEmail,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let to = SUPER_ADMIN_EMAIL;
    let subject = "[App Trắc Nghiệm] Yêu cầu duyệt tài khoản giáo viên mới";
    let html = "";

    if (eventType === "TEACHER_REGISTERED") {
      to = SUPER_ADMIN_EMAIL;
      subject = `[Phê duyệt Giáo viên] ${teacherName || teacherEmail} vừa đăng ký tài khoản`;
      html = `
        <div style="font-family: 'Times New Roman', Times, serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 24px; border-radius: 8px;">
          <h2 style="margin-top: 0; color: #0f172a;">Thông báo đăng ký giáo viên mới</h2>
          <p>Hệ thống vừa ghi nhận yêu cầu đăng ký tài khoản giáo viên đang chờ Quản trị viên phê duyệt:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 6px 0; color: #475569;">Họ và tên:</td><td style="font-weight: bold;">${teacherName || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Email:</td><td>${teacherEmail || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Tên đăng nhập:</td><td>${teacherUsername || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Số điện thoại:</td><td>${teacherPhone || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Trường học:</td><td>${teacherSchool || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Môn giảng dạy:</td><td>${teacherSubject || "—"}</td></tr>
            <tr><td style="padding: 6px 0; color: #475569;">Thời gian:</td><td>${new Date().toLocaleString("vi-VN")}</td></tr>
          </table>
          <p>Vui lòng truy cập bảng điều khiển Quản trị viên tại <a href="${appUrl || "https://truongthuyhtq.vercel.app"}/admin">${appUrl || "https://truongthuyhtq.vercel.app"}/admin</a> để phê duyệt hoặc từ chối.</p>
        </div>
      `;
    } else if (eventType === "TEACHER_APPROVED" && teacherEmail) {
      to = teacherEmail;
      subject = "[App Trắc Nghiệm] Tài khoản giáo viên của bạn đã được phê duyệt";
      html = `
        <div style="font-family: 'Times New Roman', Times, serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 24px; border-radius: 8px;">
          <h2 style="margin-top: 0; color: #047857;">Tài khoản giáo viên đã được phê duyệt</h2>
          <p>Xin chào Thầy/Cô <strong>${teacherName || teacherEmail}</strong>,</p>
          <p>Quản trị viên hệ thống đã phê duyệt tài khoản giáo viên của Thầy/Cô. Thầy/Cô có thể đăng nhập và sử dụng đầy đủ các chức năng tạo đề ngay bây giờ.</p>
          <p><a href="${appUrl || "https://truongthuyhtq.vercel.app"}/auth">Đăng nhập hệ thống</a></p>
        </div>
      `;
    } else if (eventType === "TEACHER_REJECTED" && teacherEmail) {
      to = teacherEmail;
      subject = "[App Trắc Nghiệm] Thông báo về yêu cầu đăng ký tài khoản giáo viên";
      html = `
        <div style="font-family: 'Times New Roman', Times, serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 24px; border-radius: 8px;">
          <h2 style="margin-top: 0; color: #b91c1c;">Yêu cầu đăng ký chưa được phê duyệt</h2>
          <p>Xin chào <strong>${teacherName || teacherEmail}</strong>,</p>
          <p>Yêu cầu đăng ký tài khoản giáo viên của bạn chưa được Quản trị viên phê duyệt.</p>
          ${rejectionReason ? `<p><strong>Lý do:</strong> ${rejectionReason}</p>` : ""}
        </div>
      `;
    } else {
      return new Response(JSON.stringify({ sent: false, skipped: true, reason: "Missing recipient" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromEmail, to: [to], subject, html }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ sent: false, error: errText }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await resp.json();
    return new Response(
      JSON.stringify({ sent: true, id: data?.id, channel: "resend" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
