import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { KeyRound, Loader2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import {
  hashPassword,
  getTeacherById,
  upsertTeacher,
  getAdminAccount,
  saveAdminAccount,
  getCurrentAuthUser,
} from "@/lib/teacherStorage";
import { supabase } from "@/integrations/supabase/client";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { user, isAdmin } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error("Vui lòng nhập mật khẩu hiện tại");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }
    if (currentPassword === newPassword) {
      toast.error("Mật khẩu mới không được trùng mật khẩu cũ");
      return;
    }

    setBusy(true);

    try {
      const authUser = getCurrentAuthUser();

      // Case 1: Custom local teacher/admin account
      if (authUser) {
        if (isAdmin) {
          const adm = getAdminAccount();
          if (adm.passwordHash !== hashPassword(currentPassword)) {
            toast.error("Mật khẩu hiện tại không đúng");
            setBusy(false);
            return;
          }
          adm.passwordHash = hashPassword(newPassword);
          saveAdminAccount(adm);
          toast.success("Đổi mật khẩu Quản trị viên thành công!");
          resetForm();
          onOpenChange(false);
          setBusy(false);
          return;
        } else {
          const teacher = getTeacherById(authUser.id);
          if (!teacher) {
            toast.error("Không tìm thấy thông tin tài khoản giáo viên");
            setBusy(false);
            return;
          }
          if (teacher.passwordHash !== hashPassword(currentPassword)) {
            toast.error("Mật khẩu hiện tại không chính xác");
            setBusy(false);
            return;
          }
          teacher.passwordHash = hashPassword(newPassword);
          upsertTeacher(teacher);
          toast.success("Đổi mật khẩu thành công!");
          resetForm();
          onOpenChange(false);
          setBusy(false);
          return;
        }
      }

      // Case 2: Supabase Auth account
      const { error: reAuthError } = await supabase.auth.signInWithPassword({
        email: user?.email || "",
        password: currentPassword,
      });
      if (reAuthError) {
        toast.error("Mật khẩu hiện tại không chính xác");
        setBusy(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        toast.error("Lỗi cập nhật mật khẩu: " + updateError.message);
      } else {
        toast.success("Đổi mật khẩu thành công!");
        resetForm();
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message || "Không thể đổi mật khẩu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <KeyRound className="size-5 text-primary" /> Đổi mật khẩu
          </DialogTitle>
          <DialogDescription>
            Bảo vệ tài khoản bằng mật khẩu an toàn (ít nhất 6 ký tự). Mật khẩu được mã hóa an toàn và không lưu dưới dạng văn bản thô.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="curr-pass">Mật khẩu hiện tại *</Label>
            <div className="relative">
              <Input
                id="curr-pass"
                type={showCurrent ? "text" : "password"}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Nhập mật khẩu đang dùng"
                className="pr-10"
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

          <div className="space-y-1">
            <Label htmlFor="new-pass">Mật khẩu mới *</Label>
            <div className="relative">
              <Input
                id="new-pass"
                type={showNew ? "text" : "password"}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                className="pr-10"
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

          <div className="space-y-1">
            <Label htmlFor="conf-pass">Xác nhận mật khẩu mới *</Label>
            <Input
              id="conf-pass"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
            />
          </div>

          <div className="p-3 bg-muted/40 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary shrink-0" />
            <span>Mật khẩu được băm và mã hóa tự động trước khi lưu trữ, đảm bảo an toàn tuyệt đối.</span>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button type="submit" disabled={busy} className="bg-gradient-primary">
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận đổi mật khẩu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
