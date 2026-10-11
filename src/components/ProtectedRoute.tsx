import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "./DashboardLayout";
import ProfileCompletionGate from "./ProfileCompletionGate";
import MandatoryPasswordChange from "./MandatoryPasswordChange";
import { toast } from "sonner";
import { useEffect } from "react";

interface ProtectedRouteProps {
  children: JSX.Element;
  requireAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { user, isAdmin, loading, mustChangePassword, refreshProfile } = useAuth();
  const loc = useLocation();

  useEffect(() => {
    if (!loading && user && requireAdmin && !isAdmin) {
      toast.error("Bạn không có quyền truy cập khu vực Quản trị viên!");
    }
  }, [loading, user, requireAdmin, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Đang kiểm tra quyền truy cập…
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  }

  // If requires Admin but user is not admin, deny and redirect to teacher home
  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  // Mandatory password change gate (Admin must change initial password before proceeding)
  if (mustChangePassword) {
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
