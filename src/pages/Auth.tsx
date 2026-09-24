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
  User,
  KeyRound,
} from "lucide-react";
import { SUBJECT_LIST } from "@/lib/subjects";
import {
  hashPassword,
  getTeacherByUsernameOrEmail,
  getAdminAccount,
  setCurrentAuthUser,
  upsertTeacher,
  TeacherUser,
  getAllTeachers,
} from "@/lib/teacherStorage";

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [searchParams] = useSearchParams();
  const { user, isAdmin, loading } = useAuth();

  // Selected Role: "teacher" | "student" | "admin"
  const roleParam = searchParams.get("role") as "teacher" | "student" | "admin" | null;
  const [selectedRole, setSelectedRole] = useState<"teacher" | "student" | "admin">(
    roleParam || "teacher"
  );

  // Tab: "login" | "signup" (signup only available for teacher)
  const [tab, setTab] = useState<"login" | "signup">("login");

  // Login form state
  const [identifier, setIdentifier] = useState(""); // username or email
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
  const redirectTo = location.state?.from || "/";

  // Redirect if user already logged in with valid session
  useEffect(() => {
    if (!loading && user) {
      if (isAdmin) {
        navigate("/admin", { replace: true });
      } else {
        navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
      }
    }
  }, [user, isAdmin, loading, navigate, redirectTo]);

  // Handle switching to student role
  const handleSelectRole = (r: "teacher" | "student" | "admin") => {
    setSelectedRole(r);
    setTab("login");
    if (r === "student") {
      navigate("/student/auth");
    }
  };

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error("Vui lòng nhập đầy đủ tài khoản và mật khẩu");
      return;
    }

    setBusy(true);

    try {
      // 1. ADMIN LOGIN FLOW
      if (selectedRole === "admin") {
        const adminAcc = getAdminAccount();
        const normInput = identifier.trim().toLowerCase();
        const inputHash = hashPassword(password);

        // Check if credentials match the single admin account
        if (
          (normInput === adminAcc.username.toLowerCase() || normInput === adminAcc.email.toLowerCase()) &&
          inputHash === adminAcc.passwordHash
        ) {
          setCurrentAuthUser({
            id: adminAcc.id,
            username: adminAcc.username,
            name: adminAcc.name,
            email: adminAcc.email,
            role: "admin",
          });
          toast.success("Đăng nhập thành công với quyền Quản trị viên (Admin)");
          setBusy(false);
          navigate("/admin", { replace: true });
          return;
        }

        // If not matched, strictly refuse wrong role/credentials
        setBusy(false);
        toast.error("Tài khoản hoặc mật khẩu Quản trị viên không chính xác");
        return;
      }

      // 2. TEACHER LOGIN FLOW
      if (selectedRole === "teacher") {
        const teacher = getTeacherByUsernameOrEmail(identifier);
        const inputHash = hashPassword(password);

        if (teacher) {
          // Check if teacher account is locked
          if (teacher.status === "locked") {
            setBusy(false);
            toast.error("Tài khoản giáo viên này đã bị khóa. Vui lòng liên hệ Admin!");
            return;
          }

          // Check password
          if (teacher.passwordHash === inputHash) {
            setCurrentAuthUser({
              id: teacher.id,
              username: teacher.username,
              name: teacher.name,
              email: teacher.email,
              phone: teacher.phone,
              school: teacher.school,
              subject: teacher.subject,
              avatar: teacher.avatar,
              role: "teacher",
            });
            toast.success(`Chào mừng giáo viên ${teacher.name}`);
            setBusy(false);
            navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
            return;
          }
        }

        // Fallback to Supabase Auth if registered via email
        const { data: signData, error: sbError } = await supabase.auth.signInWithPassword({
          email: identifier.trim(),
          password,
        });

        if (!sbError && signData?.user) {
          toast.success("Đăng nhập thành công");
          setBusy(false);
          navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
          return;
        }

        setBusy(false);
        toast.error("Tên đăng nhập / Email hoặc mật khẩu giáo viên không chính xác");
        return;
      }
    } catch (err: any) {
      setBusy(false);
      toast.error(err.message || "Đăng nhập thất bại");
    }
  };

  // Teacher Signup handler
  const handleTeacherSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRole !== "teacher") return;

    if (signupPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    if (!fullName.trim() || !subjectName) {
      toast.error("Vui lòng điền họ tên và môn học");
      return;
    }

    const normUsername = (signupUsername || signupEmail.split("@")[0] || "").trim().toLowerCase();
    if (!normUsername) {
      toast.error("Vui lòng nhập tên đăng nhập");
      return;
    }

    // Check existing
    const existing = getTeacherByUsernameOrEmail(normUsername);
    if (existing) {
      toast.error("Tên đăng nhập này đã được sử dụng");
      return;
    }

    setBusy(true);

    const newTeacher: TeacherUser = {
      id: `teacher-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: normUsername,
      name: fullName.trim(),
      email: signupEmail.trim(),
      phone: signupPhone.trim(),
      school: signupSchool.trim() || "Trường THPT",
      subject: subjectName,
      status: "active",
      passwordHash: hashPassword(signupPassword),
      createdAt: new Date().toISOString(),
    };

    upsertTeacher(newTeacher);

    // Also attempt Supabase signup for backend sync if email is provided
    try {
      if (signupEmail) {
        await supabase.auth.signUp({
          email: signupEmail,
          password: signupPassword,
          options: {
            data: { full_name: fullName.trim(), subject_name: subjectName },
          },
        });
      }
    } catch {}

    // Auto login
    setCurrentAuthUser({
      id: newTeacher.id,
      username: newTeacher.username,
      name: newTeacher.name,
      email: newTeacher.email,
      phone: newTeacher.phone,
      school: newTeacher.school,
      subject: newTeacher.subject,
      role: "teacher",
    });

    setBusy(false);
    toast.success("Tạo tài khoản giáo viên thành công!");
    navigate(redirectTo === "/admin" ? "/" : redirectTo, { replace: true });
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
            Đăng nhập phân quyền theo 3 vai trò: Giáo viên, Học sinh, Quản trị viên
          </p>
        </div>

        {/* 3 ROLE SELECTOR BUTTONS */}
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
                  ? "bg-white text-primary shadow-sm ring-1 ring-primary/20 scale-[1.02]"
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
                  ? "bg-white text-primary shadow-sm ring-1 ring-primary/20 scale-[1.02]"
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
                  ? "bg-white text-amber-600 shadow-sm ring-1 ring-amber-500/20 scale-[1.02]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ShieldCheck className="size-4 mb-1" />
              <span>ADMIN</span>
            </button>
          </div>
        </div>

        {/* ROLE NOTICE */}
        {selectedRole === "admin" && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <ShieldCheck className="size-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Khu vực dành riêng cho Quản trị viên (Admin):</span>
              <p className="mt-0.5 text-muted-foreground">
                Đăng nhập tài khoản Admin để quản lý danh sách giáo viên, bài thi và toàn bộ dữ liệu hệ thống.
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
                  <Label htmlFor="t-login-user">Tên đăng nhập hoặc Email</Label>
                  <Input
                    id="t-login-user"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="VD: giaovien hoặc thuy.tb@lqd.edu.vn"
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
                    <Label htmlFor="s-email">Email</Label>
                    <Input
                      id="s-email"
                      type="email"
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

                <Button type="submit" className="w-full bg-gradient-primary h-10 mt-2" disabled={busy}>
                  {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng ký tài khoản Giáo viên
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}

        {/* ADMIN LOGIN */}
        {selectedRole === "admin" && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="adm-user">Tên đăng nhập hoặc Email Quản trị</Label>
              <Input
                id="adm-user"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="admin"
                className="h-10"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="adm-pass">Mật khẩu Quản trị</Label>
              <div className="relative">
                <Input
                  id="adm-pass"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu Admin"
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
              className="w-full h-10 mt-2 text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700"
              disabled={busy}
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Đăng nhập quyền Quản trị viên
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
