import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPER_ADMIN_EMAIL = "bichthuylqd@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Missing Supabase service configuration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await adminClient.auth.getUser(jwt);
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const caller = userRes.user;
    const isSuper =
      caller.email?.toLowerCase() === SUPER_ADMIN_EMAIL ||
      caller.app_metadata?.role === "super_admin";

    if (!isSuper) {
      return new Response(JSON.stringify({ error: "Forbidden: Super Admin required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, payload = {} } = body || {};

    if (action === "lock_teacher") {
      const { userId, reason } = payload;
      const { data: targetProfile } = await adminClient.from("profiles").select("email, role").eq("id", userId).maybeSingle();
      if (targetProfile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL || targetProfile?.role === "super_admin") {
        return new Response(JSON.stringify({ error: "Không thể khóa tài khoản Super Admin gốc" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      await adminClient.auth.admin.signOut(userId).catch(() => {});
      await adminClient.from("profiles").update({
        status: "locked",
        approval_status: "LOCKED",
        locked_at: new Date().toISOString(),
        locked_by: caller.id,
      }).eq("id", userId);
      await adminClient.from("admin_activity_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        action: "LOCK_TEACHER",
        target_type: "teacher",
        target_id: userId,
        target_label: targetProfile?.email || userId,
        detail: reason || "Khóa tài khoản giáo viên",
        outcome: "success",
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unlock_teacher") {
      const { userId } = payload;
      await adminClient.auth.admin.updateUserById(userId, { ban_duration: "none" });
      await adminClient.from("profiles").update({
        status: "active",
        approval_status: "APPROVED",
        locked_at: null,
        locked_by: null,
        is_deleted: false,
      }).eq("id", userId);
      await adminClient.from("admin_activity_logs").insert({
        admin_id: caller.id,
        admin_email: caller.email,
        action: "UNLOCK_TEACHER",
        target_type: "teacher",
        target_id: userId,
        detail: "Mở khóa tài khoản giáo viên",
        outcome: "success",
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_teacher") {
      const { userId, preserveData = true } = payload;
      const { data: targetProfile } = await adminClient.from("profiles").select("email, role").eq("id", userId).maybeSingle();
      if (targetProfile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL || targetProfile?.role === "super_admin") {
        return new Response(JSON.stringify({ error: "Tuyệt đối không thể xóa tài khoản Super Admin gốc" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (preserveData) {
        await adminClient.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
        await adminClient.from("profiles").update({
          status: "locked",
          approval_status: "LOCKED",
          is_deleted: true,
          deleted_at: new Date().toISOString(),
        }).eq("id", userId);
      } else {
        await adminClient.from("exam_folders").delete().eq("teacher_id", userId);
        await adminClient.from("exams").delete().eq("created_by", userId);
        await adminClient.from("teacher_registrations").delete().eq("user_id", userId);
        await adminClient.from("user_roles").delete().eq("user_id", userId);
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
      }
      return new Response(JSON.stringify({ ok: true, preserved: preserveData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unsupported action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
