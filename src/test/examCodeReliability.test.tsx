import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockDb = vi.hoisted(() => ({
  exams: new Map<string, any>(),
  schools: new Map<string, string>(),
  shortLinks: new Map<string, any>(),
  loggedEvents: [] as any[],
  failMode: null as null | "network" | "server_503" | "rls_42501",
  failWriteOnly: false,
  delayMs: 0,
  slowFirstRejectSecond: false,
  lookupCallCount: 0,
}));

const maybeDelay = async () => {
  if (mockDb.delayMs > 0) {
    await new Promise((r) => setTimeout(r, mockDb.delayMs));
  }
};

const makeFailure = () => {
  if (mockDb.failMode === "network") {
    return { message: "TypeError: Failed to fetch", name: "FetchError" };
  }
  if (mockDb.failMode === "server_503") {
    return { status: 503, code: "503", message: "Service Unavailable 503" };
  }
  if (mockDb.failMode === "rls_42501") {
    return { status: 403, code: "42501", message: "new row violates row-level security policy for table" };
  }
  return null;
};

vi.mock("@/integrations/supabase/client", () => {
  const buildQuery = (table: string) => {
    const filters: Record<string, any> = {};
    let inFilter: { col: string; vals: any[] } | null = null;
    let isSingle = false;

    const executeSelect = async () => {
      await maybeDelay();
      const err = mockDb.failWriteOnly ? null : makeFailure();
      if (err) return { data: null, error: err };

      if (table === "schools") {
        if (inFilter && inFilter.col === "name_key") {
          const rows = inFilter.vals
            .filter((k) => mockDb.schools.has(k))
            .map((k) => ({ name_key: k, name: mockDb.schools.get(k)! }));
          return { data: isSingle ? rows[0] || null : rows, error: null };
        }
        if (filters.name_key !== undefined) {
          const v = mockDb.schools.get(filters.name_key);
          const row = v !== undefined ? { name_key: filters.name_key, name: v } : null;
          return { data: isSingle ? row : row ? [row] : [], error: null };
        }
        const all = Array.from(mockDb.schools.entries()).map(([k, v]) => ({ name_key: k, name: v }));
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      if (table === "exams") {
        if (filters.id !== undefined) {
          const row = mockDb.exams.get(filters.id) || null;
          return { data: isSingle ? row : row ? [row] : [], error: null };
        }
        const all = Array.from(mockDb.exams.values());
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      if (table === "exam_short_links") {
        const all = Array.from(mockDb.shortLinks.values()).filter((row) => {
          if (filters.short_code !== undefined && row.short_code !== filters.short_code) return false;
          if (filters.exam_id !== undefined && row.exam_id !== filters.exam_id) return false;
          if (filters.is_active !== undefined && row.is_active !== filters.is_active) return false;
          if (filters.is_primary !== undefined && row.is_primary !== filters.is_primary) return false;
          if (filters.assignment_id !== undefined && row.assignment_id !== filters.assignment_id) return false;
          return true;
        });
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      return { data: isSingle ? null : [], error: null };
    };

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      in: (col: string, vals: any[]) => {
        inFilter = { col, vals };
        return builder;
      },
      filter: (col: string, _op: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      like: () => builder,
      limit: () => builder,
      order: () => builder,
      maybeSingle: () => {
        isSingle = true;
        return executeSelect();
      },
      single: () => {
        isSingle = true;
        return executeSelect();
      },
      then: (onF: any, onR: any) => executeSelect().then(onF, onR),
      upsert: async (rows: any) => {
        const err = makeFailure();
        if (err) return { data: null, error: err };
        const arr = Array.isArray(rows) ? rows : [rows];
        if (table === "schools") {
          for (const r of arr) {
            mockDb.schools.set(r.name_key, r.name);
          }
        }
        return { data: arr, error: null };
      },
      insert: async (rows: any) => {
        const err = makeFailure();
        if (err) return { data: null, error: err };
        const arr = Array.isArray(rows) ? rows : [rows];
        if (table === "exam_short_links") {
          for (const r of arr) {
            if (mockDb.shortLinks.has(r.short_code)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            mockDb.shortLinks.set(r.short_code, { ...r, id: `sl_${r.short_code}` });
          }
        }
        return { data: arr, error: null };
      },
      update: (patch: any) => ({
        eq: (col: string, val: any) => {
          const runUpdate = async () => {
            const err = makeFailure();
            if (err) return { data: null, error: err };
            if (table === "exams" && col === "id") {
              const cur = mockDb.exams.get(val);
              if (cur) mockDb.exams.set(val, { ...cur, ...patch });
            }
            if (table === "exam_short_links") {
              for (const [k, row] of mockDb.shortLinks.entries()) {
                if (row[col] === val) {
                  mockDb.shortLinks.set(k, { ...row, ...patch });
                }
              }
            }
            return { data: null, error: null };
          };
          return {
            eq: (col2: string, val2: any) => ({
              then: (onF: any, onR: any) =>
                (async () => {
                  const err = makeFailure();
                  if (err) return { data: null, error: err };
                  if (table === "exam_short_links") {
                    for (const [k, row] of mockDb.shortLinks.entries()) {
                      if (row[col] === val && row[col2] === val2) {
                        mockDb.shortLinks.set(k, { ...row, ...patch });
                      }
                    }
                  }
                  return { data: null, error: null };
                })().then(onF, onR),
            }),
            then: (onF: any, onR: any) => runUpdate().then(onF, onR),
          };
        },
      }),
      delete: () => ({
        eq: async (col: string, val: any) => {
          if (table === "schools" && col === "name_key") {
            mockDb.schools.delete(val);
          }
          return { data: null, error: null };
        },
      }),
    };

    return builder;
  };

  return {
    supabase: {
      from: (table: string) => buildQuery(table),
      rpc: async (fn: string, args: any) => {
        await maybeDelay();
        if (fn === "log_exam_access_event") {
          mockDb.loggedEvents.push(args);
          return { data: null, error: null };
        }

        const err = makeFailure();
        if (err) return { data: null, error: err };

        if (fn === "check_exam_code_taken") {
          const code = String(args?.p_code || "").trim().toUpperCase();
          if (mockDb.shortLinks.has(code)) return { data: true, error: null };
          if (mockDb.schools.has(`assign_code:${code}`) || mockDb.schools.has(`short_code:${code}`)) {
            return { data: true, error: null };
          }
          for (const ex of mockDb.exams.values()) {
            const pc = String(ex.team_config?.primary_code || "").trim().toUpperCase();
            if (pc === code) return { data: true, error: null };
            const assigns = Array.isArray(ex.team_config?.assignments) ? ex.team_config.assignments : [];
            if (assigns.some((a: any) => String(a?.code || "").trim().toUpperCase() === code)) {
              return { data: true, error: null };
            }
          }
          return { data: false, error: null };
        }

        if (fn === "resolve_exam_access_code") {
          mockDb.lookupCallCount += 1;
          const raw = String(args?.p_code || "").trim().toUpperCase();
          const norm = /^\d{1,6}$/.test(raw) ? raw.padStart(6, "0") : raw;

          const sl = mockDb.shortLinks.get(raw);
          if (sl && sl.is_active !== false) {
            const ex = mockDb.exams.get(sl.exam_id);
            if (ex) {
              return {
                data: {
                  found: true,
                  source: "exam_short_links",
                  exam_id: ex.id,
                  assignment_id: sl.assignment_id,
                  assignment_code: sl.assignment_code,
                  class_name: sl.class_name || "Chung",
                  short_code: sl.short_code,
                  display_mode: ex.display_mode,
                  status: ex.manual_closed ? "closed" : "open",
                },
                error: null,
              };
            }
          }

          for (const ex of mockDb.exams.values()) {
            const pc = String(ex.team_config?.primary_code || "").trim().toUpperCase();
            const psc = String(ex.team_config?.primary_short_code || "").trim().toUpperCase();
            const assigns = Array.isArray(ex.team_config?.assignments) ? ex.team_config.assignments : [];
            const matchedAssign = assigns.find(
              (a: any) =>
                String(a?.code || "").trim().toUpperCase() === norm ||
                String(a?.code || "").trim().toUpperCase() === raw ||
                String(a?.shortCode || "").trim().toUpperCase() === raw
            );

            if (matchedAssign || pc === norm || pc === raw || psc === raw) {
              return {
                data: {
                  found: true,
                  source: "exams_team_config",
                  exam_id: ex.id,
                  assignment_id: matchedAssign?.id || `primary_${ex.id}`,
                  assignment_code: matchedAssign?.code || pc || norm,
                  class_name: matchedAssign?.className || "Chung",
                  short_code: matchedAssign?.shortCode || psc || undefined,
                  display_mode: ex.display_mode,
                  status: ex.manual_closed ? "closed" : "open",
                },
                error: null,
              };
            }
          }

          return { data: { found: false, reason: "not_found" }, error: null };
        }

        if (fn === "resolve_exam_short_link") {
          const code = String(args?.p_short_code || "").trim().toUpperCase();
          const sl = mockDb.shortLinks.get(code);
          if (!sl || sl.is_active === false) return { data: { found: false }, error: null };
          const ex = mockDb.exams.get(sl.exam_id);
          if (!ex) return { data: { found: false }, error: null };
          return {
            data: {
              found: true,
              short_code: sl.short_code,
              exam_id: sl.exam_id,
              assignment_id: sl.assignment_id,
              assignment_code: sl.assignment_code,
              class_name: sl.class_name,
              target_path: sl.target_path,
              is_primary: sl.is_primary,
              display_mode: ex.display_mode,
              status: ex.manual_closed ? "closed" : "open",
            },
            error: null,
          };
        }

        if (fn === "get_exam_for_student") {
          const ex = mockDb.exams.get(args?.p_exam_id);
          if (!ex) return { data: null, error: { message: "exam not found" } };
          const closed = !!ex.manual_closed || (ex.close_at && new Date() > new Date(ex.close_at));
          const notOpen = ex.open_at && new Date() < new Date(ex.open_at);
          const status = closed ? "closed" : notOpen ? "not_open" : "open";
          return {
            data: {
              id: ex.id,
              title: ex.title,
              duration_minutes: ex.duration_minutes,
              display_mode: ex.display_mode,
              manual_closed: !!ex.manual_closed,
              status,
              open_at: ex.open_at || null,
              close_at: ex.close_at || null,
              scoring: ex.scoring,
              questions: status === "open" ? ex.questions : { partI: [], partII: [], partIII: [] },
            },
            error: null,
          };
        }

        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
      },
    },
  };
});

vi.mock("@/lib/supabaseAuthSync", () => ({
  withSupabaseAuthRetry: async (fn: any) => await fn("teacher-1"),
  ensureSupabaseSession: async () => "teacher-1",
}));

const mockStudent = vi.hoisted(() => ({
  account: "hs_test01",
  fullName: "Nguyễn Văn An",
  className: "12A1",
}));

vi.mock("@/hooks/useStudentAuth", () => ({
  useStudentAuth: () => ({
    student: mockStudent,
    logout: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import {
  createAssignment,
  findAssignmentOrExamByCode,
  isExamCodeTaken,
  syncExamAssignmentCodes,
} from "@/lib/examAssignments";
import { ensureExamShortLink, generateShortCode, resolveShortLink } from "@/lib/shortLinks";
import { getLocalExamAccessLogs, sanitizeCodeForLog, sanitizeTechnicalDetail } from "@/lib/examAccessLogger";
import Share from "@/pages/Share";
import ShortLinkRedirect from "@/pages/ShortLinkRedirect";
import StudentDashboard from "@/pages/StudentDashboard";

const EXAM_A_UUID = "aaaaaaaa-1111-4222-8333-444444444444";
const EXAM_B_UUID = "bbbbbbbb-1111-4222-8333-444444444444";

function makeExam(id: string, primaryCode: string, overrides: Record<string, any> = {}) {
  return {
    id,
    title: `Đề kiểm tra ${primaryCode}`,
    duration_minutes: 45,
    max_attempts: 1,
    display_mode: "standard",
    manual_closed: false,
    open_at: null,
    close_at: null,
    created_by: "teacher-1",
    team_config: {
      primary_code: primaryCode,
      assignments: [],
    },
    questions: {
      partI: [{ id: "q1", text: "Câu 1", options: [{ key: "A", text: "Đúng" }] }],
      partII: [],
      partIII: [],
    },
    ...overrides,
  };
}

describe("Exam Code & Short Link System Reliability", () => {
  beforeEach(() => {
    localStorage.clear();
    mockDb.exams.clear();
    mockDb.schools.clear();
    mockDb.shortLinks.clear();
    mockDb.loggedEvents = [];
    mockDb.failMode = null;
    mockDb.failWriteOnly = false;
    mockDb.delayMs = 0;
    mockDb.lookupCallCount = 0;
  });

  it("1. 10 lần nhập đúng mã liên tiếp đều vào được 10/10, kể cả trên thiết bị mới (localStorage rỗng)", async () => {
    const exam = makeExam(EXAM_A_UUID, "048291");
    mockDb.exams.set(EXAM_A_UUID, exam);
    await syncExamAssignmentCodes(exam);

    for (let i = 0; i < 10; i++) {
      localStorage.clear();
      const res = await findAssignmentOrExamByCode("048291");
      expect(res.success).toBe(true);
      expect(res.exam?.id).toBe(EXAM_A_UUID);
      expect(res.assignment?.code).toBe("048291");
    }
  });

  it("2. Nhiều học sinh truy cập đồng thời (concurrency) trả kết quả chính xác đồng nhất", async () => {
    const exam = makeExam(EXAM_A_UUID, "739201");
    mockDb.exams.set(EXAM_A_UUID, exam);
    await syncExamAssignmentCodes(exam);
    localStorage.clear();

    const batch = await Promise.all(
      Array.from({ length: 15 }, () => findAssignmentOrExamByCode("739201"))
    );
    expect(batch.every((r) => r.success && r.exam?.id === EXAM_A_UUID)).toBe(true);
  });

  it("3. Đề cũ chưa từng đồng bộ vào bảng schools vẫn tìm được chính xác qua RPC resolve_exam_access_code", async () => {
    // Exam tồn tại trong `exams.team_config` nhưng `schools` hoàn toàn trống (lỗi RLS/sync cũ)
    const legacyExam = makeExam(EXAM_B_UUID, "009911");
    mockDb.exams.set(EXAM_B_UUID, legacyExam);
    expect(mockDb.schools.size).toBe(0);

    const res = await findAssignmentOrExamByCode("009911");
    expect(res.success).toBe(true);
    expect(res.exam?.id).toBe(EXAM_B_UUID);
    expect(res.assignment?.code).toBe("009911");

    // Kể cả khi học sinh gõ bỏ số 0 đầu ("9911")
    const unpaddedRes = await findAssignmentOrExamByCode("9911");
    expect(unpaddedRes.success).toBe(true);
    expect(unpaddedRes.exam?.id).toBe(EXAM_B_UUID);
  });

  it("4. Đóng đề và mở lại đề cập nhật trạng thái ngay lập tức, không bị kẹt cache", async () => {
    const exam = makeExam(EXAM_A_UUID, "551122");
    mockDb.exams.set(EXAM_A_UUID, exam);
    await syncExamAssignmentCodes(exam);

    const openRes = await findAssignmentOrExamByCode("551122");
    expect(openRes.success).toBe(true);
    expect(openRes.exam?.manual_closed).toBe(false);
    expect(openRes.exam?.questions?.partI?.length).toBe(1);

    // Giáo viên đóng đề
    mockDb.exams.set(EXAM_A_UUID, { ...exam, manual_closed: true });
    const closedRes = await findAssignmentOrExamByCode("551122");
    expect(closedRes.success).toBe(true);
    expect(closedRes.exam?.manual_closed).toBe(true);
    expect(closedRes.exam?.status).toBe("closed");

    // Giáo viên mở lại đề
    mockDb.exams.set(EXAM_A_UUID, { ...exam, manual_closed: false });
    const reopenedRes = await findAssignmentOrExamByCode("551122");
    expect(reopenedRes.success).toBe(true);
    expect(reopenedRes.exam?.manual_closed).toBe(false);
    expect(reopenedRes.exam?.status).toBe("open");
    expect(reopenedRes.exam?.questions?.partI?.length).toBe(1);
  });

  it("5. Phân biệt rạch ròi mã 6 chữ số và mã link ngắn; chống trùng mã giữa các giáo viên khác nhau", async () => {
    for (let i = 0; i < 60; i++) {
      const sc = generateShortCode();
      expect(sc).toMatch(/[A-Z]/); // Luôn có ít nhất 1 chữ cái, không bao giờ trùng dạng 6 chữ số
    }

    const otherTeacherExam = makeExam(EXAM_B_UUID, "882244", { created_by: "teacher-2" });
    mockDb.exams.set(EXAM_B_UUID, otherTeacherExam);

    expect(await isExamCodeTaken("882244")).toBe(true);
    await expect(
      createAssignment({
        exam: makeExam(EXAM_A_UUID, "112233"),
        className: "12A1",
        customCode: "882244",
      })
    ).rejects.toThrow(/đã được sử dụng/i);
  });

  it("6. Khi Supabase ghi lỗi RLS/mạng, không giả báo thành công và Share.tsx báo lỗi kèm nút Thử lại đồng bộ", async () => {
    const exam = makeExam(EXAM_A_UUID, "664422");
    mockDb.exams.set(EXAM_A_UUID, exam);

    // Giả lập lỗi RLS 42501 khi tạo lượt giao bài hoặc short link
    mockDb.failMode = "rls_42501";
    await expect(createAssignment({ exam, className: "12A2" })).rejects.toThrow(
      /Không thể lưu mã bài thi/i
    );
    await expect(ensureExamShortLink({ exam })).rejects.toThrow(/Không thể lưu link ngắn/i);

    // Mở Share.tsx khi SELECT thành công nhưng ghi đồng bộ thất bại -> hiển thị cảnh báo + nút Thử lại đồng bộ
    mockDb.failWriteOnly = true;
    mockDb.failMode = "rls_42501";
    render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_A_UUID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Chưa đồng bộ xong mã bài thi lên máy chủ/i)).toBeInTheDocument();
    });

    // Sửa lỗi RLS và bấm Thử lại đồng bộ -> khôi phục trạng thái sẵn sàng
    mockDb.failMode = null;
    mockDb.failWriteOnly = false;
    fireEvent.click(screen.getByRole("button", { name: /Thử lại đồng bộ/i }));
    await waitFor(() => {
      expect(screen.getByText(/Đề thi đã sẵn sàng/i)).toBeInTheDocument();
    });
  });

  it("7. Lỗi mạng / 503 khi học sinh nhập mã KHÔNG được báo sai là 'mã không tồn tại'", async () => {
    mockDb.failMode = "network";
    const netRes = await findAssignmentOrExamByCode("583214");
    expect(netRes.success).toBe(false);
    expect(netRes.errorType).toBe("network");
    expect(netRes.error).not.toContain("không tồn tại");
    expect(netRes.error).toContain("kết nối");

    const shortNetRes = await resolveShortLink("A8K29X");
    expect(shortNetRes.success).toBe(false);
    expect(shortNetRes.errorType).toBe("network");
    expect(shortNetRes.error).not.toContain("không tồn tại");

    mockDb.failMode = "server_503";
    const srvRes = await findAssignmentOrExamByCode("583214");
    expect(srvRes.success).toBe(false);
    expect(srvRes.errorType).toBe("server");
    expect(srvRes.error).not.toContain("không tồn tại");
  });

  it("8. ShortLinkRedirect hiển thị đúng màn hình Mất kết nối + nút Thử kết nối lại và khôi phục khi mạng ổn định", async () => {
    const exam = makeExam(EXAM_A_UUID, "314159");
    mockDb.exams.set(EXAM_A_UUID, exam);
    const link = await ensureExamShortLink({ exam });

    mockDb.failMode = "network";
    render(
      <MemoryRouter initialEntries={[`/e/${link.shortCode}`]}>
        <Routes>
          <Route path="/e/:code" element={<ShortLinkRedirect />} />
          <Route path="/take/:id" element={<div>OPENED_EXAM_PAGE</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Không thể kết nối máy chủ")).toBeInTheDocument();
    });

    // Khôi phục mạng & bấm Thử kết nối lại
    mockDb.failMode = null;
    fireEvent.click(screen.getByRole("button", { name: /Thử kết nối lại/i }));
    await waitFor(() => {
      expect(screen.getByText("OPENED_EXAM_PAGE")).toBeInTheDocument();
    });
  });

  it("9. StudentDashboard không xóa mất chữ cái khi gõ mã ngắn/mã chữ và chống bấm gửi liên tiếp (double-click)", async () => {
    const exam = makeExam(EXAM_A_UUID, "424242");
    mockDb.exams.set(EXAM_A_UUID, exam);
    const link = await ensureExamShortLink({ exam });
    mockDb.delayMs = 80;

    render(
      <MemoryRouter initialEntries={["/student"]}>
        <Routes>
          <Route path="/student" element={<StudentDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Nhập mã bài thi/i) as HTMLInputElement;
    // Gõ mã link ngắn toàn chữ/số không có dấu gạch ngang
    fireEvent.change(input, { target: { value: link.shortCode.toLowerCase() } });
    expect(input.value).toBe(link.shortCode.toUpperCase());

    // Gõ mã cũ có dấu gạch ngang từng bước
    fireEvent.change(input, { target: { value: "T" } });
    expect(input.value).toBe("T");
    fireEvent.change(input, { target: { value: "tin12-7a3k9" } });
    expect(input.value).toBe("TIN12-7A3K9");

    // Bấm double-click nút Vào bài thi với mã hợp lệ
    fireEvent.change(input, { target: { value: "424242" } });
    const submitBtn = screen.getByRole("button", { name: /Vào bài thi/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/XÁC NHẬN THAM GIA BÀI THI/i)).toBeInTheDocument();
    });
    // Chỉ gọi tra cứu 1 lần dù bấm đúp nút gửi
    expect(mockDb.lookupCallCount).toBe(1);
  });

  it("10. Hệ thống log kỹ thuật ghi nhận đúng nguyên nhân lỗi và ẩn toàn bộ mật khẩu/thông tin nhạy cảm", async () => {
    expect(sanitizeCodeForLog("https://app.vercel.app/e/A8K29X?password=secret123")).toBe("A8K***9X");
    expect(sanitizeTechnicalDetail("token=abc123 password=mysecret failure")).toContain("[REDACTED]");

    mockDb.failMode = "network";
    await findAssignmentOrExamByCode("999888");
    const logs = getLocalExamAccessLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].outcome).toBe("network_error");
    expect(logs[0].errorCategory).toBe("network");
    expect(JSON.stringify(logs[0])).not.toContain("mysecret");
  });
});
