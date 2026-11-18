import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { TEACHER_ID, EXAM_UUID, mockTracker } = vi.hoisted(() => ({
  TEACHER_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  EXAM_UUID: "11111111-2222-4333-8444-555555555555",
  mockTracker: {
    authLoading: false,
    isAdmin: false,
    examsSelectCalls: 0,
    examInsertCalls: 0,
    examUpdateCalls: 0,
    examInsertMode: "ok" as "ok" | "error" | "timeout",
    examUpdateMode: "ok" as "ok" | "error" | "timeout",
    editLoadMode: "ok" as "ok" | "timeout",
    examsListMode: "ok" as "ok" | "timeout",
    examFoldersCalls: 0,
    examFoldersMissing: false,
    rpcCalls: [] as string[],
    missingRpcs: new Set<string>(),
    schoolsWrites: 0,
    schoolsStore: new Map<string, any>(),
    examsRows: [] as any[],
    subRows: [] as any[],
    failCreateFolderOnce: false,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: TEACHER_ID,
      email: "teacher@school.edu.vn",
      name: "Cô Lan",
      school: "THPT Test",
      subject: "Tin học",
    },
    profile: {
      full_name: "Cô Lan",
      role: mockTracker.isAdmin ? "super_admin" : "teacher",
      school_name: "THPT Test",
      subject_name: "Tin học",
    },
    isAdmin: mockTracker.isAdmin,
    isSuperAdmin: mockTracker.isAdmin,
    loading: mockTracker.authLoading,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const buildChain = (table: string) => {
    const filters: Record<string, any> = {};
    let isSingle = false;
    let isInsert = false;
    let isUpdate = false;
    let insertPayload: any = null;
    let updatePayload: any = null;

    const execute = async () => {
      if (table === "exams") {
        if (isInsert) {
          mockTracker.examInsertCalls += 1;
          if (mockTracker.examInsertMode === "timeout") {
            return Promise.reject(new Error("[RequestTimeout] Step \"exams.insert\" timed out after 10000ms"));
          }
          if (mockTracker.examInsertMode === "error") {
            return { data: null, error: { message: "Insert failed from server" } };
          }
          return { data: { id: EXAM_UUID }, error: null };
        }
        if (isUpdate) {
          mockTracker.examUpdateCalls += 1;
          if (mockTracker.examUpdateMode === "timeout") {
            return Promise.reject(new Error("[RequestTimeout] Step \"exams.update\" timed out after 10000ms"));
          }
          if (mockTracker.examUpdateMode === "error") {
            return { data: null, error: { message: "Update failed" } };
          }
          return { data: { id: EXAM_UUID }, error: null };
        }

        mockTracker.examsSelectCalls += 1;
        if (mockTracker.examsListMode === "timeout") {
          return Promise.reject(new Error("[RequestTimeout] Step \"exams.select\" timed out after 10000ms"));
        }
        if (filters.id !== undefined) {
          if (mockTracker.editLoadMode === "timeout") {
            return Promise.reject(new Error("[RequestTimeout] Step \"editExam.loadExam\" timed out after 10000ms"));
          }
          const found = mockTracker.examsRows.find((r) => r.id === filters.id) || null;
          return { data: isSingle ? found : found ? [found] : [], error: null };
        }
        return { data: isSingle ? mockTracker.examsRows[0] || null : mockTracker.examsRows, error: null };
      }

      if (table === "submissions") {
        return { data: isSingle ? null : mockTracker.subRows, count: mockTracker.subRows.length, error: null };
      }

      if (table === "exam_folders") {
        mockTracker.examFoldersCalls += 1;
        if (mockTracker.examFoldersMissing) {
          return {
            data: null,
            error: {
              code: "PGRST205",
              message: "Could not find the table 'public.exam_folders' in the schema cache",
            },
          };
        }
        if (isInsert) {
          return { data: [insertPayload], error: null };
        }
        return { data: [], error: null };
      }

      if (table === "schools") {
        if (isInsert) {
          mockTracker.schoolsWrites += 1;
          const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
          for (const r of rows) {
            mockTracker.schoolsStore.set(r.name_key, r);
          }
          return { data: rows, error: null };
        }
        if (isUpdate) {
          mockTracker.schoolsWrites += 1;
          return { data: null, error: null };
        }
        if (filters.name_key !== undefined) {
          const row = mockTracker.schoolsStore.get(filters.name_key) || null;
          return { data: isSingle ? row : row ? [row] : [], error: null };
        }
        const all = Array.from(mockTracker.schoolsStore.values());
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      if (table === "exam_short_links") {
        if (isInsert) {
          return { data: [insertPayload], error: null };
        }
        return { data: isSingle ? null : [], error: null };
      }

      return { data: isSingle ? null : [], error: null };
    };

    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn((payload: any) => {
        isInsert = true;
        insertPayload = payload;
        return chain;
      }),
      update: vi.fn((payload: any) => {
        isUpdate = true;
        updatePayload = payload;
        return chain;
      }),
      upsert: vi.fn(async (payload: any) => {
        if (table === "schools") {
          mockTracker.schoolsWrites += 1;
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const r of rows) mockTracker.schoolsStore.set(r.name_key, r);
        }
        return { data: payload, error: null };
      }),
      delete: vi.fn(() => chain),
      eq: vi.fn((col: string, val: any) => {
        filters[col] = val;
        return chain;
      }),
      in: vi.fn(() => chain),
      like: vi.fn(() => chain),
      or: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => {
        isSingle = true;
        return execute();
      }),
      maybeSingle: vi.fn(() => {
        isSingle = true;
        return execute();
      }),
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
    };
    return chain;
  };

  return {
    supabase: {
      from: vi.fn((table: string) => buildChain(table)),
      rpc: vi.fn(async (fn: string) => {
        mockTracker.rpcCalls.push(fn);
        if (mockTracker.missingRpcs.has(fn)) {
          return {
            data: null,
            error: {
              code: "PGRST202",
              message: `Could not find the function public.${fn}`,
            },
          };
        }
        if (fn === "check_exam_code_taken") {
          return { data: false, error: null };
        }
        return { data: { success: true }, error: null };
      }),
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token-1", user: { id: TEACHER_ID } } },
          error: null,
        })),
        getUser: vi.fn(async () => ({
          data: { user: { id: TEACHER_ID } },
          error: null,
        })),
        refreshSession: vi.fn(async () => ({
          data: { session: { access_token: "token-1", user: { id: TEACHER_ID } } },
          error: null,
        })),
      },
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example.com/file.docx" } })),
        })),
      },
    },
  };
});

import {
  resetSupabaseCapabilitiesCache,
  setSupabaseCapabilitiesCacheEnabledForTest,
  isCapabilityUnavailable,
} from "@/lib/supabaseCapabilities";
import { withRequestTimeout, RequestTimeoutError, isRequestTimeoutError } from "@/lib/requestTimeout";
import { createFolder, getFolders, resetFolderStorageAvailabilityCache } from "@/lib/folderStorage";
import { isExamCodeTaken } from "@/lib/examAssignments";
import {
  fetchSystemExamsForAdmin,
  fetchAdminOverview,
  invalidateAdminServiceCache,
} from "@/lib/adminService";
import { CreateOrEditFolderModal } from "@/components/FolderModals";
import QuickExamShareModal from "@/components/QuickExamShareModal";
import Index from "@/pages/Index";
import Exams from "@/pages/Exams";
import Teacher from "@/pages/Teacher";
import EditExam from "@/pages/EditExam";
import Share from "@/pages/Share";
import { toast } from "sonner";

function makeSampleExam(id = EXAM_UUID) {
  return {
    id,
    title: "Đề kiểm tra Tin học 12",
    duration_minutes: 45,
    max_attempts: 1,
    created_at: "2026-11-18T00:00:00Z",
    created_by: TEACHER_ID,
    display_mode: "standard",
    manual_closed: false,
    team_config: { primary_code: "654321", assignments: [] },
    questions: {
      partI: [
        {
          id: "q1",
          text: "SQL là gì?",
          options: [
            { key: "A", text: "Ngôn ngữ truy vấn" },
            { key: "B", text: "Trình duyệt" },
            { key: "C", text: "Hệ điều hành" },
            { key: "D", text: "Phần cứng" },
          ],
          answer: "A",
        },
      ],
      partII: [],
      partIII: [],
    },
  };
}

describe("Hiệu năng tải trang, chống treo UI & cache capability Supabase", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetSupabaseCapabilitiesCache();
    setSupabaseCapabilitiesCacheEnabledForTest(false);
    resetFolderStorageAvailabilityCache();
    invalidateAdminServiceCache();
    vi.clearAllMocks();

    mockTracker.authLoading = false;
    mockTracker.isAdmin = false;
    mockTracker.examsSelectCalls = 0;
    mockTracker.examInsertCalls = 0;
    mockTracker.examUpdateCalls = 0;
    mockTracker.examInsertMode = "ok";
    mockTracker.examUpdateMode = "ok";
    mockTracker.editLoadMode = "ok";
    mockTracker.examsListMode = "ok";
    mockTracker.examFoldersCalls = 0;
    mockTracker.examFoldersMissing = false;
    mockTracker.rpcCalls = [];
    mockTracker.missingRpcs.clear();
    mockTracker.schoolsWrites = 0;
    mockTracker.schoolsStore.clear();
    mockTracker.examsRows = [];
    mockTracker.subRows = [];
  });

  afterEach(() => {
    setSupabaseCapabilitiesCacheEnabledForTest(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("1. withRequestTimeout phát hiện RequestTimeoutError đúng hạn và không giữ timer treo", async () => {
    vi.useFakeTimers();
    const stalled = new Promise<string>(() => {});
    const p = withRequestTimeout(stalled, 500, "test.stalled");
    const assertion = expect(p).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(520);
    await assertion;
    expect(isRequestTimeoutError(new RequestTimeoutError("x", 100))).toBe(true);
  });

  it("2. Index và Exams KHÔNG phát sinh bão syncExamAssignmentCodes khi mount và tự tắt spinner khi truy vấn lỗi", async () => {
    mockTracker.examsRows = Array.from({ length: 12 }, (_, i) =>
      makeSampleExam(`00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`)
    );

    const { unmount: unmountIndex } = render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Đề kiểm tra Tin học 12/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(mockTracker.schoolsWrites).toBe(0);
    expect(mockTracker.rpcCalls).not.toContain("sync_exam_codes_and_links");
    unmountIndex();

    const { unmount: unmountExams } = render(
      <MemoryRouter>
        <Exams />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Đề kiểm tra Tin học 12/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(mockTracker.schoolsWrites).toBe(0);
    expect(mockTracker.rpcCalls).not.toContain("sync_exam_codes_and_links");
    unmountExams();

    // Khi truy vấn exams bị timeout -> vẫn thoát trạng thái loading sạch sẽ
    mockTracker.examsListMode = "timeout";
    render(
      <MemoryRouter>
        <Exams />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByText(/Đang tải/i)).not.toBeInTheDocument();
    });
  });

  it("3. Index không gọi Supabase khi authLoading=true và bắt đầu tải ngay khi authLoading=false", async () => {
    mockTracker.authLoading = true;
    mockTracker.examsRows = [makeSampleExam()];

    const { rerender } = render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(mockTracker.examsSelectCalls).toBe(0);

    mockTracker.authLoading = false;
    rerender(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockTracker.examsSelectCalls).toBeGreaterThanOrEqual(1);
    });
  });

  it("4. supabaseCapabilities cache lỗi 404 PGRST205/PGRST202 để lần gọi sau bỏ qua roundtrip dư thừa và createFolder chỉ đọc getFolders 1 lần", async () => {
    setSupabaseCapabilitiesCacheEnabledForTest(true);
    mockTracker.examFoldersMissing = true;
    mockTracker.missingRpcs.add("check_exam_code_taken");

    // Lần 1 getFolders gặp PGRST205 -> đánh dấu table:exam_folders unavailable
    const f0 = await getFolders(TEACHER_ID);
    expect(f0).toEqual([]);
    expect(mockTracker.examFoldersCalls).toBe(1);
    expect(isCapabilityUnavailable("table:exam_folders")).toBe(true);

    // Tạo cha -> con -> cháu qua fallback schools: KHÔNG gọi lại exam_folders
    const parent = await createFolder({ name: "Khối 12", teacher_id: TEACHER_ID });
    const child = await createFolder({ name: "Chương 1", parent_id: parent.id, teacher_id: TEACHER_ID });
    const grandchild = await createFolder({ name: "Bài 1", parent_id: child.id, teacher_id: TEACHER_ID });

    expect(grandchild.parent_id).toBe(child.id);
    expect(child.parent_id).toBe(parent.id);
    // Không tăng thêm bất kỳ truy vấn exam_folders 404 nào nữa
    expect(mockTracker.examFoldersCalls).toBe(1);

    // Lần 1 kiểm tra mã gặp PGRST202 -> lần 2 bỏ qua RPC check_exam_code_taken
    await isExamCodeTaken("112233");
    await isExamCodeTaken("445566");
    const checkRpcCount = mockTracker.rpcCalls.filter((fn) => fn === "check_exam_code_taken").length;
    expect(checkRpcCount).toBe(1);
  });

  it("5. adminService dùng mergeLocalExamsForAdmin khi /api/admin thành công và fetchAdminOverview(preloaded) không query lặp", async () => {
    const serverExam = makeSampleExam();
    const fetchMock = vi.fn(async (_url: any, init?: any) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.action === "list_exams_system") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            exams: [serverExam],
            submissionCounts: { [EXAM_UUID]: 5 },
          }),
        } as any;
      }
      return { ok: false, status: 404, json: async () => null } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const sysRes = await fetchSystemExamsForAdmin();
    expect(sysRes.exams.some((e) => e.id === EXAM_UUID)).toBe(true);
    expect(sysRes.submissionCounts[EXAM_UUID]).toBe(5);
    // Không query lại supabase.from("exams") khi API đã trả về danh sách đề
    expect(mockTracker.examsSelectCalls).toBe(0);

    const overview = await fetchAdminOverview({
      teachers: [
        {
          id: TEACHER_ID,
          email: "t@school.vn",
          username: "t1",
          full_name: "Cô Lan",
          phone: "",
          school_name: "",
          subject_name: "",
          status: "active",
          approval_status: "APPROVED",
          created_at: "2026-11-18T00:00:00Z",
          exam_count: 1,
          folder_count: 0,
        },
      ],
      exams: sysRes.exams,
      folders: [],
    });

    expect(overview.totalTeachers).toBe(1);
    expect(overview.totalExams).toBe(sysRes.exams.length);
    expect(mockTracker.examsSelectCalls).toBe(0);
    expect(mockTracker.examFoldersCalls).toBe(0);
  });

  it("6. Teacher.onCreate chống bấm đúp và luôn mở khóa nút 'Tạo link bài thi' qua finally khi insert bị lỗi/timeout", async () => {
    mockTracker.examInsertMode = "timeout";

    render(
      <MemoryRouter>
        <Teacher />
      </MemoryRouter>
    );

    // Chuyển qua tab Nhập tay và phân tích đề hợp lệ
    const manualTab = screen.getByRole("tab", { name: /Nhập tay/i });
    fireEvent.mouseDown(manualTab);
    fireEvent.click(manualTab);
    const textarea = await screen.findByPlaceholderText(/PHẦN I/i);
    fireEvent.change(textarea, {
      target: {
        value: "PHẦN I\nCâu 1: 1 + 1 bằng?\nA. 1\n*B. 2\nC. 3\nD. 4",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Phân tích" }));

    const createBtn = await screen.findByRole("button", { name: /Tạo link bài thi/i });
    expect(createBtn).not.toBeDisabled();

    // Bấm đúp liên tiếp -> chỉ gửi 1 insert request và sau catch/finally nút phải được mở khóa lại
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Tạo link bài thi/i })).not.toBeDisabled();
    });
    expect(mockTracker.examInsertCalls).toBe(1);
  });

  it("7. EditExam không treo khi tải đề timeout và luôn mở khóa nút 'Lưu cài đặt' khi cập nhật thất bại", async () => {
    // Trường hợp A: tải đề gặp lỗi/timeout -> tự chuyển về trạng thái không loading
    mockTracker.editLoadMode = "timeout";
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_UUID}/edit`]}>
        <Routes>
          <Route path="/exam/:id/edit" element={<EditExam />} />
          <Route path="/" element={<div data-testid="home-fallback">Trang chủ</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("home-fallback")).toBeInTheDocument();
    });
    unmount();

    // Trường hợp B: tải đề thành công nhưng lưu đề gặp timeout/lỗi -> không kẹt spinner và chống bấm đúp
    mockTracker.editLoadMode = "ok";
    mockTracker.examUpdateMode = "timeout";
    mockTracker.examsRows = [makeSampleExam()];

    render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_UUID}/edit`]}>
        <Routes>
          <Route path="/exam/:id/edit" element={<EditExam />} />
          <Route path="/" element={<div data-testid="edit-done-home">Đã lưu xong</div>} />
        </Routes>
      </MemoryRouter>
    );

    const saveBtn = await screen.findByRole("button", { name: /Lưu cài đặt/i });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.queryByTestId("edit-done-home") !== null ||
          (screen.queryByRole("button", { name: /Lưu cài đặt/i }) as HTMLButtonElement | null)?.disabled === false
      ).toBe(true);
    });
    // 1 update chính trong EditExam (không nhân đôi do bấm đúp) + tối đa 1 update team_config từ syncExamAssignmentCodes
    expect(mockTracker.examUpdateCalls).toBeLessThanOrEqual(2);
  });

  it("8. Share & QuickExamShareModal mở khóa đồng bộ mã/link an toàn qua try/finally khi RPC lỗi hoặc timeout", async () => {
    const exam = makeSampleExam();
    mockTracker.examsRows = [exam];
    mockTracker.missingRpcs.add("sync_exam_codes_and_links");
    mockTracker.missingRpcs.add("resolve_exam_short_link");

    const { unmount } = render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_UUID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Link làm bài ngắn")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Đang đồng bộ mã/i)).not.toBeInTheDocument();
    });
    unmount();

    render(
      <MemoryRouter>
        <QuickExamShareModal open={true} onOpenChange={() => {}} exam={exam} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const input = screen.getByLabelText("Link làm bài ngắn") as HTMLInputElement;
      expect(input.value).toMatch(/\/654321$/);
    });
  });

  it("9. CreateOrEditFolderModal không bị khóa nút submit vĩnh viễn khi tạo thư mục thất bại", async () => {
    mockTracker.examFoldersMissing = true;
    // Khi cả schools insert cũng báo lỗi RLS -> createFolder throw error -> finally mở khóa nút
    const origFrom = (await import("@/integrations/supabase/client")).supabase.from;
    const fromSpy = vi.fn((table: string) => {
      if (table === "schools") {
        const c: any = {
          select: vi.fn(() => c),
          eq: vi.fn(() => c),
          like: vi.fn(() => c),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn(async () => ({
            data: null,
            error: { code: "42501", message: "row-level security violation" },
          })),
          then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
        };
        return c;
      }
      return origFrom(table);
    });
    const mod = await import("@/integrations/supabase/client");
    const restoreSpy = vi.spyOn(mod.supabase, "from").mockImplementation(fromSpy as any);

    try {
      render(
        <CreateOrEditFolderModal
          open={true}
          onOpenChange={() => {}}
          teacherId={TEACHER_ID}
          onSuccess={() => {}}
        />
      );

      fireEvent.change(screen.getByLabelText(/tên thư mục/i), { target: { value: "Thư mục lỗi" } });
      const submitBtn = screen.getByRole("button", { name: "Tạo thư mục" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Tạo thư mục" })).not.toBeDisabled();
      });
    } finally {
      restoreSpy.mockRestore();
    }
  });
});
