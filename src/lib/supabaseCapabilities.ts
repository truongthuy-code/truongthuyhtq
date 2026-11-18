export type SupabaseCapabilityKey =
  | "table:exam_folders"
  | "table:exam_short_links"
  | "table:teacher_registrations"
  | "col:exams.folder_id"
  | "rpc:check_exam_code_taken"
  | "rpc:sync_exam_codes_and_links"
  | "rpc:resolve_exam_short_link"
  | "rpc:resolve_exam_access_code"
  | "rpc:get_exam_for_student"
  | "rpc:log_exam_access_event"
  | "rpc:get_my_account_state"
  | (string & {});

interface CapabilityEntry {
  available: boolean;
  updatedAt: number;
}

const DEFAULT_UNAVAILABLE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_AVAILABLE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const isVitestEnv = typeof process !== "undefined" && Boolean((process as any).env?.VITEST);

const capabilityMap = new Map<string, CapabilityEntry>();
let forceCacheInTests = false;

export function setSupabaseCapabilitiesCacheEnabledForTest(enabled: boolean): void {
  forceCacheInTests = enabled;
}

export function resetSupabaseCapabilitiesCache(): void {
  capabilityMap.clear();
}

function isCacheActive(): boolean {
  return !isVitestEnv || forceCacheInTests;
}

export function isCapabilityUnavailable(key: SupabaseCapabilityKey): boolean {
  if (!isCacheActive()) return false;
  const entry = capabilityMap.get(key);
  if (!entry) return false;
  const ttl = entry.available ? DEFAULT_AVAILABLE_TTL_MS : DEFAULT_UNAVAILABLE_TTL_MS;
  if (Date.now() - entry.updatedAt > ttl) {
    capabilityMap.delete(key);
    return false;
  }
  return entry.available === false;
}

export function markCapabilityUnavailable(key: SupabaseCapabilityKey): void {
  if (!isCacheActive()) return;
  capabilityMap.set(key, { available: false, updatedAt: Date.now() });
}

export function markCapabilityAvailable(key: SupabaseCapabilityKey): void {
  if (!isCacheActive()) return;
  capabilityMap.set(key, { available: true, updatedAt: Date.now() });
}

export function isMissingTableOrRpcError(err: any, targetName?: string): boolean {
  if (!err) return false;
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "").toLowerCase();
  const details = String(err?.details || "").toLowerCase();
  const status = Number(err?.status || err?.statusCode || 0);

  if (code === "42703" || code === "PGRST204") {
    return false;
  }

  if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01") {
    return true;
  }

  if (
    status === 404 &&
    (msg.includes("could not find") ||
      msg.includes("schema cache") ||
      msg.includes("does not exist") ||
      msg.includes("not found"))
  ) {
    return true;
  }

  if (
    msg.includes("could not find the table") ||
    msg.includes("could not find the function") ||
    (targetName ? msg.includes(targetName.toLowerCase()) && msg.includes("does not exist") : false) ||
    details.includes("does not exist")
  ) {
    return true;
  }

  return false;
}

export function isMissingColumnError(err: any, columnName?: string): boolean {
  if (!err) return false;
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "").toLowerCase();
  const col = columnName ? columnName.toLowerCase() : "";

  if (code === "42703" || code === "PGRST204") {
    if (!col || msg.includes(col)) return true;
    return code === "42703" || code === "PGRST204";
  }

  if (
    col &&
    msg.includes(col) &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"))
  ) {
    return true;
  }

  return false;
}

if (typeof Storage !== "undefined" && Storage.prototype && typeof Storage.prototype.clear === "function") {
  try {
    const origClear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      capabilityMap.clear();
      return origClear.apply(this);
    };
  } catch {}
}
