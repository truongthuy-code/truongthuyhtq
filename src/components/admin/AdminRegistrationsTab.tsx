import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Search, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import {
  AdminRegistrationRecord,
  approveTeacherAccount,
  rejectTeacherAccount,
} from "@/lib/adminService";
import { toast } from "sonner";

interface AdminRegistrationsTabProps {
  registrations: AdminRegistrationRecord[];
  onRefresh: () => Promise<void>;
}

export function AdminRegistrationsTab({ registrations, onRefresh }: AdminRegistrationsTabProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [approveTarget, setApproveTarget] = useState<AdminRegistrationRecord | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminRegistrationRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingCount = useMemo(
    () => registrations.filter((r) => r.status === "PENDING").length,
    [registrations]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return registrations.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.school_name || "").toLowerCase().includes(q) ||
        (r.subject_name || "").toLowerCase().includes(q)
      );
    });
  }, [registrations, statusFilter, query]);

  const handleConfirmApprove = async () => {
    if (!approveTarget) return;
    setBusy(true);
    const res = await approveTeacherAccount(approveTarget.teacher_id || approveTarget.id, {
      email: approveTarget.email,
      fullName: approveTarget.full_name,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã phê duyệt tài khoản giáo viên ${approveTarget.full_name}`);
      setApproveTarget(null);
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể phê duyệt tài khoản");
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget) return;
    setBusy(true);
    const res = await rejectTeacherAccount(
      rejectTarget.teacher_id || rejectTarget.id,
      rejectReason,
      { email: rejectTarget.email, fullName: rejectTarget.full_name }
    );
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã từ chối đăng ký của ${rejectTarget.full_name}`);
      setRejectTarget(null);
      setRejectReason("");
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể từ chối đăng ký");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border shadow-none flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "ALL", label: `Tất cả (${registrations.length})` },
            { key: "PENDING", label: `Chờ duyệt (${pendingCount})` },
            {
              key: "APPROVED",
              label: `Đã duyệt (${registrations.filter((r) => r.status === "APPROVED").length})`,
            },
            {
              key: "REJECTED",
              label: `Từ chối (${registrations.filter((r) => r.status === "REJECTED").length})`,
            },
          ].map((btn) => (
            <Button
              key={btn.key}
              size="sm"
              variant={statusFilter === btn.key ? "default" : "outline"}
              onClick={() => setStatusFilter(btn.key as any)}
              className="tabular-nums"
            >
              {btn.label}
            </Button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm họ tên, email, trường..."
            className="pl-9"
          />
        </div>
      </Card>

      <Card className="border shadow-none overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">STT</TableHead>
                <TableHead>Họ tên</TableHead>
                <TableHead>Email / Tên đăng nhập</TableHead>
                <TableHead>Trường học & Môn</TableHead>
                <TableHead>Ngày đăng ký</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                    Không có hồ sơ đăng ký nào khớp bộ lọc.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r, idx) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-bold text-sm">{r.full_name}</div>
                      {r.phone && <div className="text-xs text-muted-foreground">{r.phone}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.email}</div>
                      <div className="text-xs text-muted-foreground">@{r.username}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{r.school_name || "Chưa cập nhật"}</div>
                      <div className="text-xs text-muted-foreground">{r.subject_name || "Chưa chọn môn"}</div>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString("vi-VN")}
                    </TableCell>
                    <TableCell>
                      {r.status === "PENDING" ? (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 gap-1">
                          <Clock className="size-3" /> Chờ duyệt
                        </Badge>
                      ) : r.status === "APPROVED" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1">
                          <CheckCircle2 className="size-3" /> Đã duyệt
                        </Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="size-3" /> Từ chối
                          </Badge>
                          {r.rejection_reason && (
                            <div className="text-[11px] text-destructive max-w-[180px] truncate" title={r.rejection_reason}>
                              {r.rejection_reason}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status !== "APPROVED" && (
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => setApproveTarget(r)}
                          >
                            <CheckCircle2 className="size-3.5 mr-1" /> Phê duyệt
                          </Button>
                        )}
                        {r.status !== "REJECTED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => {
                              setRejectTarget(r);
                              setRejectReason(r.rejection_reason || "");
                            }}
                          >
                            <XCircle className="size-3.5 mr-1" /> Từ chối
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Approve Confirmation AlertDialog */}
      <AlertDialog open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <AlertDialogContent className="font-times-new-roman">
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận phê duyệt tài khoản Giáo viên</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn chắc chắn muốn phê duyệt cho giáo viên <strong>{approveTarget?.full_name}</strong> (
              {approveTarget?.email})? Sau khi duyệt, giáo viên này có thể đăng nhập và tạo đề thi, quản lý thư mục bình thường.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmApprove} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận phê duyệt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Reason Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>Từ chối đăng ký tài khoản Giáo viên</DialogTitle>
            <DialogDescription>
              Tài khoản <strong>{rejectTarget?.full_name}</strong> ({rejectTarget?.email}) sẽ không thể đăng nhập hệ thống.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-reason">Lý do từ chối</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ví dụ: Email không thuộc danh sách giáo viên của trường..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleConfirmReject} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
