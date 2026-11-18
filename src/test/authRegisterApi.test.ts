import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  mockCreateClient,
  mockAdminCreateUser,
  mockProfilesMaybeSingle,
  mockTeacherRegsUpsert,
  mockAnonSignUp,
  mockAnonSignOut,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockAdminCreateUser: vi.fn(),
  mockProfilesMaybeSingle: vi.fn(),
  mockTeacherRegsUpsert: vi.fn(),
  mockAnonSignUp: vi.fn(),
  mockAnonSignOut: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { resolveClientSupabaseConfig } from "@/integrations/supabase/client";
import authRegisterHandler, { resolveAuthRegisterEnv } from "../../api/auth-register";

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

describe("Supabase API Key Resilience & /api/auth-register Fallback", () => {
  const originalEnv = { ...process.env };
  const verifiedAnonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";
  const matchingServiceJwt = makeJwt({
    iss: "supabase",
    ref: "zhixpglctyfffpwamixv",
    role: "service_role",
    iat: 1777960186,
    exp: 2093536186,
  });
  const wrongProjectAnonJwt = makeJwt({
    iss: "supabase",
    ref: "otherproject123456",
    role: "anon",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ sent: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }),
      }))
    );

    mockProfilesMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockTeacherRegsUpsert.mockResolvedValue({ data: null, error: null });
    mockAnonSignUp.mockResolvedValue({
      data: { user: { id: "user-anon-123" } },
      error: null,
    });
    mockAnonSignOut.mockResolvedValue({ error: null });
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { id: "user-admin-456" } },
      error: null,
    });

    mockCreateClient.mockImplementation((_url: string, key: string) => {
      if (key === matchingServiceJwt || key.startsWith("sb_secret_")) {
        return {
          from: (table: string) => ({
            select: () => ({
              ilike: () => ({
                maybeSingle: mockProfilesMaybeSingle,
              }),
            }),
            upsert: table === "teacher_registrations" ? mockTeacherRegsUpsert : vi.fn(async () => ({ error: null })),
          }),
          auth: {
            admin: {
              createUser: mockAdminCreateUser,
            },
          },
        };
      }
      return {
        auth: {
          signUp: mockAnonSignUp,
          signOut: mockAnonSignOut,
        },
      };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("1. Client config sanitizes quotes/whitespace and rejects service_role or wrong-project keys", () => {
    const quoted = resolveClientSupabaseConfig({
      VITE_SUPABASE_URL: '  "https://zhixpglctyfffpwamixv.supabase.co/" \n',
      VITE_SUPABASE_PUBLISHABLE_KEY: ` "${verifiedAnonKey}" `,
    });
    expect(quoted.supabaseUrl).toBe("https://zhixpglctyfffpwamixv.supabase.co");
    expect(quoted.publishableKey).toBe(verifiedAnonKey);

    const leakedService = resolveClientSupabaseConfig({
      VITE_SUPABASE_URL: "https://zhixpglctyfffpwamixv.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: matchingServiceJwt,
    });
    expect(leakedService.publishableKey).toBe(verifiedAnonKey);
    expect(leakedService.usedFallbackKey).toBe(true);

    const mismatched = resolveClientSupabaseConfig({
      VITE_SUPABASE_URL: "https://zhixpglctyfffpwamixv.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: wrongProjectAnonJwt,
    });
    expect(mismatched.publishableKey).toBe(verifiedAnonKey);
  });

  it("2. Server env resolver rejects anon/PAT/mismatched keys in SUPABASE_SERVICE_ROLE_KEY", () => {
    const withAnonAsService = resolveAuthRegisterEnv({
      VITE_SUPABASE_URL: "https://zhixpglctyfffpwamixv.supabase.co",
      VITE_SUPABASE_ANON_KEY: verifiedAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: verifiedAnonKey,
    });
    expect(withAnonAsService.serviceRoleKey).toBe("");
    expect(withAnonAsService.anonKey).toBe(verifiedAnonKey);

    const withPatAsService = resolveAuthRegisterEnv({
      VITE_SUPABASE_URL: "https://zhixpglctyfffpwamixv.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sbp_1234567890abcdef",
    });
    expect(withPatAsService.serviceRoleKey).toBe("");

    const withValidService = resolveAuthRegisterEnv({
      VITE_SUPABASE_URL: "https://zhixpglctyfffpwamixv.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: `  "${matchingServiceJwt}"\n `,
    });
    expect(withValidService.serviceRoleKey).toBe(matchingServiceJwt);
  });

  it("3. Valid SUPABASE_SERVICE_ROLE_KEY persists teacher registration using user_id column", async () => {
    process.env.VITE_SUPABASE_URL = "https://zhixpglctyfffpwamixv.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = verifiedAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = matchingServiceJwt;

    const req = {
      method: "POST",
      body: {
        email: "gv.moi@school.edu.vn",
        password: "Password123",
        confirmPassword: "Password123",
        fullName: "Nguyễn Thị Lan",
        username: "gv_lan",
        subjectName: "Tin học",
        schoolName: "THPT Phan Bội Châu",
      },
    };
    const res = createMockRes();
    await authRegisterHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.persistenceMode).toBe("service_role");
    expect(res.body.status).toBe("PENDING");
    expect(mockTeacherRegsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-admin-456",
        email: "gv.moi@school.edu.vn",
        status: "PENDING",
      }),
      { onConflict: "user_id" }
    );
  });

  it("4. Invalid API key from SUPABASE_SERVICE_ROLE_KEY seamlessly falls back to anon_signup without failing", async () => {
    process.env.VITE_SUPABASE_URL = "https://zhixpglctyfffpwamixv.supabase.co";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = verifiedAnonKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_corrupted_or_revoked_key";

    mockProfilesMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid API key", status: 401 },
    });

    const req = {
      method: "POST",
      body: {
        email: "gv.fallback@school.edu.vn",
        password: "Password123",
        confirmPassword: "Password123",
        fullName: "Trần Văn Bình",
        username: "gv_binh",
        subjectName: "Toán",
        schoolName: "THPT Lê Quý Đôn",
      },
    };
    const res = createMockRes();
    await authRegisterHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.persistenceMode).toBe("anon_signup");
    expect(res.body.userId).toBe("user-anon-123");
    expect(mockAnonSignUp).toHaveBeenCalledTimes(1);
    expect(mockAnonSignOut).toHaveBeenCalledTimes(1);
  });

  it("5. Blocks reserved Super Admin email and client role escalation", async () => {
    const reqAdminEmail = {
      method: "POST",
      body: {
        email: "bichthuylqd@gmail.com",
        password: "Password123",
        confirmPassword: "Password123",
        fullName: "Fake Admin",
        username: "fake_admin",
        subjectName: "Tin học",
      },
    };
    const res1 = createMockRes();
    await authRegisterHandler(reqAdminEmail, res1);
    expect(res1.statusCode).toBe(403);
    expect(res1.body.ok).toBe(false);

    const reqRoleInjection = {
      method: "POST",
      body: {
        email: "attacker@school.edu.vn",
        password: "Password123",
        confirmPassword: "Password123",
        fullName: "Attacker",
        username: "attacker",
        subjectName: "Tin học",
        role: "super_admin",
      },
    };
    const res2 = createMockRes();
    await authRegisterHandler(reqRoleInjection, res2);
    expect(res2.statusCode).toBe(403);
    expect(res2.body.ok).toBe(false);
  });
});
