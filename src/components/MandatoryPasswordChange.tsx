import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ShieldAlert,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  LogOut,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  hashPassword,
  getRootAdmin,
  changeAdminPassword,
  saveAdminAccount,
  SUPER_ADMIN_EMAIL,
} from "@/lib/teacherStorage";

interface MandatoryPasswordChangeProps {
  onSuccess?: () => void;
}

export default function MandatoryPasswordChange({ onSuccess }: MandatoryPasswordChangeProps) {
  const { user, session, signOut, refreshProfile } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDifferentFromDefault = newPassword.length > 0 && newPassword !== "123456";
  const hasMinLength = newPassword.length >= 6;
  const hasUpperCase = /[A-Z]/.test(newPassword);
  const hasLowerCase = /[a-z]/.test(newPassword);
  const hasDigitOrSpecial = /[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);
  const isMatching = newPassword.length > 0 && newPassword === confirmPassword;

  const isFormValid =
    currentPassword.length > 0 &&
    isDifferentFromDefault &&
    hasMinLength &&
    hasUpperCase &&
    hasLowerCase &&
    hasDigitOrSpecial &&
    isMatching;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword) {
      toast.error("Vui lòng nhập mật khẩu hiện tại");
      return;
    }

    if (!isDifferentFromDefault) {
      toast.error("Mật khẩu mới không được trùng với mật khẩu mặc định ban đầu!");
      return;
    }

    if (!hasMinLength) {
      toast.error("Mật khẩu mới phải có tối thiểu 6 ký tự");
      return;
    }

    if (!hasUpperCase || !hasLowerCase || !hasDigitOrSpecial) {
      toast.error("Mật khẩu mới phải bao gồm chữ hoa, chữ thường và ít nhất một chữ số hoặc ký tự đặc biệt");
      return;
    }

    if (!isMatching) {
      toast.error("Mật khẩu xác nhận không trùng khớp");
      return;
    }

    setBusy(true);

    try {
      const admin = getRootAdmin();
      const targetEmail = user?.email || SUPER_ADMIN_EMAIL;

      // Verify current password via Supabase Auth when session exists, or local hash fallback
      if (session?.access_token) {
        const { error: verifyErr } = await supabase.auth.signInWithPassword({
          email: targetEmail,
          password: currentPassword,
        });
        if (verifyErr) {
          toast.error("Mật khẩu hiện tại không chính xác.");
          setBusy(false);
          return;
        }

        const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
        if (updErr) {
          toast.error("Không thể cập nhật mật khẩu trên máy chủ: " + updErr.message);
          setBusy(false);
          return;
        }

        // Persist must_change_password = false via SECURITY DEFINER RPC and /api/admin fallback
        try {
          await (supabase as any).rpc("complete_super_admin_first_password_change");
        } catch {}

        try {
          await fetch("/api/admin", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              action: "change_super_admin_password",
              newPassword,
            }),
          });
        } catch {}
      } else {
        if (admin.passwordHash !== hashPassword(currentPassword)) {
          toast.error("Mật khẩu hiện tại không chính xác.");
          setBusy(false);
          return;
        }
      }

      changeAdminPassword(admin.id, newPassword);
      saveAdminAccount({
        ...admin,
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
      });

      await refreshProfile();

      toast.success("Đổi mật khẩu thành công! Chào mừng Super Admin đến với Bảng điều khiển.");
      setBusy(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.message || "Đã xảy ra lỗi khi đổi mật khẩu");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <Card className="max-w-xl w-full p-6 sm:p-8 bg-card border-amber-500/30 shadow-2xl rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />

        <div className="text-center space-y-3 mb-6">
          <div className="mx-auto size-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 grid place-items-center text-amber-600 dark:text-amber-400 shadow-sm">
            <Lock className="size-7" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500/10 text-rose-600 border border-rose-500/20 mb-2">
              <ShieldAlert className="size-3.5" /> Bắt buộc đổi mật khẩu lần đầu
            </span>
            <h2 className="text-2xl font-black tracking-tight text-foreground">
              ĐỔI MẬT KHẨU SUPER ADMIN
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Tài khoản Quản trị viên đang sử dụng mật khẩu khởi tạo mặc định. Vui lòng thiết lập mật khẩu an toàn mới để bảo vệ toàn bộ hệ thống.
            </p>
          </div>
        </div>

        <div className="mb-6 p-3.5 bg-muted/50 rounded-xl border border-border text-xs flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-muted-foreground">Tài khoản Quản trị:</span>{" "}
            <span className="font-bold text-foreground">{user?.email || SUPER_ADMIN_EMAIL}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600" />
            <span className="font-semibold text-emerald-600">SUPER_ADMIN</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="curr-pass" className="text-xs font-bold">
              Mật khẩu hiện tại *
            </Label>
            <div className="relative">
              <Input
                id="curr-pass"
                type={showCurrent ? "text" : "password"}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                className="h-11 pr-10 rounded-xl font-mono text-sm"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-pass" className="text-xs font-bold">
              Mật khẩu mới *
            </Label>
            <div className="relative">
              <Input
                id="new-pass"
                type={showNew ? "text" : "password"}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Thiết lập mật khẩu an toàn mới"
                className="h-11 pr-10 rounded-xl font-mono text-sm"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conf-pass" className="text-xs font-bold">
              Xác nhận mật khẩu mới *
            </Label>
            <div className="relative">
              <Input
                id="conf-pass"
                type={showConfirm ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                className="h-11 pr-10 rounded-xl font-mono text-sm"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="p-3 bg-muted/40 rounded-xl space-y-1.5 text-xs border border-border/60">
            <div className="font-semibold text-muted-foreground mb-1">Yêu cầu bảo mật mật khẩu mới:</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <div className={`flex items-center gap-1.5 ${isDifferentFromDefault ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {isDifferentFromDefault ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Khác mật khẩu mặc định</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {hasMinLength ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Tối thiểu 6 ký tự</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasUpperCase ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {hasUpperCase ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Có ít nhất 1 chữ hoa (A-Z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasLowerCase ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {hasLowerCase ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Có ít nhất 1 chữ thường (a-z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${hasDigitOrSpecial ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {hasDigitOrSpecial ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Có chữ số hoặc ký tự đặc biệt</span>
              </div>
              <div className={`flex items-center gap-1.5 ${isMatching ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                {isMatching ? <CheckCircle2 className="size-3.5 shrink-0" /> : <XCircle className="size-3.5 shrink-0" />}
                <span>Hai lần nhập khớp nhau</span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => signOut()}
              className="sm:w-1/3 h-11 rounded-xl"
              disabled={busy}
            >
              <LogOut className="size-4 mr-2" /> Đăng xuất
            </Button>

            <Button
              type="submit"
              disabled={!isFormValid || busy}
              className="sm:w-2/3 h-11 rounded-xl bg-gradient-to-r from-amber-600 to-primary font-bold shadow-md hover:shadow-lg transition-all"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> Đang cập nhật...
                </>
              ) : (
                <>
                  <KeyRound className="size-4 mr-2" /> Lưu mật khẩu & Vào Dashboard
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
