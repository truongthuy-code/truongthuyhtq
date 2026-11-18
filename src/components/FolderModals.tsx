import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Folder, BookOpen, GraduationCap, Award, Star, FileText, Library, Bookmark,
  AlertTriangle, Check, FolderPlus, FolderInput, CornerDownRight, Search, Home,
} from "lucide-react";
import {
  ExamFolder,
  FOLDER_COLOR_PRESETS,
  FOLDER_ICON_PRESETS,
  createFolder,
  updateFolder,
  moveFolder,
  deleteFolder,
  moveExamToFolder,
  moveExamsToFolder,
  getFolderColorMeta,
  getFolderBreadcrumbLabel,
  buildFolderTreeOptions,
} from "@/lib/folderStorage";

// Icon lookup helper
export function renderFolderIcon(iconKey?: string | null, className = "size-5") {
  switch (iconKey) {
    case "book-open":
      return <BookOpen className={className} />;
    case "graduation-cap":
      return <GraduationCap className={className} />;
    case "award":
      return <Award className={className} />;
    case "star":
      return <Star className={className} />;
    case "file-text":
      return <FileText className={className} />;
    case "library":
      return <Library className={className} />;
    case "bookmark":
      return <Bookmark className={className} />;
    case "folder":
    default:
      return <Folder className={className} />;
  }
}

// -------------------------------------------------------------
// 1. MODAL TẠO HOẶC CHỈNH SỬA THƯ MỤC (HỖ TRỢ THƯ MỤC CHA & CON NHIỀU CẤP)
// -------------------------------------------------------------
interface CreateOrEditFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder?: ExamFolder | null;
  parentId?: string | null;
  parentPathLabel?: string | null;
  teacherId?: string | null;
  isAdmin?: boolean;
  onSuccess: (savedFolder: ExamFolder) => void | Promise<void>;
}

export function CreateOrEditFolderModal({
  open,
  onOpenChange,
  folder,
  parentId = null,
  parentPathLabel = null,
  teacherId,
  isAdmin,
  onSuccess,
}: CreateOrEditFolderModalProps) {
  const isEditing = !!folder;
  const effectiveParentId = isEditing ? folder?.parent_id || null : parentId || null;
  const isCreatingSubfolder = !isEditing && !!effectiveParentId;

  const [name, setName] = useState("");
  const [color, setColor] = useState("sky");
  const [icon, setIcon] = useState("folder");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    if (open) {
      if (folder) {
        setName(folder.name || "");
        setColor(folder.color || "sky");
        setIcon(folder.icon || "folder");
      } else {
        setName("");
        setColor("sky");
        setIcon("folder");
      }
    }
  }, [open, folder]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("Vui lòng nhập tên thư mục");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (isEditing && folder) {
        const updated = await updateFolder(
          folder.id,
          {
            name: cleanName,
            description: folder.description,
            color,
            icon,
          },
          teacherId,
          isAdmin
        );
        toast.success(`Đã cập nhật thư mục "${cleanName}"`);
        await onSuccess(updated);
        onOpenChange(false);
      } else {
        const created = await createFolder({
          name: cleanName,
          color,
          icon,
          parent_id: effectiveParentId,
          teacher_id: teacherId,
          isAdmin,
        });
        toast.success(
          isCreatingSubfolder
            ? `Đã tạo thư mục con "${cleanName}" thành công!`
            : `Đã tạo thư mục "${cleanName}" thành công!`
        );
        await onSuccess(created);
        onOpenChange(false);
      }
    } catch (err: any) {
      console.error("[CreateOrEditFolderModal] Save folder failed:", err);
      toast.error(err?.message || "Không thể lưu thư mục");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const selectedColorMeta = getFolderColorMeta(color);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-[calc(100vw-2rem)] rounded-2xl p-4 sm:p-5 shadow-2xl border border-border/80">
        <DialogHeader className="pb-0.5">
          <div className="flex items-center gap-2.5">
            <div className={`size-9 rounded-xl bg-gradient-to-br ${selectedColorMeta.iconGradient} text-white grid place-items-center shadow-sm shrink-0`}>
              {renderFolderIcon(icon, "size-4.5")}
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base sm:text-lg font-bold leading-tight">
                {isEditing
                  ? "Chỉnh sửa thư mục"
                  : isCreatingSubfolder
                    ? "Tạo thư mục con"
                    : "Tạo thư mục mới"}
              </DialogTitle>
              <DialogDescription className="text-[11px] sm:text-xs text-muted-foreground leading-tight truncate">
                {isEditing
                  ? "Cập nhật tên, màu sắc hoặc biểu tượng thư mục."
                  : isCreatingSubfolder
                    ? `Trong: ${parentPathLabel || "Thư mục hiện tại"}`
                    : "Phân loại và gom nhóm các đề thi cùng môn học, lớp học."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-3.5 pt-1">
          {/* 1. Ô nhập tên thư mục */}
          <div className="space-y-1">
            <Label htmlFor="folder-name" className="text-xs font-semibold text-foreground">
              Tên thư mục <span className="text-destructive">*</span>
            </Label>
            <Input
              id="folder-name"
              placeholder={
                isCreatingSubfolder
                  ? "VD: Chương 1, Bài 1, Đề kiểm tra 15 phút..."
                  : "VD: LỚP 10, LỚP 11, KIỂM TRA GIỮA KỲ..."
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 sm:h-10 rounded-xl text-sm font-medium"
              autoFocus
              maxLength={80}
            />
          </div>

          {/* 2. Chọn màu sắc thư mục (hàng ngang 8 màu compact) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">Màu sắc thư mục</Label>
              <span className="text-[11px] font-medium text-muted-foreground">
                {selectedColorMeta.name}
              </span>
            </div>
            <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
              {FOLDER_COLOR_PRESETS.map((p) => {
                const isSelected = color === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    title={p.name}
                    onClick={() => setColor(p.key)}
                    className={`aspect-square w-full rounded-full flex items-center justify-center transition-all ${p.dot} ${
                      isSelected
                        ? "ring-2 ring-offset-2 ring-primary scale-110 shadow-sm"
                        : "opacity-80 hover:opacity-100 hover:scale-105"
                    }`}
                  >
                    {isSelected && <Check className="size-3.5 text-white stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Chọn biểu tượng thư mục (hàng ngang 8 biểu tượng compact) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground">Biểu tượng thư mục</Label>
              <span className="text-[11px] font-medium text-muted-foreground">
                {FOLDER_ICON_PRESETS.find((ic) => ic.key === icon)?.label || "Thư mục"}
              </span>
            </div>
            <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
              {FOLDER_ICON_PRESETS.map((ic) => {
                const isSelected = icon === ic.key;
                return (
                  <button
                    key={ic.key}
                    type="button"
                    title={ic.label}
                    onClick={() => setIcon(ic.key)}
                    className={`aspect-square w-full rounded-xl border flex items-center justify-center transition-all ${
                      isSelected
                        ? `${selectedColorMeta.bg} ${selectedColorMeta.border} ring-2 ${selectedColorMeta.ring} ${selectedColorMeta.text} font-bold scale-105 shadow-sm`
                        : "border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {renderFolderIcon(ic.key, "size-4 sm:size-4.5")}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Nút Hủy và Tạo thư mục - luôn hiển thị đầy đủ không cần cuộn */}
          <DialogFooter className="pt-2 sm:pt-3 border-t border-border/50 gap-2 sm:gap-2 flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 sm:h-10 px-4 rounded-xl text-xs sm:text-sm font-medium flex-1 sm:flex-none"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              className="h-9 sm:h-10 px-5 rounded-xl text-xs sm:text-sm font-semibold text-white shadow-soft bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 flex-1 sm:flex-none"
              disabled={submitting}
            >
              {submitting ? "Đang lưu…" : isEditing ? "Lưu thay đổi" : "Tạo thư mục"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------
// 2. MODAL XÁC NHẬN XÓA THƯ MỤC (CẢNH BÁO RÕ RÀNG KHI CÓ THƯ MỤC CON / ĐỀ THI)
// -------------------------------------------------------------
interface DeleteFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ExamFolder | null;
  examCount: number;
  subfolderCount?: number;
  totalNestedExamCount?: number;
  teacherId?: string | null;
  isAdmin?: boolean;
  onSuccess: (deletedId: string) => void;
}

export function DeleteFolderModal({
  open,
  onOpenChange,
  folder,
  examCount,
  subfolderCount = 0,
  totalNestedExamCount = 0,
  teacherId,
  isAdmin,
  onSuccess,
}: DeleteFolderModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
  }, [open, folder]);

  if (!folder) return null;

  const handleDelete = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await deleteFolder(folder.id, teacherId || folder.teacher_id, isAdmin);
      toast.success(
        subfolderCount > 0
          ? `Đã xóa thư mục "${folder.name}". Thư mục con và toàn bộ đề thi vẫn được bảo toàn!`
          : `Đã xóa thư mục "${folder.name}". Các đề thi đã được chuyển về "Đề thi chưa phân loại".`
      );
      onSuccess(folder.id);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Không thể xóa thư mục");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const hasSubfolders = subfolderCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl bg-destructive/10 text-destructive grid place-items-center shrink-0">
              <AlertTriangle className="size-6" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-destructive">
                Xóa thư mục "{folder.name}"?
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Thao tác này chỉ xóa thư mục phân loại, hoàn toàn không xóa các đề thi bên trong.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-2.5 text-xs text-foreground/90">
          {hasSubfolders && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-900 dark:text-rose-200 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
                Cảnh báo thư mục đang chứa dữ liệu phân cấp:
              </p>
              <p className="text-[11px] leading-relaxed">
                Thư mục này có <span className="font-bold">{subfolderCount}</span> thư mục con/cháu
                {totalNestedExamCount > examCount
                  ? <> và tổng cộng <span className="font-bold">{totalNestedExamCount}</span> đề thi</>
                  : null}
                . Các thư mục con trực tiếp (kèm toàn bộ đề thi bên trong chúng) sẽ được tự động nâng lên cấp cha.
              </p>
            </div>
          )}

          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <Check className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Bảo toàn dữ liệu 100%:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground pl-1">
              <li>
                Toàn bộ <span className="font-bold text-foreground">{examCount}</span> đề thi trực tiếp trong thư mục này sẽ được tự động chuyển về mục <span className="font-bold text-foreground">"Đề thi chưa phân loại"</span>.
              </li>
              <li>Mã bài thi, đường link chia sẻ, mã QR và kết quả làm bài của học sinh được giữ nguyên vẹn.</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-1">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="rounded-xl"
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting ? "Đang xóa…" : "Xác nhận xóa thư mục"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------
// 3. MODAL CHUYỂN ĐỀ THI VÀO THƯ MỤC BẤT KỲ CẤP ĐỘ (ĐƠN & HÀNG LOẠT)
// -------------------------------------------------------------
interface MoveExamModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examIds: string[];
  examTitles?: string[];
  folders: ExamFolder[];
  currentFolderId?: string | null;
  onSuccess: (targetFolderId: string | null) => void;
}

export function MoveExamModal({
  open,
  onOpenChange,
  examIds,
  examTitles = [],
  folders,
  currentFolderId,
  onSuccess,
}: MoveExamModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    if (open) {
      setSelectedFolderId(currentFolderId ?? null);
      setSearchTerm("");
    }
  }, [open, currentFolderId]);

  const treeOptions = useMemo(() => buildFolderTreeOptions(folders), [folders]);
  const filteredOptions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return treeOptions;
    return treeOptions.filter(
      (opt) =>
        opt.folder.name.toLowerCase().includes(q) ||
        opt.pathLabel.toLowerCase().includes(q)
    );
  }, [treeOptions, searchTerm]);

  const count = examIds.length;
  if (count === 0) return null;

  const handleMove = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (count === 1) {
        await moveExamToFolder(examIds[0], selectedFolderId);
      } else {
        await moveExamsToFolder(examIds, selectedFolderId);
      }

      const targetPath = selectedFolderId
        ? getFolderBreadcrumbLabel(folders, selectedFolderId, " > ")
        : "";
      const targetName = targetPath
        ? `thư mục "${targetPath}"`
        : 'mục "Đề thi chưa phân loại"';
      toast.success(`Đã chuyển ${count} đề thi vào ${targetName}!`);

      onSuccess(selectedFolderId);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Không thể chuyển đề thi");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <FolderPlus className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold truncate">
                {count === 1
                  ? `Chuyển đề thi: "${examTitles[0] || "Đề thi"}"`
                  : `Chuyển ${count} đề thi vào thư mục`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Chọn bất kỳ thư mục gốc hoặc thư mục con để phân loại đề thi.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">Chọn điểm đến:</Label>

          {folders.length > 5 && (
            <div className="relative">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm nhanh thư mục hoặc đường dẫn…"
                className="pl-8 h-8 rounded-xl text-xs"
              />
            </div>
          )}

          {/* Lựa chọn: Đề thi chưa phân loại (ra ngoài thư mục) */}
          <button
            type="button"
            onClick={() => setSelectedFolderId(null)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
              selectedFolderId === null
                ? "bg-primary/10 border-primary text-primary font-bold shadow-sm"
                : "border-border/70 hover:bg-muted/40 text-foreground"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-muted grid place-items-center text-muted-foreground">
                <FileText className="size-4" />
              </div>
              <div>
                <div className="text-xs font-bold">Đề thi chưa phân loại</div>
                <div className="text-[10px] text-muted-foreground">Đưa đề thi ra ngoài các thư mục</div>
              </div>
            </div>
            {selectedFolderId === null && <Check className="size-4 text-primary shrink-0" />}
          </button>

          {/* Danh sách cây thư mục nhiều cấp */}
          {folders.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
              Chưa có thư mục nào. Bạn có thể tạo thư mục mới từ trang chủ.
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
              Không tìm thấy thư mục khớp "{searchTerm}".
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {filteredOptions.map((opt) => {
                const f = opt.folder;
                const colorMeta = getFolderColorMeta(f.color);
                const isSelected = selectedFolderId === f.id;
                const indentPx = searchTerm.trim() ? 0 : Math.min(opt.depth, 5) * 14;

                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFolderId(f.id)}
                    style={{ marginLeft: `${indentPx}px`, width: `calc(100% - ${indentPx}px)` }}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${colorMeta.bg} ${colorMeta.border} font-bold shadow-sm`
                        : "border-border/60 hover:bg-muted/40 text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {opt.depth > 0 && !searchTerm.trim() && (
                        <CornerDownRight className="size-3.5 text-muted-foreground shrink-0" />
                      )}
                      <div className={`size-8 rounded-lg bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shrink-0`}>
                        {renderFolderIcon(f.icon, "size-4")}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{f.name}</div>
                        {opt.depth > 0 && (
                          <div className="text-[10px] text-muted-foreground truncate" title={opt.pathLabel}>
                            {opt.pathLabel}
                          </div>
                        )}
                      </div>
                    </div>
                    {isSelected && <Check className={`size-4 ${colorMeta.text} shrink-0`} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-1">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Hủy
          </Button>
          <Button
            type="button"
            className="rounded-xl text-white shadow-soft bg-gradient-primary"
            onClick={handleMove}
            disabled={submitting}
          >
            {submitting ? "Đang chuyển…" : "Xác nhận chuyển"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------
// 4. MODAL DI CHUYỂN THƯ MỤC (CHỐNG VÒNG LẶP CHA-CON, GIỮ NGUYÊN CÂY CON & ĐỀ THI)
// -------------------------------------------------------------
interface MoveFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ExamFolder | null;
  folders: ExamFolder[];
  teacherId?: string | null;
  isAdmin?: boolean;
  onSuccess: (movedFolder: ExamFolder) => void;
}

export function MoveFolderModal({
  open,
  onOpenChange,
  folder,
  folders,
  teacherId,
  isAdmin,
  onSuccess,
}: MoveFolderModalProps) {
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    submittingRef.current = false;
    setSubmitting(false);
    if (open && folder) {
      setSelectedParentId(folder.parent_id ?? null);
      setSearchTerm("");
    }
  }, [open, folder]);

  const validTargets = useMemo(() => {
    if (!folder) return [];
    return buildFolderTreeOptions(folders, {
      excludeFolderAndDescendantsId: folder.id,
    });
  }, [folders, folder]);

  const filteredTargets = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return validTargets;
    return validTargets.filter(
      (opt) =>
        opt.folder.name.toLowerCase().includes(q) ||
        opt.pathLabel.toLowerCase().includes(q)
    );
  }, [validTargets, searchTerm]);

  if (!folder) return null;

  const currentParentId = folder.parent_id ?? null;
  const isUnchanged = selectedParentId === currentParentId;

  const handleConfirmMove = async () => {
    if (submittingRef.current) return;
    if (isUnchanged) {
      onOpenChange(false);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const updated = await moveFolder(folder.id, selectedParentId, teacherId, isAdmin);
      const destLabel = selectedParentId
        ? `"${getFolderBreadcrumbLabel(folders, selectedParentId, " > ")}"`
        : '"Cấp gốc (Trang chủ)"';
      toast.success(`Đã di chuyển thư mục "${folder.name}" vào ${destLabel}!`);
      onSuccess(updated);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Không thể di chuyển thư mục");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <FolderInput className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold truncate">
                Di chuyển thư mục "{folder.name}"
              </DialogTitle>
              <DialogDescription className="text-xs">
                Toàn bộ thư mục con và đề thi bên trong sẽ được giữ nguyên cấu trúc.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">
            Chọn thư mục cha mới:
          </Label>

          {validTargets.length > 5 && (
            <div className="relative">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm thư mục đích…"
                className="pl-8 h-8 rounded-xl text-xs"
              />
            </div>
          )}

          {/* Chuyển về cấp gốc (Trang chủ) */}
          <button
            type="button"
            onClick={() => setSelectedParentId(null)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
              selectedParentId === null
                ? "bg-primary/10 border-primary text-primary font-bold shadow-sm"
                : "border-border/70 hover:bg-muted/40 text-foreground"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-muted grid place-items-center text-muted-foreground">
                <Home className="size-4" />
              </div>
              <div>
                <div className="text-xs font-bold">Cấp gốc (Trang chủ)</div>
                <div className="text-[10px] text-muted-foreground">Đưa thư mục ra ngoài làm thư mục chính</div>
              </div>
            </div>
            {selectedParentId === null && <Check className="size-4 text-primary shrink-0" />}
          </button>

          <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
            {filteredTargets.map((opt) => {
              const target = opt.folder;
              const colorMeta = getFolderColorMeta(target.color);
              const isSelected = selectedParentId === target.id;
              const indentPx = searchTerm.trim() ? 0 : Math.min(opt.depth, 5) * 14;

              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => setSelectedParentId(target.id)}
                  style={{ marginLeft: `${indentPx}px`, width: `calc(100% - ${indentPx}px)` }}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? `${colorMeta.bg} ${colorMeta.border} font-bold shadow-sm`
                      : "border-border/60 hover:bg-muted/40 text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {opt.depth > 0 && !searchTerm.trim() && (
                      <CornerDownRight className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                    <div className={`size-8 rounded-lg bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shrink-0`}>
                      {renderFolderIcon(target.icon, "size-4")}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{target.name}</div>
                      {opt.depth > 0 && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {opt.pathLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className={`size-4 ${colorMeta.text} shrink-0`} />}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-1">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Hủy
          </Button>
          <Button
            type="button"
            className="rounded-xl text-white shadow-soft bg-gradient-primary"
            onClick={handleConfirmMove}
            disabled={submitting || isUnchanged}
          >
            {submitting ? "Đang chuyển…" : "Xác nhận di chuyển"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
