import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "./DashboardLayout";
import ProfileCompletionGate from "./ProfileCompletionGate";

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="container py-20 text-center text-muted-foreground">Đang tải…</div>;
  if (!user) return <Navigate to="/auth" state={{ from: loc.pathname }} replace />;
  return <DashboardLayout><ProfileCompletionGate>{children}</ProfileCompletionGate></DashboardLayout>;
}

