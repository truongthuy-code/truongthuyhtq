import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import React from "react";

/**
 * Mô phỏng chính xác chính sách RLS thực tế của bảng `public.schools` trên PostgreSQL/Supabase:
 * - SELECT: cho phép đọc công khai (anon + authenticated).
 * - INSERT: cho phép authenticated khi `name_key` chưa tồn tại.
 * - UPDATE / UPSERT (ON CONFLICT DO UPDATE):
 *     + Khi giả lập DB CHƯA chạy migration `20261118000000` (unmigratedDb = true):
 *       MỌI lệnh `.upsert()` chạm vào `name_key` đã tồn tại sẽ bị PostgreSQL đánh giá policy UPDATE
 *       `USING (is_admin(auth.uid()))` -> trả về lỗi 42501:
 *       `new row violates row-level security policy (USING expression) for table "schools"`!
 *     + Khi giáo viên A và giáo viên B dùng tài khoản khác nhau (multi-school / multi-teacher):
 *       Giáo viên B KHÔNG BAO GIỜ được phép ghi đè hoặc sửa `name_key` thuộc bài thi của giáo viên A.
 * - Hỗ trợ mô phỏng ngắt kết nối mạng (networkErrorCount) giữa chừng để test nút "Thử lại đồng bộ".
 */
const rlsMockState = vi.hoisted(() => ({
  currentUserId: "teacher-a-uuid-1111",
  currentSchoolId: "school-a",
  unmigratedSchoolsUpdateRls: true,
  failNextSchoolsSelect: false,
  failNextSchoolsInsert: false,
  exams: new Map<string, any>(),
  schools: new Map<string, { name_key: string; name: string; owner_user_id?: string }>(),
  shortLinks: new Map<string, any>(),
  upsertAttempts: [] as Array<{ keys: string[]; failedWithRls: boolean }>,
  insertAttempts: [] as Array<{ keys: string[]; succeeded: boolean }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const buildQuery = (table: string) => {
    const filters: Array<{ col: string; op: string; val: any }> = [];
    let isSingle = false;

    const executeSelect = async () => {
      if (table === "schools") {
        if (rlsMockState.failNextSchoolsSelect) {
          rlsMockState.failNextSchoolsSelect = false;
          return { data: null, error: { message: "Failed to fetch", status: 0 } };
        }
        let rows = Array.from(rlsMockState.schools.values()).map((r) => ({
          name_key: r.name_key,
          name: r.name,
        }));
        for (const f of filters) {
          if (f.op === "eq") {
            rows = rows.filter((r: any) => r[f.col] === f.val);
          } else if (f.op === "in") {
            rows = rows.filter((r: any) => Array.isArray(f.val) && f.val.includes(r[f.col]));
          } else if (f.op === "like") {
            const prefix = String(f.val || "").replace(/%$/, "");
            rows = rows.filter((r: any) => String(r[f.col] || "").startsWith(prefix));
          }
        }
        return { data: isSingle ? rows[0] || null : rows, error: null };
      }

      if (table === "exams") {
        let rows = Array.from(rlsMockState.exams.values());
        for (const f of filters) {
          if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val);
        }
        return { data: isSingle ? rows[0] || null : rows, error: null };
      }

      if (table === "exam_short_links") {
        let rows = Array.from(rlsMockState.shortLinks.values());
        for (const f of filters) {
          if (f.op === "eq") rows = rows.filter((r) => r[f.col] === f.val);
        }
        return { data: isSingle ? rows[0] || null : rows, error: null };
      }

      return { data: isSingle ? null : [], error: null };
    };

    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        filters.push({ col, op: "eq", val });
        return builder;
      },
      in: (col: string, val: any) => {
        filters.push({ col, op: "in", val });
        return builder;
      },
      like: (col: string, val: any) => {
        filters.push({ col, op: "like", val });
        return builder;
      },
      ilike: (col: string, val: any) => {
        filters.push({ col, op: "like", val });
        return builder;
      },
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
      insert: async (rows: any) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        const keys = arr.map((r) => r.name_key).filter(Boolean);

        if (table === "schools") {
          if (rlsMockState.failNextSchoolsInsert) {
            rlsMockState.failNextSchoolsInsert = false;
            rlsMockState.insertAttempts.push({ keys, succeeded: false });
            return { data: null, error: { message: "Failed to fetch", status: 0 } };
          }
          // Check duplicate PK first (Postgres unique constraint)
          for (const r of arr) {
            if (rlsMockState.schools.has(r.name_key)) {
              rlsMockState.insertAttempts.push({ keys, succeeded: false });
              return {
                data: null,
                error: { code: "23505", message: `duplicate key value violates unique constraint "schools_pkey"` },
              };
            }
          }
          for (const r of arr) {
            rlsMockState.schools.set(r.name_key, {
              name_key: r.name_key,
              name: r.name,
              owner_user_id: rlsMockState.currentUserId,
            });
          }
          rlsMockState.insertAttempts.push({ keys, succeeded: true });
          return { data: arr, error: null };
        }

        if (table === "exam_short_links") {
          for (const r of arr) {
            if (rlsMockState.shortLinks.has(r.short_code)) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            rlsMockState.shortLinks.set(r.short_code, { ...r, id: `sl_${r.short_code}` });
          }
          return { data: arr, error: null };
        }

        return { data: arr, error: null };
      },
      upsert: async (rows: any) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        const keys = arr.map((r) => r.name_key).filter(Boolean);

        if (table === "schools") {
          // Simulate exact Postgres ON CONFLICT DO UPDATE behavior:
          // If ANY key already exists in `schools`, PostgreSQL checks UPDATE USING policy!
          const existingHits = arr.filter((r) => rlsMockState.schools.has(r.name_key));
          if (existingHits.length > 0 && rlsMockState.unmigratedSchoolsUpdateRls) {
            rlsMockState.upsertAttempts.push({ keys, failedWithRls: true });
            return {
              data: null,
              error: {
                code: "42501",
                message: 'new row violates row-level security policy (USING expression) for table "schools"',
              },
            };
          }

          // Even when migrated, cross-teacher/cross-exam overwrite is blocked by scoped RLS!
          for (const r of existingHits) {
            const cur = rlsMockState.schools.get(r.name_key)!;
            if (cur.owner_user_id && cur.owner_user_id !== rlsMockState.currentUserId) {
              rlsMockState.upsertAttempts.push({ keys, failedWithRls: true });
              return {
                data: null,
                error: {
                  code: "42501",
                  message: 'new row violates row-level security policy for table "schools"',
                },
              };
            }
          }

          for (const r of arr) {
            rlsMockState.schools.set(r.name_key, {
              name_key: r.name_key,
              name: r.name,
              owner_user_id: rlsMockState.currentUserId,
            });
          }
          rlsMockState.upsertAttempts.push({ keys, failedWithRls: false });
          return { data: arr, error: null };
        }

        return { data: arr, error: null };
      },
      update: (patch: any) => ({
        eq: async (col: string, val: any) => {
          if (table === "exams" && col === "id") {
            const ex = rlsMockState.exams.get(val);
            if (ex && ex.created_by && ex.created_by !== rlsMockState.currentUserId) {
              return {
                data: null,
                error: { code: "42501", message: 'new row violates row-level security policy for table "exams"' },
              };
            }
            if (ex) {
              rlsMockState.exams.set(val, { ...ex, ...patch });
            }
          }
          return { data: null, error: null };
        },
      }),
      delete: () => ({
        eq: async (col: string, val: any) => {
          if (table === "schools" && col === "name_key") {
            const cur = rlsMockState.schools.get(val);
            if (cur?.owner_user_id && cur.owner_user_id !== rlsMockState.currentUserId) {
              return {
                data: null,
                error: { code: "42501", message: 'permission denied for table "schools"' },
              };
            }
            rlsMockState.schools.delete(val);
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
        // Mô phỏng môi trường Supabase chưa chạy SQL RPC mới (404 PGRST202) trừ get_exam_for_student
        if (fn === "get_exam_for_student") {
          const eid = args?.p_exam_id;
          const ex = rlsMockState.exams.get(eid);
          if (!ex) return { data: null, error: { message: "exam not found" } };
          return {
            data: {
              id: ex.id,
              title: ex.title,
              duration_minutes: ex.duration_minutes,
              display_mode: ex.display_mode || "standard",
              manual_closed: !!ex.manual_closed,
              open_at: ex.open_at || null,
              close_at: ex.close_at || null,
              team_config: ex.team_config || {},
              lock_mode: ex.lock_mode || {},
              scoring: ex.scoring || {},
              questions: {
                partI: (ex.questions?.partI || []).map(({ answer: _a, explanation: _e, ...q }: any) => q),
                partII: [],
                partIII: [],
              },
            },
            error: null,
          };
        }

        return {
          data: null,
          error: { code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` },
        };
      },
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: rlsMockState.currentUserId } } },
          error: null,
        }),
        getUser: async () => ({
          data: { user: { id: rlsMockState.currentUserId } },
          error: null,
        }),
      },
    },
  };
});

vi.mock("@/lib/supabaseAuthSync", () => ({
  withSupabaseAuthRetry: async (fn: any) => await fn(rlsMockState.currentUserId),
  ensureSupabaseSession: async () => rlsMockState.currentUserId,
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
  syncExamAssignmentCodes,
  findAssignmentOrExamByCode,
  generateUniqueNumericExamCode,
  createAssignment,
} from "@/lib/examAssignments";
import { ensureExamShortLink, getShortExamUrl, resolveShortLink } from "@/lib/shortLinks";
import Share from "@/pages/Share";
import ShortLinkRedirect from "@/pages/ShortLinkRedirect";

const EXAM_A_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const EXAM_B_ID = "bbbbbbbb-2222-4222-8222-222222222222";

function makeExam(overrides: Record<string, any> = {}) {
  return {
    id: EXAM_A_ID,
    title: "Đề kiểm tra Vật Lý 12 - Trường THPT Chu Văn An",
    duration_minutes: 45,
    max_attempts: 1,
    display_mode: "standard",
    manual_closed: false,
    open_at: null,
    close_at: null,
    teacher_name: "Thầy Minh",
    school_name: "THPT Chu Văn An",
    subject_name: "Vật Lý",
    created_by: rlsMockState.currentUserId,
    team_config: {
      primary_code: "642819",
      assignments: [],
    },
    questions: {
      partI: [
        {
          id: "q1",
          text: "Đơn vị của tần số là gì?",
          options: [
            { key: "A", text: "Hz" },
            { key: "B", text: "m/s" },
            { key: "C", text: "N" },
            { key: "D", text: "J" },
          ],
          answer: "A",
        },
      ],
      partII: [],
      partIII: [],
    },
    ...overrides,
  };
}

describe("Fix Supabase RLS trên bảng `schools` & Đồng bộ mã bài thi 6 chữ số", () => {
  beforeEach(() => {
    localStorage.clear();
    rlsMockState.currentUserId = "teacher-a-uuid-1111";
    rlsMockState.currentSchoolId = "school-a";
    rlsMockState.unmigratedSchoolsUpdateRls = true;
    rlsMockState.failNextSchoolsSelect = false;
    rlsMockState.failNextSchoolsInsert = false;
    rlsMockState.exams.clear();
    rlsMockState.schools.clear();
    rlsMockState.shortLinks.clear();
    rlsMockState.upsertAttempts = [];
    rlsMockState.insertAttempts = [];
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("Test 1: Giáo viên tạo đề và mở trang Chia sẻ liên tục (re-sync nhiều lần) không bao giờ dính lỗi RLS USING expression", async () => {
    const examA = makeExam();
    rlsMockState.exams.set(EXAM_A_ID, examA);

    // Lần 1: Teacher.tsx đồng bộ mã bài thi khi tạo đề
    const sync1 = await syncExamAssignmentCodes(examA);
    expect(sync1.success).toBe(true);
    expect(sync1.primaryCode).toBe("642819");
    expect(rlsMockState.schools.has("assign_code:642819")).toBe(true);

    // Tạo link ngắn ngay sau đó
    const sl1 = await ensureExamShortLink({ exam: examA });
    expect(sl1.shortCode).toMatch(/^[A-Z0-9]{6}$/);

    // Lần 2: Render Share.tsx (mở trang Chia sẻ sẽ gọi syncExamAssignmentCodes & ensureExamShortLink lại lần nữa)
    // Với code cũ (gọi upsert trực tiếp), lần 2 này CHẮC CHẮN chết lỗi 42501 USING expression!
    render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_A_ID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("642819")).toBeInTheDocument();
      expect(screen.getByText(/Đề thi đã sẵn sàng/i)).toBeInTheDocument();
    });

    // Không có banner lỗi RLS và không có upsert thất bại nào
    expect(screen.queryByText(/Chưa đồng bộ xong mã bài thi lên máy chủ/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/row-level security policy/i)).not.toBeInTheDocument();
    expect(rlsMockState.upsertAttempts.filter((a) => a.failedWithRls)).toHaveLength(0);
  });

  it("Test 2: Học sinh ở thiết bị/trình duyệt khác (chưa đăng nhập, localStorage rỗng) nhập mã 6 chữ số vào làm bài thành công", async () => {
    const examA = makeExam();
    rlsMockState.exams.set(EXAM_A_ID, examA);
    const syncRes = await syncExamAssignmentCodes(examA);
    expect(syncRes.success).toBe(true);

    // Mô phỏng thiết bị học sinh hoàn toàn mới: xóa sạch localStorage & đóng vai trò khách ẩn danh
    localStorage.clear();
    rlsMockState.currentUserId = "";

    const lookup = await findAssignmentOrExamByCode("642819");
    expect(lookup.success).toBe(true);
    expect(lookup.exam?.id).toBe(EXAM_A_ID);
    expect(lookup.assignment?.code).toBe("642819");
    // Không lộ đáp án khi học sinh resolve
    expect(lookup.exam?.questions?.partI?.[0]?.answer).toBeUndefined();
  });

  it("Test 3: Học sinh truy cập bằng link ngắn (/:code và /e/:code) dẫn tới đúng cùng một bài thi và mã 6 chữ số", async () => {
    const examA = makeExam();
    rlsMockState.exams.set(EXAM_A_ID, examA);
    await syncExamAssignmentCodes(examA);
    const sl = await ensureExamShortLink({ exam: examA });

    // Thiết bị học sinh khác (không cần đăng nhập, localStorage sạch)
    localStorage.clear();
    rlsMockState.currentUserId = "";

    const resolved = await resolveShortLink(sl.shortCode);
    expect(resolved.success).toBe(true);
    expect(resolved.exam?.id).toBe(EXAM_A_ID);
    expect(resolved.targetUrl).toBe(`/take/${EXAM_A_ID}?code=642819`);

    // Kiểm tra route mới /:code (mã 6 chữ số)
    const rootRender = render(
      <MemoryRouter initialEntries={["/642819"]}>
        <Routes>
          <Route path="/:code" element={<ShortLinkRedirect />} />
          <Route path="/take/:id" element={<div>EXAM_TAKE_ROUTE_NEW_READY</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("EXAM_TAKE_ROUTE_NEW_READY")).toBeInTheDocument();
    });
    rootRender.unmount();

    // Kiểm tra trang ShortLinkRedirect với route /e/:code vẫn hoạt động tương thích ngược
    render(
      <MemoryRouter initialEntries={[`/e/${sl.shortCode}`]}>
        <Routes>
          <Route path="/e/:code" element={<ShortLinkRedirect />} />
          <Route path="/take/:id" element={<div>EXAM_TAKE_ROUTE_READY</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("EXAM_TAKE_ROUTE_READY")).toBeInTheDocument();
    });
  });

  it("Test 4: Mã QR chứa đúng link ngắn 6 chữ số (/<6-digit>) khớp 100% cùng bài thi với mã 6 chữ số", async () => {
    const examA = makeExam();
    rlsMockState.exams.set(EXAM_A_ID, examA);
    await syncExamAssignmentCodes(examA);
    await ensureExamShortLink({ exam: examA });

    render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_A_ID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Đề thi đã sẵn sàng/i)).toBeInTheDocument();
    });

    const shortInput = screen.getByLabelText("Link làm bài ngắn") as HTMLInputElement;
    const expectedShortUrl = getShortExamUrl("642819");
    expect(shortInput.value).toBe(expectedShortUrl);
    expect(shortInput.value).toMatch(/\/642819$/);

    // QR URL luôn trỏ về cùng EXAM_A_ID + code 642819
    const qrResolved = await findAssignmentOrExamByCode(shortInput.value);
    expect(qrResolved.success).toBe(true);
    expect(qrResolved.exam?.id).toBe(EXAM_A_ID);
    expect(qrResolved.assignment?.code).toBe("642819");
  });

  it("Test 5: Cô lập giữa nhiều trường / nhiều giáo viên: Giáo viên B không ghi đè được mã của Giáo viên A và tự đổi sang mã 6 chữ số khác không trùng", async () => {
    // Giáo viên A (Trường THPT Chu Văn An) sở hữu mã 642819
    rlsMockState.currentUserId = "teacher-a-uuid-1111";
    const examA = makeExam({
      id: EXAM_A_ID,
      teacher_name: "Thầy Minh",
      school_name: "THPT Chu Văn An",
      team_config: { primary_code: "642819", assignments: [] },
    });
    rlsMockState.exams.set(EXAM_A_ID, examA);
    const syncA = await syncExamAssignmentCodes(examA);
    expect(syncA.success).toBe(true);

    // Giáo viên B (Trường THPT Lê Quý Đôn) tạo đề mới mà có primary_code trùng "642819"
    rlsMockState.currentUserId = "teacher-b-uuid-2222";
    const examB = makeExam({
      id: EXAM_B_ID,
      title: "Đề kiểm tra Hóa 12 - Trường Lê Quý Đôn",
      teacher_name: "Cô Lan",
      school_name: "THPT Lê Quý Đôn",
      created_by: "teacher-b-uuid-2222",
      team_config: { primary_code: "642819", assignments: [] },
    });
    rlsMockState.exams.set(EXAM_B_ID, examB);

    const syncB = await syncExamAssignmentCodes(examB);
    expect(syncB.success).toBe(true);
    // Hệ thống tự động phát hiện xung đột mã với Giáo viên A và cấp mã mới hoàn toàn cho Giáo viên B
    expect(syncB.primaryCode).toBeTruthy();
    expect(syncB.primaryCode).not.toBe("642819");
    expect(syncB.primaryCode).toMatch(/^\d{6}$/);

    // Dữ liệu gốc của Giáo viên A vẫn nguyên vẹn 100%, không bị ghi đè!
    const verifyA = await findAssignmentOrExamByCode("642819");
    expect(verifyA.success).toBe(true);
    expect(verifyA.exam?.id).toBe(EXAM_A_ID);

    // Mã mới của Giáo viên B truy cập chính xác đề của Giáo viên B
    const verifyB = await findAssignmentOrExamByCode(syncB.primaryCode!);
    expect(verifyB.success).toBe(true);
    expect(verifyB.exam?.id).toBe(EXAM_B_ID);

    // Tạo mã giao bài tùy chỉnh trùng với mã của Giáo viên A phải bị từ chối rõ ràng
    await expect(
      createAssignment({ exam: examB, className: "12B2", customCode: "642819" })
    ).rejects.toThrow();

    // Generate mã số tự động cho giáo viên B không bao giờ trả về mã đã thuộc giáo viên A
    const freshCode = await generateUniqueNumericExamCode();
    expect(freshCode).toMatch(/^\d{6}$/);
    expect(freshCode).not.toBe("642819");
    expect(freshCode).not.toBe(syncB.primaryCode);
  });

  it("Test 6: Mạng gián đoạn giữa chừng không báo thành công giả; bấm 'Thử lại đồng bộ' giữ nguyên cùng 1 mã 6 chữ số và không tạo dữ liệu trùng", async () => {
    const examA = makeExam({
      team_config: { primary_code: "739104", assignments: [] },
    });
    rlsMockState.exams.set(EXAM_A_ID, examA);

    // Giả lập lỗi mạng khi INSERT vào bảng `schools`
    rlsMockState.failNextSchoolsInsert = true;

    render(
      <MemoryRouter initialEntries={[`/exam/${EXAM_A_ID}/share`]}>
        <Routes>
          <Route path="/exam/:id/share" element={<Share />} />
        </Routes>
      </MemoryRouter>
    );

    // Phải hiển thị cảnh báo chưa đồng bộ xong + nút Thử lại đồng bộ (KHÔNG báo thành công giả)
    await waitFor(() => {
      expect(screen.getByText(/Chưa đồng bộ xong mã bài thi lên máy chủ/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Thử lại đồng bộ/i })).toBeInTheDocument();
    });
    expect(rlsMockState.schools.has("assign_code:739104")).toBe(false);

    // Mạng khôi phục, giáo viên bấm "Thử lại đồng bộ"
    fireEvent.click(screen.getByRole("button", { name: /Thử lại đồng bộ/i }));

    await waitFor(() => {
      expect(screen.getByText(/Đề thi đã sẵn sàng/i)).toBeInTheDocument();
    });

    // Giữ nguyên đúng mã 6 chữ số ban đầu 739104, không sinh mã trùng
    expect(screen.getByText("739104")).toBeInTheDocument();
    expect(rlsMockState.schools.has("assign_code:739104")).toBe(true);
    const assignKeys = Array.from(rlsMockState.schools.keys()).filter((k) => {
      if (!/^assign_code:\d{6}$/.test(k)) return false;
      const val = JSON.parse(rlsMockState.schools.get(k)!.name);
      return val.examId === EXAM_A_ID;
    });
    // Chỉ có đúng 1 mã 6 chữ số cho bài thi này
    expect(assignKeys).toEqual(["assign_code:739104"]);
  });
});
