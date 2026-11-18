import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  FileText,
  FolderTree,
  Link2,
  GraduationCap,
  BookOpen,
  Edit,
  Eye,
  Lock,
  Unlock,
  Trash2,
  FolderPlus,
  Plus,
  Copy,
  RefreshCw,
  Loader2,
  AlertTriangle,
  School,
  CheckCircle2,
  Ban,
  Clock,
} from "lucide-react";
import {
  AdminTeacherRecord,
  TeacherDataBundle,
  fetchTeacherDataBundle,
  saveExamByAdmin,
  deleteExamByAdmin,
  toggleExamLockByAdmin,
  saveFolderByAdmin,
  deleteFolderByAdmin,
  getExamCodeBadgeForAdmin,
} from "@/lib/adminService";
import { SystemExam, getParsedQuestions } from "@/lib/allExamsStorage";
import {
  ExamFolder,
  FOLDER_COLOR_PRESETS,
  buildFolderTreeOptions,
  canMoveFolder,
  getFolderBreadcrumbLabel,
  getFolderColorMeta,
} from "@/lib/folderStorage";
import { formatScore } from "@/lib/grading";
import { AdminExamEditorModal } from "@/components/admin/AdminExamEditorModal";
import { toast } from "sonner";

interface AdminTeacherDataTabProps {
  teachers: AdminTeacherRecord[];
  selectedTeacherId: string;
  onSelectTeacher: (teacherId: string) => void;
  onGlobalRefresh: () => Promise<void>;
}

export function AdminTeacherDataTab({
  teachers,
  selectedTeacherId,
  onSelectTeacher,
  onGlobalRefresh,
}: AdminTeacherDataTabProps) {
  const [bundle, setBundle] = useState<TeacherDataBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<"exams" | "folders" | "codes" | "submissions" | "taxonomy">("exams");
  const [subSearch, setSubSearch] = useState("");

  // Exam editor & delete state
  const [editingExam, setEditingExam] = useState<SystemExam | null>(null);
  const [editorInitialTab, setEditorInitialTab] = useState<"settings" | "questions" | "preview">("questions");
  const [deleteExamTarget, setDeleteExamTarget] = useState<SystemExam | null>(null);
  const [examDeleteMode, setExamDeleteMode] = useState<"archive" | "hard">("archive");

  // Folder CRUD modal state
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<ExamFolder | null>(null);
  const [fName, setFName] = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fColor, setFColor] = useState("sky");
  const [fParentId, setFParentId] = useState<string>("__root__");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<ExamFolder | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveTeacherId = useMemo(() => {
    if (selectedTeacherId && teachers.some((t) => t.id === selectedTeacherId)) {
      return selectedTeacherId;
    }
    return teachers[0]?.id || "";
  }, [selectedTeacherId, teachers]);

  const loadBundle = useCallback(async (tid: string) => {
    if (!tid) {
      setBundle(null);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchTeacherDataBundle(tid);
      setBundle(data);
    } catch {
      toast.error("Không thể tải dữ liệu của giáo viên");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveTeacherId) {
      if (effectiveTeacherId !== selectedTeacherId) {
        onSelectTeacher(effectiveTeacherId);
      }
      loadBundle(effectiveTeacherId);
    } else {
      setBundle(null);
    }
  }, [effectiveTeacherId, selectedTeacherId, onSelectTeacher, loadBundle]);

  const folderTreeOptions = useMemo(() => {
    return buildFolderTreeOptions(bundle?.folders || []);
  }, [bundle?.folders]);

  const moveParentOptions = useMemo(() => {
    return buildFolderTreeOptions(bundle?.folders || [], {
      excludeFolderAndDescendantsId: editingFolder?.id || null,
    });
  }, [bundle?.folders, editingFolder?.id]);

  const submissionCountByExam = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of bundle?.submissions || []) {
      if (s.exam_id) {
        map[s.exam_id] = (map[s.exam_id] || 0) + 1;
      }
    }
    return map;
  }, [bundle?.submissions]);

  const filteredSubmissions = useMemo(() => {
    const list = bundle?.submissions || [];
    const q = subSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const examTitle = bundle?.exams.find((e) => e.id === s.exam_id)?.title || "";
      return (
        String(s.student_name || "").toLowerCase().includes(q) ||
        String(s.student_class || "").toLowerCase().includes(q) ||
        examTitle.toLowerCase().includes(q)
      );
    });
  }, [bundle?.submissions, bundle?.exams, subSearch]);

  const refreshAll = async () => {
    if (effectiveTeacherId) {
      await Promise.all([loadBundle(effectiveTeacherId), onGlobalRefresh()]);
    }
  };

  const openCreateFolder = (parentId: string | null) => {
    setEditingFolder(null);
    setFName("");
    setFDescription("");
    setFColor("sky");
    setFParentId(parentId || "__root__");
    setFolderModalOpen(true);
  };

  const openEditFolder = (folder: ExamFolder) => {
    setEditingFolder(folder);
    setFName(folder.name);
    setFDescription(folder.description || "");
    setFColor(folder.color || "sky");
    setFParentId(folder.parent_id || "__root__");
    setFolderModalOpen(true);
  };

  const handleSaveFolder = async () => {
    if (!effectiveTeacherId) return;
    if (!fName.trim()) {
      toast.error("Tên thư mục không được để trống");
      return;
    }

    const nextParentId = fParentId === "__root__" ? null : fParentId;
    if (editingFolder) {
      const check = canMoveFolder(bundle?.folders || [], editingFolder.id, nextParentId);
      if (!check.valid) {
        toast.error(check.reason || "Không thể di chuyển thư mục tới vị trí này");
        return;
      }
    }

    setBusy(true);
    const res = await saveFolderByAdmin({
      id: editingFolder?.id,
      name: fName.trim(),
      description: fDescription.trim() || null,
      color: fColor,
      icon: editingFolder?.icon || "folder",
      parent_id: nextParentId,
      teacher_id: effectiveTeacherId,
    });
    setBusy(false);

    if (res.ok) {
      toast.success(editingFolder ? "Đã cập nhật thư mục" : "Đã tạo thư mục mới cho giáo viên");
      setFolderModalOpen(false);
      await refreshAll();
    } else {
      toast.error(res.error || "Không thể lưu thư mục");
    }
  };

  const handleConfirmDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    setBusy(true);
    const res = await deleteFolderByAdmin(deleteFolderTarget.id, effectiveTeacherId);
    setBusy(false);
    if (res.ok) {
      toast.success(`Đã xóa thư mục "${deleteFolderTarget.name}" (đề thi được đưa về Chưa phân loại)`);
      setDeleteFolderTarget(null);
      await refreshAll();
    } else {
      toast.error(res.error || "Không thể xóa thư mục");
    }
  };

  const handleConfirmDeleteExam = async () => {
    if (!deleteExamTarget) return;
    setBusy(true);
    const hardDelete = examDeleteMode === "hard";
    const res = await deleteExamByAdmin(deleteExamTarget.id, hardDelete);
    setBusy(false);
    if (res.ok) {
      toast.success(
        hardDelete
          ? `Đã xóa vĩnh viễn đề thi "${deleteExamTarget.title}"`
          : `Đã lưu trữ & ẩn đề thi "${deleteExamTarget.title}" (vẫn giữ lịch sử kết quả)`
      );
      setDeleteExamTarget(null);
      await refreshAll();
    } else {
      toast.error(res.error || "Không thể xóa đề thi");
    }
  };

  const handleToggleLock = async (ex: SystemExam) => {
    const res = await toggleExamLockByAdmin(ex);
    if (res.ok) {
      toast.success(res.nextState ? `Đã khóa đề thi "${ex.title}"` : `Đã mở lại đề thi "${ex.title}"`);
      await refreshAll();
    } else {
      toast.error(res.error || "Không thể thay đổi trạng thái đề thi");
    }
  };

  const renderTeacherStatus = (t: AdminTeacherRecord) => {
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

  if (teachers.length === 0) {
    return (
      <Card className="p-10 text-center border shadow-none text-muted-foreground">
        Chưa có tài khoản giáo viên nào trong hệ thống.
      </Card>
    );
  }

  const activeTeacher = bundle?.teacher || teachers.find((t) => t.id === effectiveTeacherId) || null;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://truongthuyhtq.vercel.app";

  return (
    <div className="space-y-4">
      {/* Selector & Header */}
      <Card className="p-4 border shadow-none space-y-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div className="space-y-1.5 flex-1 max-w-xl">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Chọn giáo viên cần kiểm tra & quản lý dữ liệu
            </Label>
            <Select value={effectiveTeacherId} onValueChange={onSelectTeacher}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn tài khoản giáo viên" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.full_name} ({t.email}) — {t.school_name || "Chưa cập nhật trường"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => effectiveTeacherId && loadBundle(effectiveTeacherId)}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />}
            Tải lại kho dữ liệu
          </Button>
        </div>

        {activeTeacher && (
          <div className="pt-3 border-t flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold">{activeTeacher.full_name}</h3>
                {renderTeacherStatus(activeTeacher)}
              </div>
              <div className="text-xs text-muted-foreground">
                {activeTeacher.email} • @{activeTeacher.username} • {activeTeacher.school_name || "Chưa cập nhật trường"} •{" "}
                Môn {activeTeacher.subject_name || "Chưa phân môn"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs tabular-nums">
              <Badge variant="secondary" className="gap-1 px-2.5 py-1">
                <FileText className="size-3.5" /> {bundle?.exams.length ?? 0} đề thi
              </Badge>
              <Badge variant="secondary" className="gap-1 px-2.5 py-1">
                <FolderTree className="size-3.5" /> {bundle?.folders.length ?? 0} thư mục
              </Badge>
              <Badge variant="secondary" className="gap-1 px-2.5 py-1">
                <GraduationCap className="size-3.5" /> {bundle?.submissions.length ?? 0} bài nộp
              </Badge>
            </div>
          </div>
        )}
      </Card>

      {loading && !bundle ? (
        <Card className="p-12 border shadow-none flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Đang tải toàn bộ dữ liệu của giáo viên...
        </Card>
      ) : (
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as any)} className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start bg-muted/60 p-1">
            <TabsTrigger value="exams" className="gap-1.5">
              <FileText className="size-3.5" /> Đề thi & Câu hỏi ({bundle?.exams.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="folders" className="gap-1.5">
              <FolderTree className="size-3.5" /> Cây thư mục ({bundle?.folders.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="codes" className="gap-1.5">
              <Link2 className="size-3.5" /> Mã đề & Link ngắn
            </TabsTrigger>
            <TabsTrigger value="submissions" className="gap-1.5">
              <GraduationCap className="size-3.5" /> Kết quả học sinh ({bundle?.submissions.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="taxonomy" className="gap-1.5">
              <BookOpen className="size-3.5" /> Môn & Trường học
            </TabsTrigger>
          </TabsList>

          {/* Sub-tab 1: Teacher Exams & Questions */}
          <TabsContent value="exams" className="m-0">
            <Card className="border shadow-none overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">STT</TableHead>
                      <TableHead>Tên đề thi & Thư mục</TableHead>
                      <TableHead>Mã đề</TableHead>
                      <TableHead>Cấu trúc câu</TableHead>
                      <TableHead>Lượt nộp</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!bundle || bundle.exams.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                          Giáo viên này chưa tạo đề thi nào.
                        </TableCell>
                      </TableRow>
                    ) : (
                      bundle.exams.map((ex, idx) => {
                        const parsed = getParsedQuestions(ex.questions);
                        const folderPath = ex.folder_id
                          ? getFolderBreadcrumbLabel(bundle.folders, ex.folder_id)
                          : "";
                        const code = getExamCodeBadgeForAdmin(ex);
                        const subCount = submissionCountByExam[ex.id] || 0;
                        return (
                          <TableRow key={ex.id}>
                            <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell>
                              <div className="font-bold text-sm">{ex.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {ex.subject_name || "Chưa phân môn"} •{" "}
                                <span className="tabular-nums">{ex.duration_minutes} phút</span>
                                {folderPath ? ` • Thư mục: ${folderPath}` : " • Chưa phân loại"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono tabular-nums">
                                {code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">
                              PI: {parsed.partI.length} • PII: {parsed.partII.length} • PIII: {parsed.partIII.length}
                            </TableCell>
                            <TableCell className="tabular-nums text-sm font-medium">{subCount}</TableCell>
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
                                  title="Sửa câu hỏi & cấu hình"
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
                                  title={ex.manual_closed ? "Mở lại đề thi" : "Khóa đề thi"}
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
                                  title="Xóa / Lưu trữ đề thi"
                                  onClick={() => {
                                    setExamDeleteMode(subCount > 0 ? "archive" : "hard");
                                    setDeleteExamTarget(ex);
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
          </TabsContent>

          {/* Sub-tab 2: Multilevel Folder Tree */}
          <TabsContent value="folders" className="m-0 space-y-3">
            <Card className="p-4 border shadow-none flex items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-sm">Cây thư mục nhiều cấp của {activeTeacher?.full_name}</h4>
                <p className="text-xs text-muted-foreground">
                  Super Admin có thể tạo thư mục gốc, tạo thư mục con, đổi tên, di chuyển hoặc xóa thư mục.
                </p>
              </div>
              <Button size="sm" onClick={() => openCreateFolder(null)}>
                <FolderPlus className="size-4 mr-1.5" /> + Tạo thư mục gốc
              </Button>
            </Card>

            <Card className="p-4 border shadow-none space-y-2">
              {folderTreeOptions.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                  Giáo viên này chưa có thư mục nào.
                </div>
              ) : (
                folderTreeOptions.map(({ folder, depth, pathLabel }) => {
                  const color = getFolderColorMeta(folder.color);
                  const examCountInFolder = (bundle?.exams || []).filter((e) => e.folder_id === folder.id).length;
                  return (
                    <div
                      key={folder.id}
                      style={{ marginLeft: `${Math.min(depth, 6) * 24}px` }}
                      className="p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-card hover:border-primary/40 transition-colors"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <span className={`size-3 rounded-full shrink-0 ${color.dot}`} />
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{folder.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {pathLabel} • <span className="tabular-nums">{examCountInFolder} đề thi trực tiếp</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCreateFolder(folder.id)}
                          title="Tạo thư mục con bên trong thư mục này"
                        >
                          <Plus className="size-3.5 mr-1" /> Thư mục con
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEditFolder(folder)} title="Sửa / Di chuyển">
                          <Edit className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteFolderTarget(folder)}
                          title="Xóa thư mục"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          </TabsContent>

          {/* Sub-tab 3: Exam Codes & Short Links */}
          <TabsContent value="codes" className="m-0">
            <Card className="border shadow-none overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">STT</TableHead>
                      <TableHead>Đề thi</TableHead>
                      <TableHead>Mã đề (6 chữ số)</TableHead>
                      <TableHead>Đường dẫn ngắn (Short Link)</TableHead>
                      <TableHead className="text-right">Sao chép</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!bundle || bundle.exams.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                          Không có đề thi nào để hiển thị mã truy cập.
                        </TableCell>
                      </TableRow>
                    ) : (
                      bundle.exams.map((ex, idx) => {
                        const code = getExamCodeBadgeForAdmin(ex);
                        const hasCode = code !== "Chưa gán mã";
                        const shortUrl = hasCode ? `${origin}/${code}` : "";
                        return (
                          <TableRow key={ex.id}>
                            <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell>
                              <div className="font-bold text-sm">{ex.title}</div>
                              <div className="text-xs text-muted-foreground">{ex.subject_name || "Chưa phân môn"}</div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={hasCode ? "default" : "secondary"} className="font-mono tabular-nums">
                                {code}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              {hasCode ? shortUrl : "Chưa phát hành link ngắn"}
                            </TableCell>
                            <TableCell className="text-right">
                              {hasCode && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(shortUrl);
                                      toast.success(`Đã sao chép link: ${shortUrl}`);
                                    } catch {
                                      toast.error("Trình duyệt không cho phép sao chép tự động");
                                    }
                                  }}
                                >
                                  <Copy className="size-3.5 mr-1.5" /> Sao chép link
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* Sub-tab 4: Student Submissions */}
          <TabsContent value="submissions" className="m-0 space-y-3">
            <Card className="p-3 border shadow-none flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Thang điểm quy chuẩn: <strong className="text-foreground">Thang 10</strong>
              </span>
              <Input
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                placeholder="Tìm tên học sinh, lớp, đề thi..."
                className="max-w-xs"
              />
            </Card>

            <Card className="border shadow-none overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">STT</TableHead>
                      <TableHead>Học sinh</TableHead>
                      <TableHead>Lớp</TableHead>
                      <TableHead>Đề thi</TableHead>
                      <TableHead>Điểm (Thang 10)</TableHead>
                      <TableHead>Đúng / Sai</TableHead>
                      <TableHead>Vi phạm</TableHead>
                      <TableHead>Thời gian nộp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSubmissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                          Chưa có bài nộp học sinh nào.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSubmissions.map((s, idx) => {
                        const ex = bundle?.exams.find((e) => e.id === s.exam_id);
                        return (
                          <TableRow key={s.id || idx}>
                            <TableCell className="tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-bold text-sm">{s.student_name || "Học sinh"}</TableCell>
                            <TableCell className="text-sm">{s.student_class || "—"}</TableCell>
                            <TableCell className="text-sm max-w-[220px] truncate">{ex?.title || "Đề thi"}</TableCell>
                            <TableCell className="font-bold tabular-nums text-primary">
                              {formatScore(s.score)} / {formatScore(s.max_score || 10)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">
                              <span className="text-emerald-700 font-semibold">{s.correct_count ?? 0}</span> /{" "}
                              <span className="text-rose-700">{s.wrong_count ?? 0}</span>
                            </TableCell>
                            <TableCell className="tabular-nums text-xs">
                              {s.violation_count > 0 ? (
                                <Badge variant="destructive" className="tabular-nums">
                                  {s.violation_count}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">
                              {s.submitted_at ? new Date(s.submitted_at).toLocaleString("vi-VN") : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          {/* Sub-tab 5: Subjects & Schools */}
          <TabsContent value="taxonomy" className="m-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5 border shadow-none space-y-3">
                <div className="flex items-center gap-2 font-bold text-base">
                  <BookOpen className="size-4 text-primary" /> Môn học giảng dạy
                </div>
                <div className="flex flex-wrap gap-2">
                  {(bundle?.subjects || []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">Chưa có dữ liệu môn học</span>
                  ) : (
                    bundle!.subjects.map((s) => (
                      <Badge key={s} variant="secondary" className="px-3 py-1">
                        {s}
                      </Badge>
                    ))
                  )}
                </div>
              </Card>

              <Card className="p-5 border shadow-none space-y-3">
                <div className="flex items-center gap-2 font-bold text-base">
                  <School className="size-4 text-primary" /> Trường học / Đơn vị công tác
                </div>
                <div className="flex flex-wrap gap-2">
                  {(bundle?.schools || []).length === 0 ? (
                    <span className="text-xs text-muted-foreground">Chưa có dữ liệu trường học</span>
                  ) : (
                    bundle!.schools.map((sc) => (
                      <Badge key={sc} variant="outline" className="px-3 py-1">
                        {sc}
                      </Badge>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Full Exam Editor Modal */}
      <AdminExamEditorModal
        open={!!editingExam}
        onOpenChange={(o) => !o && setEditingExam(null)}
        exam={editingExam}
        folders={bundle?.folders || []}
        initialTab={editorInitialTab}
        onSave={async (updated) => {
          const res = await saveExamByAdmin(updated);
          if (res.ok) await refreshAll();
          return res;
        }}
      />

      {/* Safe Exam Delete Dialog */}
      <Dialog open={!!deleteExamTarget} onOpenChange={(o) => !o && setDeleteExamTarget(null)}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>Xử lý xóa đề thi</DialogTitle>
            <DialogDescription>
              Đề thi <strong>{deleteExamTarget?.title}</strong>
              {deleteExamTarget && (submissionCountByExam[deleteExamTarget.id] || 0) > 0 && (
                <span className="block mt-1 text-amber-700 font-semibold">
                  Cảnh báo: Đề thi này đang có {submissionCountByExam[deleteExamTarget.id]} lượt học sinh đã nộp bài!
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={examDeleteMode} onValueChange={(v) => setExamDeleteMode(v as any)} className="space-y-3 py-2">
            <label className="flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer hover:bg-muted/30">
              <RadioGroupItem value="archive" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold">Lưu trữ & ẩn đề thi (Khuyên dùng)</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Đóng đề thi khỏi danh sách nhưng vẫn giữ nguyên toàn bộ kết quả điểm của học sinh.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/30 cursor-pointer hover:bg-destructive/5">
              <RadioGroupItem value="hard" className="mt-1" />
              <div className="text-sm">
                <div className="font-bold text-destructive flex items-center gap-1">
                  <AlertTriangle className="size-3.5" /> Xóa vĩnh viễn đề thi & bài nộp
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Xóa hoàn toàn đề thi và mọi kết quả học sinh gắn với đề này. Không thể hoàn tác!
                </div>
              </div>
            </label>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteExamTarget(null)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteExam} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Create / Edit / Move Dialog */}
      <Dialog open={folderModalOpen} onOpenChange={setFolderModalOpen}>
        <DialogContent className="font-times-new-roman max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFolder ? "Chỉnh sửa / Di chuyển thư mục" : "Tạo thư mục mới"}</DialogTitle>
            <DialogDescription>Quản lý thư mục nhiều cấp cho giáo viên {activeTeacher?.full_name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Tên thư mục *</Label>
              <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="VD: Chương 1: Hàm số..." />
            </div>
            <div className="space-y-1">
              <Label>Thư mục cha</Label>
              <Select value={fParentId} onValueChange={setFParentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— Thư mục gốc (Cấp cao nhất) —</SelectItem>
                  {moveParentOptions.map((opt) => (
                    <SelectItem key={opt.folder.id} value={opt.folder.id}>
                      {"— ".repeat(opt.depth)}
                      {opt.folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Màu nhận diện</Label>
              <Select value={fColor} onValueChange={setFColor}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOLDER_COLOR_PRESETS.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mô tả ngắn</Label>
              <Input value={fDescription} onChange={(e) => setFDescription(e.target.value)} placeholder="Tùy chọn" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderModalOpen(false)} disabled={busy}>
              Hủy
            </Button>
            <Button onClick={handleSaveFolder} disabled={busy}>
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Lưu thư mục
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Folder Delete Confirmation */}
      <AlertDialog open={!!deleteFolderTarget} onOpenChange={(o) => !o && setDeleteFolderTarget(null)}>
        <AlertDialogContent className="font-times-new-roman">
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa thư mục "{deleteFolderTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Thư mục con (nếu có) sẽ được nâng lên cấp cha gần nhất, và các đề thi bên trong vẫn được giữ an toàn ở mục
              Chưa phân loại.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteFolder}
              disabled={busy}
              className="bg-destructive hover:bg-destructive/90"
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />} Xóa thư mục
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
