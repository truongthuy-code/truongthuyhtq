import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Folder, BookOpen, GraduationCap, Award, Star, FileText, Library, Bookmark,
  AlertTriangle, Check, ArrowRight, FolderPlus, FolderEdit,
} from "lucide-react";
import {
  ExamFolder,
  FOLDER_COLOR_PRESETS,
  FOLDER_ICON_PRESETS,
  SAMPLE_FOLDER_NAMES,
  createFolder,
  updateFolder,
  deleteFolder,
  moveExamToFolder,
  moveExamsToFolder,
  getFolderColorMeta,
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
// 1. MODAL TẠO HOẶC CHỈNH SỬA THƯ MỤC
// -------------------------------------------------------------
interface CreateOrEditFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder?: ExamFolder | null;
  teacherId?: string | null;
  onSuccess: (savedFolder: ExamFolder) => void;
}

export function CreateOrEditFolderModal({
  open,
  onOpenChange,
  folder,
  teacherId,
  onSuccess,
}: CreateOrEditFolderModalProps) {
  const isEditing = !!folder;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("sky");
  const [icon, setIcon] = useState("folder");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (folder) {
        setName(folder.name || "");
        setDescription(folder.description || "");
        setColor(folder.color || "sky");
        setIcon(folder.icon || "folder");
      } else {
        setName("");
        setDescription("");
        setColor("sky");
        setIcon("folder");
      }
    }
  }, [open, folder]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      toast.error("Vui lòng nhập tên thư mục");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing && folder) {
        const updated = await updateFolder(folder.id, {
          name: cleanName,
          description,
          color,
          icon,
        });
        toast.success(`Đã cập nhật thư mục "${cleanName}"`);
        onSuccess(updated);
        onOpenChange(false);
      } else {
        const created = await createFolder({
          name: cleanName,
          description,
          color,
          icon,
          teacher_id: teacherId,
        });
        toast.success(`Đã tạo thư mục "${cleanName}" thành công!`);
        onSuccess(created);
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err?.message || "Không thể lưu thư mục");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedColorMeta = getFolderColorMeta(color);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`size-10 rounded-xl bg-gradient-to-br ${selectedColorMeta.iconGradient} text-white grid place-items-center shadow-sm`}>
              {renderFolderIcon(icon, "size-5")}
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">
                {isEditing ? "Chỉnh sửa thư mục" : "Tạo thư mục mới"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {isEditing
                  ? "Cập nhật tên, mô tả, màu sắc hoặc biểu tượng của thư mục."
                  : "Phân loại đề thi theo lớp, môn học, học kỳ hoặc kỳ thi."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Tên thư mục */}
          <div className="space-y-1.5">
            <Label htmlFor="folder-name" className="text-xs font-semibold">
              Tên thư mục <span className="text-destructive">*</span>
            </Label>
            <Input
              id="folder-name"
              placeholder="VD: LỚP 12A1, KIỂM TRA GIỮA HỌC KỲ..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl font-medium"
              autoFocus
              maxLength={80}
            />
          </div>

          {/* Gợi ý tên thư mục mẫu nếu tạo mới */}
          {!isEditing && (
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground font-medium">Gợi ý mẫu nhanh:</span>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {SAMPLE_FOLDER_NAMES.map((sName) => (
                  <button
                    key={sName}
                    type="button"
                    onClick={() => setName(sName)}
                    className="text-[11px] px-2 py-0.5 rounded-lg border bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    + {sName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mô tả */}
          <div className="space-y-1.5">
            <Label htmlFor="folder-desc" className="text-xs font-semibold">
              Mô tả thư mục <span className="text-muted-foreground text-[10px]">(không bắt buộc)</span>
            </Label>
            <Textarea
              id="folder-desc"
              placeholder="Ghi chú về lớp học, môn học, giáo viên phụ trách..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-xl text-xs resize-none"
              rows={2}
              maxLength={200}
            />
          </div>

          {/* Chọn màu sắc */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Chọn màu sắc thư mục</Label>
            <div className="grid grid-cols-4 gap-2">
              {FOLDER_COLOR_PRESETS.map((p) => {
                const isSelected = color === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setColor(p.key)}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${p.bg} ${p.border} ring-2 ${p.ring} font-semibold shadow-sm`
                        : "border-border/60 hover:bg-muted/40"
                    }`}
                  >
                    <span className={`size-3.5 rounded-full ${p.dot} shrink-0`} />
                    <span className="text-xs truncate">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chọn biểu tượng */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Chọn biểu tượng</Label>
            <div className="grid grid-cols-4 gap-2">
              {FOLDER_ICON_PRESETS.map((ic) => {
                const isSelected = icon === ic.key;
                return (
                  <button
                    key={ic.key}
                    type="button"
                    onClick={() => setIcon(ic.key)}
                    className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "bg-primary/10 border-primary text-primary font-semibold ring-2 ring-primary/40 shadow-sm"
                        : "border-border/60 hover:bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {renderFolderIcon(ic.key, "size-4 shrink-0")}
                    <span className="text-xs truncate">{ic.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
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
              type="submit"
              className="rounded-xl text-white shadow-soft bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700"
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
// 2. MODAL XÁC NHẬN XÓA THƯ MỤC
// -------------------------------------------------------------
interface DeleteFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ExamFolder | null;
  examCount: number;
  onSuccess: (deletedId: string) => void;
}

export function DeleteFolderModal({
  open,
  onOpenChange,
  folder,
  examCount,
  onSuccess,
}: DeleteFolderModalProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!folder) return null;

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await deleteFolder(folder.id, folder.teacher_id);
      toast.success(`Đã xóa thư mục "${folder.name}". Các đề thi đã được chuyển về "Đề thi chưa phân loại".`);
      onSuccess(folder.id);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Không thể xóa thư mục");
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <Check className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Bảo toàn dữ liệu 100%:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-muted-foreground pl-1">
              <li>
                Toàn bộ <span className="font-bold text-foreground">{examCount}</span> đề thi bên trong sẽ được tự động chuyển về mục <span className="font-bold text-foreground">"Đề thi chưa phân loại"</span>.
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
// 3. MODAL CHUYỂN ĐỀ THI VÀO THƯ MỤC (HỖ TRỢ ĐƠN & HÀNG LOẠT)
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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedFolderId(currentFolderId ?? null);
    }
  }, [open, currentFolderId]);

  const count = examIds.length;
  if (count === 0) return null;

  const handleMove = async () => {
    setSubmitting(true);
    try {
      if (count === 1) {
        await moveExamToFolder(examIds[0], selectedFolderId);
      } else {
        await moveExamsToFolder(examIds, selectedFolderId);
      }

      const targetFolder = folders.find((f) => f.id === selectedFolderId);
      const targetName = targetFolder ? `thư mục "${targetFolder.name}"` : 'mục "Đề thi chưa phân loại"';
      toast.success(`Đã chuyển ${count} đề thi vào ${targetName}!`);

      onSuccess(selectedFolderId);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Không thể chuyển đề thi");
    } finally {
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
            <div>
              <DialogTitle className="text-base font-bold">
                {count === 1
                  ? `Chuyển đề thi: "${examTitles[0] || "Đề thi"}"`
                  : `Chuyển ${count} đề thi vào thư mục`}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Chọn thư mục đích để lưu trữ và phân loại đề thi.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">Chọn điểm đến:</Label>

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

          {/* Danh sách các thư mục */}
          {folders.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
              Chưa có thư mục nào. Bạn có thể tạo thư mục mới từ trang chủ.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
              {folders.map((f) => {
                const colorMeta = getFolderColorMeta(f.color);
                const isSelected = selectedFolderId === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFolderId(f.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${colorMeta.bg} ${colorMeta.border} font-bold shadow-sm`
                        : "border-border/60 hover:bg-muted/40 text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`size-8 rounded-lg bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shrink-0`}>
                        {renderFolderIcon(f.icon, "size-4")}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{f.name}</div>
                        {f.description && (
                          <div className="text-[10px] text-muted-foreground truncate">{f.description}</div>
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
