import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "./DashboardLayout";
import ProfileCompletionGate from "./ProfileCompletionGate";
import MandatoryPasswordChange from "./MandatoryPasswordChange";
import { toast } from "sonner";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Ban, LogOut, ShieldAlert, WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { SUPER_ADMIN_EMAIL } from "@/lib/teacherStorage";

interface ProtectedRouteProps {
  children: JSX.Element;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const {
    user,
    isSuperAdmin,
    approvalStatus,
    rejectionReason,
    accountBlockReason,
    loading,
    authError,
    mustChangePassword,
    refreshProfile,
    retryAuth,
    signOut,
  } = useAuth();
  const loc = useLocation();

  useEffect(() => {
    if (!loading && !authError && user && requireAdmin && !isSuperAdmin) {
      toast.error("Bạn không có quyền truy cập khu vực Quản trị viên (Super Admin)!");
    }
  }, [loading, authError, user, requireAdmin, isSuperAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm p-4">
        <Loader2 className="size-6 animate-spin text-primary" />
        <span>Đang kiểm tra quyền truy cập…</span>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="max-w-md w-full p-6 sm:p-8 text-center space-y-4 border shadow-soft">
          <div className="mx-auto size-14 rounded-2xl grid place-items-center bg-destructive/10 text-destructive">
            <WifiOff className="size-7" />
          </div>

          <h2 className="text-xl font-bold">Không thể kiểm tra quyền truy cập</h2>

          <p className="text-sm text-muted-foreground leading-relaxed">{authError}</p>

          <div className="pt-2 flex flex-col gap-2">
            <Button onClick={() => void retryAuth()} className="w-full bg-gradient-primary">
              <RefreshCw className="size-4 mr-2" /> Thử lại
            </Button>
            <Button
              onClick={() => void signOut({ redirectTo: "/auth" })}
              className="w-full"
              variant="outline"
            >
              <LogOut className="size-4 mr-2" /> Quay lại trang đăng nhập
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  }

  // Enforce approval & lock status for non-Super-Admin teacher accounts
  if (!isSuperAdmin && approvalStatus && approvalStatus !== "APPROVED") {
    const isPending = approvalStatus === "PENDING";
    const isRejected = approvalStatus === "REJECTED";
    return (
      <div className="min-h-screen bg-gradient-soft grid place-items-center p-4">
        <Card className="max-w-md w-full p-6 sm:p-8 text-center space-y-4 border shadow-soft">
          <div
            className={`mx-auto size-14 rounded-2xl grid place-items-center ${
              isPending ? "bg-amber-500/10 text-amber-600" : "bg-destructive/10 text-destructive"
            }`}
          >
            {isPending ? <Clock className="size-7" /> : isRejected ? <Ban className="size-7" /> : <ShieldAlert className="size-7" />}
          </div>

          <h2 className="text-xl font-bold">
            {isPending
              ? "Tài khoản đang chờ phê duyệt"
              : isRejected
                ? "Tài khoản chưa được phê duyệt"
                : "Tài khoản đã bị khóa"}
          </h2>

          <p className="text-sm text-muted-foreground leading-relaxed">
            {accountBlockReason ||
              (isPending
                ? `Tài khoản giáo viên của bạn đã được đăng ký và đang chờ Quản trị viên (${SUPER_ADMIN_EMAIL}) phê duyệt.`
                : isRejected
                  ? "Yêu cầu đăng ký tài khoản của bạn đã bị từ chối."
                  : "Tài khoản của bạn hiện đang bị tạm khóa.")}
          </p>

          {rejectionReason && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs font-medium text-left">
              Lý do từ chối: {rejectionReason}
            </div>
          )}

          <div className="pt-2">
            <Button onClick={() => signOut({ redirectTo: "/auth" })} className="w-full" variant="outline">
              <LogOut className="size-4 mr-2" /> Đăng xuất & Quay lại trang đăng nhập
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (requireAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  if (isSuperAdmin && mustChangePassword) {
    return (
      <MandatoryPasswordChange
        onSuccess={() => {
          refreshProfile();
        }}
      />
    );
  }

  return (
    <DashboardLayout>
      <ProfileCompletionGate>{children}</ProfileCompletionGate>
    </DashboardLayout>
  );
}
