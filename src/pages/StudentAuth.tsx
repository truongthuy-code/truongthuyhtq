import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { toast } from "sonner";
import { GraduationCap, ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";

export default function StudentAuth() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const { student, login, register, logout } = useStudentAuth();
  const [tab, setTab] = useState<"login" | "signup">("login");

  // Login form state
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup form state
  const [fullName, setFullName] = useState("");
  const [className, setClassName] = useState("");
  const [signupAccount, setSignupAccount] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const redirectTo = location.state?.from || "/student";

  // If already logged in, show quick switch / continue
  if (student) {
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="p-8 max-w-md w-full text-center space-y-4">
          <div className="size-14 rounded-full bg-success/10 text-success grid place-items-center mx-auto text-2xl">
            <CheckCircle2 className="size-8" />
          </div>
          <h2 className="text-xl font-bold">Bạn đã đăng nhập</h2>
          <p className="text-sm text-muted-foreground">
            Tài khoản: <b>{student.fullName}</b> ({student.className})<br />
            Email / Tài khoản: <b>{student.account}</b>
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Button onClick={() => navigate(redirectTo)} className="w-full bg-gradient-primary">
              Vào trang tài khoản của tôi
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                logout();
              }}
            >
              Đăng nhập tài khoản khác
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = login(loginAccount, loginPassword);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error || "Đăng nhập thất bại");
      return;
    }
    toast.success("Đăng nhập thành công!");
    navigate(redirectTo, { replace: true });
  };

  const handleSignup = (e: React.FormEvent) => {
    e.preventDefault();
    if (signupPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp!");
      return;
    }
    setBusy(true);
    const res = register({
      fullName,
      className,
      account: signupAccount,
      password: signupPassword,
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error || "Đăng ký thất bại");
      return;
    }
    toast.success("Đăng ký tài khoản thành công!");
    navigate(redirectTo, { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
      <Card className="p-6 sm:p-8 w-full max-w-md shadow-card rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <Link
            to="/"
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5 mr-1" /> Về trang chủ
          </Link>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            Cổng Học Sinh
          </span>
        </div>

        {/* 3 Role buttons */}
        <div className="mb-4">
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-muted/60 rounded-xl">
            <Link
              to="/auth?role=teacher"
              className="py-1.5 px-2 rounded-lg font-bold text-xs text-center text-muted-foreground hover:text-foreground transition-all"
            >
              GIÁO VIÊN
            </Link>
            <span
              className="py-1.5 px-2 rounded-lg font-bold text-xs text-center bg-white text-primary shadow-sm ring-1 ring-primary/20"
            >
              HỌC SINH
            </span>
            <Link
              to="/auth?role=admin"
              className="py-1.5 px-2 rounded-lg font-bold text-xs text-center text-muted-foreground hover:text-foreground transition-all"
            >
              ADMIN
            </Link>
          </div>
        </div>

        <div className="text-center mb-6">
          <div className="size-12 rounded-xl bg-gradient-primary text-primary-foreground grid place-items-center mx-auto mb-3 shadow-soft">
            <GraduationCap className="size-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Tài Khoản Học Sinh</h1>
          <p className="text-xs font-semibold text-primary mt-1 uppercase tracking-wide">
            Tác giả: Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng
          </p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
            <ShieldCheck className="size-3.5 text-success inline" />
            Đăng ký & đăng nhập ngay — Không cần xác minh email
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
          <TabsList className="grid grid-cols-2 w-full rounded-xl">
            <TabsTrigger value="login" className="rounded-lg">Đăng nhập</TabsTrigger>
            <TabsTrigger value="signup" className="rounded-lg">Đăng ký mới</TabsTrigger>
          </TabsList>

          {/* ĐĂNG NHẬP */}
          <TabsContent value="login" className="mt-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label className="text-xs">Tài khoản hoặc Email</Label>
                <Input
                  required
                  placeholder="Nhập email hoặc tên tài khoản..."
                  value={loginAccount}
                  onChange={(e) => setLoginAccount(e.target.value)}
                  className="mt-1 rounded-xl"
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs">Mật khẩu</Label>
                <Input
                  type="password"
                  required
                  placeholder="Nhập mật khẩu..."
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full rounded-xl bg-gradient-primary shadow-soft">
                Đăng nhập
              </Button>
            </form>
          </TabsContent>

          {/* ĐĂNG KÝ */}
          <TabsContent value="signup" className="mt-4">
            <form onSubmit={handleSignup} className="space-y-3.5">
              <div>
                <Label className="text-xs">Họ và tên học sinh *</Label>
                <Input
                  required
                  placeholder="Ví dụ: Nguyễn Văn An"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs">Lớp học *</Label>
                <Input
                  required
                  placeholder="Ví dụ: 12A1, 11B2..."
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs">Email hoặc Tên tài khoản *</Label>
                <Input
                  required
                  placeholder="Ví dụ: an12a1@gmail.com hoặc nguyenvana"
                  value={signupAccount}
                  onChange={(e) => setSignupAccount(e.target.value)}
                  className="mt-1 rounded-xl"
                />
                <span className="text-[10px] text-muted-foreground mt-0.5 block">
                  Có thể dùng email hoặc tên tài khoản ngắn gọn tùy ý.
                </span>
              </div>
              <div>
                <Label className="text-xs">Mật khẩu *</Label>
                <Input
                  type="password"
                  required
                  minLength={4}
                  placeholder="Tối thiểu 4 ký tự..."
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs">Nhập lại mật khẩu *</Label>
                <Input
                  type="password"
                  required
                  minLength={4}
                  placeholder="Nhập lại mật khẩu..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 rounded-xl"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full rounded-xl bg-gradient-primary shadow-soft">
                Tạo tài khoản & Đăng nhập ngay
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t text-center text-xs text-muted-foreground">
          Bạn là Giáo viên?{" "}
          <Link to="/auth" className="text-primary font-medium hover:underline">
            Đăng nhập Giáo viên tại đây
          </Link>
        </div>
      </Card>
    </div>
  );
}
