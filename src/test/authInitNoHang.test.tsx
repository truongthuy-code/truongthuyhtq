import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";

const mockAuthState = vi.hoisted(() => ({
  getSessionImpl: null as null | (() => Promise<{ data: { session: Session | null }; error: any }>),
  rpcImpl: null as null | ((fn: string) => Promise<{ data: any; error: any }>),
  profilesImpl: null as null | ((uid: string) => Promise<{ data: any; error: any }>),
  rolesImpl: null as null | ((uid: string) => Promise<{ data: any; error: any }>),
  regsImpl: null as null | ((uid: string) => Promise<{ data: any; error: any }>),
  authListener: null as null | ((event: string, session: Session | null) => void),
  getSessionCalls: 0,
  rpcCalls: 0,
  regCalls: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const buildTableChain = (table: string) => {
    let eqCol = "";
    let eqVal = "";
    const chain: any = {
      select: vi.fn(() => chain),
      update: vi.fn(() => chain),
      eq: vi.fn((col: string, val: string) => {
        eqCol = col;
        eqVal = val;
        return chain;
      }),
      order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === "profiles" && mockAuthState.profilesImpl) {
          return mockAuthState.profilesImpl(eqVal);
        }
        if (table === "teacher_registrations") {
          mockAuthState.regCalls += 1;
          if (mockAuthState.regsImpl) {
            return mockAuthState.regsImpl(eqVal);
          }
        }
        return { data: null, error: null };
      }),
      then: (resolve: any, reject?: any) => {
        const p =
          table === "user_roles" && mockAuthState.rolesImpl
            ? mockAuthState.rolesImpl(eqVal)
            : table === "profiles" && mockAuthState.profilesImpl
              ? mockAuthState.profilesImpl(eqVal)
              : Promise.resolve({ data: [], error: null });
        return p.then(resolve, reject);
      },
    };
    return chain;
  };

  return {
    supabase: {
      auth: {
        getSession: vi.fn(async () => {
          mockAuthState.getSessionCalls += 1;
          if (mockAuthState.getSessionImpl) {
            return mockAuthState.getSessionImpl();
          }
          return { data: { session: null }, error: null };
        }),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
        onAuthStateChange: vi.fn((cb: (event: string, session: Session | null) => void) => {
          mockAuthState.authListener = cb;
          return {
            data: {
              subscription: {
                unsubscribe: vi.fn(() => {
                  mockAuthState.authListener = null;
                }),
              },
            },
          };
        }),
      },
      rpc: vi.fn(async (fn: string) => {
        mockAuthState.rpcCalls += 1;
        if (mockAuthState.rpcImpl) {
          return mockAuthState.rpcImpl(fn);
        }
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      }),
      from: vi.fn((table: string) => buildTableChain(table)),
    },
  };
});

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("@/components/MandatoryPasswordChange", () => ({
  default: () => <div data-testid="mandatory-password-change">Đổi mật khẩu bắt buộc</div>,
}));

import { AuthProvider, useAuth, AUTH_TIMEOUT_CONFIG } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import { SUPER_ADMIN_EMAIL, setCurrentAuthUser } from "@/lib/teacherStorage";

function makeSession(id: string, email: string): Session {
  return {
    access_token: "test-token",
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id,
      email,
      app_metadata: {},
      user_metadata: { full_name: email.split("@")[0] },
      aud: "authenticated",
      created_at: new Date().toISOString(),
    } as any,
  };
}

function DashboardStub({ label = "Teacher Dashboard" }: { label?: string }) {
  const { user, role, approvalStatus, signOut } = useAuth();
  return (
    <div data-testid="protected-content">
      <span>{label}</span>
      <span data-testid="auth-role">{role}</span>
      <span data-testid="auth-approval">{approvalStatus}</span>
      <span data-testid="auth-email">{user?.email}</span>
      <button onClick={() => void signOut({ redirect: false })}>Đăng xuất test</button>
    </div>
  );
}

function renderProtectedApp(initialPath = "/", requireAdmin = false) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth" element={<div data-testid="auth-login-page">Trang Đăng Nhập</div>} />
          <Route
            path="/"
            element={
              <ProtectedRoute requireAdmin={requireAdmin}>
                <DashboardStub label="Teacher Dashboard" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <DashboardStub label="Super Admin Dashboard" />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("Auth Initialization & ProtectedRoute No-Hang Verification (All 12 Scenarios)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockAuthState.getSessionImpl = null;
    mockAuthState.rpcImpl = null;
    mockAuthState.profilesImpl = null;
    mockAuthState.rolesImpl = null;
    mockAuthState.regsImpl = null;
    mockAuthState.authListener = null;
    mockAuthState.getSessionCalls = 0;
    mockAuthState.rpcCalls = 0;
    mockAuthState.regCalls = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1. Unauthenticated user finishes loading cleanly and redirects to /auth", async () => {
    const start = performance.now();
    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByTestId("auth-login-page")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Đang kiểm tra quyền truy cập/i)).not.toBeInTheDocument();
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("2. SUPER_ADMIN enters /admin cleanly without waiting on teacher_registrations", async () => {
    const adminId = "b9e61e93-caa6-4e72-a534-55072d943ad2";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(adminId, SUPER_ADMIN_EMAIL) },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: adminId,
        email: SUPER_ADMIN_EMAIL,
        role: "super_admin",
        status: "active",
        approval_status: "APPROVED",
        must_change_password: false,
        is_super_admin: true,
      },
      error: null,
    });

    renderProtectedApp("/admin", true);

    await waitFor(() => {
      expect(screen.getByText("Super Admin Dashboard")).toBeInTheDocument();
    });
    expect(screen.getByTestId("auth-role").textContent).toBe("super_admin");
    expect(mockAuthState.regCalls).toBe(0);
  });

  it("3. Legacy teacher (missing profile row, no pending registration) is APPROVED and allowed", async () => {
    const legacyId = "11111111-1111-4111-8111-111111111111";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(legacyId, "giaoviencu@school.edu.vn") },
      error: null,
    });
    // Simulate RPC missing (404/PGRST202) and empty profile row (legacy user)
    mockAuthState.profilesImpl = async () => ({ data: null, error: null });
    mockAuthState.rolesImpl = async () => ({ data: [{ role: "teacher" }], error: null });
    mockAuthState.regsImpl = async () => ({ data: null, error: null });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Teacher Dashboard")).toBeInTheDocument();
    });
    expect(screen.getByTestId("auth-approval").textContent).toBe("APPROVED");
  });

  it("4. Newly approved teacher enters Dashboard cleanly", async () => {
    const teacherId = "22222222-2222-4222-8222-222222222222";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(teacherId, "giaovienmoi@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: teacherId,
        email: "giaovienmoi@school.edu.vn",
        full_name: "Nguyễn Văn A",
        role: "teacher",
        status: "active",
        approval_status: "APPROVED",
        is_super_admin: false,
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Teacher Dashboard")).toBeInTheDocument();
    });
    expect(screen.getByTestId("auth-role").textContent).toBe("teacher");
    expect(screen.getByTestId("auth-approval").textContent).toBe("APPROVED");
  });

  it("5. PENDING teacher sees pending-approval gate and never hangs or enters Dashboard", async () => {
    const pendingId = "33333333-3333-4333-8333-333333333333";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(pendingId, "pending@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: pendingId,
        email: "pending@school.edu.vn",
        role: "teacher",
        status: "pending",
        approval_status: "PENDING",
        is_super_admin: false,
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Tài khoản đang chờ phê duyệt")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/Đang kiểm tra quyền truy cập/i)).not.toBeInTheDocument();
  });

  it("6. LOCKED teacher is blocked with locked-account screen", async () => {
    const lockedId = "44444444-4444-4444-8444-444444444444";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(lockedId, "locked@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: lockedId,
        email: "locked@school.edu.vn",
        role: "teacher",
        status: "locked",
        approval_status: "LOCKED",
        is_super_admin: false,
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Tài khoản đã bị khóa")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("7. REJECTED teacher is blocked with rejection reason", async () => {
    const rejectedId = "55555555-5555-4555-8555-555555555555";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(rejectedId, "rejected@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: rejectedId,
        email: "rejected@school.edu.vn",
        role: "teacher",
        status: "rejected",
        approval_status: "REJECTED",
        rejection_reason: "Không thuộc trường trong danh sách",
        is_super_admin: false,
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Tài khoản chưa được phê duyệt")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Không thuộc trường trong danh sách/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  it("8. Reload with existing session + INITIAL_SESSION does NOT trigger infinite syncState loop", async () => {
    const teacherId = "66666666-6666-4666-8666-666666666666";
    const session = makeSession(teacherId, "reload@school.edu.vn");
    mockAuthState.getSessionImpl = async () => ({
      data: { session },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: teacherId,
        email: "reload@school.edu.vn",
        full_name: "Cô Reload",
        role: "teacher",
        status: "active",
        approval_status: "APPROVED",
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Teacher Dashboard")).toBeInTheDocument();
    });

    // Simulate GoTrue emitting INITIAL_SESSION right after mount
    act(() => {
      mockAuthState.authListener?.("INITIAL_SESSION", session);
    });

    // Wait briefly to confirm no feedback loop from setCurrentAuthUser -> app_auth_change -> syncState
    await new Promise((r) => setTimeout(r, 120));

    expect(mockAuthState.getSessionCalls).toBe(1);
    expect(mockAuthState.rpcCalls).toBeLessThanOrEqual(2);
  });

  it("9. New tab / storage event syncs updated session cleanly", async () => {
    renderProtectedApp("/");
    await waitFor(() => {
      expect(screen.getByTestId("auth-login-page")).toBeInTheDocument();
    });

    const newTeacherId = "77777777-7777-4777-8777-777777777777";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(newTeacherId, "tab2@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: newTeacherId,
        email: "tab2@school.edu.vn",
        role: "teacher",
        status: "active",
        approval_status: "APPROVED",
      },
      error: null,
    });

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "qc_current_auth_user_v2" }));
    });

    // Even while already on /auth route in this stub, verify auth context recovered without hanging
    await new Promise((r) => setTimeout(r, 60));
    expect(mockAuthState.rpcCalls).toBeGreaterThanOrEqual(1);
  });

  it("10. Logout then re-login via deferred onAuthStateChange works cleanly without deadlock", async () => {
    const teacherId = "88888888-8888-4888-8888-888888888888";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(teacherId, "first@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: teacherId,
        email: "first@school.edu.vn",
        role: "teacher",
        status: "active",
        approval_status: "APPROVED",
      },
      error: null,
    });

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Teacher Dashboard")).toBeInTheDocument();
    });

    // Logout
    mockAuthState.getSessionImpl = async () => ({ data: { session: null }, error: null });
    fireEvent.click(screen.getByText("Đăng xuất test"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-login-page")).toBeInTheDocument();
    });

    // Re-login as Super Admin via GoTrue SIGNED_IN callback
    const adminId = "b9e61e93-caa6-4e72-a534-55072d943ad2";
    const adminSess = makeSession(adminId, SUPER_ADMIN_EMAIL);
    mockAuthState.getSessionImpl = async () => ({ data: { session: adminSess }, error: null });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: adminId,
        email: SUPER_ADMIN_EMAIL,
        role: "super_admin",
        status: "active",
        approval_status: "APPROVED",
        must_change_password: false,
        is_super_admin: true,
      },
      error: null,
    });

    // Trigger setCurrentAuthUser + onAuthStateChange concurrently like Auth.tsx + GoTrue do
    act(() => {
      setCurrentAuthUser({
        id: adminId,
        username: "bichthuylqd",
        name: "Trương Thị Bích Thủy",
        email: SUPER_ADMIN_EMAIL,
        role: "super_admin",
        approvalStatus: "APPROVED",
      });
      mockAuthState.authListener?.("SIGNED_IN", adminSess);
    });

    await new Promise((r) => setTimeout(r, 80));
    expect(mockAuthState.rpcCalls).toBeGreaterThanOrEqual(2);
  });

  it("11. Slow / stalled Supabase times out cleanly, shows error + Retry, and recovers when clicked", async () => {
    vi.useFakeTimers();

    // Simulate completely stalled Supabase getSession()
    mockAuthState.getSessionImpl = () => new Promise(() => {});

    renderProtectedApp("/");

    // Initially loading
    expect(screen.getByText(/Đang kiểm tra quyền truy cập/i)).toBeInTheDocument();

    // Advance past STEP_TIMEOUT_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_CONFIG.STEP_TIMEOUT_MS + 100);
    });

    // Must stop hanging and show explicit connection error + Retry button (NEVER grant access!)
    expect(screen.queryByText(/Đang kiểm tra quyền truy cập/i)).not.toBeInTheDocument();
    expect(screen.getByText("Không thể kiểm tra quyền truy cập")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thử lại/i })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();

    // Now Supabase recovers!
    const teacherId = "99999999-9999-4999-8999-999999999999";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(teacherId, "recovered@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: {
        authenticated: true,
        id: teacherId,
        email: "recovered@school.edu.vn",
        role: "teacher",
        status: "active",
        approval_status: "APPROVED",
      },
      error: null,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Thử lại/i }));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText("Teacher Dashboard")).toBeInTheDocument();
  });

  it("12. Supabase offline / DB network error finishes loading and blocks unauthorized access", async () => {
    const teacherId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockAuthState.getSessionImpl = async () => ({
      data: { session: makeSession(teacherId, "offline@school.edu.vn") },
      error: null,
    });
    mockAuthState.rpcImpl = async () => ({
      data: null,
      error: { message: "TypeError: Failed to fetch", status: 0 },
    });
    mockAuthState.profilesImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    mockAuthState.rolesImpl = async () => {
      throw new TypeError("Failed to fetch");
    };

    renderProtectedApp("/");

    await waitFor(() => {
      expect(screen.getByText("Không thể kiểm tra quyền truy cập")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Thử lại/i })).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });
});
