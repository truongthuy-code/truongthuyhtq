import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Search, Eye, Edit, Lock, Unlock, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { SystemExam, getParsedQuestions } from "@/lib/allExamsStorage";
import { ExamFolder, getFolderBreadcrumbLabel } from "@/lib/folderStorage";
import {
  AdminTeacherRecord,
  getExamCodeBadgeForAdmin,
  saveExamByAdmin,
  deleteExamByAdmin,
  toggleExamLockByAdmin,
} from "@/lib/adminService";
import { AdminExamEditorModal } from "@/components/admin/AdminExamEditorModal";
import { toast } from "sonner";

interface AdminAllExamsTabProps {
  exams: SystemExam[];
  folders: ExamFolder[];
  teachers: AdminTeacherRecord[];
  submissionCounts: Record<string, number>;
  onRefresh: () => Promise<void>;
}

export function AdminAllExamsTab({
  exams,
  folders,
  teachers,
  submissionCounts,
  onRefresh,
}: AdminAllExamsTabProps) {
  const [query, setQuery] = useState("");
  const [teacherFilter, setTeacherFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");

  const [editingExam, setEditingExam] = useState<SystemExam | null>(null);
  const [editorInitialTab, setEditorInitialTab] = useState<"settings" | "questions" | "preview">("settings");
  const [deleteTarget, setDeleteTarget] = useState<SystemExam | null>(null);
  const [deleteMode, setDeleteMode] = useState<"archive" | "hard">("archive");
  const [busy, setBusy] = useState(false);

  const teacherNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teachers) {
      map.set(t.id, t.full_name);
    }
    return map;
  }, [teachers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exams.filter((ex) => {
      if (teacherFilter !== "ALL" && ex.created_by !== teacherFilter) return false;
      if (statusFilter === "OPEN" && ex.manual_closed) return false;
      if (statusFilter === "CLOSED" && !ex.manual_closed) return false;
      if (!q) return true;
      const code = getExamCodeBadgeForAdmin(ex).toLowerCase();
      const tName = (ex.created_by ? teacherNameMap.get(ex.created_by) : "") || ex.teacher_name || "";
      return (
        ex.title.toLowerCase().includes(q) ||
        (ex.subject_name || "").toLowerCase().includes(q) ||
        tName.toLowerCase().includes(q) ||
        code.includes(q)
      );
    });
  }, [exams, teacherFilter, statusFilter, query, teacherNameMap]);

  const handleToggleLock = async (ex: SystemExam) => {
    const res = await toggleExamLockByAdmin(ex);
    if (res.ok) {
      toast.success(res.nextState ? `Đã khóa đề thi "${ex.title}"` : `Đã mở đề thi "${ex.title}"`);
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể thay đổi trạng thái đề thi");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    const hardDelete = deleteMode === "hard";
    const res = await deleteExamByAdmin(deleteTarget.id, hardDelete);
    setBusy(false);
    if (res.ok) {
      toast.success(
        hardDelete
          ? `Đã xóa vĩnh viễn đề thi "${deleteTarget.title}"`
          : `Đã lưu trữ & ẩn đề thi "${deleteTarget.title}" (giữ nguyên kết quả học sinh)`
      );
      setDeleteTarget(null);
      await onRefresh();
    } else {
      toast.error(res.error || "Không thể xóa đề thi");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 border shadow-none flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={teacherFilter} onValueChange={setTeacherFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Lọc theo giáo viên" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả giáo viên</SelectItem>
              {teachers.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
              <SelectItem value="OPEN">Đang mở</SelectItem>
              <SelectItem value="CLOSED">Đã khóa</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên đề, mã 6 số, môn, giáo viên..."
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
                <TableHead>Tên đề thi</TableHead>
                <TableHead>Giáo viên tạo</TableHead>
                <TableHead>Môn học & Thời gian</TableHead>
                <TableHead>Mã đề & Số câu</TableHead>
                <TableHead>Lượt nộp</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                    Không tìm thấy đề thi nào phù hợp.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((ex, idx) => {
                  const parsed = getParsedQuestions(ex.questions);
                  const totalQ = parsed.partI.length + parsed.partII.length + parsed.partIII.length;
                  const tName = (ex.created_by ? teacherNameMap.get(ex.created_by) : "") || ex.teacher_name || "Giáo viên";
                  const subCount = submissionCounts[ex.id] || 0;
                  const folderPath = ex.folder_id ? getFolderBreadcrumbLabel(folders, ex.folder_id) : "";
                  const code = getExamCodeBadgeForAdmin(ex);

                  return (
                    <TableRow key={ex.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <div className="font-bold text-sm max-w-[260px] truncate" title={ex.title}>
                          {ex.title}
                        </div>
                        {folderPath && (
                          <div className="text-xs text-muted-foreground max-w-[260px] truncate">
                            Thư mục: {folderPath}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{tName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="text-foreground font-medium">{ex.subject_name || "Chưa phân loại"}</div>
                        <div className="tabular-nums">{ex.duration_minutes} phút</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="font-mono tabular-nums text-[11px]">
                            {code}
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">{totalQ} câu</span>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums font-medium text-sm">{subCount}</TableCell>
                      <TableCell>
                        <Badge variant={ex.manual_closed ? "destructive" : "secondary"}>
                          {ex.manual_closed ? "Đã khóa" : "Đang mở"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Xem trước nội dung đề"
                            onClick={() => {
                              setEditorInitialTab("preview");
                              setEditingExam(ex);
                            }}
                          >
                            <Eye className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Chỉnh sửa toàn bộ đề thi"
                            onClick={() => {
                              setEditorInitialTab("questions");
                              setEditingExam(ex);
                            }}
                          >
                            <Edit className="size-4 text-primary" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={ex.manual_closed ? "Mở lại đề" : "Khóa đề"}
                            onClick={() => handleToggleLock(ex)}
                          >
                            {ex.manual_closed ? (
                              <Unlock className="size-4 text-emerald-600" />
                            ) : (
                              <Lock className="size-4 text-amber-600" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Xóa / Lưu trữ đề"
                            onClick={() => {
                              setDeleteMode(subCount > 0 ? "archive" : "hard");
                              setDeleteTarget(ex);
                            }}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <AdminExamEditorModal
        open={!!editingExam}
        onOpenChange={(o) => !o && setEditingExam(null)}
        exam={editingExam}
        folders={folders}
        initialTab={editorInitialTab}
        onSave={async (updated) => {
          const res = await saveExamByAdmin(updated);
          if (res.ok) await onRefresh();
          return res;
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa đề thi toàn hệ thống</DialogTitle>
            <DialogDescription>
              Đề thi <strong>{deleteTarget?.title}</strong>
              {deleteTarget && (submissionCounts[deleteTarget.id] || 0) > 0 && (
                <span className="block mt-1 text-amber-700 font-semibold">
                  Cảnh báo: Đề thi này đã có {submissionCounts[deleteTarget.id]} lượt nộp bài của học sinh.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={deleteMode} onValueChange={(v) => setDeleteMode(v as any)} className="space-y-3 py-2">
            <label className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
              <RadioGroupItem value="archive" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold">Lưu trữ & ẩn đề thi (Khuyên dùng)</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Ngừng cho học sinh làm bài nhưng vẫn bảo toàn lịch sử bài nộp và điểm số đã chấm.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/30 cursor-pointer hover:bg-destructive/5">
              <RadioGroupItem value="hard" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold text-destructive flex items-center gap-1">
                  <AlertTriangle className="size-3.5" /> Xóa vĩnh viễn đề thi & kết quả
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Xóa hoàn toàn đề thi và toàn bộ bài nộp học sinh thuộc đề thi này.
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
