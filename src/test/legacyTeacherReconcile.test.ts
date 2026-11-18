import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import adminHandler, {
  assembleAndClassifyTeacherAccounts,
  fetchAllRows,
  fetchAllAuthUsers,
} from "../../api/admin";

function makeJwt(payloadObj: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  return `${header}.${payload}.signature`;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    setHeader(k: string, v: string) {
      res.headers[k] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

describe("Legacy Teacher Account Audit, Pagination & Idempotent Reconciliation", () => {
  const originalEnv = { ...process.env };
  const serviceJwt = makeJwt({
    iss: "supabase",
    ref: "zhixpglctyfffpwamixv",
    role: "service_role",
    iat: 1777960186,
    exp: 2093536186,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it("classifies Groups A–G, UNRESOLVED, excludes super_admin and pure students accurately", () => {
    const result = assembleAndClassifyTeacherAccounts({
      authUsers: [
        { id: "uid-super", email: "bichthuylqd@gmail.com", app_metadata: { role: "super_admin" }, created_at: "2025-01-01T00:00:00Z" },
        { id: "uid-a", email: "clean@school.edu.vn", created_at: "2025-02-01T00:00:00Z" },
        { id: "uid-b", email: "oldpending@school.edu.vn", created_at: "2025-03-01T00:00:00Z" },
        { id: "uid-c", email: "noprofile@school.edu.vn", user_metadata: { full_name: "Cô Mai" }, created_at: "2025-04-01T00:00:00Z" },
        { id: "uid-d", email: "incomplete@school.edu.vn", created_at: "2025-04-10T00:00:00Z" },
        { id: "uid-e", email: "mismatch@school.edu.vn", created_at: "2025-05-01T00:00:00Z" },
        { id: "uid-f", email: "newreg@school.edu.vn", created_at: "2026-11-15T00:00:00Z" },
        { id: "uid-g-locked", email: "locked@school.edu.vn", created_at: "2025-06-01T00:00:00Z" },
        { id: "uid-g-rej", email: "rejected@school.edu.vn", created_at: "2026-11-10T00:00:00Z" },
        { id: "uid-student", email: "hs12a1@student.edu.vn", user_metadata: { role: "student" }, created_at: "2026-10-01T00:00:00Z" },
      ],
      profiles: [
        { id: "uid-super", email: "bichthuylqd@gmail.com", username: "bichthuylqd", full_name: "Super Admin", role: "super_admin", status: "active", approval_status: "APPROVED", is_deleted: false },
        { id: "uid-a", email: "clean@school.edu.vn", username: "clean", full_name: "Thầy A", role: "teacher", status: "active", approval_status: "APPROVED", is_deleted: false },
        { id: "uid-b", email: "oldpending@school.edu.vn", username: "oldpending", full_name: "Cô B", role: "teacher", status: "pending", approval_status: "PENDING", is_deleted: false },
        // uid-c intentionally missing from profiles!
        { id: "uid-d", email: "incomplete@school.edu.vn", username: null, full_name: null, role: null, status: "active", approval_status: "APPROVED", is_deleted: null },
        { id: "uid-e", email: "mismatch@school.edu.vn", username: "mismatch", full_name: "Thầy E", role: "teacher", status: "active", approval_status: "PENDING", is_deleted: false },
        { id: "uid-f", email: "newreg@school.edu.vn", username: "newreg", full_name: "GV Mới F", role: "teacher", status: "pending", approval_status: "PENDING", is_deleted: false },
        { id: "uid-g-locked", email: "locked@school.edu.vn", username: "lockedgv", full_name: "GV Khóa", role: "teacher", status: "locked", approval_status: "LOCKED", is_deleted: false },
        { id: "uid-g-rej", email: "rejected@school.edu.vn", username: "rejgv", full_name: "GV Từ Chối", role: "teacher", status: "rejected", approval_status: "REJECTED", is_deleted: false },
        { id: "uid-student", email: "hs12a1@student.edu.vn", username: "hs12a1", full_name: "Học sinh A", role: "student", status: "active", approval_status: "APPROVED", is_deleted: false },
      ],
      userRoles: [
        { user_id: "uid-a", role: "teacher" },
        { user_id: "uid-b", role: "teacher" },
        { user_id: "uid-d", role: "teacher" },
        // uid-e intentionally missing teacher role too
        { user_id: "uid-f", role: "teacher" },
        { user_id: "uid-student", role: "student" },
      ],
      registrations: [
        { id: "reg-f", user_id: "uid-f", email: "newreg@school.edu.vn", full_name: "GV Mới F", status: "PENDING" },
        { id: "reg-g", user_id: "uid-g-rej", email: "rejected@school.edu.vn", full_name: "GV Từ Chối", status: "REJECTED", rejection_reason: "Không hợp lệ" },
      ],
      exams: [
        { id: "ex-1", created_by: "uid-b", is_deleted: false },
        { id: "ex-2", created_by: "uid-c", is_deleted: false },
        { id: "ex-orphan", created_by: "uid-orphan-no-auth", is_deleted: false },
      ],
      folders: [
        { id: "fld-1", teacher_id: "uid-c", is_deleted: false },
      ],
    });

    const byId = new Map(result.accounts.map((a) => [a.id, a]));

    expect(byId.has("uid-super")).toBe(false);
    expect(byId.has("uid-student")).toBe(false);

    expect(byId.get("uid-a")?.sync_group).toBe("A");
    expect(byId.get("uid-b")?.sync_group).toBe("B");
    expect(byId.get("uid-b")?.approval_status).toBe("APPROVED"); // Restored legacy
    expect(byId.get("uid-c")?.sync_group).toBe("C");
    expect(byId.get("uid-c")?.missing_profile).toBe(true);
    expect(byId.get("uid-c")?.exam_count).toBe(1);
    expect(byId.get("uid-c")?.folder_count).toBe(1);
    expect(byId.get("uid-d")?.sync_group).toBe("D");
    expect(byId.get("uid-e")?.sync_group).toBe("E");
    expect(byId.get("uid-f")?.sync_group).toBe("F");
    expect(byId.get("uid-f")?.approval_status).toBe("PENDING"); // Preserved new pending
    expect(byId.get("uid-g-locked")?.sync_group).toBe("G");
    expect(byId.get("uid-g-locked")?.approval_status).toBe("LOCKED");
    expect(byId.get("uid-g-rej")?.sync_group).toBe("G");
    expect(byId.get("uid-g-rej")?.approval_status).toBe("REJECTED");
    expect(byId.get("uid-orphan-no-auth")?.sync_group).toBe("UNRESOLVED");

    expect(result.stats.total_auth_users).toBe(10);
    expect(result.stats.total_students_skipped).toBe(1);
    expect(result.stats.missing_profiles_created).toBe(1);
    expect(result.stats.legacy_pending_restored).toBe(1);
    expect(result.stats.status_mismatch_synced).toBe(2); // D + E
    expect(result.stats.new_pending_preserved).toBe(1);
    expect(result.stats.locked_rejected_preserved).toBe(2);
    expect(result.unresolved_errors).toHaveLength(1);
    expect(result.unresolved_errors[0].user_id).toBe("uid-orphan-no-auth");
  });

  it("paginates beyond 1,000 rows in fetchAllRows and >1,000 auth users in fetchAllAuthUsers", async () => {
    const all2500Rows = Array.from({ length: 2500 }, (_, i) => ({ id: `row-${i}` }));
    const mockDb = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async (from: number, to: number) => ({
              data: all2500Rows.slice(from, to + 1),
              error: null,
            }),
          }),
        }),
      }),
    };

    const res = await fetchAllRows(mockDb, "profiles", "*", { orderCol: "created_at" });
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(2500);

    const all1500Users = Array.from({ length: 1500 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@test.vn` }));
    const mockAuthClient = {
      auth: {
        admin: {
          listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
            const start = (page - 1) * perPage;
            return {
              data: { users: all1500Users.slice(start, start + perPage) },
              error: null,
            };
          },
        },
      },
    };

    const authRes = await fetchAllAuthUsers(mockAuthClient);
    expect(authRes.accessible).toBe(true);
    expect(authRes.users).toHaveLength(1500);
  });

  it("executes idempotent Node fallback reconciliation via /api/admin, handles username collisions and per-row errors safely", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceJwt;

    const dbState: {
      authUsers: any[];
      profiles: any[];
      userRoles: any[];
      registrations: any[];
      exams: any[];
      folders: any[];
      logs: any[];
    } = {
      authUsers: [
        { id: "admin-1", email: "bichthuylqd@gmail.com", app_metadata: { role: "super_admin" }, created_at: "2024-01-01T00:00:00Z" },
        { id: "gv-c1", email: "lan@gmail.com", user_metadata: { full_name: "Cô Lan 1" }, created_at: "2025-01-10T00:00:00Z" },
        { id: "gv-c2", email: "lan@yahoo.com", user_metadata: { full_name: "Cô Lan 2" }, created_at: "2025-01-11T00:00:00Z" },
        { id: "gv-b1", email: "oldgv@school.vn", created_at: "2025-02-01T00:00:00Z" },
        { id: "gv-f1", email: "newpending@school.vn", created_at: "2026-11-17T00:00:00Z" },
        { id: "gv-g1", email: "lockedgv@school.vn", created_at: "2025-05-01T00:00:00Z" },
        { id: "gv-bad", email: "failrow@school.vn", created_at: "2025-03-01T00:00:00Z" },
      ],
      profiles: [
        { id: "admin-1", email: "bichthuylqd@gmail.com", username: "bichthuylqd", full_name: "Super Admin", role: "super_admin", status: "active", approval_status: "APPROVED", is_deleted: false },
        { id: "gv-b1", email: "oldgv@school.vn", username: "oldgv", full_name: "GV Cũ B1", role: "teacher", status: "pending", approval_status: "PENDING", is_deleted: false },
        { id: "gv-f1", email: "newpending@school.vn", username: "newpending", full_name: "GV Mới F1", role: "teacher", status: "pending", approval_status: "PENDING", is_deleted: false },
        { id: "gv-g1", email: "lockedgv@school.vn", username: "lockedgv", full_name: "GV Khóa", role: "teacher", status: "locked", approval_status: "LOCKED", is_deleted: false },
      ],
      userRoles: [{ user_id: "admin-1", role: "super_admin" }],
      registrations: [
        { id: "r-f1", user_id: "gv-f1", email: "newpending@school.vn", full_name: "GV Mới F1", status: "PENDING" },
      ],
      exams: [{ id: "e-1", created_by: "gv-b1", is_deleted: false }],
      folders: [],
      logs: [],
    };

    const makeQueryBuilder = (table: string) => {
      const getArr = () => {
        if (table === "profiles") return dbState.profiles;
        if (table === "user_roles") return dbState.userRoles;
        if (table === "teacher_registrations") return dbState.registrations;
        if (table === "exams") return dbState.exams;
        if (table === "exam_folders") return dbState.folders;
        return [];
      };
      const builder: any = {
        select: () => builder,
        order: () => builder,
        limit: () => Promise.resolve({ data: getArr().slice(0, 1), error: null }),
        range: async (from: number, to: number) => ({ data: getArr().slice(from, to + 1), error: null }),
        upsert: async (row: any) => {
          if (table === "profiles") {
            if (row.id === "gv-bad") {
              return { error: { message: "Simulated constraint error for gv-bad" } };
            }
            const idx = dbState.profiles.findIndex((p) => p.id === row.id);
            if (idx >= 0) dbState.profiles[idx] = { ...dbState.profiles[idx], ...row };
            else dbState.profiles.push(row);
          } else if (table === "user_roles") {
            const exists = dbState.userRoles.some((u) => u.user_id === row.user_id && u.role === row.role);
            if (!exists) dbState.userRoles.push(row);
          }
          return { error: null };
        },
        update: (patch: any) => ({
          eq: async (col: string, val: any) => {
            const arr = getArr();
            for (let i = 0; i < arr.length; i++) {
              if (arr[i][col] === val) arr[i] = { ...arr[i], ...patch };
            }
            return { error: null };
          },
        }),
        insert: async (row: any) => {
          if (table === "admin_activity_logs") dbState.logs.push(row);
          return { error: null };
        },
      };
      return builder;
    };

    mockCreateClient.mockImplementation((_url: string, key: string) => {
      const isService = key === serviceJwt;
      return {
        auth: {
          getUser: async () => ({
            data: { user: { id: "admin-1", email: "bichthuylqd@gmail.com", app_metadata: { role: "super_admin" } } },
            error: null,
          }),
          admin: isService
            ? {
                listUsers: async () => ({ data: { users: dbState.authUsers }, error: null }),
              }
            : undefined,
        },
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Function not deployed yet" } }),
        from: (table: string) => makeQueryBuilder(table),
      };
    });

    // 1. Verify list_teachers returns missing-profile accounts BEFORE sync!
    const listRes = createMockRes();
    await adminHandler(
      { method: "POST", headers: { authorization: "Bearer valid-token" }, body: { action: "list_teachers" } },
      listRes
    );
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.teachers.some((t: any) => t.id === "gv-c1" && t.missing_profile)).toBe(true);

    // 2. Run reconcile_execute
    const syncRes = createMockRes();
    await adminHandler(
      { method: "POST", headers: { authorization: "Bearer valid-token" }, body: { action: "reconcile_execute" } },
      syncRes
    );
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.body.ok).toBe(true);
    expect(syncRes.body.applied).toBe(true);

    // Check username collision handling for lan@gmail.com & lan@yahoo.com
    const c1 = dbState.profiles.find((p) => p.id === "gv-c1");
    const c2 = dbState.profiles.find((p) => p.id === "gv-c2");
    expect(c1?.approval_status).toBe("APPROVED");
    expect(c2?.approval_status).toBe("APPROVED");
    expect(c1?.username).not.toBe(c2?.username);

    // Check legacy pending restored
    const b1 = dbState.profiles.find((p) => p.id === "gv-b1");
    expect(b1?.status).toBe("active");
    expect(b1?.approval_status).toBe("APPROVED");

    // Check Group F preserved PENDING & Group G preserved LOCKED
    const f1 = dbState.profiles.find((p) => p.id === "gv-f1");
    const g1 = dbState.profiles.find((p) => p.id === "gv-g1");
    expect(f1?.approval_status).toBe("PENDING");
    expect(g1?.approval_status).toBe("LOCKED");

    // Check gv-bad error was isolated and reported cleanly without aborting others
    expect(syncRes.body.unresolved_errors.some((e: any) => e.user_id === "gv-bad")).toBe(true);

    // Remove failing mock condition & re-run to verify 100% idempotency on second run
    dbState.authUsers = dbState.authUsers.filter((u) => u.id !== "gv-bad");
    const audit2Res = createMockRes();
    await adminHandler(
      { method: "POST", headers: { authorization: "Bearer valid-token" }, body: { action: "reconcile_audit" } },
      audit2Res
    );
    expect(audit2Res.statusCode).toBe(200);
    expect(audit2Res.body.group_counts.B).toBe(0);
    expect(audit2Res.body.group_counts.C).toBe(0);
    expect(audit2Res.body.group_counts.E).toBe(0);
    expect(audit2Res.body.group_counts.F).toBe(1);
    expect(audit2Res.body.group_counts.G).toBe(1);
  });
});
