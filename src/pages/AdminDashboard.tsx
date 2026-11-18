import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  UserCheck,
  Users,
  FolderKanban,
  FileText,
  History,
  Settings,
  RefreshCw,
  Crown,
  Loader2,
  Home,
  LogOut,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SUPER_ADMIN_EMAIL } from "@/lib/teacherStorage";
import {
  AdminOverviewMetrics,
  AdminRegistrationRecord,
  AdminTeacherRecord,
  AdminActivityLogRecord,
  fetchAdminOverview,
  fetchAdminRegistrations,
  fetchAdminTeachers,
  fetchSystemExamsForAdmin,
  fetchAdminActivityLogs,
  invalidateAdminServiceCache,
} from "@/lib/adminService";
import { withRequestTimeout } from "@/lib/requestTimeout";
import { SystemExam } from "@/lib/allExamsStorage";
import { ExamFolder, getFolders } from "@/lib/folderStorage";
import MandatoryPasswordChange from "@/components/MandatoryPasswordChange";
import { AdminOverviewTab } from "@/components/admin/AdminOverviewTab";
import { AdminRegistrationsTab } from "@/components/admin/AdminRegistrationsTab";
import { AdminTeachersTab } from "@/components/admin/AdminTeachersTab";
import { AdminTeacherDataTab } from "@/components/admin/AdminTeacherDataTab";
import { AdminAllExamsTab } from "@/components/admin/AdminAllExamsTab";
import { AdminAuditLogsTab } from "@/components/admin/AdminAuditLogsTab";
import { AdminAccountSettingsTab } from "@/components/admin/AdminAccountSettingsTab";
import { toast } from "sonner";

type AdminTabKey =
  | "overview"
  | "registrations"
  | "teachers"
  | "teacher-data"
  | "exams"
  | "audit-logs"
  | "settings";

const EMPTY_METRICS: AdminOverviewMetrics = {
  totalTeachers: 0,
  pendingCount: 0,
  approvedCount: 0,
  lockedCount: 0,
  rejectedCount: 0,
  totalExams: 0,
  totalFolders: 0,
  totalSubmissions: 0,
};

export default function AdminDashboard() {
  const { user, isSuperAdmin, mustChangePassword, refreshProfile, signOut, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTabKey>("overview");
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [metrics, setMetrics] = useState<AdminOverviewMetrics>(EMPTY_METRICS);
  const [registrations, setRegistrations] = useState<AdminRegistrationRecord[]>([]);
  const [teachers, setTeachers] = useState<AdminTeacherRecord[]>([]);
  const [exams, setExams] = useState<SystemExam[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<ExamFolder[]>([]);
  const [logs, setLogs] = useState<AdminActivityLogRecord[]>([]);

  const loadAll = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else {
      setRefreshing(true);
      invalidateAdminServiceCache();
    }

    try {
      const [regs, tchs, sysExams, allFolders, actLogs] = await withRequestTimeout(
        Promise.all([
          fetchAdminRegistrations(),
          fetchAdminTeachers(false),
          fetchSystemExamsForAdmin(),
          getFolders(undefined, true),
          fetchAdminActivityLogs(250),
        ]),
        15000,
        "adminDashboard.loadAll"
      );

      const ov = await withRequestTimeout(
        fetchAdminOverview({
          teachers: tchs,
          exams: sysExams.exams,
          folders: allFolders,
        }),
        10000,
        "adminDashboard.overview"
      );

      setMetrics(ov);
      setRegistrations(regs);
      setTeachers(tchs);
      setExams(sysExams.exams);
      setSubmissionCounts(sysExams.submissionCounts);
      setFolders(allFolders);
      setLogs(actLogs);

      setSelectedTeacherId((prev) => {
        if (prev && tchs.some((t) => t.id === prev)) return prev;
        return tchs[0]?.id || "";
      });
    } catch {
      toast.error("Không thể tải dữ liệu quản trị hệ thống");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isSuperAdmin && !mustChangePassword) {
      loadAll(true);
    }
  }, [authLoading, isSuperAdmin, mustChangePassword, loadAll]);

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 font-times-new-roman">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="size-12 rounded-full bg-destructive/10 text-destructive grid place-items-center mx-auto">
            <ShieldAlert className="size-6" />
          </div>
          <h2 className="text-xl font-bold">Không có quyền truy cập</h2>
          <p className="text-sm text-muted-foreground">
            Khu vực này chỉ dành riêng cho tài khoản Super Admin duy nhất ({SUPER_ADMIN_EMAIL}).
          </p>
          <Button asChild className="w-full">
            <Link to="/">Quay lại trang chủ</Link>
          </Button>
        </Card>
      </div>
    );
  }

  if (mustChangePassword) {
    return (
      <MandatoryPasswordChange
        onSuccess={async () => {
          await refreshProfile();
          await loadAll(true);
        }}
      />
    );
  }

  const pendingCount = registrations.filter((r) => r.status === "PENDING").length || metrics.pendingCount;

  const navItems: {
    key: AdminTabKey;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  }[] = [
    { key: "overview", label: "Tổng quan", icon: LayoutDashboard },
    {
      key: "registrations",
      label: "Quản lý đăng ký",
      icon: UserCheck,
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    { key: "teachers", label: "Quản lý giáo viên", icon: Users },
    { key: "teacher-data", label: "Quản lý dữ liệu giáo viên", icon: FolderKanban },
    { key: "exams", label: "Quản lý đề thi toàn hệ thống", icon: FileText },
    { key: "audit-logs", label: "Nhật ký hoạt động", icon: History },
    { key: "settings", label: "Cài đặt tài khoản", icon: Settings },
  ];

  const activeNavMeta = navItems.find((n) => n.key === activeTab) || navItems[0];

  const handleInspectTeacherData = (teacherId: string) => {
    setSelectedTeacherId(teacherId);
    setActiveTab("teacher-data");
  };

  return (
    <div className="min-h-screen bg-muted/20 font-times-new-roman flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-amber-500/15 text-amber-700 grid place-items-center shrink-0">
              <Crown className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
                HỆ THỐNG QUẢN TRỊ VIÊN TOÀN QUYỀN (SUPER ADMIN)
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                <span>{user?.email || SUPER_ADMIN_EMAIL}</span>
                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("registrations")}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 text-amber-800 font-semibold hover:bg-amber-500/25 transition-colors tabular-nums"
                  >
                    {pendingCount} đăng ký chờ duyệt
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadAll(false)}
              disabled={refreshing || loading}
            >
              {refreshing || loading ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="size-4 mr-1.5" />
              )}
              <span className="hidden sm:inline">Làm mới dữ liệu</span>
            </Button>

            <Button size="sm" variant="outline" asChild>
              <Link to="/">
                <Home className="size-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Trang chủ</span>
              </Link>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => signOut({ redirectTo: "/auth" })}
              title="Đăng xuất"
            >
              <LogOut className="size-4 sm:mr-1.5" />
              <span className="hidden md:inline">Đăng xuất</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 flex-1 flex flex-col lg:flex-row gap-5">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-68 shrink-0">
          <Card className="p-2.5 border shadow-none sticky top-20 space-y-1">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-foreground/80 hover:bg-muted"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <Badge
                      variant={active ? "secondary" : "destructive"}
                      className="tabular-nums px-1.5 py-0 text-[11px]"
                    >
                      {item.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </Card>
        </aside>

        {/* Mobile/Tablet Horizontal Navigation */}
        <div className="lg:hidden overflow-x-auto pb-1">
          <div className="flex items-center gap-1.5 min-w-max">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <Button
                  key={item.key}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setActiveTab(item.key)}
                  className="gap-1.5 shrink-0"
                >
                  <item.icon className="size-3.5" />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <Badge variant={active ? "secondary" : "destructive"} className="tabular-nums px-1.5 py-0 text-[10px]">
                      {item.badge}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Workspace Panel */}
        <main className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <activeNavMeta.icon className="size-5 text-primary" />
              <h2 className="text-lg sm:text-xl font-bold">{activeNavMeta.label}</h2>
            </div>
          </div>

          {loading ? (
            <Card className="p-16 border shadow-none flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="size-7 animate-spin text-primary" />
              <span className="text-sm">Đang đồng bộ dữ liệu toàn hệ thống...</span>
            </Card>
          ) : (
            <>
              {activeTab === "overview" && (
                <AdminOverviewTab
                  metrics={metrics}
                  registrations={registrations}
                  recentExams={exams}
                  onNavigateTab={(tab) => setActiveTab(tab as AdminTabKey)}
                />
              )}

              {activeTab === "registrations" && (
                <AdminRegistrationsTab
                  registrations={registrations}
                  onRefresh={() => loadAll(false)}
                />
              )}

              {activeTab === "teachers" && (
                <AdminTeachersTab
                  teachers={teachers}
                  onRefresh={() => loadAll(false)}
                  onInspectTeacherData={handleInspectTeacherData}
                />
              )}

              {activeTab === "teacher-data" && (
                <AdminTeacherDataTab
                  teachers={teachers}
                  selectedTeacherId={selectedTeacherId}
                  onSelectTeacher={setSelectedTeacherId}
                  onGlobalRefresh={() => loadAll(false)}
                />
              )}

              {activeTab === "exams" && (
                <AdminAllExamsTab
                  exams={exams}
                  folders={folders}
                  teachers={teachers}
                  submissionCounts={submissionCounts}
                  onRefresh={() => loadAll(false)}
                />
              )}

              {activeTab === "audit-logs" && (
                <AdminAuditLogsTab logs={logs} onRefresh={() => loadAll(false)} />
              )}

              {activeTab === "settings" && <AdminAccountSettingsTab />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
