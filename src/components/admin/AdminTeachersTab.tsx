import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Eye,
  Edit,
  Lock,
  Unlock,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Clock,
  Ban,
  Loader2,
} from "lucide-react";
import {
  AdminTeacherRecord,
  updateTeacherProfileByAdmin,
  lockTeacherAccount,
  unlockTeacherAccount,
  deleteTeacherAccount,
  approveTeacherAccount,
} from "@/lib/adminService";
import { SUBJECT_LIST } from "@/lib/subjects";
import { toast } from "sonner";

interface AdminTeachersTabProps {
  teachers: AdminTeacherRecord[];
  onRefresh: () => Promise<void>;
  onInspectTeacherData: (teacherId: string) => void;
}

export function AdminTeachersTab({
  teachers,
  onRefresh,
  onInspectTeacherData,
}: AdminTeachersTabProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "LOCKED" | "REJECTED">("ALL");

  const [detailTeacher, setDetailTeacher] = useState<AdminTeacherRecord | null>(null);
  const [editTeacher, setEditTeacher] = useState<AdminTeacherRecord | null>(null);
  const [eFullName, setEFullName] = useState("");
  const [eUsername, setEUsername] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eSchool, setESchool] = useState("");
  const [eSubject, setESubject] = useState("");

  const [lockTarget, setLockTarget] = useState<AdminTeacherRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminTeacherRecord | null>(null);
  const [deleteMode, setDeleteMode] = useState<"archive" | "hard">("archive");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teachers.filter((t) => {
      if (filter !== "ALL" && t.approval_status !== filter) return false;
      if (!q) return true;
      return (
        t.full_name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.username.toLowerCase().includes(q) ||
        (t.school_name || "").toLowerCase().includes(q) ||
        (t.subject_name || "").toLowerCase().includes(q)
      );
    });
  }, [teachers, filter, query]);

  const openEdit = (t: AdminTeacherRecord) => {
    setEditTeacher(t);
    setEFullName(t.full_name);
    setEUsername(t.username);
    setEPhone(t.phone || "");
    setESchool(t.school_name || "");
    setESubject(t.subject_name || "Tin học");
  };

  const handleSaveEdit = async () => {
    if (!editTeacher) return;
    if (!eFullName.trim() || !eUsername.trim()) {
      toast.error("Họ tên và tên đăng nhập không được để trống");
      return;
    }
    setBusy(true);
    const res = await updateTeacherProfileByAdmin(editTeacher.id, {
      fullName: eFullName.trim(),
      username: eUsername.trim().toLowerCase(),
      phone: ePhone.trim(),
      schoolName: eSchool.trim(),
      subjectName: eSubject.trim(),
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Đã cập nhật hồ sơ giáo viên");
      setEditTeacher(null);
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể cập nhật giáo viên");
    }
  };

  const handleConfirmLockToggle = async () => {
    if (!lockTarget) return;
    setBusy(true);
    const isLocked = lockTarget.approval_status === "LOCKED";
    const res = isLocked
      ? await unlockTeacherAccount(lockTarget.id)
      : await lockTeacherAccount(lockTarget.id, "Bị khóa bởi Super Admin");
    setBusy(false);
    if (res.ok) {
      toast.success(
        isLocked
          ? `Đã mở khóa tài khoản ${lockTarget.full_name}`
          : `Đã khóa tài khoản ${lockTarget.full_name} (toàn bộ đề thi và kết quả vẫn được giữ nguyên)`
      );
      setLockTarget(null);
      await onRefresh();
    } else {
      toast.error(res.error || "Thao tác thất bại");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const preserveData = deleteMode === "archive";
    const res = await deleteTeacherAccount(deleteTarget.id, preserveData);
    setBusy(false);
    if (res.ok) {
      toast.success(
        preserveData
          ? `Đã lưu trữ tài khoản ${deleteTarget.full_name} và bảo toàn đề thi, kết quả.`
          : `Đã xóa vĩnh viễn tài khoản ${deleteTarget.full_name} và dữ liệu liên quan.`
      );
      setDeleteTarget(null);
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể xóa tài khoản");
    }
  };

  const renderStatusBadge = (t: AdminTeacherRecord) => {
    switch (t.approval_status) {
      case "PENDING":
        return (
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 gap-1">
            <Clock className="size-3" /> Chờ duyệt
          </Badge>
        );
      case "LOCKED":
        return (
          <Badge variant="destructive" className="gap-1">
            <Lock className="size-3" /> Bị khóa
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="secondary" className="text-destructive gap-1">
            <Ban className="size-3" /> Từ chối
          </Badge>
        );
      default:
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1">
            <CheckCircle2 className="size-3" /> Đang hoạt động
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border shadow-none flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "ALL", label: "Tất cả" },
            { key: "PENDING", label: "Chờ duyệt" },
            { key: "APPROVED", label: "Đang hoạt động" },
            { key: "LOCKED", label: "Bị khóa" },
            { key: "REJECTED", label: "Từ chối" },
          ].map((btn) => (
            <Button
              key={btn.key}
              size="sm"
              variant={filter === btn.key ? "default" : "outline"}
              onClick={() => setFilter(btn.key as any)}
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
                <TableHead>Email</TableHead>
                <TableHead>Tên đăng nhập</TableHead>
                <TableHead>Trường học</TableHead>
                <TableHead>Ngày đăng ký</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                    Không tìm thấy tài khoản giáo viên nào.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t, idx) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-bold text-sm">{t.full_name}</div>
                      <div className="text-xs text-muted-foreground">{t.subject_name || "Chưa cập nhật môn"}</div>
                    </TableCell>
                    <TableCell className="text-sm">{t.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">@{t.username}</TableCell>
                    <TableCell className="text-sm">{t.school_name || "Chưa cập nhật"}</TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("vi-VN")}
                    </TableCell>
                    <TableCell>{renderStatusBadge(t)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Xem chi tiết"
                          onClick={() => setDetailTeacher(t)}
                        >
                          <Eye className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Quản lý dữ liệu giáo viên (Đề thi, thư mục, học sinh)"
                          onClick={() => onInspectTeacherData(t.id)}
                        >
                          <FolderOpen className="size-4 text-primary" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Chỉnh sửa thông tin"
                          onClick={() => openEdit(t)}
                        >
                          <Edit className="size-4" />
                        </Button>
                        {t.approval_status === "PENDING" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Phê duyệt nhanh"
                            onClick={async () => {
                              const r = await approveTeacherAccount(t.id, {
                                email: t.email,
                                fullName: t.full_name,
                              });
                              if (r.ok) {
                                toast.success(`Đã phê duyệt ${t.full_name}`);
                                await onRefresh();
                              } else {
                                toast.error(r.error || "Lỗi phê duyệt");
                              }
                            }}
                          >
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={t.approval_status === "LOCKED" ? "Mở khóa tài khoản" : "Khóa tài khoản"}
                            onClick={() => setLockTarget(t)}
                          >
                            {t.approval_status === "LOCKED" ? (
                              <Unlock className="size-4 text-emerald-600" />
                            ) : (
                              <Lock className="size-4 text-amber-600" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Xóa / Lưu trữ tài khoản"
                          onClick={() => {
                            setDeleteMode("archive");
                            setDeleteTarget(t);
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Teacher Detail Dialog */}
      <Dialog open={!!detailTeacher} onOpenChange={(o) => !o && setDetailTeacher(null)}>
        <DialogContent className="font-times-new-roman max-w-lg">
          <DialogHeader>
            <DialogTitle>Chi tiết tài khoản Giáo viên</DialogTitle>
            <DialogDescription>Thông tin hồ sơ và tổng quan dữ liệu đã tạo.</DialogDescription>
          </DialogHeader>
          {detailTeacher && (
            <div className="space-y-3 text-sm py-2">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg border bg-muted/20">
                <div>
                  <span className="text-xs text-muted-foreground block">Họ và tên</span>
                  <strong>{detailTeacher.full_name}</strong>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Trạng thái</span>
                  {renderStatusBadge(detailTeacher)}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Email</span>
                  <span>{detailTeacher.email}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Tên đăng nhập</span>
                  <span>@{detailTeacher.username}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Trường học</span>
                  <span>{detailTeacher.school_name || "Chưa cập nhật"}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Môn giảng dạy</span>
                  <span>{detailTeacher.subject_name || "Chưa cập nhật"}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Số điện thoại</span>
                  <span>{detailTeacher.phone || "Chưa cập nhật"}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Dữ liệu hiện có</span>
                  <span className="tabular-nums">
                    {detailTeacher.exam_count} đề thi • {detailTeacher.folder_count} thư mục
                  </span>
                </div>
              </div>
              {detailTeacher.rejection_reason && (
                <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs">
                  Lý do từ chối: {detailTeacher.rejection_reason}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailTeacher(null)}>
              Đóng
            </Button>
            {detailTeacher && (
              <Button
                onClick={() => {
                  const id = detailTeacher.id;
                  setDetailTeacher(null);
                  onInspectTeacherData(id);
                }}
              >
                <FolderOpen className="size-4 mr-1.5" /> Mở kho dữ liệu giáo viên
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Teacher Dialog */}
      <Dialog open={!!editTeacher} onOpenChange={(o) => !o && setEditTeacher(null)}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa thông tin Giáo viên</DialogTitle>
            <DialogDescription>Cập nhật hồ sơ trực tiếp trên cơ sở dữ liệu hệ thống.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Họ và tên *</Label>
              <Input value={eFullName} onChange={(e) => setEFullName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Tên đăng nhập *</Label>
              <Input value={eUsername} onChange={(e) => setEUsername(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Môn học giảng dạy</Label>
              <Select value={eSubject} onValueChange={setESubject}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_LIST.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                  {!SUBJECT_LIST.includes(eSubject) && eSubject && <SelectItem value={eSubject}>{eSubject}</SelectItem>}
                  <SelectItem value="Khác">Khác</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Trường học</Label>
              <Input value={eSchool} onChange={(e) => setESchool(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Số điện thoại</Label>
              <Input value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTeacher(null)} disabled={busy}>
              Hủy
            </Button>
            <Button onClick={handleSaveEdit} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Lưu cập nhật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock/Unlock AlertDialog */}
      <AlertDialog open={!!lockTarget} onOpenChange={(o) => !o && setLockTarget(null)}>
        <AlertDialogContent className="font-times-new-roman">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockTarget?.approval_status === "LOCKED"
                ? "Mở khóa tài khoản Giáo viên?"
                : "Khóa tài khoản Giáo viên?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockTarget?.approval_status === "LOCKED"
                ? `Mở khóa sẽ khôi phục hoàn toàn quyền đăng nhập và toàn bộ dữ liệu cũ cho ${lockTarget?.full_name}.`
                : `Khóa tài khoản ${lockTarget?.full_name} sẽ thu hồi quyền đăng nhập và chỉnh sửa đề thi. Toàn bộ đề thi, thư mục và kết quả học sinh vẫn được giữ nguyên an toàn.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLockToggle} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Teacher Choice Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>Xử lý xóa tài khoản Giáo viên</DialogTitle>
            <DialogDescription>
              Chọn phương án xử lý đối với tài khoản <strong>{deleteTarget?.full_name}</strong> ({deleteTarget?.email}).
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={deleteMode} onValueChange={(v) => setDeleteMode(v as any)} className="space-y-3 py-2">
            <label className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
              <RadioGroupItem value="archive" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold">Lưu trữ & vô hiệu hóa tài khoản (Khuyên dùng)</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Vô hiệu hóa đăng nhập nhưng vẫn giữ lại toàn bộ đề thi, thư mục và lịch sử kết quả của học sinh.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/30 cursor-pointer hover:bg-destructive/5">
              <RadioGroupItem value="hard" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold text-destructive">Xóa vĩnh viễn tài khoản & toàn bộ dữ liệu</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Xóa hoàn toàn tài khoản Auth, hồ sơ, thư mục, đề thi và toàn bộ bài nộp học sinh của giáo viên này. Không thể hoàn tác!
                </div>
              </div>
            </label>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận thực hiện
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
