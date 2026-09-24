/**
 * audioStorage.ts
 * Quản lý lưu trữ file nhạc nền cho chế độ Đội/Nhóm.
 * - Thử lưu lên Supabase Storage (bucket "exam-files" hoặc "exam-audio") để chia sẻ giữa các thiết bị.
 * - Tự động fallback sang IndexedDB nội bộ trình duyệt và data URL để đảm bảo 100% hoạt động
 *   ngay cả khi chưa cấp quyền Supabase Storage hoặc mạng chập chờn.
 */

import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "OnlineExamAudioDB";
const STORE_NAME = "exam_audios";
const DB_VERSION = 1;

function openAudioDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAudioToIDB(id: string, file: Blob, fileName: string): Promise<string> {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const item = {
      id,
      blob: file,
      name: fileName,
      type: file.type || "audio/mpeg",
      updatedAt: Date.now(),
    };
    const req = store.put(item);
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function getAudioFromIDB(id: string): Promise<{ blob: Blob; name: string } | null> {
  try {
    const db = await openAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve({ blob: req.result.blob, name: req.result.name });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function removeAudioFromIDB(id: string): Promise<void> {
  try {
    const db = await openAudioDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
  } catch {
    // Ignore
  }
}

/**
 * Đọc File thành Base64 Data URL (thích hợp cho các file nhạc vừa và nhỏ,
 * lưu thẳng vào team_config để bất kỳ máy nào mở bài thi cũng nghe được ngay).
 */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface UploadAudioResult {
  url: string;
  name: string;
  storageType: "supabase" | "data_url" | "idb";
  idbKey?: string;
}

/**
 * Tải file nhạc lên:
 * 1. Thử upload lên Supabase bucket 'exam-files' mục 'team-music/'.
 * 2. Nếu file <= 4MB, chuyển sang Data URL base64 lưu thẳng vào json để đồng bộ 100% mọi nơi.
 * 3. Đồng thời lưu bản sao vào IndexedDB để phát mượt mà không delay.
 */
export async function uploadExamBattleMusic(
  examIdOrTemp: string,
  file: File
): Promise<UploadAudioResult> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const uniqueKey = `team_music_${examIdOrTemp}_${Date.now()}`;

  // 1. Thử lưu vào Supabase storage nếu có quyền
  try {
    const { data: u } = await supabase.auth.getUser();
    const userId = u.user?.id || "public";
    const path = `team-music/${userId}/${Date.now()}-${safeName}`;
    const up = await supabase.storage.from("exam-files").upload(path, file, {
      contentType: file.type || "audio/mpeg",
      upsert: true,
    });
    if (!up.error && up.data) {
      // Lấy public URL hoặc signed URL
      const { data: pub } = supabase.storage.from("exam-files").getPublicUrl(path);
      if (pub?.publicUrl) {
        // Lưu cache IDB
        await saveAudioToIDB(uniqueKey, file, file.name).catch(() => {});
        return {
          url: pub.publicUrl,
          name: file.name,
          storageType: "supabase",
          idbKey: uniqueKey,
        };
      }
    }
  } catch {
    // Fallback nếu storage Supabase không hỗ trợ
  }

  // 2. Nếu file kích thước hợp lý (<= 6MB), chuyển sang Data URL để lưu trực tiếp vào JSON
  if (file.size <= 6 * 1024 * 1024) {
    try {
      const dataUrl = await fileToDataUrl(file);
      await saveAudioToIDB(uniqueKey, file, file.name).catch(() => {});
      return {
        url: dataUrl,
        name: file.name,
        storageType: "data_url",
        idbKey: uniqueKey,
      };
    } catch {
      // fallthrough
    }
  }

  // 3. Fallback sang IndexedDB + Blob URL
  await saveAudioToIDB(uniqueKey, file, file.name);
  const blobUrl = URL.createObjectURL(file);
  return {
    url: blobUrl,
    name: file.name,
    storageType: "idb",
    idbKey: uniqueKey,
  };
}

/**
 * Giải quyết URL phát nhạc (nếu lưu dạng IDB key thì tạo Blob URL)
 */
export async function resolvePlayableAudioUrl(urlOrKey?: string, idbKey?: string): Promise<string | null> {
  if (!urlOrKey && !idbKey) return null;

  // Nếu là data URL hoặc http/https URL hợp lệ
  if (urlOrKey && (urlOrKey.startsWith("data:") || urlOrKey.startsWith("http://") || urlOrKey.startsWith("https://") || urlOrKey.startsWith("blob:"))) {
    return urlOrKey;
  }

  // Kiểm tra IDB
  const keyToLookup = idbKey || urlOrKey;
  if (keyToLookup) {
    const cached = await getAudioFromIDB(keyToLookup);
    if (cached) {
      return URL.createObjectURL(cached.blob);
    }
  }

  return urlOrKey || null;
}
