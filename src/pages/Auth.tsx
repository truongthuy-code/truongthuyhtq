import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withAuthTimeout } from "@/lib/supabaseAuthSync";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  GraduationCap,
  ShieldCheck,
  UserCheck,
  ArrowRight,
  Eye,
  EyeOff,
  Clock,
  Ban,
  CheckCircle2,
} from "lucide-react";
import { SUBJECT_LIST } from "@/lib/subjects";
import {
  hashPassword,
  getTeacherByUsernameOrEmail,
  fetchTeacherByUsernameOrEmail,
  getAdminByUsernameOrEmail,
  setCurrentAuthUser,
  upsertTeacher,
  TeacherUser,
  generateUuid,
  SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
  isReservedAdminIdentifier,
} from "@/lib/teacherStorage";

type BlockBannerState = {
  type: "PENDING" | "REJECTED" | "LOCKED";
  message: string;
  reason?: string | null;
} | null;

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [searchParams] = useSearchParams();
  const { user, isSuperAdmin, approvalStatus, loading } = useAuth();

  const roleParam = searchParams.get("role") as "teacher" | "student" | "admin" | null;
  const [selectedRole, setSelectedRole] = useState<"teacher" | "student" | "admin">(
    roleParam || "teacher"
  );
  const [tab, setTab] = useState<"login" | "signup">("login");

  // Login form state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Teacher Signup form state
  const [fullName, setFullName] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupSchool, setSignupSchool] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [blockBanner, setBlockBanner] = useState<BlockBannerState>(null);
  const [pendingSuccessBanner, setPendingSuccessBanner] = useState<string | null>(null);
  const redirectTo = location.state?.from || "/";

  // Redirect only if authenticated AND approved (or Super Admin)
  useEffect(() => {
    if (!loading && user) {
      if (isSuperAdmin) {
        navigate("/admin", { replace: true });
      } else if (approvalStatus === "APPROVED") {
        navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
      }
    }
  }, [user, isSuperAdmin, approvalStatus, loading, navigate, redirectTo]);

  const handleSelectRole = (r: "teacher" | "student" | "admin") => {
    setSelectedRole(r);
    setTab("login");
    setBlockBanner(null);
    if (r === "student") {
      navigate("/student/auth");
    }
  };

  async function completeSuperAdminSupabaseLogin(email: string, pwd: string): Promise<boolean> {
    try {
      const { data: signData, error: sbError } = await supabase.auth.signInWithPassword({
        email,
        password: pwd,
      });

      if (!sbError && signData?.user) {
        let stateData: any = null;
        try {
          const { data } = await withAuthTimeout(
            (supabase as any).rpc("get_my_account_state"),
            4500,
            "auth.superAdmin.get_my_account_state"
          );
          stateData = data;
        } catch {}

        let prof: any = null;
        if (!stateData) {
          try {
            const { data } = await withAuthTimeout(
              supabase.from("profiles").select("*").eq("id", signData.user.id).maybeSingle(),
              4500,
              "auth.superAdmin.profiles"
            );
            prof = data;
          } catch {}
        }

        const resolvedRole = stateData?.role || prof?.role;
        const isAllowedSuperAdmin =
          isSuperAdminEmail(signData.user.email) ||
          stateData?.is_super_admin === true ||
          resolvedRole === "super_admin";

        if (!isAllowedSuperAdmin) {
          await supabase.auth.signOut().catch(() => {});
          toast.error("Tài khoản này không có quyền Super Admin!");
          return false;
        }

        const mustChange = Boolean(
          stateData?.must_change_password ?? prof?.must_change_password ?? pwd === "123456"
        );

        setCurrentAuthUser({
          id: signData.user.id,
          username: "bichthuylqd",
          name: stateData?.full_name || prof?.full_name || "Trương Thị Bích Thủy",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
          approvalStatus: "APPROVED",
          mustChangePassword: mustChange,
        });

        if (mustChange) {
          toast.info("Đăng nhập thành công! Bạn bắt buộc phải đổi mật khẩu lần đầu tiên để tiếp tục.");
        } else {
          toast.success("Đăng nhập thành công với quyền Super Admin.");
        }
        navigate("/admin", { replace: true });
        return true;
      }
    } catch (err) {
      console.warn("Supabase Super Admin login warning:", err);
    }

    // Offline / unmigrated sandbox fallback ONLY if matching local Super Admin registry
    const localAdmin = getAdminByUsernameOrEmail(email);
    if (localAdmin && localAdmin.passwordHash === hashPassword(pwd)) {
      setCurrentAuthUser({
        id: localAdmin.id,
        username: localAdmin.username,
        name: localAdmin.name,
        email: SUPER_ADMIN_EMAIL,
        role: "super_admin",
        approvalStatus: "APPROVED",
        mustChangePassword: !!localAdmin.mustChangePassword,
      });
      toast.success("Đăng nhập thành công với quyền Super Admin.");
      navigate("/admin", { replace: true });
      return true;
    }

    return false;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBlockBanner(null);
    setPendingSuccessBanner(null);

    if (!identifier.trim() || !password) {
      toast.error("Vui lòng nhập đầy đủ tài khoản và mật khẩu");
      return;
    }

    setBusy(true);
    const normInput = identifier.trim().toLowerCase();

    try {
      // 1. SUPER ADMIN LOGIN FLOW
      if (selectedRole === "admin" || isSuperAdminEmail(normInput) || normInput === "bichthuylqd") {
        const targetEmail =
          normInput === "bichthuylqd" || isSuperAdminEmail(normInput) ? SUPER_ADMIN_EMAIL : identifier.trim();

        if (!isSuperAdminEmail(targetEmail)) {
          setBusy(false);
          toast.error(`Chỉ tài khoản Super Admin duy nhất (${SUPER_ADMIN_EMAIL}) được phép đăng nhập khu vực quản trị.`);
          return;
        }

        const ok = await completeSuperAdminSupabaseLogin(targetEmail, password);
        setBusy(false);
        if (!ok) {
          toast.error("Email hoặc mật khẩu Super Admin không chính xác.");
        }
        return;
      }

      // 2. TEACHER LOGIN FLOW
      let loginEmail = normInput;
      if (!loginEmail.includes("@")) {
        const resolved =
          getTeacherByUsernameOrEmail(normInput) || (await fetchTeacherByUsernameOrEmail(normInput));
        if (resolved?.email) {
          loginEmail = resolved.email.toLowerCase();
        }
      }

      if (loginEmail.includes("@")) {
        const { data: signData, error: sbError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });

        if (!sbError && signData?.user) {
          let stateData: any = null;
          try {
            const { data } = await withAuthTimeout(
              (supabase as any).rpc("get_my_account_state"),
              4500,
              "auth.teacher.get_my_account_state"
            );
            stateData = data;
          } catch {}

          let prof: any = null;
          if (!stateData) {
            try {
              const { data } = await withAuthTimeout(
                supabase.from("profiles").select("*").eq("id", signData.user.id).maybeSingle(),
                4500,
                "auth.teacher.profiles"
              );
              prof = data;
            } catch {}
          }

          let eff = stateData || prof || {};

          if (eff.missing_profile || !stateData) {
            try {
              const { data: regRow } = await withAuthTimeout(
                (supabase as any)
                  .from("teacher_registrations")
                  .select("status, rejection_reason")
                  .eq("user_id", signData.user.id)
                  .maybeSingle(),
                4500,
                "auth.teacher.registrations"
              );
              if (!regRow && eff.missing_profile) {
                eff = { ...eff, status: "active", approval_status: "APPROVED" };
              } else if (regRow?.status === "APPROVED" && String(eff.approval_status || "").toUpperCase() === "PENDING") {
                eff = { ...eff, status: "active", approval_status: "APPROVED" };
              }
            } catch {}
          }

          const rawApproval = String(eff.approval_status || "").toUpperCase();
          const rawStatus = String(eff.status || "").toLowerCase();

          if (eff.is_deleted || rawApproval === "LOCKED" || rawStatus === "locked") {
            await supabase.auth.signOut().catch(() => {});
            setBlockBanner({
              type: "LOCKED",
              message: "Tài khoản giáo viên này đã bị khóa bởi Quản trị viên.",
            });
            setBusy(false);
            return;
          }

          if (rawApproval === "REJECTED" || rawStatus === "rejected") {
            await supabase.auth.signOut().catch(() => {});
            setBlockBanner({
              type: "REJECTED",
              message: "Yêu cầu đăng ký tài khoản giáo viên của bạn đã bị từ chối.",
              reason: eff.rejection_reason || null,
            });
            setBusy(false);
            return;
          }

          if (rawApproval === "PENDING" || rawStatus === "pending") {
            await supabase.auth.signOut().catch(() => {});
            setBlockBanner({
              type: "PENDING",
              message: `Tài khoản của bạn đang chờ Quản trị viên (${SUPER_ADMIN_EMAIL}) phê duyệt. Vui lòng quay lại sau khi được duyệt.`,
            });
            setBusy(false);
            return;
          }

          const fullName =
            eff.full_name || signData.user.user_metadata?.full_name || loginEmail.split("@")[0];
          const username = eff.username || loginEmail.split("@")[0];

          setCurrentAuthUser({
            id: signData.user.id,
            username,
            name: fullName,
            email: signData.user.email || loginEmail,
            phone: eff.phone || "",
            school: eff.school_name || "Trường THPT",
            subject: eff.subject_name || "Tin học",
            avatar: eff.avatar,
            role: "teacher",
            approvalStatus: "APPROVED",
          });

          upsertTeacher({
            id: signData.user.id,
            username,
            name: fullName,
            email: signData.user.email || loginEmail,
            phone: eff.phone || "",
            school: eff.school_name || "Trường THPT",
            subject: eff.subject_name || "Tin học",
            status: "active",
            approvalStatus: "APPROVED",
            passwordHash: hashPassword(password),
            createdAt: eff.created_at || new Date().toISOString(),
          });

          toast.success(`Chào mừng giáo viên ${fullName}`);
          setBusy(false);
          navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
          return;
        }
      }

      // Local offline fallback (only when Supabase Auth unreachable / local Vitest teacher)
      const localTeacher = getTeacherByUsernameOrEmail(identifier);
      if (localTeacher && localTeacher.passwordHash && localTeacher.passwordHash === hashPassword(password)) {
        if (localTeacher.status === "locked" || localTeacher.approvalStatus === "LOCKED") {
          setBlockBanner({
            type: "LOCKED",
            message: "Tài khoản giáo viên này đã bị khóa bởi Quản trị viên.",
          });
          setBusy(false);
          return;
        }
        if (localTeacher.status === "rejected" || localTeacher.approvalStatus === "REJECTED") {
          setBlockBanner({
            type: "REJECTED",
            message: "Tài khoản giáo viên đã bị từ chối.",
            reason: localTeacher.rejectionReason,
          });
          setBusy(false);
          return;
        }
        if (localTeacher.status === "pending" || localTeacher.approvalStatus === "PENDING") {
          setBlockBanner({
            type: "PENDING",
            message: "Tài khoản đang chờ Quản trị viên phê duyệt.",
          });
          setBusy(false);
          return;
        }

        setCurrentAuthUser({
          id: localTeacher.id,
          username: localTeacher.username,
          name: localTeacher.name,
          email: localTeacher.email,
          phone: localTeacher.phone,
          school: localTeacher.school,
          subject: localTeacher.subject,
          avatar: localTeacher.avatar,
          role: "teacher",
          approvalStatus: "APPROVED",
        });
        toast.success(`Chào mừng giáo viên ${localTeacher.name}`);
        setBusy(false);
        navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
        return;
      }

      setBusy(false);
      toast.error("Tên đăng nhập / Email hoặc mật khẩu không chính xác");
    } catch (err: any) {
      setBusy(false);
      toast.error(err?.message || "Đăng nhập thất bại");
    }
  };

  const handleTeacherSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRole !== "teacher") return;
    setBlockBanner(null);
    setPendingSuccessBanner(null);

    if (signupPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    if (signupPassword.length < 6) {
      toast.error("Mật khẩu phải có tối thiểu 6 ký tự");
      return;
    }
    if (!fullName.trim() || !subjectName) {
      toast.error("Vui lòng điền họ tên và môn học giảng dạy");
      return;
    }

    const normEmail = signupEmail.trim().toLowerCase();
    const normUsername = (signupUsername || normEmail.split("@")[0] || "").trim().toLowerCase();

    if (!normEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
      toast.error("Vui lòng nhập địa chỉ email hợp lệ");
      return;
    }
    if (!normUsername || normUsername.length < 3) {
      toast.error("Tên đăng nhập phải có ít nhất 3 ký tự");
      return;
    }

    if (isReservedAdminIdentifier(normEmail) || isReservedAdminIdentifier(normUsername)) {
      toast.error("Không được phép đăng ký bằng email hoặc tên đăng nhập của Quản trị viên hệ thống!");
      return;
    }

    setBusy(true);

    try {
      let registeredUserId: string | null = null;
      let registeredViaServer = false;

      // 1. Primary path: server API endpoint (/api/auth-register) -> forces PENDING + notifies Super Admin
      try {
        const resp = await fetch("/api/auth-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normEmail,
            password: signupPassword,
            confirmPassword,
            fullName: fullName.trim(),
            username: normUsername,
            phone: signupPhone.trim(),
            schoolName: signupSchool.trim() || "Trường THPT",
            subjectName,
          }),
        });

        const payload = await resp.json().catch(() => null);
        const errText = String(payload?.error || "");
        const isGatewayOrKeyError = /invalid api key|invalid jwt|no api key|apikey/i.test(errText);

        if (resp.ok && payload?.ok) {
          registeredViaServer = true;
          registeredUserId = payload.userId || null;
        } else if (
          !isGatewayOrKeyError &&
          (resp.status === 403 || resp.status === 409 || resp.status === 422 || (resp.status === 400 && errText))
        ) {
          setBusy(false);
          toast.error(errText);
          return;
        }
      } catch {
        // Network / offline fallback handled below
      }

      // 2. Fallback path if server endpoint unavailable or returned gateway/API key error
      if (!registeredViaServer) {
        const { data: sbData, error: sbErr } = await supabase.auth.signUp({
          email: normEmail,
          password: signupPassword,
          options: {
            data: {
              full_name: fullName.trim(),
              username: normUsername,
              phone: signupPhone.trim(),
              school_name: signupSchool.trim() || "Trường THPT",
              subject_name: subjectName,
            },
          },
        });
        if (sbErr) {
          setBusy(false);
          const rawMsg = sbErr.message || "Không thể đăng ký tài khoản.";
          if (/already|registered/i.test(rawMsg)) {
            toast.error("Email này đã được đăng ký trước đó.");
          } else if (/invalid api key/i.test(rawMsg)) {
            toast.error(
              "Lỗi cấu hình kết nối Supabase (API key không hợp lệ). Vui lòng kiểm tra biến môi trường VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY."
            );
          } else {
            toast.error(rawMsg);
          }
          return;
        }
        registeredUserId = sbData?.user?.id || null;
        // CRITICAL: Never allow newly registered teacher to remain signed in before Super Admin approval!
        await supabase.auth.signOut().catch(() => {});

        // Best-effort notification to Super Admin via Edge Function
        try {
          await supabase.functions.invoke("teacher-register-notify", {
            body: {
              eventType: "TEACHER_REGISTERED",
              teacherName: fullName.trim(),
              teacherEmail: normEmail,
              teacherUsername: normUsername,
              teacherPhone: signupPhone.trim(),
              teacherSchool: signupSchool.trim() || "Trường THPT",
              teacherSubject: subjectName,
            },
          });
        } catch {}
      }

      const newTeacher: TeacherUser = {
        id: registeredUserId || generateUuid(),
        username: normUsername,
        name: fullName.trim(),
        email: normEmail,
        phone: signupPhone.trim(),
        school: signupSchool.trim() || "Trường THPT",
        subject: subjectName,
        status: "pending",
        approvalStatus: "PENDING",
        passwordHash: hashPassword(signupPassword),
        createdAt: new Date().toISOString(),
      };
      upsertTeacher(newTeacher);

      setPendingSuccessBanner(
        `Đăng ký tài khoản "${fullName.trim()}" (${normEmail}) thành công! Tài khoản hiện đang ở trạng thái CHỜ PHÊ DUYỆT bởi Quản trị viên (${SUPER_ADMIN_EMAIL}). Bạn sẽ có thể đăng nhập sau khi được phê duyệt.`
      );

      setFullName("");
      setSignupUsername("");
      setSignupEmail("");
      setSignupPhone("");
      setSignupSchool("");
      setSubjectName("");
      setSignupPassword("");
      setConfirmPassword("");
      setTab("login");
      setBusy(false);
      toast.success("Đã gửi đăng ký tài khoản! Vui lòng chờ Quản trị viên phê duyệt.");
    } catch (err: any) {
      setBusy(false);
      toast.error(err?.message || "Đăng ký thất bại");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
      <Card className="p-6 sm:p-8 w-full max-w-lg shadow-soft border">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="size-12 rounded-2xl bg-gradient-primary grid place-items-center text-primary-foreground shadow-soft mb-3">
            <FileText className="size-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight">
            Hệ thống Tạo đề trắc nghiệm Online
          </h1>
          <p className="text-xs font-semibold text-primary mt-1 uppercase tracking-wide">
            Tác giả: Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Đăng nhập phân quyền: Giáo viên, Học sinh, Quản trị viên
          </p>
        </div>

        {/* ROLE SELECTOR BUTTONS */}
        <div className="mb-6">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2 text-center">
            Chọn vai trò đăng nhập
          </Label>
          <div className="grid grid-cols-3 gap-2 p-1.5 bg-muted/60 rounded-xl">
            <button
              type="button"
              onClick={() => handleSelectRole("teacher")}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg font-bold text-xs transition-all ${
                selectedRole === "teacher"
                  ? "bg-white text-primary shadow-sm ring-1 ring-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <UserCheck className="size-4 mb-1" />
              <span>GIÁO VIÊN</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectRole("student")}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg font-bold text-xs transition-all ${
                selectedRole === "student"
                  ? "bg-white text-primary shadow-sm ring-1 ring-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <GraduationCap className="size-4 mb-1" />
              <span>HỌC SINH</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectRole("admin")}
              className={`flex flex-col items-center justify-center py-2.5 px-2 rounded-lg font-bold text-xs transition-all ${
                selectedRole === "admin"
                  ? "bg-white text-amber-700 shadow-sm ring-1 ring-amber-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ShieldCheck className="size-4 mb-1" />
              <span>QUẢN TRỊ VIÊN</span>
            </button>
          </div>
        </div>

        {/* Pending registration success banner */}
        {pendingSuccessBanner && (
          <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Đăng ký đang chờ phê duyệt</p>
              <p className="mt-0.5 leading-relaxed">{pendingSuccessBanner}</p>
            </div>
          </div>
        )}

        {/* Blocked / Pending / Rejected login banner */}
        {blockBanner && (
          <div
            className={`mb-4 p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
              blockBanner.type === "PENDING"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {blockBanner.type === "PENDING" ? (
              <Clock className="size-4 shrink-0 mt-0.5" />
            ) : (
              <Ban className="size-4 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-bold">
                {blockBanner.type === "PENDING"
                  ? "Tài khoản đang chờ phê duyệt"
                  : blockBanner.type === "REJECTED"
                    ? "Đăng ký chưa được phê duyệt"
                    : "Tài khoản đã bị khóa"}
              </p>
              <p className="mt-0.5 leading-relaxed">{blockBanner.message}</p>
              {blockBanner.reason && (
                <p className="mt-1 font-semibold">Lý do: {blockBanner.reason}</p>
              )}
            </div>
          </div>
        )}

        {selectedRole === "admin" && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <ShieldCheck className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Khu vực Quản trị viên Toàn quyền (Super Admin):</span>
              <p className="mt-0.5 text-muted-foreground">
                Chỉ tài khoản Super Admin duy nhất của hệ thống mới có quyền đăng nhập tại đây. Không hỗ trợ tự đăng ký tài khoản quản trị.
              </p>
            </div>
          </div>
        )}

        {selectedRole === "teacher" && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-4">
              <TabsTrigger value="login">Đăng nhập</TabsTrigger>
              <TabsTrigger value="signup">Đăng ký tài khoản mới</TabsTrigger>
            </TabsList>

            {/* TEACHER LOGIN */}
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div className="space-y-1">
                  <Label htmlFor="t-login-user">Email hoặc Tên đăng nhập</Label>
                  <Input
                    id="t-login-user"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="VD: giaovien@truong.edu.vn"
                    className="h-10"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="t-login-pass">Mật khẩu</Label>
                  <div className="relative">
                    <Input
                      id="t-login-pass"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nhập mật khẩu"
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full bg-gradient-primary h-10 mt-2" disabled={busy}>
                  {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng nhập Giáo viên
                </Button>
              </form>
            </TabsContent>

            {/* TEACHER SIGNUP */}
            <TabsContent value="signup">
              <form onSubmit={handleTeacherSignup} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="s-fullname">Họ và tên *</Label>
                    <Input
                      id="s-fullname"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Thầy/Cô..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="s-user">Tên đăng nhập *</Label>
                    <Input
                      id="s-user"
                      required
                      value={signupUsername}
                      onChange={(e) => setSignupUsername(e.target.value)}
                      placeholder="giaovien123"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="s-sub">Môn học giảng dạy *</Label>
                  <Select value={subjectName} onValueChange={setSubjectName}>
                    <SelectTrigger id="s-sub">
                      <SelectValue placeholder="Chọn môn học" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUBJECT_LIST.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                      <SelectItem value="Khác">Môn khác</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="s-email">Email *</Label>
                    <Input
                      id="s-email"
                      type="email"
                      required
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="gv@school.edu.vn"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="s-phone">Số điện thoại</Label>
                    <Input
                      id="s-phone"
                      value={signupPhone}
                      onChange={(e) => setSignupPhone(e.target.value)}
                      placeholder="0912..."
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="s-school">Trường học</Label>
                  <Input
                    id="s-school"
                    value={signupSchool}
                    onChange={(e) => setSignupSchool(e.target.value)}
                    placeholder="THPT Lê Quý Đôn"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="s-pass">Mật khẩu *</Label>
                    <Input
                      id="s-pass"
                      type="password"
                      required
                      minLength={6}
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="Ít nhất 6 ký tự"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="s-conf">Xác nhận mật khẩu *</Label>
                    <Input
                      id="s-conf"
                      type="password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Nhập lại mật khẩu"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Tài khoản đăng ký mới sẽ ở trạng thái <strong>Chờ phê duyệt</strong> và cần Quản trị viên xét duyệt trước khi đăng nhập.
                </p>

                <Button type="submit" className="w-full bg-gradient-primary h-10 mt-1" disabled={busy}>
                  {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Gửi đăng ký tài khoản Giáo viên
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {/* SUPER ADMIN LOGIN */}
        {selectedRole === "admin" && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="adm-user">Email Quản trị viên</Label>
              <Input
                id="adm-user"
                type="email"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={SUPER_ADMIN_EMAIL}
                className="h-10"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="adm-pass">Mật khẩu Super Admin</Label>
              <div className="relative">
                <Input
                  id="adm-pass"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu Quản trị viên"
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-10 mt-2 text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
              disabled={busy}
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng nhập Quản trị viên (Super Admin)
            </Button>
          </form>
        )}

        {/* Footer Links */}
        <div className="mt-6 pt-4 border-t flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
          <div>
            Bạn là Học sinh tham gia làm bài?{" "}
            <Link to="/student/auth" className="text-primary font-bold hover:underline inline-flex items-center gap-1">
              Chuyển sang Cổng học sinh <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
