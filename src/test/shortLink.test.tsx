import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Stateful in-memory mock DB for Supabase tables & RPCs
const mockState = vi.hoisted(() => ({
  exams: new Map<string, any>(),
  schools: new Map<string, string>(),
  shortLinks: new Map<string, any>(),
  deletedExamIds: new Set<string>(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const buildQuery = (table: string) => {
    const filters: Record<string, any> = {};
    let isSingle = false;

    const executeSelect = async () => {
      if (table === "schools") {
        if (Array.isArray(filters.__in_name_key)) {
          const all = filters.__in_name_key
            .filter((k: string) => mockState.schools.has(k))
            .map((k: string) => ({ name_key: k, name: mockState.schools.get(k)! }));
          return { data: isSingle ? all[0] || null : all, error: null };
        }
        if (filters.name_key !== undefined) {
          const val = mockState.schools.get(filters.name_key);
          const row = val !== undefined ? { name_key: filters.name_key, name: val } : null;
          return { data: isSingle ? row : row ? [row] : [], error: null };
        }
        const all = Array.from(mockState.schools.entries()).map(([k, v]) => ({ name_key: k, name: v }));
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      if (table === "exams") {
        if (filters.id !== undefined) {
          const row = mockState.exams.get(filters.id) || null;
          return { data: isSingle ? row : row ? [row] : [], error: null };
        }
        const all = Array.from(mockState.exams.values());
        return { data: isSingle ? all[0] || null : all, error: null };
      }

      if (table === "exam_short_links") {
        const all = Array.from(mockState.shortLinks.values()).filter((row) => {
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
        filters[`__in_${col}`] = Array.isArray(vals) ? vals : [];
        return builder;
      },
      filter: (col: string, _op: string, val: any) => {
        filters[col] = val;
        return builder;
      },
      like: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        isSingle = true;
        return executeSelect();
      },
      single: () => {
        isSingle = true;
        return executeSelect();
      },
      then: (onFulfilled: any, onRejected: any) => executeSelect().then(onFulfilled, onRejected),
      upsert: async (rows: any) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (table === "schools") {
          for (const r of arr) {
            mockState.schools.set(r.name_key, r.name);
          }
        }
        return { data: arr, error: null };
      },
      insert: async (rows: any) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        if (table === "schools") {
          for (const r of arr) {
            if (mockState.schools.has(r.name_key)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
          }
          for (const r of arr) {
            mockState.schools.set(r.name_key, r.name);
          }
          return { data: arr, error: null };
        }
        if (table === "exam_short_links") {
          for (const r of arr) {
            if (mockState.shortLinks.has(r.short_code)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            mockState.shortLinks.set(r.short_code, { ...r, id: `sl_${r.short_code}` });
          }
        }
        return { data: arr, error: null };
      },
      update: (patch: any) => ({
        eq: (col: string, val: any) => {
          const runUpdate = async () => {
            if (table === "exams" && col === "id") {
              const cur = mockState.exams.get(val);
              if (cur) mockState.exams.set(val, { ...cur, ...patch });
            }
            if (table === "exam_short_links") {
              for (const [k, row] of mockState.shortLinks.entries()) {
                if (row[col] === val) {
                  mockState.shortLinks.set(k, { ...row, ...patch });
                }
              }
            }
            return { data: null, error: null };
          };
          const chain: any = {
            eq: (col2: string, val2: any) => {
              const run2 = async () => {
                if (table === "exam_short_links") {
                  for (const [k, row] of mockState.shortLinks.entries()) {
                    if (row[col] === val && row[col2] === val2) {
                      mockState.shortLinks.set(k, { ...row, ...patch });
                    }
                  }
                }
                return { data: null, error: null };
              };
              return run2();
            },
            then: (onF: any, onR: any) => runUpdate().then(onF, onR),
          };
          return chain;
        },
      }),
      delete: () => ({
        eq: async (col: string, val: any) => {
          if (table === "schools" && col === "name_key") {
            mockState.schools.delete(val);
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
        if (fn === "resolve_exam_short_link") {
          const code = String(args?.p_short_code || "").trim().toUpperCase();
          const link = mockState.shortLinks.get(code);
          if (!link || link.is_active === false) {
            return { data: { found: false }, error: null };
          }
          const ex = mockState.exams.get(link.exam_id);
          if (!ex || mockState.deletedExamIds.has(link.exam_id)) {
            return { data: { found: false }, error: null };
          }
          return {
            data: {
              found: true,
              short_code: link.short_code,
              exam_id: link.exam_id,
              assignment_id: link.assignment_id,
              assignment_code: link.assignment_code,
              class_name: link.class_name,
              target_path: link.target_path,
              is_primary: link.is_primary,
              display_mode: ex.display_mode,
              status: ex.manual_closed ? "closed" : "open",
            },
            error: null,
          };
        }

        if (fn === "get_exam_for_student") {
          const eid = args?.p_exam_id;
          if (!eid || mockState.deletedExamIds.has(eid)) {
            return { data: null, error: { message: "exam not found" } };
          }
          const ex = mockState.exams.get(eid);
          if (!ex) {
            return { data: null, error: { message: "exam not found" } };
          }
          // Return sanitized exam without answer keys or explanations
          return {
            data: {
              id: ex.id,
              title: ex.title,
              duration_minutes: ex.duration_minutes,
              display_mode: ex.display_mode,
              manual_closed: ex.manual_closed,
              status: ex.manual_closed ? "closed" : "open",
              open_at: ex.open_at || null,
              close_at: ex.close_at || null,
              lock_mode: ex.lock_mode || {},
              scoring: ex.scoring,
              questions: {
                partI: (ex.questions?.partI || []).map(({ answer: _a, explanation: _e, ...q }: any) => q),
                partII: [],
                partIII: [],
              },
            },
            error: null,
          };
        }

        return { data: null, error: null };
      },
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "teacher-1" } } }, error: null }),
        getUser: async () => ({ data: { user: { id: "teacher-1" } }, error: null }),
      },
    },
  };
});

vi.mock("@/lib/supabaseAuthSync", () => ({
  withSupabaseAuthRetry: async (fn: any) => await fn("teacher-1"),
  ensureSupabaseSession: async () => ({ ok: true }),
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
  SHORT_CODE_ALPHABET,
  generateShortCode,
  generateUniqueShortCode,
  ensureExamShortLink,
  getShortExamUrl,
  resolveShortLink,
  getLocalShortLinks,
} from "@/lib/shortLinks";
import {
  createAssignment,
  deleteAssignment,
  findAssignmentOrExamByCode,
  syncExamAssignmentCodes,
} from "@/lib/examAssignments";
import Share from "@/pages/Share";
import QuickExamShareModal from "@/components/QuickExamShareModal";
import ShortLinkRedirect from "@/pages/ShortLinkRedirect";

const EXAM_UUID = "11111111-2222-4333-8444-555555555555";

function createSampleTeacherExam(overrides: Record<string, any> = {}) {
  return {
    id: EXAM_UUID,
    title: "Kiểm tra giữa kỳ Tin học 12",
    duration_minutes: 45,
    max_attempts: 1,
    display_mode: "standard",
    manual_closed: false,
    open_at: null,
    close_at: null,
    teacher_name: "Cô Thủy",
    created_by: "teacher-1",
    team_config: {
      primary_code: "583214",
      assignments: [],
    },
    questions: {
      partI: [
        {
          id: "q1",
          text: "Câu 1: SQL là viết tắt của?",
          options: [
            { key: "A", text: "Structured Query Language" },
            { key: "B", text: "Simple Query Language" },
            { key: "C", text: "Standard Query Logic" },
            { key: "D", text: "Server Query Language" },
          ],
          answer: "A",
          explanation: "Đáp án bí mật không được lộ khi resolve link",
        },
      ],
      partII: [],
      partIII: [],
    },
    ...overrides,
  };
}

describe("Short Exam Links (/e/:code)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockState.exams.clear();
    mockState.schools.clear();
    mockState.shortLinks.clear();
    mockState.deletedExamIds.clear();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("1. Sinh mã ngắn đúng độ dài 5-8 ký tự, chữ hoa/số rõ ràng, loại bỏ ký tự dễ nhầm 0/O/1/I/L", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateShortCode();
      expect(code.length).toBeGreaterThanOrEqual(5);
      expect(code.length).toBeLessThanOrEqual(8);
      expect(code).toMatch(/^[A-Z0-9]+$/);
      expect(code).not.toMatch(/[0O1IL]/);
      for (const ch of code) {
        expect(SHORT_CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it("2. Không trùng lặp khi sinh liên tiếp và tránh collision với mã đã tồn tại trong CSDL", async () => {
    const generated = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const code = await generateUniqueShortCode();
      expect(generated.has(code)).toBe(false);
      generated.add(code);
      mockState.shortLinks.set(code, {
        short_code: code,
        exam_id: EXAM_UUID,
        target_path: `/take/${EXAM_UUID}`,
        is_active: true,
      });
    }
    expect(generated.size).toBe(30);
  });

  it("3. Tự động tạo link ngắn và tái sử dụng đúng link đã lưu khi mở lại đề thi (không sinh lại)", async () => {
    const exam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, exam);

    const first = await ensureExamShortLink({ exam });
    expect(first.shortCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    // Mã ngắn legacy giữ nguyên /e/:code, còn mã 6 chữ số tạo link trực tiếp /:code
    expect(getShortExamUrl(first.shortCode)).toContain(`/e/${first.shortCode}`);
    expect(getShortExamUrl("583214")).toMatch(/\/583214$/);

    // Mở lại từ trình duyệt mới (localStorage trống), chỉ còn dữ liệu trên Supabase
    localStorage.clear();
    const persistedExam = mockState.exams.get(EXAM_UUID);
    const second = await ensureExamShortLink({ exam: persistedExam });
    expect(second.shortCode).toBe(first.shortCode);

    // Kể cả khi chưa có primary_short_code trên object exam, vẫn khôi phục từ exam_short_links / schools
    const strippedExam = { ...persistedExam, team_config: { primary_code: "583214" } };
    const third = await ensureExamShortLink({ exam: strippedExam });
    expect(third.shortCode).toBe(first.shortCode);
  });

  it("4. Giải mã link ngắn (/e/:code và /123456) không phân biệt hoa/thường, bảo toàn chế độ thi và không làm lộ đáp án", async () => {
    const exam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, exam);
    await syncExamAssignmentCodes(exam);

    const link = await ensureExamShortLink({ exam });
    const lowerCodeRes = await resolveShortLink(link.shortCode.toLowerCase());
    expect(lowerCodeRes.success).toBe(true);
    expect(lowerCodeRes.targetUrl).toBe(`/take/${EXAM_UUID}?code=583214`);
    expect(lowerCodeRes.exam?.id).toBe(EXAM_UUID);
    // Đáp án và lời giải phải được lọc sạch bởi get_exam_for_student
    expect(lowerCodeRes.exam?.questions?.partI?.[0]?.answer).toBeUndefined();
    expect(lowerCodeRes.exam?.questions?.partI?.[0]?.explanation).toBeUndefined();

    // Học sinh dán nguyên URL link ngắn legacy hoặc URL 6 chữ số mới vào ô nhập mã
    const fullUrl = `https://ten-app.vercel.app/e/${link.shortCode}`;
    const byUrl = await findAssignmentOrExamByCode(fullUrl);
    expect(byUrl.success).toBe(true);
    expect(byUrl.exam?.id).toBe(EXAM_UUID);

    const newShortUrl = "https://truongthuyhtq.vercel.app/583214";
    const byNewUrl = await findAssignmentOrExamByCode(newShortUrl);
    expect(byNewUrl.success).toBe(true);
    expect(byNewUrl.exam?.id).toBe(EXAM_UUID);
    expect(byNewUrl.assignment?.code).toBe("583214");
  });

  it("5. Hỗ trợ chế độ Đội/Nhóm (/team/:id) và giao bài theo từng lớp", async () => {
    const teamExamId = "22222222-3333-4444-8555-666666666666";
    const teamExam = createSampleTeacherExam({
      id: teamExamId,
      display_mode: "team",
      team_config: { primary_code: "778899", assignments: [] },
    });
    mockState.exams.set(teamExamId, teamExam);

    const teamLink = await ensureExamShortLink({ exam: teamExam });
    const teamResolved = await resolveShortLink(teamLink.shortCode);
    expect(teamResolved.success).toBe(true);
    expect(teamResolved.targetUrl).toBe(`/team/${teamExamId}`);

    // Tạo lượt giao bài cho lớp 12A1 -> tự động có link ngắn riêng, xóa đi thì link hết hiệu lực
    const stdExam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, stdExam);
    const assign = await createAssignment({ exam: stdExam, className: "12A1" });
    expect(assign.shortCode).toBeTruthy();
    const resAssign = await resolveShortLink(assign.shortCode!);
    expect(resAssign.success).toBe(true);
    expect(resAssign.targetUrl).toContain(`code=${assign.code}`);
    expect(resAssign.targetUrl).toContain("targetClass=12A1");

    await deleteAssignment(EXAM_UUID, assign.id);
    const afterDelete = await resolveShortLink(assign.shortCode!);
    expect(afterDelete.success).toBe(false);
  });

  it("6. Từ chối mã ngắn ngẫu nhiên/không hợp lệ và không vượt qua trạng thái đóng đề hoặc đề đã xóa", async () => {
    const invalid = await resolveShortLink("ZZZZ99");
    expect(invalid.success).toBe(false);
    expect(invalid.exam).toBeUndefined();

    // Đề đã đóng vẫn trả về trạng thái closed để Take chặn làm bài
    const closedExam = createSampleTeacherExam({ manual_closed: true });
    mockState.exams.set(EXAM_UUID, closedExam);
    const link = await ensureExamShortLink({ exam: closedExam });
    const closedRes = await resolveShortLink(link.shortCode);
    expect(closedRes.success).toBe(true);
    expect(closedRes.exam?.manual_closed).toBe(true);
    expect(closedRes.exam?.status).toBe("closed");

    // Đề bị xóa -> không thể truy cập qua link ngắn
    mockState.deletedExamIds.add(EXAM_UUID);
    const deletedRes = await resolveShortLink(link.shortCode);
    expect(deletedRes.success).toBe(false);
    expect(getLocalShortLinks().length).toBeGreaterThan(0);
  });

  it("7. Giao diện Share.tsx tạo link ngắn dùng trực tiếp mã 6 chữ số (/<6-digit>) và tạo QR từ link đó", async () => {
    const exam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, exam);

    const { container } = render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_UUID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("LINK LÀM BÀI NGẮN")).toBeInTheDocument();
    });

    const shortInput = screen.getByLabelText("Link làm bài ngắn") as HTMLInputElement;
    await waitFor(() => {
      expect(shortInput.value).toMatch(/\/583214$/);
    });

    // Không hiển thị link gốc hoặc nút sao chép link gốc
    expect(screen.queryByLabelText("Link làm bài gốc")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sao chép link gốc/i })).toBeNull();
    expect(container.innerHTML).not.toContain(`/take/${EXAM_UUID}`);

    expect(screen.getByRole("button", { name: /Sao chép link ngắn/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mở link/i })).toHaveAttribute(
      "href",
      "/583214"
    );
    expect(screen.getByRole("button", { name: /Tạo QR Code/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sao chép link ngắn/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(shortInput.value);

    // Mở modal QR Code -> link trong modal QR cũng là link ngắn /583214
    fireEvent.click(screen.getByRole("button", { name: /Tạo QR Code/i }));
    await waitFor(() => {
      const inputs = screen.getAllByLabelText("Link làm bài ngắn") as HTMLInputElement[];
      expect(inputs.length).toBe(2);
      expect(inputs[1].value).toBe(shortInput.value);
    });
  });

  it("8. QuickExamShareModal chỉ hiển thị link ngắn dùng mã 6 chữ số (/<6-digit>), nút Sao chép, Mở link và Tạo QR Code", async () => {
    const exam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, exam);

    const { container } = render(
      <MemoryRouter>
        <QuickExamShareModal open={true} onOpenChange={() => {}} exam={exam} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("LINK LÀM BÀI NGẮN")).toBeInTheDocument();
    });

    const shortInput = screen.getByLabelText("Link làm bài ngắn") as HTMLInputElement;
    await waitFor(() => {
      expect(shortInput.value).toMatch(/\/583214$/);
    });

    expect(screen.queryByLabelText("Link làm bài gốc")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sao chép link gốc/i })).toBeNull();
    expect(container.innerHTML).not.toContain(`/take/${EXAM_UUID}`);

    expect(screen.getByRole("button", { name: /Sao chép link ngắn/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mở link/i })).toHaveAttribute("href", "/583214");
    expect(screen.getByRole("button", { name: /Tạo QR Code/i })).toBeInTheDocument();
  });

  it("9. Route /:code (6 chữ số) và legacy /e/:code đều điều hướng đúng học sinh vào trang làm bài; path không phải mã trả về NotFound", async () => {
    const exam = createSampleTeacherExam();
    mockState.exams.set(EXAM_UUID, exam);
    await syncExamAssignmentCodes(exam);
    const link = await ensureExamShortLink({ exam });

    // A. Route mới dạng /583214
    const firstRender = render(
      <MemoryRouter initialEntries={["/583214"]}>
        <Routes>
          <Route path="/:code" element={<ShortLinkRedirect />} />
          <Route path="/take/:id" element={<div data-testid="take-landing-new">Exam Loaded New</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("take-landing-new")).toBeInTheDocument();
    });
    firstRender.unmount();

    // B. Route legacy /e/:code vẫn hoạt động bình thường
    const legacyRender = render(
      <MemoryRouter initialEntries={[`/e/${link.shortCode}`]}>
        <Routes>
          <Route path="/e/:code" element={<ShortLinkRedirect />} />
          <Route path="/take/:id" element={<div data-testid="take-landing-legacy">Exam Loaded Legacy</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("take-landing-legacy")).toBeInTheDocument();
    });
    legacyRender.unmount();

    // C. Mã 6 chữ số không tồn tại -> báo lỗi Không tìm thấy bài thi
    const missingRender = render(
      <MemoryRouter initialEntries={["/999999"]}>
        <Routes>
          <Route path="/:code" element={<ShortLinkRedirect />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Không tìm thấy bài thi")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Nhập mã bài thi khác/i })).toBeInTheDocument();
    missingRender.unmount();

    // D. Đường dẫn không phải mã 6 chữ số -> hiển thị trang 404 NotFound
    render(
      <MemoryRouter initialEntries={["/khong-phai-ma"]}>
        <Routes>
          <Route path="/:code" element={<ShortLinkRedirect />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("404")).toBeInTheDocument();
  });
});
