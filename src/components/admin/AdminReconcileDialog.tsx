import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  DatabaseZap,
} from "lucide-react";
import {
  ReconcileReport,
  runTeacherReconciliationAudit,
  executeTeacherReconciliation,
} from "@/lib/adminService";
import { toast } from "sonner";

interface AdminReconcileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced: () => Promise<void>;
}

const GROUP_LABELS: Record<string, { label: string; tone: string }> = {
  A: { label: "Nhóm A (Đã chuẩn)", tone: "bg-emerald-600 text-white" },
  B: { label: "Nhóm B (Cũ bị PENDING)", tone: "bg-amber-600 text-white" },
  C: { label: "Nhóm C (Thiếu profile)", tone: "bg-orange-600 text-white" },
  D: { label: "Nhóm D (Thiếu trường/ẩn)", tone: "bg-sky-600 text-white" },
  E: { label: "Nhóm E (Lệch bảng)", tone: "bg-indigo-600 text-white" },
  F: { label: "Nhóm F (Đăng ký mới)", tone: "bg-slate-600 text-white" },
  G: { label: "Nhóm G (Khóa/Từ chối)", tone: "bg-rose-600 text-white" },
  UNRESOLVED: { label: "Chưa xử lý được", tone: "bg-destructive text-destructive-foreground" },
};

export function AdminReconcileDialog({ open, onOpenChange, onSynced }: AdminReconcileDialogProps) {
  const [auditing, setAuditing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [report, setReport] = useState<ReconcileReport | null>(null);

  const handleAudit = async () => {
    setAuditing(true);
    try {
      const res = await runTeacherReconciliationAudit();
      setReport(res);
      toast.success("Đã hoàn tất kiểm tra & đối soát toàn bộ nguồn tài khoản.");
    } catch (err: any) {
      toast.error(err?.message || "Không thể đối soát tài khoản giáo viên.");
    } finally {
      setAuditing(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    try {
      const res = await executeTeacherReconciliation();
      setReport(res);
      toast.success("Đã chạy đồng bộ idempotent & xác minh lại dữ liệu thành công!");
      await onSynced();
    } catch (err: any) {
      toast.error(err?.message || "Đồng bộ thất bại. Vui lòng kiểm tra cấu hình SQL/Service Role.");
    } finally {
      setExecuting(false);
    }
  };

  const handleExportCsv = () => {
    if (!report) return;
    const rows: string[] = [
      "Group,UserID,Email,FullName,MissingProfile,MissingRole,Exams,Folders,Status,Note",
    ];
    for (const d of report.discrepancies || []) {
      rows.push(
        [
          d.sync_group,
          d.user_id,
          `"${(d.email || "").replace(/"/g, '""')}"`,
          `"${(d.full_name || "").replace(/"/g, '""')}"`,
          d.missing_profile,
          d.missing_user_role,
          d.exam_count,
          d.folder_count,
          d.approval_status,
          `"${(d.sync_warning || "").replace(/"/g, '""')}"`,
        ].join(",")
      );
    }
    for (const e of report.unresolved_errors || []) {
      rows.push(
        [
          e.group,
          e.user_id,
          `"${(e.email || "").replace(/"/g, '""')}"`,
          "",
          "",
          "",
          "",
          "",
          "ERROR",
          `"${(e.reason || "").replace(/"/g, '""')}"`,
        ].join(",")
      );
    }
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doi-soat-giao-vien-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statsRows = report
    ? [
        { label: "Tổng số tài khoản trong Supabase Auth", value: report.stats.total_auth_users },
        { label: "Tổng số giáo viên trước đồng bộ", value: report.stats.total_teachers_before },
        { label: "Số tài khoản thiếu profile đã tạo bổ sung", value: report.stats.missing_profiles_created },
        { label: "Số tài khoản giáo viên cũ bị PENDING đã khôi phục ACTIVE", value: report.stats.legacy_pending_restored },
        { label: "Số tài khoản lệch trạng thái đã đồng bộ", value: report.stats.status_mismatch_synced },
        { label: "Số tài khoản đăng ký mới vẫn giữ PENDING", value: report.stats.new_pending_preserved },
        { label: "Số tài khoản bị khóa/từ chối vẫn giữ nguyên", value: report.stats.locked_rejected_preserved },
        { label: "Tổng số giáo viên hiển thị trong Super Admin sau đồng bộ", value: report.stats.total_teachers_after },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="font-times-new-roman max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseZap className="size-5 text-primary" />
            Đối soát & Đồng bộ Toàn bộ Tài khoản Giáo viên Cũ
          </DialogTitle>
          <DialogDescription>
            Quét toàn bộ nguồn dữ liệu (auth.users, profiles, user_roles, teacher_registrations, đề thi, thư mục)
            không giới hạn 1.000 dòng, phân loại nhóm A–G và đồng bộ idempotent bảo toàn tuyệt đối dữ liệu cũ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleAudit} disabled={auditing || executing} variant="outline" className="gap-1.5">
              {auditing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              1. Kiểm tra & Đối soát (Dry-run)
            </Button>
            <Button
              onClick={handleExecute}
              disabled={auditing || executing}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              {executing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              2. Chạy đồng bộ an toàn (Idempotent)
            </Button>
            {report && (
              <Button onClick={handleExportCsv} variant="ghost" size="sm" className="ml-auto gap-1.5">
                <Download className="size-4" /> Xuất báo cáo CSV
              </Button>
            )}
          </div>

          {!report && (
            <div className="p-6 border border-dashed rounded-xl text-center text-sm text-muted-foreground">
              Nhấn <strong>&ldquo;1. Kiểm tra &amp; Đối soát (Dry-run)&rdquo;</strong> để xem báo cáo phân loại chi tiết trước khi ghi dữ liệu.
            </div>
          )}

          {report && (
            <>
              {report.auth_users_accessible === false && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Lưu ý truy cập auth.users:</strong> Hệ thống đang chạy ở chế độ chưa có hàm RPC{" "}
                    <code>admin_reconcile_legacy_teachers</code> hoặc <code>SUPABASE_SERVICE_ROLE_KEY</code> trên server,
                    nên chưa đọc được trực tiếp bảng <code>auth.users</code>. Hãy chạy file migration{" "}
                    <code>20261121000000_reconcile_legacy_teachers.sql</code> trong Supabase SQL Editor để quét đủ 100% tài khoản Auth.
                  </div>
                </div>
              )}

              {report.applied && report.verification?.idempotent_clean && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  <span>
                    Đã đồng bộ &amp; xác minh vòng 2 thành công! Không còn tài khoản giáo viên cũ nào thiếu profile hoặc bị kẹt trạng thái.
                    {report.stats.total_students_skipped > 0 &&
                      ` (Đã bảo vệ & bỏ qua ${report.stats.total_students_skipped} tài khoản học sinh.)`}
                  </span>
                </div>
              )}

              {/* 8-row summary table */}
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chỉ tiêu đối soát</TableHead>
                      <TableHead className="text-right w-32">Số lượng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statsRows.map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="font-medium text-sm">{row.label}</TableCell>
                        <TableCell className="text-right font-bold tabular-nums">{row.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Group A-G pills */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {Object.entries(report.group_counts || {}).map(([g, cnt]) => {
                  const meta = GROUP_LABELS[g] || { label: g, tone: "bg-muted" };
                  return (
                    <Badge key={g} className={`${meta.tone} tabular-nums`}>
                      {meta.label}: {cnt}
                    </Badge>
                  );
                })}
              </div>

              {/* Unresolved / error list */}
              {report.unresolved_errors && report.unresolved_errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-destructive flex items-center gap-1.5">
                    <AlertTriangle className="size-4" />
                    Tài khoản chưa xử lý được / phát sinh lỗi ({report.unresolved_errors.length})
                  </h4>
                  <div className="border border-destructive/30 rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User ID</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Nhóm</TableHead>
                          <TableHead>Nguyên nhân</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.unresolved_errors.map((err) => (
                          <TableRow key={err.user_id}>
                            <TableCell className="font-mono text-xs">{err.user_id}</TableCell>
                            <TableCell className="text-xs">{err.email || "—"}</TableCell>
                            <TableCell className="text-xs">{err.group}</TableCell>
                            <TableCell className="text-xs text-destructive">{err.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Discrepancies preview */}
              {report.discrepancies && report.discrepancies.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold">
                    Chi tiết tài khoản cần lưu ý / lệch đồng bộ ({report.discrepancies.length})
                  </h4>
                  <div className="border rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nhóm</TableHead>
                          <TableHead>Email / Họ tên</TableHead>
                          <TableHead>Đề / Thư mục</TableHead>
                          <TableHead>Ghi chú đối soát</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.discrepancies.map((d) => {
                          const meta = GROUP_LABELS[d.sync_group] || { label: d.sync_group, tone: "bg-muted" };
                          return (
                            <TableRow key={d.user_id}>
                              <TableCell>
                                <Badge className={meta.tone}>{d.sync_group}</Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="font-semibold">{d.email || d.user_id}</div>
                                <div className="text-muted-foreground">{d.full_name}</div>
                              </TableCell>
                              <TableCell className="text-xs tabular-nums">
                                {d.exam_count} đề • {d.folder_count} thư mục
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {d.sync_warning || `Trạng thái: ${d.approval_status}`}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
