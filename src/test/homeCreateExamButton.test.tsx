import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Index from "@/pages/Index";
import Teacher from "@/pages/Teacher";

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

const mockExamsList = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Đề kiểm tra Tin học mẫu",
    duration_minutes: 45,
    created_at: new Date().toISOString(),
    questions: { partI: [], partII: [], partIII: [] },
    created_by: "22222222-2222-4222-8222-222222222222",
    display_mode: "standard",
  },
];

const MOCK_AUTH = {
  user: { id: "22222222-2222-4222-8222-222222222222", email: "teacher@test.local" },
  profile: { full_name: "Nguyễn Thị Hoa", role: "teacher" },
  isAdmin: false,
  isSuperAdmin: false,
  loading: false,
  signOut: vi.fn(),
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => MOCK_AUTH,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQueryChain = (resolvedData: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      or: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: resolvedData, error: null }).then(resolve, reject),
    };
    return chain;
  };

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "exams") return makeQueryChain(mockExamsList);
        if (table === "submissions") return makeQueryChain([]);
        if (table === "exam_folders") return makeQueryChain([]);
        return makeQueryChain([]);
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
          error: null,
        }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    },
  };
});

function renderHomeWithRoutes(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/teacher" element={<Teacher />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("HOMEPAGE '+ Tạo đề mới' BUTTON BESIDE '+ Tạo thư mục'", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("1. Renders '+ Tạo đề mới' directly beside '+ Tạo thư mục' on the same row with matching styling", async () => {
    renderHomeWithRoutes("/");

    const createFolderBtn = await screen.findByRole("button", { name: /\+ Tạo thư mục/i });
    const createExamLink = await screen.findByRole("link", { name: /\+ Tạo đề mới/i });

    expect(createFolderBtn).toBeInTheDocument();
    expect(createExamLink).toBeInTheDocument();

    // Both sit inside the same non-wrapping action row directly beside each other
    const actionRow = createFolderBtn.parentElement;
    expect(actionRow).not.toBeNull();
    expect(actionRow).toBe(createExamLink.parentElement);
    expect(actionRow?.className).toContain("flex items-center gap-2");
    expect(createFolderBtn.nextElementSibling).toBe(createExamLink);

    // Consistent button geometry & styling
    expect(createFolderBtn.className).toContain("rounded-xl");
    expect(createFolderBtn.className).toContain("h-9");
    expect(createExamLink.className).toContain("rounded-xl");
    expect(createExamLink.className).toContain("h-9");
    expect(createExamLink.getAttribute("href")).toBe("/teacher");

    // Existing exam card from teacher account displays properly on homepage
    expect(await screen.findByText("Đề kiểm tra Tin học mẫu")).toBeInTheDocument();
  });

  it("2. Clicking '+ Tạo đề mới' opens the existing Teacher exam creation page without auto-creating any folder", async () => {
    renderHomeWithRoutes("/");

    const createExamLink = await screen.findByRole("link", { name: /\+ Tạo đề mới/i });
    fireEvent.click(createExamLink);

    // Should navigate to existing Teacher page ("Tạo bài thi mới") without creating any folder
    await waitFor(() => {
      expect(screen.getByText("Tạo bài thi mới")).toBeInTheDocument();
    });

    // No folder was created automatically
    expect(screen.queryByText("Tạo thư mục mới")).toBeNull();
    const storedFoldersRaw = localStorage.getItem("exam_folders_v1");
    expect(!storedFoldersRaw || JSON.parse(storedFoldersRaw).length === 0).toBe(true);
  });

  it("3. '+ Tạo thư mục' still opens the Create Folder modal properly without affecting existing flows", async () => {
    renderHomeWithRoutes("/");

    const createFolderBtn = await screen.findByRole("button", { name: /\+ Tạo thư mục/i });
    fireEvent.click(createFolderBtn);

    expect(await screen.findByText("Tạo thư mục mới")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo thư mục" })).toBeInTheDocument();
  });
});
