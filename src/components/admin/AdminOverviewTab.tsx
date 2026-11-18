import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Clock,
  CheckCircle2,
  Lock,
  Ban,
  FileText,
  FolderTree,
  GraduationCap,
  ArrowRight,
  UserCheck,
} from "lucide-react";
import { AdminOverviewMetrics, AdminRegistrationRecord } from "@/lib/adminService";
import { SystemExam } from "@/lib/allExamsStorage";

interface AdminOverviewTabProps {
  metrics: AdminOverviewMetrics;
  registrations: AdminRegistrationRecord[];
  recentExams: SystemExam[];
  onNavigateTab: (tab: string) => void;
}

export function AdminOverviewTab({
  metrics,
  registrations,
  recentExams,
  onNavigateTab,
}: AdminOverviewTabProps) {
  const pendingList = registrations.filter((r) => r.status === "PENDING").slice(0, 5);

  const statCards = [
    {
      label: "Tổng số giáo viên",
      value: metrics.totalTeachers,
      icon: Users,
      tone: "text-sky-700 bg-sky-500/10",
    },
    {
      label: "Đang chờ phê duyệt",
      value: metrics.pendingCount,
      icon: Clock,
      tone: "text-amber-700 bg-amber-500/10",
    },
    {
      label: "Đang hoạt động",
      value: metrics.approvedCount,
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-500/10",
    },
    {
      label: "Tài khoản bị khóa",
      value: metrics.lockedCount,
      icon: Lock,
      tone: "text-rose-700 bg-rose-500/10",
    },
    {
      label: "Bị từ chối",
      value: metrics.rejectedCount,
      icon: Ban,
      tone: "text-slate-700 bg-slate-500/10",
    },
    {
      label: "Tổng số đề thi",
      value: metrics.totalExams,
      icon: FileText,
      tone: "text-indigo-700 bg-indigo-500/10",
    },
    {
      label: "Tổng số thư mục",
      value: metrics.totalFolders,
      icon: FolderTree,
      tone: "text-teal-700 bg-teal-500/10",
    },
    {
      label: "Lượt học sinh nộp bài",
      value: metrics.totalSubmissions,
      icon: GraduationCap,
      tone: "text-purple-700 bg-purple-500/10",
    },
  ];

  return (
    <div className="space-y-6">
      {metrics.pendingCount > 0 && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-amber-500/15 text-amber-700 grid place-items-center shrink-0">
              <UserCheck className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Có {metrics.pendingCount} giáo viên mới đang chờ phê duyệt
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tài khoản giáo viên mới chỉ có thể đăng nhập và tạo đề thi sau khi được Super Admin xét duyệt.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => onNavigateTab("registrations")} className="shrink-0">
            Xét duyệt ngay <ArrowRight className="size-4 ml-1.5" />
          </Button>
        </Card>
      )}

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {statCards.map((c) => (
          <Card key={c.label} className="p-4 border shadow-none hover:border-primary/40 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${c.tone}`}>
                <c.icon className="size-4" />
              </div>
            </div>
            <div className="text-2xl font-bold mt-2 tabular-nums text-foreground">{c.value}</div>
          </Card>
        ))}
      </div>

      {/* Quick Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 border shadow-none space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Hồ sơ đăng ký chờ duyệt</h3>
            <Button variant="ghost" size="sm" onClick={() => onNavigateTab("registrations")}>
              Xem tất cả
            </Button>
          </div>

          {pendingList.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground border rounded-lg border-dashed">
              Hiện không có đăng ký giáo viên nào đang chờ duyệt.
            </div>
          ) : (
            <div className="space-y-2">
              {pendingList.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-lg border flex items-center justify-between gap-3 bg-muted/15"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.email} • {r.school_name || "Chưa cập nhật trường"}
                    </div>
                  </div>
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700 shrink-0">
                    Chờ duyệt
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 border shadow-none space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold">Đề thi mới tạo toàn hệ thống</h3>
            <Button variant="ghost" size="sm" onClick={() => onNavigateTab("exams")}>
              Quản lý đề thi
            </Button>
          </div>

          {recentExams.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground border rounded-lg border-dashed">
              Chưa có đề thi nào trong hệ thống.
            </div>
          ) : (
            <div className="space-y-2">
              {recentExams.slice(0, 5).map((ex) => (
                <div
                  key={ex.id}
                  className="p-3 rounded-lg border flex items-center justify-between gap-3 bg-muted/15"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">{ex.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {ex.teacher_name || "Giáo viên"} • {ex.subject_name || "Chưa phân loại"} •{" "}
                      <span className="tabular-nums">{ex.duration_minutes} phút</span>
                    </div>
                  </div>
                  <Badge variant={ex.manual_closed ? "destructive" : "secondary"} className="shrink-0">
                    {ex.manual_closed ? "Đã khóa" : "Đang mở"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
