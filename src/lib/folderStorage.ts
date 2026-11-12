import { supabase } from "@/integrations/supabase/client";
import { generateUuid, isUuid } from "@/lib/teacherStorage";
import { withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";

export interface ExamFolder {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  teacher_id?: string | null;
  created_at: string;
  updated_at: string;
  exam_count?: number;
}

export interface FolderColorMeta {
  key: string;
  name: string;
  bg: string;
  border: string;
  hoverBorder: string;
  text: string;
  badgeBg: string;
  iconGradient: string;
  dot: string;
  ring: string;
}

export const FOLDER_COLOR_PRESETS: FolderColorMeta[] = [
  {
    key: "sky",
    name: "Xanh lam",
    bg: "bg-sky-500/10",
    border: "border-sky-300 dark:border-sky-800/80",
    hoverBorder: "hover:border-sky-400 dark:hover:border-sky-600",
    text: "text-sky-600 dark:text-sky-400",
    badgeBg: "bg-sky-50 dark:bg-sky-950/60",
    iconGradient: "from-sky-500 to-blue-600",
    dot: "bg-sky-500",
    ring: "ring-sky-500",
  },
  {
    key: "violet",
    name: "Tím",
    bg: "bg-violet-500/10",
    border: "border-violet-300 dark:border-violet-800/80",
    hoverBorder: "hover:border-violet-400 dark:hover:border-violet-600",
    text: "text-violet-600 dark:text-violet-400",
    badgeBg: "bg-violet-50 dark:bg-violet-950/60",
    iconGradient: "from-violet-500 to-purple-600",
    dot: "bg-violet-500",
    ring: "ring-violet-500",
  },
  {
    key: "emerald",
    name: "Xanh ngọc",
    bg: "bg-emerald-500/10",
    border: "border-emerald-300 dark:border-emerald-800/80",
    hoverBorder: "hover:border-emerald-400 dark:hover:border-emerald-600",
    text: "text-emerald-600 dark:text-emerald-400",
    badgeBg: "bg-emerald-50 dark:bg-emerald-950/60",
    iconGradient: "from-emerald-500 to-teal-600",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500",
  },
  {
    key: "amber",
    name: "Hổ phách",
    bg: "bg-amber-500/10",
    border: "border-amber-300 dark:border-amber-800/80",
    hoverBorder: "hover:border-amber-400 dark:hover:border-amber-600",
    text: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-50 dark:bg-amber-950/60",
    iconGradient: "from-amber-500 to-yellow-600",
    dot: "bg-amber-500",
    ring: "ring-amber-500",
  },
  {
    key: "rose",
    name: "Hồng đào",
    bg: "bg-rose-500/10",
    border: "border-rose-300 dark:border-rose-800/80",
    hoverBorder: "hover:border-rose-400 dark:hover:border-rose-600",
    text: "text-rose-600 dark:text-rose-400",
    badgeBg: "bg-rose-50 dark:bg-rose-950/60",
    iconGradient: "from-rose-500 to-pink-600",
    dot: "bg-rose-500",
    ring: "ring-rose-500",
  },
  {
    key: "indigo",
    name: "Chàm",
    bg: "bg-indigo-500/10",
    border: "border-indigo-300 dark:border-indigo-800/80",
    hoverBorder: "hover:border-indigo-400 dark:hover:border-indigo-600",
    text: "text-indigo-600 dark:text-indigo-400",
    badgeBg: "bg-indigo-50 dark:bg-indigo-950/60",
    iconGradient: "from-indigo-500 to-blue-700",
    dot: "bg-indigo-500",
    ring: "ring-indigo-500",
  },
  {
    key: "teal",
    name: "Xanh mòng két",
    bg: "bg-teal-500/10",
    border: "border-teal-300 dark:border-teal-800/80",
    hoverBorder: "hover:border-teal-400 dark:hover:border-teal-600",
    text: "text-teal-600 dark:text-teal-400",
    badgeBg: "bg-teal-50 dark:bg-teal-950/60",
    iconGradient: "from-teal-500 to-emerald-600",
    dot: "bg-teal-500",
    ring: "ring-teal-500",
  },
  {
    key: "orange",
    name: "Cam san hô",
    bg: "bg-orange-500/10",
    border: "border-orange-300 dark:border-orange-800/80",
    hoverBorder: "hover:border-orange-400 dark:hover:border-orange-600",
    text: "text-orange-600 dark:text-orange-400",
    badgeBg: "bg-orange-50 dark:bg-orange-950/60",
    iconGradient: "from-orange-500 to-red-500",
    dot: "bg-orange-500",
    ring: "ring-orange-500",
  },
];

export const FOLDER_ICON_PRESETS = [
  { key: "folder", label: "Thư mục mặc định" },
  { key: "book-open", label: "Sách giáo khoa" },
  { key: "graduation-cap", label: "Lớp học" },
  { key: "award", label: "Kỳ thi / Giải thưởng" },
  { key: "star", label: "Học sinh giỏi" },
  { key: "file-text", label: "Bài kiểm tra" },
  { key: "library", label: "Kho tư liệu" },
  { key: "bookmark", label: "Đánh dấu" },
];

export const SAMPLE_FOLDER_NAMES = [
  "LỚP 10",
  "LỚP 11",
  "LỚP 12",
  "KIỂM TRA THƯỜNG XUYÊN",
  "KIỂM TRA GIỮA HỌC KỲ",
  "KIỂM TRA CUỐI HỌC KỲ",
  "ĐỀ THI HỌC SINH GIỎI",
];

const LOCAL_FOLDERS_KEY = "qc_exam_folders_v1";
const LOCAL_MAPPINGS_KEY = "qc_exam_folder_mappings_v1";

export function getFolderColorMeta(colorKey?: string | null): FolderColorMeta {
  const c = (colorKey || "sky").toLowerCase();
  const found = FOLDER_COLOR_PRESETS.find((p) => p.key === c);
  return found || FOLDER_COLOR_PRESETS[0];
}

function getLocalFolders(): ExamFolder[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(LOCAL_FOLDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalFolders(folders: ExamFolder[]): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(folders));
  } catch {}
}

export function getExamFolderMapping(): Record<string, string | null> {
  try {
    if (typeof window === "undefined") return {};
    const raw = localStorage.getItem(LOCAL_MAPPINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveExamFolderMapping(mapping: Record<string, string | null>): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(LOCAL_MAPPINGS_KEY, JSON.stringify(mapping));
  } catch {}
}

/**
 * Lấy danh sách thư mục của giáo viên (hoặc tất cả thư mục nếu là Admin).
 * Đồng bộ hai chiều giữa Supabase và LocalStorage để luôn hoạt động bền bỉ.
 */
export async function getFolders(teacherId?: string | null, isAdmin?: boolean): Promise<ExamFolder[]> {
  const localList = getLocalFolders();

  try {
    let q = (supabase.from("exam_folders") as any).select("*").order("name", { ascending: true });

    if (!isAdmin && teacherId) {
      if (isUuid(teacherId)) {
        q = q.or(`teacher_id.eq.${teacherId},teacher_id.is.null`);
      }
    }

    const { data, error } = await q;

    if (!error && Array.isArray(data)) {
      const mergedMap = new Map<string, ExamFolder>();

      // Put local folders first
      localList.forEach((f) => mergedMap.set(f.id, f));

      // Merge remote folders
      data.forEach((r: any) => {
        mergedMap.set(r.id, {
          id: r.id,
          name: r.name,
          description: r.description || null,
          color: r.color || "sky",
          icon: r.icon || "folder",
          teacher_id: r.teacher_id || null,
          created_at: r.created_at || new Date().toISOString(),
          updated_at: r.updated_at || new Date().toISOString(),
        });
      });

      const combined = Array.from(mergedMap.values());
      saveLocalFolders(combined);

      // Filter by teacher if not admin
      if (!isAdmin && teacherId) {
        return combined.filter(
          (f) => !f.teacher_id || f.teacher_id === teacherId
        );
      }
      return combined;
    }
  } catch (err) {
    console.warn("[FolderStorage] Supabase fetch error, fallback to local:", err);
  }

  // Fallback to local storage
  if (!isAdmin && teacherId) {
    return localList.filter((f) => !f.teacher_id || f.teacher_id === teacherId);
  }
  return localList;
}

/**
 * Kiểm tra tên thư mục có bị trùng không (không phân biệt hoa thường)
 */
export async function checkDuplicateFolderName(
  name: string,
  teacherId?: string | null,
  excludeId?: string,
  isAdmin?: boolean
): Promise<boolean> {
  const cleanName = (name || "").trim().toLowerCase();
  if (!cleanName) return false;

  const folders = await getFolders(teacherId, isAdmin);
  return folders.some((f) => {
    if (excludeId && f.id === excludeId) return false;
    return (f.name || "").trim().toLowerCase() === cleanName;
  });
}

/**
 * Tạo mới một thư mục đề thi
 */
export async function createFolder(input: {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  teacher_id?: string | null;
}): Promise<ExamFolder> {
  const cleanName = (input.name || "").trim();
  if (!cleanName) {
    throw new Error("Tên thư mục không được để trống");
  }

  const isDup = await checkDuplicateFolderName(cleanName, input.teacher_id);
  if (isDup) {
    throw new Error(`Thư mục "${cleanName}" đã tồn tại. Vui lòng đặt tên khác.`);
  }

  const id = generateUuid();
  const now = new Date().toISOString();
  const newFolder: ExamFolder = {
    id,
    name: cleanName,
    description: input.description?.trim() || null,
    color: input.color || "sky",
    icon: input.icon || "folder",
    teacher_id: isUuid(input.teacher_id) ? input.teacher_id : null,
    created_at: now,
    updated_at: now,
  };

  // 1. Lưu vào local storage trước để phản hồi tức thì
  const localList = getLocalFolders();
  saveLocalFolders([newFolder, ...localList]);

  // 2. Đồng bộ lên Supabase nếu có kết nối
  try {
    await withSupabaseAuthRetry(async () => {
      return await (supabase.from("exam_folders") as any).insert({
        id: newFolder.id,
        name: newFolder.name,
        description: newFolder.description,
        color: newFolder.color,
        icon: newFolder.icon,
        teacher_id: newFolder.teacher_id,
        created_at: newFolder.created_at,
        updated_at: newFolder.updated_at,
      });
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase insert folder error (will rely on local):", err);
  }

  return newFolder;
}

/**
 * Cập nhật thông tin thư mục (Đổi tên, mô tả, màu sắc, icon)
 */
export async function updateFolder(
  id: string,
  updates: Partial<Pick<ExamFolder, "name" | "description" | "color" | "icon">>
): Promise<ExamFolder> {
  const localList = getLocalFolders();
  const existing = localList.find((f) => f.id === id);
  if (!existing) {
    throw new Error("Không tìm thấy thư mục cần cập nhật");
  }

  if (updates.name !== undefined) {
    const cleanName = updates.name.trim();
    if (!cleanName) throw new Error("Tên thư mục không được để trống");
    const isDup = await checkDuplicateFolderName(cleanName, existing.teacher_id, id);
    if (isDup) throw new Error(`Tên thư mục "${cleanName}" đã tồn tại.`);
    existing.name = cleanName;
  }

  if (updates.description !== undefined) {
    existing.description = updates.description?.trim() || null;
  }
  if (updates.color !== undefined) {
    existing.color = updates.color;
  }
  if (updates.icon !== undefined) {
    existing.icon = updates.icon;
  }
  existing.updated_at = new Date().toISOString();

  // Save to local
  saveLocalFolders(localList.map((f) => (f.id === id ? existing : f)));

  // Sync to Supabase
  try {
    await withSupabaseAuthRetry(async () => {
      return await (supabase.from("exam_folders") as any)
        .update({
          name: existing.name,
          description: existing.description,
          color: existing.color,
          icon: existing.icon,
          updated_at: existing.updated_at,
        })
        .eq("id", id);
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase update folder error:", err);
  }

  return existing;
}

/**
 * Xóa thư mục:
 * QUY TẮC BẢO VỆ:
 * - Không xóa các đề thi bên trong.
 * - Mọi đề thi đang thuộc thư mục này được chuyển về mục "Đề thi chưa phân loại" (folder_id = null).
 * - Không xóa mã bài thi, QR code, kết quả hay dữ liệu làm bài.
 */
export async function deleteFolder(id: string, teacherId?: string | null): Promise<boolean> {
  // 1. Chuyển tất cả đề thi của thư mục này về Chưa phân loại trong local mapping
  const mappings = getExamFolderMapping();
  let changedMapping = false;
  Object.keys(mappings).forEach((examId) => {
    if (mappings[examId] === id) {
      mappings[examId] = null;
      changedMapping = true;
    }
  });
  if (changedMapping) {
    saveExamFolderMapping(mappings);
  }

  // 2. Xóa khỏi local folders
  const localList = getLocalFolders();
  saveLocalFolders(localList.filter((f) => f.id !== id));

  // 3. Đồng bộ lên Supabase: Set folder_id = null cho các đề thi và xóa thư mục
  try {
    await withSupabaseAuthRetry(async () => {
      // Unlink exams
      await (supabase.from("exams") as any).update({ folder_id: null }).eq("folder_id", id);
      // Delete folder
      return await (supabase.from("exam_folders") as any).delete().eq("id", id);
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase delete folder error:", err);
  }

  return true;
}

/**
 * Chuyển một đề thi vào một thư mục (hoặc đưa về Chưa phân loại nếu folderId là null)
 */
export async function moveExamToFolder(examId: string, folderId: string | null): Promise<boolean> {
  if (!examId) return false;

  // 1. Cập nhật local mapping
  const mappings = getExamFolderMapping();
  mappings[examId] = folderId;
  saveExamFolderMapping(mappings);

  // 2. Cập nhật Supabase
  try {
    await withSupabaseAuthRetry(async () => {
      return await (supabase.from("exams") as any)
        .update({ folder_id: folderId })
        .eq("id", examId);
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase move exam error (fallback mapping kept):", err);
  }

  return true;
}

/**
 * Chuyển hàng loạt nhiều đề thi vào một thư mục (hoặc đưa về Chưa phân loại)
 */
export async function moveExamsToFolder(examIds: string[], folderId: string | null): Promise<boolean> {
  if (!examIds || examIds.length === 0) return true;

  // 1. Cập nhật local mapping
  const mappings = getExamFolderMapping();
  examIds.forEach((eid) => {
    mappings[eid] = folderId;
  });
  saveExamFolderMapping(mappings);

  // 2. Cập nhật Supabase
  try {
    await withSupabaseAuthRetry(async () => {
      return await (supabase.from("exams") as any)
        .update({ folder_id: folderId })
        .in("id", examIds);
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase batch move exams error (fallback mappings kept):", err);
  }

  return true;
}

/**
 * Xác định chính xác đề thi thuộc thư mục nào:
 * Ưu tiên:
 * 1. exam.folder_id (từ Supabase / unified exam object)
 * 2. mappings[exam.id] (từ local mapping)
 * 3. null (chưa phân loại)
 */
export function getFolderIdForExam(
  exam: any,
  mappings?: Record<string, string | null>
): string | null {
  if (!exam) return null;
  if (exam.folder_id !== undefined && exam.folder_id !== null && exam.folder_id !== "") {
    return String(exam.folder_id);
  }
  const map = mappings || getExamFolderMapping();
  if (map && exam.id && map[exam.id]) {
    return String(map[exam.id]);
  }
  return null;
}
