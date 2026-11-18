import { FormEvent, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Crown, KeyRound, LogOut, ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SUPER_ADMIN_EMAIL } from "@/lib/teacherStorage";
import { changeSuperAdminPassword } from "@/lib/adminService";
import { toast } from "sonner";

export function AdminAccountSettingsTab() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error("Vui lòng nhập mật khẩu hiện tại");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast.error("Mật khẩu mới phải có ít nhất 6 ký tự");
      return;
    }
    if (newPassword === "123456") {
      toast.error("Không được sử dụng lại mật khẩu mặc định 123456");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Mật khẩu xác nhận không khớp");
      return;
    }

    setSaving(true);
    const res = await changeSuperAdminPassword(currentPassword, newPassword);
    setSaving(false);

    if (res.ok) {
      toast.success("Đã cập nhật mật khẩu Super Admin thành công");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshProfile();
    } else {
      toast.error(res.error || "Không thể đổi mật khẩu");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-6 border shadow-none space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-amber-500/15 text-amber-700 grid place-items-center shrink-0">
              <Crown className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">{profile?.full_name || "Trương Thị Bích Thủy"}</h3>
              <div className="text-xs text-muted-foreground">{user?.email || SUPER_ADMIN_EMAIL}</div>
            </div>
          </div>
          <Badge className="bg-amber-600 hover:bg-amber-600">SUPER ADMIN DUY NHẤT</Badge>
        </div>

        <div className="p-4 rounded-lg border bg-muted/20 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email quản trị hệ thống:</span>
            <strong className="font-mono text-xs">{SUPER_ADMIN_EMAIL}</strong>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Quyền hạn:</span>
            <span className="font-semibold text-emerald-700 flex items-center gap-1">
              <ShieldCheck className="size-4" /> Toàn quyền hệ thống
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Trạng thái phiên đăng nhập:</span>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
              Đang hoạt động
            </Badge>
          </div>
        </div>

        <div className="pt-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => signOut({ redirectTo: "/auth" })}
          >
            <LogOut className="size-4 mr-2" /> Đăng xuất khỏi tài khoản Quản trị viên
          </Button>
        </div>
      </Card>

      <Card className="p-6 border shadow-none space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-primary" />
          <div>
            <h3 className="text-base font-bold">Đổi mật khẩu Super Admin</h3>
            <p className="text-xs text-muted-foreground">
              Cập nhật mật khẩu mới trực tiếp trên Supabase Auth và đồng bộ bảo mật hệ thống.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sa-cur-pwd">Mật khẩu hiện tại</Label>
            <div className="relative">
              <Input
                id="sa-cur-pwd"
                type={showPwd ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                required
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sa-new-pwd">Mật khẩu mới</Label>
            <Input
              id="sa-new-pwd"
              type={showPwd ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Ít nhất 6 ký tự (khác 123456)"
              required
              minLength={6}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sa-conf-pwd">Xác nhận mật khẩu mới</Label>
            <Input
              id="sa-conf-pwd"
              type={showPwd ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
              required
            />
          </div>

          <Button type="submit" disabled={saving} className="w-full sm:w-auto">
            {saving && <Loader2 className="size-4 mr-2 animate-spin" />} Cập nhật mật khẩu
          </Button>
        </form>
      </Card>
    </div>
  );
}
