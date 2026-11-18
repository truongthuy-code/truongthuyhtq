import { supabase } from "@/integrations/supabase/client";
import { generateUuid, isUuid } from "@/lib/teacherStorage";
import { withSupabaseAuthRetry } from "@/lib/supabaseAuthSync";
import { isRequestTimeoutError, withRequestTimeout } from "@/lib/requestTimeout";
import {
  isCapabilityUnavailable,
  markCapabilityAvailable,
  markCapabilityUnavailable,
} from "@/lib/supabaseCapabilities";

export interface ExamFolder {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  icon: string;
  parent_id?: string | null;
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
const LOCAL_ALL_EXAMS_KEY = "qc_all_exams_registry_v1";

export type FolderSortOption = "name-asc" | "name-desc" | "created-desc" | "created-asc";

export interface FolderTreeOption {
  folder: ExamFolder;
  depth: number;
  pathLabel: string;
  ancestorNames: string[];
}

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
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f: any) => ({
      ...f,
      parent_id: f.parent_id || null,
      teacher_id: f.teacher_id || null,
    }));
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

function updateUnifiedExamsFolderId(examIds: string[], folderId: string | null): void {
  try {
    if (typeof window === "undefined" || examIds.length === 0) return;
    const raw = localStorage.getItem(LOCAL_ALL_EXAMS_KEY);
    if (!raw) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const idSet = new Set(examIds);
    let changed = false;
    const next = list.map((ex: any) => {
      if (ex && idSet.has(ex.id)) {
        changed = true;
        return { ...ex, folder_id: folderId };
      }
      return ex;
    });
    if (changed) {
      localStorage.setItem(LOCAL_ALL_EXAMS_KEY, JSON.stringify(next));
    }
  } catch {}
}

function filterFoldersByAccess(
  folders: ExamFolder[],
  teacherId?: string | null,
  isAdmin?: boolean
): ExamFolder[] {
  if (isAdmin) return folders;
  if (teacherId) {
    return folders.filter((f) => f.teacher_id === teacherId);
  }
  return folders.filter((f) => !f.teacher_id);
}

/**
 * Sắp xếp danh sách thư mục theo tùy chọn chuẩn
 */
export function sortFolderList(
  folders: ExamFolder[],
  sortOrder: FolderSortOption = "name-asc"
): ExamFolder[] {
  return [...folders].sort((a, b) => {
    if (sortOrder === "name-asc") return (a.name || "").localeCompare(b.name || "", "vi");
    if (sortOrder === "name-desc") return (b.name || "").localeCompare(a.name || "", "vi");
    if (sortOrder === "created-desc") {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }
    if (sortOrder === "created-asc") {
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    }
    return 0;
  });
}

/**
 * Trả về đường dẫn đầy đủ từ thư mục gốc đến thư mục hiện tại: [root, ..., parent, current]
 * Tự động ngắt an toàn nếu phát hiện vòng lặp dữ liệu cũ.
 */
export function getFolderPath(
  folders: ExamFolder[],
  folderId?: string | null
): ExamFolder[] {
  if (!folderId) return [];
  const byId = new Map<string, ExamFolder>(folders.map((f) => [f.id, f]));
  const path: ExamFolder[] = [];
  const visited = new Set<string>();

  let currentId: string | null | undefined = folderId;
  while (currentId && !visited.has(currentId)) {
    const node = byId.get(currentId);
    if (!node) break;
    visited.add(currentId);
    path.unshift(node);
    currentId = node.parent_id || null;
  }

  return path;
}

/**
 * Chuỗi đường dẫn phân cấp để hiển thị trên UI (VD: "Tin học 12 / Chương 1 / Bài 1")
 */
export function getFolderBreadcrumbLabel(
  folders: ExamFolder[],
  folderId?: string | null,
  separator = " / "
): string {
  const path = getFolderPath(folders, folderId);
  return path.map((f) => f.name).join(separator);
}

/**
 * Lấy danh sách thư mục gốc (parent_id null hoặc trỏ tới parent không tồn tại)
 */
export function getRootFolders(folders: ExamFolder[]): ExamFolder[] {
  const idSet = new Set(folders.map((f) => f.id));
  return folders.filter((f) => !f.parent_id || !idSet.has(f.parent_id));
}

/**
 * Lấy các thư mục con trực tiếp của một thư mục cha (parentId = null nghĩa là cấp gốc)
 */
export function getChildFolders(
  folders: ExamFolder[],
  parentId: string | null
): ExamFolder[] {
  if (!parentId) {
    return getRootFolders(folders);
  }
  return folders.filter((f) => (f.parent_id || null) === parentId);
}

/**
 * Lấy tập hợp toàn bộ ID thư mục con / cháu / chắt... của folderId (không gồm folderId)
 */
export function getDescendantFolderIds(
  folders: ExamFolder[],
  folderId: string
): Set<string> {
  const descendants = new Set<string>();
  const childrenByParent = new Map<string, ExamFolder[]>();

  folders.forEach((f) => {
    const p = f.parent_id || null;
    if (p) {
      const arr = childrenByParent.get(p) || [];
      arr.push(f);
      childrenByParent.set(p, arr);
    }
  });

  const queue: string[] = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = childrenByParent.get(current) || [];
    for (const child of children) {
      if (!descendants.has(child.id) && child.id !== folderId) {
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
  }

  return descendants;
}

/**
 * Trả về danh sách ID gồm chính thư mục đó và toàn bộ các thư mục con/cháu bên trong
 */
export function getRecursiveSubtreeIds(
  folders: ExamFolder[],
  folderId: string
): string[] {
  const desc = getDescendantFolderIds(folders, folderId);
  return [folderId, ...Array.from(desc)];
}

/**
 * Kiểm tra tính hợp lệ khi di chuyển thư mục sang thư mục cha mới (chống vòng lặp)
 */
export function canMoveFolder(
  folders: ExamFolder[],
  folderId: string,
  targetParentId: string | null
): { valid: boolean; reason?: string } {
  const source = folders.find((f) => f.id === folderId);
  if (!source) {
    return { valid: false, reason: "Không tìm thấy thư mục cần di chuyển." };
  }

  const normalizedTarget = targetParentId || null;
  if (normalizedTarget === null) {
    return { valid: true };
  }

  if (normalizedTarget === folderId) {
    return { valid: false, reason: "Không thể di chuyển thư mục vào chính nó." };
  }

  const targetExists = folders.some((f) => f.id === normalizedTarget);
  if (!targetExists) {
    return { valid: false, reason: "Thư mục đích không tồn tại." };
  }

  const descendants = getDescendantFolderIds(folders, folderId);
  if (descendants.has(normalizedTarget)) {
    return {
      valid: false,
      reason: "Không thể di chuyển thư mục vào thư mục con hoặc thư mục cháu của chính nó.",
    };
  }

  return { valid: true };
}

/**
 * Xây dựng danh sách phẳng theo thứ tự cây phân cấp (DFS) phục vụ dropdown, modal chuyển đề, modal di chuyển thư mục
 */
export function buildFolderTreeOptions(
  folders: ExamFolder[],
  options?: {
    excludeFolderAndDescendantsId?: string | null;
    sortOrder?: FolderSortOption;
  }
): FolderTreeOption[] {
  const sortOrder = options?.sortOrder || "name-asc";
  const excludeId = options?.excludeFolderAndDescendantsId || null;
  const excludedSet = new Set<string>();
  if (excludeId) {
    excludedSet.add(excludeId);
    getDescendantFolderIds(folders, excludeId).forEach((id) => excludedSet.add(id));
  }

  const folderIdSet = new Set(folders.map((f) => f.id));
  const childrenMap = new Map<string, ExamFolder[]>();
  const roots: ExamFolder[] = [];

  folders.forEach((f) => {
    if (excludedSet.has(f.id)) return;
    const parentId = f.parent_id && folderIdSet.has(f.parent_id) ? f.parent_id : null;
    if (!parentId) {
      roots.push(f);
    } else if (!excludedSet.has(parentId)) {
      const arr = childrenMap.get(parentId) || [];
      arr.push(f);
      childrenMap.set(parentId, arr);
    }
  });

  const result: FolderTreeOption[] = [];
  const visited = new Set<string>();

  const walk = (node: ExamFolder, depth: number, ancestorNames: string[]) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const nextAncestors = [...ancestorNames, node.name];
    result.push({
      folder: node,
      depth,
      pathLabel: nextAncestors.join(" / "),
      ancestorNames: nextAncestors,
    });
    const children = sortFolderList(childrenMap.get(node.id) || [], sortOrder);
    children.forEach((child) => walk(child, depth + 1, nextAncestors));
  };

  sortFolderList(roots, sortOrder).forEach((root) => walk(root, 0, []));
  return result;
}

/**
 * Đếm số đề thi trực tiếp trong 1 thư mục
 */
export function getDirectExamCount(
  folderId: string,
  exams: any[],
  mappings?: Record<string, string | null>
): number {
  const map = mappings || getExamFolderMapping();
  return exams.filter((e) => getFolderIdForExam(e, map) === folderId).length;
}

/**
 * Đếm tổng số đề thi gồm cả thư mục hiện tại và mọi thư mục con/cháu bên trong
 */
export function getRecursiveExamCount(
  folders: ExamFolder[],
  folderId: string,
  exams: any[],
  mappings?: Record<string, string | null>
): number {
  const map = mappings || getExamFolderMapping();
  const subtreeSet = new Set(getRecursiveSubtreeIds(folders, folderId));
  return exams.filter((e) => {
    const fId = getFolderIdForExam(e, map);
    return !!fId && subtreeSet.has(fId);
  }).length;
}

let cachedExamFoldersTableAvailable: boolean | null = null;
const isVitestEnv = typeof process !== "undefined" && Boolean((process as any).env?.VITEST);

export function resetFolderStorageAvailabilityCache(): void {
  cachedExamFoldersTableAvailable = null;
}

function isExamFoldersUnavailable(): boolean {
  if (!isVitestEnv && cachedExamFoldersTableAvailable === false) return true;
  return isCapabilityUnavailable("table:exam_folders");
}

function markExamFoldersUnavailable(): void {
  if (!isVitestEnv) cachedExamFoldersTableAvailable = false;
  markCapabilityUnavailable("table:exam_folders");
}

function markExamFoldersAvailable(): void {
  if (!isVitestEnv) cachedExamFoldersTableAvailable = true;
  markCapabilityAvailable("table:exam_folders");
}

function isMissingFolderIdColumnError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (msg.includes("folder_id") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find")))
  );
}

function isExamFoldersTableMissingError(err: any): boolean {
  if (!err) return false;
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "").toLowerCase();
  if (code === "42703" || code === "PGRST204" || msg.includes("column ")) {
    return false;
  }
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    msg.includes("could not find the table") ||
    msg.includes('relation "public.exam_folders" does not exist') ||
    msg.includes('relation "exam_folders" does not exist')
  );
}

const SCHOOLS_FOLDER_KEY_PREFIX = "exam_folder:";
const SCHOOLS_EXAM_MAP_KEY_PREFIX = "exam_folder_map:";

async function upsertSchoolRegistryRow(nameKey: string, jsonValue: string): Promise<{ error: any }> {
  const schoolsApi = supabase.from("schools") as any;
  if (!schoolsApi || typeof schoolsApi.select !== "function") {
    return { error: new Error("Schools registry unavailable") };
  }
  const { data: existing, error: selErr } = await withRequestTimeout<any>(
    schoolsApi.select("id").eq("name_key", nameKey).maybeSingle(),
    8000,
    "folderStorage.upsertSchoolRegistryRow.select"
  );

  if (selErr) return { error: selErr };

  if (existing) {
    const updRes = await withRequestTimeout<any>(
      schoolsApi.update({ name: jsonValue }).eq("name_key", nameKey),
      8000,
      "folderStorage.upsertSchoolRegistryRow.update"
    );
    return { error: updRes?.error || null };
  }

  const insRes = await withRequestTimeout<any>(
    schoolsApi.insert({ name_key: nameKey, name: jsonValue }),
    8000,
    "folderStorage.upsertSchoolRegistryRow.insert"
  );
  return { error: insRes?.error || null };
}

async function deleteSchoolRegistryRow(nameKey: string): Promise<{ error: any }> {
  const schoolsApi = supabase.from("schools") as any;
  if (!schoolsApi || typeof schoolsApi.delete !== "function") {
    return { error: null };
  }
  const delRes = await withRequestTimeout<any>(
    schoolsApi.delete().eq("name_key", nameKey),
    8000,
    "folderStorage.deleteSchoolRegistryRow"
  );
  return { error: delRes?.error || null };
}

async function fetchFoldersFromSchoolsFallback(): Promise<{ data: ExamFolder[]; error: any }> {
  const schoolsApi = supabase.from("schools") as any;
  if (!schoolsApi || typeof schoolsApi.select !== "function") {
    return { data: [], error: null };
  }
  const baseQuery = schoolsApi.select("name_key, name");
  if (!baseQuery || typeof baseQuery.like !== "function") {
    return { data: [], error: null };
  }
  const { data, error } = await withRequestTimeout<any>(
    baseQuery.like("name_key", `${SCHOOLS_FOLDER_KEY_PREFIX}%`),
    8000,
    "folderStorage.fetchFoldersFromSchoolsFallback"
  );

  if (error || !Array.isArray(data)) {
    return { data: [], error };
  }

  const parsed: ExamFolder[] = [];
  for (const row of data) {
    if (!row?.name_key?.startsWith(SCHOOLS_FOLDER_KEY_PREFIX) || !row?.name) continue;
    try {
      const obj = JSON.parse(row.name);
      if (obj && obj.id && obj.name) {
        parsed.push({
          id: String(obj.id),
          name: String(obj.name),
          description: obj.description ?? null,
          color: obj.color || "sky",
          icon: obj.icon || "folder",
          parent_id: obj.parent_id || null,
          teacher_id: obj.teacher_id || null,
          created_at: obj.created_at || new Date().toISOString(),
          updated_at: obj.updated_at || new Date().toISOString(),
        });
      }
    } catch {}
  }

  return { data: parsed, error: null };
}

export async function syncRemoteExamFolderMappings(): Promise<Record<string, string | null>> {
  const localMap = getExamFolderMapping();
  try {
    const schoolsApi = supabase.from("schools") as any;
    if (!schoolsApi || typeof schoolsApi.select !== "function") {
      return localMap;
    }
    const baseQuery = schoolsApi.select("name_key, name");
    if (!baseQuery || typeof baseQuery.like !== "function") {
      return localMap;
    }
    const { data, error } = await withRequestTimeout<any>(
      baseQuery.like("name_key", `${SCHOOLS_EXAM_MAP_KEY_PREFIX}%`),
      8000,
      "folderStorage.syncRemoteExamFolderMappings"
    );

    if (error || !Array.isArray(data) || data.length === 0) {
      return localMap;
    }

    const merged = { ...localMap };
    let changed = false;
    for (const row of data) {
      if (!row?.name_key?.startsWith(SCHOOLS_EXAM_MAP_KEY_PREFIX) || !row?.name) continue;
      try {
        const obj = JSON.parse(row.name);
        if (obj?.examId) {
          const nextVal = obj.folderId ? String(obj.folderId) : null;
          if (!Object.prototype.hasOwnProperty.call(merged, obj.examId) && nextVal !== null) {
            merged[obj.examId] = nextVal;
            changed = true;
          }
        }
      } catch {}
    }

    if (changed) {
      saveExamFolderMapping(merged);
    }
    return merged;
  } catch {
    return localMap;
  }
}

function formatSupabaseFolderError(err: any, action: "create" | "update" | "delete"): string {
  if (isRequestTimeoutError(err)) {
    const actionLabel = action === "create" ? "tạo" : action === "update" ? "cập nhật" : "xóa";
    return `Kết nối máy chủ bị quá thời gian phản hồi khi ${actionLabel} thư mục. Vui lòng thử lại.`;
  }
  const code = String(err?.code || "");
  const msg = String(err?.message || err?.details || err?.hint || "");
  const lower = msg.toLowerCase();

  if (
    code === "PGRST204" ||
    code === "42703" ||
    (lower.includes("parent_id") &&
      (lower.includes("does not exist") || lower.includes("schema cache") || lower.includes("could not find")))
  ) {
    return "Bảng exam_folders trên Supabase chưa có cột parent_id. Vui lòng chạy migration 20261119000000_multilevel_exam_folders.sql để nâng cấp thư mục nhiều cấp.";
  }

  if (isExamFoldersTableMissingError(err)) {
    return "Chưa khởi tạo bảng thư mục (exam_folders) trên Supabase. Vui lòng chạy migration 20261119000000_multilevel_exam_folders.sql trong Supabase SQL Editor.";
  }

  if (code === "42501" || lower.includes("row-level security") || lower.includes("permission denied")) {
    return "Không đủ quyền bảo mật (RLS) trên Supabase để lưu thư mục. Vui lòng kiểm tra tài khoản đăng nhập hoặc chính sách RLS bảng exam_folders.";
  }

  if (code === "23503") {
    return "Thư mục cha chưa tồn tại trên máy chủ Supabase (lỗi khóa ngoại parent_id).";
  }

  if (code === "22023" && msg) {
    return msg;
  }

  const actionLabel = action === "create" ? "tạo" : action === "update" ? "cập nhật" : "xóa";
  return msg
    ? `Lỗi máy chủ Supabase khi ${actionLabel} thư mục: ${msg}`
    : `Không thể ${actionLabel} thư mục trên máy chủ Supabase.`;
}

async function syncAncestorFoldersToSupabase(
  parentId: string,
  allFolders: ExamFolder[],
  fallbackTeacherId: string | null
): Promise<{ error: any }> {
  const ancestorChain = getFolderPath(allFolders, parentId);
  if (ancestorChain.length === 0) {
    return { error: null };
  }

  const tableApi = supabase.from("exam_folders") as any;
  if (typeof tableApi?.upsert !== "function") {
    return { error: null };
  }

  for (const ancestor of ancestorChain) {
    const ancestorTeacherId = isUuid(ancestor.teacher_id)
      ? ancestor.teacher_id
      : isUuid(fallbackTeacherId)
        ? fallbackTeacherId
        : null;

    const ancestorPayload = {
      id: ancestor.id,
      name: ancestor.name,
      description: ancestor.description || null,
      color: ancestor.color || "sky",
      icon: ancestor.icon || "folder",
      parent_id: ancestor.parent_id && isUuid(ancestor.parent_id) ? ancestor.parent_id : null,
      teacher_id: ancestorTeacherId,
      created_at: ancestor.created_at || new Date().toISOString(),
      updated_at: ancestor.updated_at || new Date().toISOString(),
    };

    const upsertRes = await tableApi.upsert(ancestorPayload, { onConflict: "id" });
    if (upsertRes?.error) {
      return { error: upsertRes.error };
    }
  }

  return { error: null };
}

/**
 * Lấy danh sách thư mục của giáo viên (hoặc tất cả thư mục nếu là Admin).
 * Đồng bộ hai chiều giữa Supabase (`exam_folders` hoặc fallback `schools` registry nếu bảng chưa được tạo) và LocalStorage.
 */
export async function getFolders(teacherId?: string | null, isAdmin?: boolean): Promise<ExamFolder[]> {
  const localList = getLocalFolders();

  try {
    if (!isAdmin) {
      if (teacherId && !isUuid(teacherId)) {
        // Teacher ID không phải UUID (chế độ test/local): chỉ đọc từ local theo đúng teacherId
        return filterFoldersByAccess(localList, teacherId, false);
      }
      if (!teacherId) {
        return filterFoldersByAccess(localList, null, false);
      }
    }

    let remoteRows: any[] | null = null;
    let shouldUseSchoolsFallback = isExamFoldersUnavailable();

    if (!shouldUseSchoolsFallback) {
      let q = (supabase.from("exam_folders") as any).select("*").order("name", { ascending: true });
      if (!isAdmin && teacherId && isUuid(teacherId)) {
        q = q.eq("teacher_id", teacherId);
      }

      const { data, error } = await withRequestTimeout<any>(q, 8000, "folderStorage.getFolders");
      if (!error && Array.isArray(data)) {
        markExamFoldersAvailable();
        remoteRows = data;
      } else if (isExamFoldersTableMissingError(error)) {
        markExamFoldersUnavailable();
        shouldUseSchoolsFallback = true;
      } else if (error) {
        console.warn("[FolderStorage] Supabase getFolders warning:", error?.message || error);
      }
    }

    if (shouldUseSchoolsFallback) {
      const { data: fallbackRows } = await fetchFoldersFromSchoolsFallback();
      remoteRows = fallbackRows;
    }

    if (Array.isArray(remoteRows)) {
      const mergedMap = new Map<string, ExamFolder>();
      localList.forEach((f) => mergedMap.set(f.id, f));

      remoteRows.forEach((r: any) => {
        const existingLocal = mergedMap.get(r.id);
        const hasParentIdField = Object.prototype.hasOwnProperty.call(r, "parent_id");
        mergedMap.set(r.id, {
          id: r.id,
          name: r.name,
          description: r.description ?? existingLocal?.description ?? null,
          color: r.color || existingLocal?.color || "sky",
          icon: r.icon || existingLocal?.icon || "folder",
          parent_id: hasParentIdField ? r.parent_id || null : existingLocal?.parent_id || null,
          teacher_id: r.teacher_id ?? existingLocal?.teacher_id ?? null,
          created_at: r.created_at || existingLocal?.created_at || new Date().toISOString(),
          updated_at: r.updated_at || existingLocal?.updated_at || new Date().toISOString(),
        });
      });

      const combined = Array.from(mergedMap.values());
      saveLocalFolders(combined);

      return filterFoldersByAccess(combined, teacherId, isAdmin);
    }
  } catch (err) {
    console.warn("[FolderStorage] Supabase fetch note, fallback to local:", err);
  }

  return filterFoldersByAccess(localList, teacherId, isAdmin);
}

function hasDuplicateFolderNameInList(
  folders: ExamFolder[],
  name: string,
  excludeId?: string,
  parentId: string | null = null
): boolean {
  const cleanName = (name || "").trim().toLowerCase();
  if (!cleanName) return false;
  const targetParentId = parentId || null;

  return folders.some((f) => {
    if (excludeId && f.id === excludeId) return false;
    if ((f.parent_id || null) !== targetParentId) return false;
    return (f.name || "").trim().toLowerCase() === cleanName;
  });
}

/**
 * Kiểm tra tên thư mục có bị trùng trong CÙNG CẤP thư mục cha (và cùng giáo viên) không
 */
export async function checkDuplicateFolderName(
  name: string,
  teacherId?: string | null,
  excludeId?: string,
  isAdmin?: boolean,
  parentId: string | null = null
): Promise<boolean> {
  const cleanName = (name || "").trim().toLowerCase();
  if (!cleanName) return false;

  const folders = await getFolders(teacherId, isAdmin);
  return hasDuplicateFolderNameInList(folders, cleanName, excludeId, parentId);
}

/**
 * Tạo mới một thư mục đề thi (hỗ trợ cả thư mục gốc parent_id = null và thư mục con/cháu nhiều cấp)
 */
export async function createFolder(input: {
  name: string;
  description?: string | null;
  color?: string;
  icon?: string;
  parent_id?: string | null;
  teacher_id?: string | null;
  isAdmin?: boolean;
}): Promise<ExamFolder> {
  const cleanName = (input.name || "").trim();
  if (!cleanName) {
    throw new Error("Tên thư mục không được để trống");
  }

  const parentId = input.parent_id || null;
  const visibleFolders = await getFolders(input.teacher_id, input.isAdmin);
  let parentFolder: ExamFolder | undefined;

  if (parentId) {
    parentFolder = visibleFolders.find((f) => f.id === parentId);
    if (!parentFolder) {
      throw new Error("Thư mục cha không tồn tại hoặc bạn không có quyền truy cập.");
    }
    if (
      !input.isAdmin &&
      input.teacher_id &&
      parentFolder.teacher_id &&
      parentFolder.teacher_id !== input.teacher_id
    ) {
      throw new Error("Bạn không có quyền tạo thư mục con trong thư mục của giáo viên khác.");
    }
  }

  const isDup = hasDuplicateFolderNameInList(visibleFolders, cleanName, undefined, parentId);
  if (isDup) {
    throw new Error(
      parentId
        ? `Thư mục "${cleanName}" đã tồn tại trong thư mục này. Vui lòng đặt tên khác.`
        : `Thư mục "${cleanName}" đã tồn tại. Vui lòng đặt tên khác.`
    );
  }

  const preferredTeacherId = (
    input.isAdmin && parentFolder?.teacher_id
      ? parentFolder.teacher_id
      : input.teacher_id || parentFolder?.teacher_id || null
  ) as string | null;

  const isLocalOnlyMode = Boolean(preferredTeacherId && !isUuid(preferredTeacherId));

  if (!isLocalOnlyMode && parentId && !isUuid(parentId)) {
    throw new Error("ID thư mục cha không hợp lệ.");
  }

  const id = generateUuid();
  const now = new Date().toISOString();
  const newFolder: ExamFolder = {
    id,
    name: cleanName,
    description: input.description?.trim() || null,
    color: input.color || "sky",
    icon: input.icon || "folder",
    parent_id: parentId,
    teacher_id: preferredTeacherId,
    created_at: now,
    updated_at: now,
  };

  // 1. Lưu trước vào local storage để các thao tác cây thư mục nhận diện tức thì
  const previousLocalList = getLocalFolders();
  saveLocalFolders([newFolder, ...previousLocalList]);

  if (isLocalOnlyMode) {
    return newFolder;
  }

  // 2. Đồng bộ lên Supabase — tuyệt đối không cắt bỏ parent_id, rollback và báo lỗi nếu Supabase thất bại
  let resolvedTeacherId: string | null = isUuid(preferredTeacherId) ? preferredTeacherId : null;
  let syncResult: { data?: any; error?: any } | undefined;

  try {
    syncResult = await withSupabaseAuthRetry(async (uid) => {
      resolvedTeacherId = isUuid(preferredTeacherId)
        ? preferredTeacherId
        : isUuid(uid)
          ? uid
          : null;

      const folderRecord: ExamFolder = {
        ...newFolder,
        teacher_id: resolvedTeacherId,
      };

      const payload: Record<string, any> = {
        id: folderRecord.id,
        name: folderRecord.name,
        description: folderRecord.description,
        color: folderRecord.color,
        icon: folderRecord.icon,
        parent_id: parentId || null,
        teacher_id: resolvedTeacherId,
        created_at: folderRecord.created_at,
        updated_at: folderRecord.updated_at,
      };

      if (isExamFoldersUnavailable()) {
        return await upsertSchoolRegistryRow(
          `${SCHOOLS_FOLDER_KEY_PREFIX}${folderRecord.id}`,
          JSON.stringify(folderRecord)
        );
      }

      let res = await (supabase.from("exam_folders") as any).insert(payload);

      if (!res?.error) {
        markExamFoldersAvailable();
        return res;
      }

      // Nếu bảng exam_folders chưa được tạo trên Supabase (PGRST205), đồng bộ sang bảng schools registry
      if (isExamFoldersTableMissingError(res.error)) {
        markExamFoldersUnavailable();
        const fallbackRes = await upsertSchoolRegistryRow(
          `${SCHOOLS_FOLDER_KEY_PREFIX}${folderRecord.id}`,
          JSON.stringify(folderRecord)
        );
        return fallbackRes?.error ? res : fallbackRes;
      }

      // Nếu thư mục cha chỉ mới nằm ở localStorage chưa kịp có trên Supabase (23503), tự động đồng bộ chuỗi cha trước rồi thử lại
      if (res?.error?.code === "23503" && parentId) {
        const ancestorSync = await syncAncestorFoldersToSupabase(
          parentId,
          previousLocalList,
          resolvedTeacherId
        );
        if (!ancestorSync.error) {
          res = await (supabase.from("exam_folders") as any).insert(payload);
        }
      }

      return res;
    });
  } catch (err) {
    saveLocalFolders(previousLocalList);
    console.warn("[FolderStorage] Supabase insert folder exception:", err);
    throw new Error(formatSupabaseFolderError(err, "create"));
  }

  if (syncResult?.error) {
    saveLocalFolders(previousLocalList);
    console.warn("[FolderStorage] Supabase insert folder error:", syncResult.error);
    throw new Error(formatSupabaseFolderError(syncResult.error, "create"));
  }

  if (resolvedTeacherId && newFolder.teacher_id !== resolvedTeacherId) {
    newFolder.teacher_id = resolvedTeacherId;
    saveLocalFolders([newFolder, ...previousLocalList]);
  }

  return newFolder;
}

/**
 * Cập nhật thông tin thư mục (Đổi tên, mô tả, màu sắc, icon, hoặc di chuyển parent_id)
 */
export async function updateFolder(
  id: string,
  updates: Partial<Pick<ExamFolder, "name" | "description" | "color" | "icon" | "parent_id">>,
  teacherId?: string | null,
  isAdmin?: boolean
): Promise<ExamFolder> {
  const localList = getLocalFolders();
  let existing = localList.find((f) => f.id === id);

  if (!existing) {
    const fetched = await getFolders(teacherId, isAdmin);
    existing = fetched.find((f) => f.id === id);
  }

  if (!existing) {
    throw new Error("Không tìm thấy thư mục cần cập nhật");
  }

  if (!isAdmin && teacherId && existing.teacher_id && existing.teacher_id !== teacherId) {
    throw new Error("Bạn không có quyền chỉnh sửa thư mục của giáo viên khác.");
  }

  const allFolders = await getFolders(existing.teacher_id || teacherId, isAdmin);
  const nextParentId =
    updates.parent_id !== undefined ? updates.parent_id || null : existing.parent_id || null;

  if (updates.parent_id !== undefined) {
    const validation = canMoveFolder(allFolders, id, nextParentId);
    if (!validation.valid) {
      throw new Error(validation.reason || "Không thể di chuyển thư mục tới vị trí này.");
    }
  }

  const nextName =
    updates.name !== undefined ? updates.name.trim() : existing.name;

  if (!nextName) {
    throw new Error("Tên thư mục không được để trống");
  }

  if (updates.name !== undefined || updates.parent_id !== undefined) {
    const isDup = hasDuplicateFolderNameInList(allFolders, nextName, id, nextParentId);
    if (isDup) {
      throw new Error(`Tên thư mục "${nextName}" đã tồn tại ở cấp thư mục này.`);
    }
  }

  const updatedFolder: ExamFolder = {
    ...existing,
    name: nextName,
    description:
      updates.description !== undefined ? updates.description?.trim() || null : existing.description,
    color: updates.color !== undefined ? updates.color : existing.color,
    icon: updates.icon !== undefined ? updates.icon : existing.icon,
    parent_id: nextParentId,
    updated_at: new Date().toISOString(),
  };

  const existsInLocal = localList.some((f) => f.id === id);
  saveLocalFolders(
    existsInLocal
      ? localList.map((f) => (f.id === id ? updatedFolder : f))
      : [updatedFolder, ...localList]
  );

  const effectiveTeacherId = existing.teacher_id ?? teacherId;
  const isLocalOnlyMode = Boolean(effectiveTeacherId && !isUuid(effectiveTeacherId));
  if (isLocalOnlyMode) {
    return updatedFolder;
  }

  let syncResult: { data?: any; error?: any } | undefined;
  try {
    syncResult = await withSupabaseAuthRetry(async (uid) => {
      if (isExamFoldersUnavailable()) {
        return await upsertSchoolRegistryRow(
          `${SCHOOLS_FOLDER_KEY_PREFIX}${updatedFolder.id}`,
          JSON.stringify(updatedFolder)
        );
      }

      const updatePayload: Record<string, any> = {
        name: updatedFolder.name,
        description: updatedFolder.description,
        color: updatedFolder.color,
        icon: updatedFolder.icon,
        parent_id: updatedFolder.parent_id || null,
        updated_at: updatedFolder.updated_at,
      };

      let res = await (supabase.from("exam_folders") as any)
        .update(updatePayload)
        .eq("id", id);

      if (isExamFoldersTableMissingError(res?.error)) {
        markExamFoldersUnavailable();
        const fallbackRes = await upsertSchoolRegistryRow(
          `${SCHOOLS_FOLDER_KEY_PREFIX}${updatedFolder.id}`,
          JSON.stringify(updatedFolder)
        );
        return fallbackRes?.error ? res : fallbackRes;
      }

      if (res?.error?.code === "23503" && nextParentId) {
        const ancestorSync = await syncAncestorFoldersToSupabase(
          nextParentId,
          allFolders,
          isUuid(effectiveTeacherId) ? effectiveTeacherId : isUuid(uid) ? uid : null
        );
        if (!ancestorSync.error) {
          res = await (supabase.from("exam_folders") as any)
            .update(updatePayload)
            .eq("id", id);
        }
      }

      return res;
    });
  } catch (err) {
    saveLocalFolders(localList);
    console.warn("[FolderStorage] Supabase update folder exception:", err);
    throw new Error(formatSupabaseFolderError(err, "update"));
  }

  if (syncResult?.error) {
    saveLocalFolders(localList);
    console.warn("[FolderStorage] Supabase update folder error:", syncResult.error);
    throw new Error(formatSupabaseFolderError(syncResult.error, "update"));
  }

  return updatedFolder;
}

/**
 * Di chuyển một thư mục (giữ nguyên toàn bộ thư mục con và đề thi bên trong) sang thư mục cha mới hoặc về cấp gốc (null)
 */
export async function moveFolder(
  folderId: string,
  newParentId: string | null,
  teacherId?: string | null,
  isAdmin?: boolean
): Promise<ExamFolder> {
  return updateFolder(
    folderId,
    { parent_id: newParentId || null },
    teacherId,
    isAdmin
  );
}

/**
 * Xóa thư mục an toàn:
 * QUY TẮC BẢO VỆ:
 * - Tuyệt đối không xóa các đề thi bên trong (các đề thi trực tiếp thuộc thư mục bị xóa chuyển về "Đề thi chưa phân loại").
 * - Nếu thư mục có thư mục con, các thư mục con trực tiếp được nâng lên cấp cha của thư mục bị xóa (hoặc cấp gốc nếu không có cha),
 *   giữ nguyên toàn bộ cây thư mục cháu và đề thi bên trong chúng.
 * - Không xóa mã bài thi, QR code, kết quả hay dữ liệu làm bài.
 */
export async function deleteFolder(
  id: string,
  teacherId?: string | null,
  isAdmin?: boolean
): Promise<boolean> {
  const localList = getLocalFolders();
  const target = localList.find((f) => f.id === id);

  if (target && !isAdmin && teacherId && target.teacher_id && target.teacher_id !== teacherId) {
    throw new Error("Bạn không có quyền xóa thư mục của giáo viên khác.");
  }

  const fallbackParentId = target?.parent_id || null;

  // 1. Chuyển toàn bộ đề thi trực tiếp trong thư mục này về Chưa phân loại (null)
  const previousMappings = getExamFolderMapping();
  const mappings = { ...previousMappings };
  const affectedExamIds: string[] = [];
  let changedMapping = false;
  Object.keys(mappings).forEach((examId) => {
    if (mappings[examId] === id) {
      mappings[examId] = null;
      affectedExamIds.push(examId);
      changedMapping = true;
    }
  });
  if (changedMapping) {
    saveExamFolderMapping(mappings);
    updateUnifiedExamsFolderId(affectedExamIds, null);
  }

  // 2. Nâng các thư mục con trực tiếp lên parent của thư mục bị xóa và xóa thư mục khỏi local
  const reparentedChildren: ExamFolder[] = [];
  const nextLocal = localList
    .filter((f) => f.id !== id)
    .map((f) => {
      if ((f.parent_id || null) === id) {
        const updatedChild = {
          ...f,
          parent_id: fallbackParentId,
          updated_at: new Date().toISOString(),
        };
        reparentedChildren.push(updatedChild);
        return updatedChild;
      }
      return f;
    });
  saveLocalFolders(nextLocal);

  const effectiveTeacherId = target?.teacher_id ?? teacherId;
  const isLocalOnlyMode = Boolean(effectiveTeacherId && !isUuid(effectiveTeacherId));
  if (isLocalOnlyMode) {
    return true;
  }

  const deleteFromSchoolsFallback = async () => {
    for (const child of reparentedChildren) {
      const updRes = await upsertSchoolRegistryRow(
        `${SCHOOLS_FOLDER_KEY_PREFIX}${child.id}`,
        JSON.stringify(child)
      );
      if (updRes.error) return updRes;
    }
    for (const examId of affectedExamIds) {
      await deleteSchoolRegistryRow(`${SCHOOLS_EXAM_MAP_KEY_PREFIX}${examId}`);
    }
    return await deleteSchoolRegistryRow(`${SCHOOLS_FOLDER_KEY_PREFIX}${id}`);
  };

  // 3. Đồng bộ lên Supabase
  let syncResult: { data?: any; error?: any } | undefined;
  try {
    syncResult = await withSupabaseAuthRetry(async () => {
      if (isExamFoldersUnavailable()) {
        return await deleteFromSchoolsFallback();
      }

      // Nâng thư mục con lên fallbackParentId trước khi xóa cha
      const reparentRes = await (supabase.from("exam_folders") as any)
        .update({ parent_id: isUuid(fallbackParentId) ? fallbackParentId : null })
        .eq("parent_id", id);

      if (isExamFoldersTableMissingError(reparentRes?.error)) {
        markExamFoldersUnavailable();
        const fallbackRes = await deleteFromSchoolsFallback();
        return fallbackRes?.error ? reparentRes : fallbackRes;
      }

      if (reparentRes?.error) {
        return reparentRes;
      }

      // Unlink exams trực tiếp khỏi thư mục (chịu lỗi nếu cột folder_id chưa tạo)
      if (!isCapabilityUnavailable("col:exams.folder_id")) {
        const unlinkRes = await (supabase.from("exams") as any)
          .update({ folder_id: null })
          .eq("folder_id", id);
        if (unlinkRes?.error) {
          if (isMissingFolderIdColumnError(unlinkRes.error)) {
            markCapabilityUnavailable("col:exams.folder_id");
          } else {
            console.warn("[FolderStorage] Unlink exams folder_id warning:", unlinkRes.error);
          }
        }
      }

      // Delete folder
      const delRes = await (supabase.from("exam_folders") as any).delete().eq("id", id);
      if (isExamFoldersTableMissingError(delRes?.error)) {
        markExamFoldersUnavailable();
        const fallbackRes = await deleteFromSchoolsFallback();
        return fallbackRes?.error ? delRes : fallbackRes;
      }
      return delRes;
    });
  } catch (err) {
    saveLocalFolders(localList);
    if (changedMapping) {
      saveExamFolderMapping(previousMappings);
      updateUnifiedExamsFolderId(affectedExamIds, id);
    }
    console.warn("[FolderStorage] Supabase delete folder exception:", err);
    throw new Error(formatSupabaseFolderError(err, "delete"));
  }

  if (syncResult?.error) {
    saveLocalFolders(localList);
    if (changedMapping) {
      saveExamFolderMapping(previousMappings);
      updateUnifiedExamsFolderId(affectedExamIds, id);
    }
    console.warn("[FolderStorage] Supabase delete folder error:", syncResult.error);
    throw new Error(formatSupabaseFolderError(syncResult.error, "delete"));
  }

  return true;
}

/**
 * Chuyển một đề thi vào một thư mục bất kỳ cấp độ (hoặc đưa về Chưa phân loại nếu folderId là null)
 */
export async function moveExamToFolder(
  examId: string,
  folderId: string | null,
  options?: { localOnly?: boolean }
): Promise<boolean> {
  if (!examId) return false;

  const mappings = getExamFolderMapping();
  mappings[examId] = folderId;
  saveExamFolderMapping(mappings);
  updateUnifiedExamsFolderId([examId], folderId);

  if (options?.localOnly) {
    return true;
  }

  try {
    await withSupabaseAuthRetry(async () => {
      if (isCapabilityUnavailable("col:exams.folder_id")) {
        if (folderId) {
          return await upsertSchoolRegistryRow(
            `${SCHOOLS_EXAM_MAP_KEY_PREFIX}${examId}`,
            JSON.stringify({ examId, folderId, updated_at: new Date().toISOString() })
          );
        }
        return await deleteSchoolRegistryRow(`${SCHOOLS_EXAM_MAP_KEY_PREFIX}${examId}`);
      }

      const res = await (supabase.from("exams") as any)
        .update({ folder_id: folderId })
        .eq("id", examId);

      if (isMissingFolderIdColumnError(res?.error)) {
        markCapabilityUnavailable("col:exams.folder_id");
        if (folderId) {
          return await upsertSchoolRegistryRow(
            `${SCHOOLS_EXAM_MAP_KEY_PREFIX}${examId}`,
            JSON.stringify({ examId, folderId, updated_at: new Date().toISOString() })
          );
        }
        return await deleteSchoolRegistryRow(`${SCHOOLS_EXAM_MAP_KEY_PREFIX}${examId}`);
      }
      return res;
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

  const mappings = getExamFolderMapping();
  examIds.forEach((eid) => {
    mappings[eid] = folderId;
  });
  saveExamFolderMapping(mappings);
  updateUnifiedExamsFolderId(examIds, folderId);

  try {
    await withSupabaseAuthRetry(async () => {
      const saveFallback = async () => {
        for (const eid of examIds) {
          if (folderId) {
            await upsertSchoolRegistryRow(
              `${SCHOOLS_EXAM_MAP_KEY_PREFIX}${eid}`,
              JSON.stringify({ examId: eid, folderId, updated_at: new Date().toISOString() })
            );
          } else {
            await deleteSchoolRegistryRow(`${SCHOOLS_EXAM_MAP_KEY_PREFIX}${eid}`);
          }
        }
        return { data: null, error: null };
      };

      if (isCapabilityUnavailable("col:exams.folder_id")) {
        return await saveFallback();
      }

      const res = await (supabase.from("exams") as any)
        .update({ folder_id: folderId })
        .in("id", examIds);

      if (isMissingFolderIdColumnError(res?.error)) {
        markCapabilityUnavailable("col:exams.folder_id");
        return await saveFallback();
      }
      return res;
    });
  } catch (err) {
    console.warn("[FolderStorage] Supabase batch move exams error (fallback mappings kept):", err);
  }

  return true;
}

/**
 * Xác định chính xác đề thi thuộc thư mục nào:
 * Ưu tiên:
 * 1. mappings[exam.id] nếu có bản ghi cục bộ mới nhất (bao gồm cả null khi vừa đưa ra ngoài)
 * 2. exam.folder_id (từ Supabase / unified exam object)
 * 3. null (chưa phân loại)
 */
export function getFolderIdForExam(
  exam: any,
  mappings?: Record<string, string | null>
): string | null {
  if (!exam) return null;
  const map = mappings || getExamFolderMapping();
  if (map && exam.id && Object.prototype.hasOwnProperty.call(map, exam.id)) {
    const mapped = map[exam.id];
    return mapped ? String(mapped) : null;
  }
  if (exam.folder_id !== undefined && exam.folder_id !== null && exam.folder_id !== "") {
    return String(exam.folder_id);
  }
  return null;
}
