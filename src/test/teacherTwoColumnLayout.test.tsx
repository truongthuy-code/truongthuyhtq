import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Teacher from "@/pages/Teacher";

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

const { mockInsert, mockSelectSingle, mockSyncCodes, mockShortLink } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelectSingle: vi.fn(),
  mockSyncCodes: vi.fn(),
  mockShortLink: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "gv@test.local", name: "Cô Hoa" },
    profile: { full_name: "Cô Hoa", role: "teacher" },
    isAdmin: false,
    isSuperAdmin: false,
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/supabaseAuthSync", () => ({
  ensureSupabaseSession: vi.fn().mockResolvedValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  withSupabaseAuthRetry: vi.fn(async (op: any) => op("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
}));

vi.mock("@/lib/examAssignments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/examAssignments")>("@/lib/examAssignments");
  return {
    ...actual,
    generateUniqueNumericExamCode: vi.fn().mockResolvedValue("654321"),
    syncExamAssignmentCodes: mockSyncCodes,
  };
});

vi.mock("@/lib/shortLinks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shortLinks")>("@/lib/shortLinks");
  return {
    ...actual,
    ensureExamShortLink: mockShortLink,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "exams") {
          return {
            insert: (payload: any) => {
              mockInsert(payload);
              return {
                select: () => ({
                  single: () => mockSelectSingle(),
                }),
              };
            },
          };
        }
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          like: vi.fn(() => chain),
          order: vi.fn(() => chain),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return chain;
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
          error: null,
        }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      },
    },
  };
});

describe("Trang TẠO BÀI THI MỚI — Bố cục 2 cột (40% trái / 60% phải) & bảo toàn đầy đủ tính năng", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockSelectSingle.mockResolvedValue({
      data: { id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    mockSyncCodes.mockResolvedValue({ success: true, primaryCode: "654321" });
    mockShortLink.mockResolvedValue({ shortCode: "abc123" });
  });

  function renderTeacher() {
    return render(
      <MemoryRouter initialEntries={["/teacher"]}>
        <Routes>
          <Route path="/teacher" element={<Teacher />} />
          <Route path="/exam/:id/share" element={<div data-testid="share-page">Trang chia sẻ đề</div>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("1. Sắp xếp bố cục 2 cột responsive (1 cột trên màn hình nhỏ, 40%/60% cuộn độc lập trên máy tính)", () => {
    renderTeacher();

    const grid = screen.getByTestId("teacher-two-column-layout");
    const leftCol = screen.getByTestId("teacher-left-column");
    const rightCol = screen.getByTestId("teacher-right-column");

    // 1 cột trên mobile, 2 cột 2fr:3fr (40% : 60%) trên desktop/laptop lg+
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");

    // Cột trái & cột phải cuộn độc lập trên desktop, không tạo thanh cuộn ngang
    expect(leftCol.className).toContain("lg:h-full");
    expect(leftCol.className).toContain("lg:overflow-y-auto");
    expect(leftCol.className).toContain("lg:overflow-x-hidden");
    expect(leftCol.className).toContain("min-w-0");

    expect(rightCol.className).toContain("lg:h-full");
    expect(rightCol.className).toContain("lg:overflow-y-auto");
    expect(rightCol.className).toContain("lg:overflow-x-hidden");
    expect(rightCol.className).toContain("min-w-0");

    // Ban đầu cột trái có Tải đề thi, cột phải có khung Xem trước toàn bộ câu hỏi
    expect(leftCol).toHaveTextContent("Tải đề thi");
    expect(rightCol).toHaveTextContent("Xem trước toàn bộ câu hỏi");
  });

  it("2. Giữ nguyên vị trí nội dung hai cột và toàn bộ chức năng tải đề, xem trước, cài đặt, tạo bài thi", async () => {
    renderTeacher();

    const leftCol = screen.getByTestId("teacher-left-column");
    const rightCol = screen.getByTestId("teacher-right-column");

    // 1. Tải đề thi ở cột trái (tab Nhập tay)
    const manualTab = screen.getByRole("tab", { name: /Nhập tay/i });
    fireEvent.mouseDown(manualTab);
    fireEvent.click(manualTab);

    const textarea = await screen.findByPlaceholderText(/PHẦN I/i);
    fireEvent.change(textarea, {
      target: {
        value: [
          "PHẦN I",
          "Câu 1: Thủ đô của Việt Nam là?",
          "*A. Hà Nội",
          "B. Đà Nẵng",
          "C. Huế",
          "D. Cần Thơ",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Phân tích/i }));

    // 2. Cột trái hiển thị Cài đặt bài thi + nút Tạo link bài thi; cột phải hiển thị Xem trước câu hỏi
    expect(await screen.findByText("Cài đặt bài thi")).toBeInTheDocument();
    expect(leftCol).toHaveTextContent("Tải đề thi");
    expect(leftCol).toHaveTextContent("Cài đặt bài thi");
    expect(leftCol).toHaveTextContent("Tạo link bài thi");

    expect(rightCol).toHaveTextContent("Xem trước toàn bộ câu hỏi");
    expect(rightCol).toHaveTextContent("Thủ đô của Việt Nam là?");
    expect(rightCol).not.toHaveTextContent("Cài đặt bài thi");

    // 3. Thay đổi tùy chọn cài đặt trong cột trái
    const titleInput = leftCol.querySelector("input") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Đề kiểm tra 2 cột" } });

    // 4. Bấm Tạo link bài thi -> lưu và điều hướng sang trang chia sẻ như cũ
    const createBtn = screen.getByRole("button", { name: "Tạo link bài thi" });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });
    expect(mockInsert.mock.calls[0][0].title).toBe("Đề kiểm tra 2 cột");
    expect(await screen.findByTestId("share-page")).toBeInTheDocument();
  });
});
