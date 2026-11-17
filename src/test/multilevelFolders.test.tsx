import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fs from "fs";
import path from "path";
import {
  createFolder,
  getFolders,
  updateFolder,
  moveFolder,
  deleteFolder,
  checkDuplicateFolderName,
  getFolderPath,
  getFolderBreadcrumbLabel,
  getRootFolders,
  getChildFolders,
  getDescendantFolderIds,
  canMoveFolder,
  buildFolderTreeOptions,
  getRecursiveExamCount,
  getDirectExamCount,
  moveExamToFolder,
  getFolderIdForExam,
  resetFolderStorageAvailabilityCache,
  ExamFolder,
} from "@/lib/folderStorage";
import {
  CreateOrEditFolderModal,
  DeleteFolderModal,
  MoveExamModal,
  MoveFolderModal,
} from "@/components/FolderModals";
import Index from "@/pages/Index";
import Teacher from "@/pages/Teacher";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

const { TEACHER_A_ID, TEACHER_B_ID, getCurrentAuth, setCurrentAuth, mockExamsData } = vi.hoisted(() => {
  const tA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let authState = {
    user: { id: tA, email: "teacher.a@test.local" },
    profile: { full_name: "Cô Lan", role: "teacher" },
    isAdmin: false,
    isSuperAdmin: false,
    loading: false,
    signOut: () => {},
  };
  const exams = [
    {
      id: "exam-deep-01",
      title: "Đề kiểm tra 15 phút Bài 1",
      duration_minutes: 15,
      created_at: "2026-11-16T08:00:00Z",
      questions: { partI: [], partII: [], partIII: [] },
      created_by: tA,
      display_mode: "standard",
      folder_id: null as string | null,
    },
    {
      id: "exam-root-02",
      title: "Đề ôn tập học kỳ Tin 12",
      duration_minutes: 45,
      created_at: "2026-11-16T09:00:00Z",
      questions: { partI: [], partII: [], partIII: [] },
      created_by: tA,
      display_mode: "standard",
      folder_id: null as string | null,
    },
  ];
  return {
    TEACHER_A_ID: tA,
    TEACHER_B_ID: tB,
    getCurrentAuth: () => authState,
    setCurrentAuth: (next: typeof authState) => {
      authState = next;
    },
    mockExamsData: exams,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => getCurrentAuth(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeQueryChain = (resolvedData: any) => {
    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      eq: vi.fn(() => chain),
      like: vi.fn(() => chain),
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
        if (table === "exams") return makeQueryChain(mockExamsData);
        if (table === "submissions") return makeQueryChain([]);
        if (table === "exam_folders") return makeQueryChain([]);
        return makeQueryChain([]);
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: TEACHER_A_ID } },
          error: null,
        }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      },
    },
  };
});

function renderAppAt(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/teacher" element={<Teacher />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("HỆ THỐNG QUẢN LÝ THƯ MỤC NHIỀU CẤP & TẠO ĐỀ TRONG THƯ MỤC CON", () => {
  beforeEach(() => {
    localStorage.clear();
    resetFolderStorageAvailabilityCache();
    vi.clearAllMocks();
    setCurrentAuth({
      user: { id: TEACHER_A_ID, email: "teacher.a@test.local" },
      profile: { full_name: "Cô Lan", role: "teacher" },
      isAdmin: false,
      isSuperAdmin: false,
      loading: false,
      signOut: vi.fn(),
    });
  });

  describe("1. Cấu trúc cây thư mục nhiều cấp (Gốc, Cấp 2, 3, 4+) & Quy tắc trùng tên", () => {
    it("1.1. Tạo thư mục gốc và nhiều cấp lồng nhau (4+ cấp) + nhiều thư mục con cùng cấp", async () => {
      const root = await createFolder({
        name: "Tin học 12",
        teacher_id: TEACHER_A_ID,
      });
      const ch1 = await createFolder({
        name: "Chương 1",
        parent_id: root.id,
        teacher_id: TEACHER_A_ID,
      });
      const ch2 = await createFolder({
        name: "Chương 2",
        parent_id: root.id,
        teacher_id: TEACHER_A_ID,
      });
      const bai1 = await createFolder({
        name: "Bài 1",
        parent_id: ch1.id,
        teacher_id: TEACHER_A_ID,
      });
      const bai2 = await createFolder({
        name: "Bài 2",
        parent_id: ch1.id,
        teacher_id: TEACHER_A_ID,
      });
      const cap4 = await createFolder({
        name: "Đề kiểm tra 15 phút",
        parent_id: bai1.id,
        teacher_id: TEACHER_A_ID,
      });
      const cap5 = await createFolder({
        name: "Đề nâng cao",
        parent_id: cap4.id,
        teacher_id: TEACHER_A_ID,
      });

      const all = await getFolders(TEACHER_A_ID);
      expect(all.length).toBe(7);
      expect(getRootFolders(all).map((f) => f.name)).toEqual(["Tin học 12"]);
      expect(getChildFolders(all, root.id).map((f) => f.name).sort()).toEqual(["Chương 1", "Chương 2"]);
      expect(getChildFolders(all, ch1.id).map((f) => f.name).sort()).toEqual(["Bài 1", "Bài 2"]);
      expect(getChildFolders(all, bai1.id).map((f) => f.name)).toEqual(["Đề kiểm tra 15 phút"]);
      expect(getChildFolders(all, cap4.id).map((f) => f.name)).toEqual(["Đề nâng cao"]);

      const path5 = getFolderPath(all, cap5.id);
      expect(path5.map((f) => f.name)).toEqual([
        "Tin học 12",
        "Chương 1",
        "Bài 1",
        "Đề kiểm tra 15 phút",
        "Đề nâng cao",
      ]);
      expect(getFolderBreadcrumbLabel(all, cap5.id, " > ")).toBe(
        "Tin học 12 > Chương 1 > Bài 1 > Đề kiểm tra 15 phút > Đề nâng cao"
      );
      expect(bai2.parent_id).toBe(ch1.id);
      expect(ch2.parent_id).toBe(root.id);
    });

    it("1.2. Chặn trùng tên trong cùng một thư mục cha, nhưng cho phép cùng tên ở hai thư mục cha khác nhau", async () => {
      const root = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const ch2 = await createFolder({ name: "Chương 2", parent_id: root.id, teacher_id: TEACHER_A_ID });

      await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });

      // Không được trùng trong Chương 1
      expect(await checkDuplicateFolderName("bài 1", TEACHER_A_ID, undefined, false, ch1.id)).toBe(true);
      await expect(
        createFolder({ name: "bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID })
      ).rejects.toThrow('Thư mục "bài 1" đã tồn tại');

      // Được phép đặt tên "Bài 1" trong Chương 2
      expect(await checkDuplicateFolderName("Bài 1", TEACHER_A_ID, undefined, false, ch2.id)).toBe(false);
      const bai1Ch2 = await createFolder({ name: "Bài 1", parent_id: ch2.id, teacher_id: TEACHER_A_ID });
      expect(bai1Ch2.parent_id).toBe(ch2.id);
    });
  });

  describe("2. Di chuyển thư mục, di chuyển đề thi, chống vòng lặp & xóa an toàn", () => {
    it("2.1. Di chuyển đề thi giữa các cấp thư mục và đếm đề thi trực tiếp + đệ quy chính xác", async () => {
      const root = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });

      const e1 = { id: "e-1", title: "Đề 15p", folder_id: null };
      const e2 = { id: "e-2", title: "Đề ôn chương", folder_id: null };
      const e3 = { id: "e-3", title: "Đề tổng hợp", folder_id: null };

      await moveExamToFolder(e1.id, bai1.id);
      await moveExamToFolder(e2.id, ch1.id);
      await moveExamToFolder(e3.id, root.id);

      expect(getFolderIdForExam(e1)).toBe(bai1.id);
      expect(getFolderIdForExam(e2)).toBe(ch1.id);
      expect(getFolderIdForExam(e3)).toBe(root.id);

      const all = await getFolders(TEACHER_A_ID);
      const allExams = [e1, e2, e3];
      expect(getDirectExamCount(root.id, allExams)).toBe(1);
      expect(getRecursiveExamCount(all, root.id, allExams)).toBe(3);
      expect(getRecursiveExamCount(all, ch1.id, allExams)).toBe(2);
      expect(getRecursiveExamCount(all, bai1.id, allExams)).toBe(1);

      // Chuyển e1 từ Bài 1 sang thư mục gốc Tin học 12
      await moveExamToFolder(e1.id, root.id);
      expect(getFolderIdForExam(e1)).toBe(root.id);
      expect(getDirectExamCount(bai1.id, allExams)).toBe(0);
      expect(getDirectExamCount(root.id, allExams)).toBe(2);
    });

    it("2.2. Di chuyển thư mục (giữ nguyên cây con và đề thi) & chống vòng lặp cha-con", async () => {
      const rootA = await createFolder({ name: "Khối 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: rootA.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });
      const rootB = await createFolder({ name: "Lưu trữ", teacher_id: TEACHER_A_ID });

      await moveExamToFolder("exam-in-bai1", bai1.id);

      const foldersBefore = await getFolders(TEACHER_A_ID);
      // Chặn di chuyển vào chính nó hoặc con/cháu của nó
      expect(canMoveFolder(foldersBefore, rootA.id, rootA.id).valid).toBe(false);
      expect(canMoveFolder(foldersBefore, rootA.id, ch1.id).valid).toBe(false);
      expect(canMoveFolder(foldersBefore, rootA.id, bai1.id).valid).toBe(false);

      await expect(moveFolder(rootA.id, bai1.id, TEACHER_A_ID)).rejects.toThrow(/thư mục con/i);

      // Chuyển Chương 1 (kèm Bài 1 và đề thi) sang Lưu trữ
      const moved = await moveFolder(ch1.id, rootB.id, TEACHER_A_ID);
      expect(moved.parent_id).toBe(rootB.id);

      const foldersAfter = await getFolders(TEACHER_A_ID);
      expect(getFolderBreadcrumbLabel(foldersAfter, bai1.id, " > ")).toBe("Lưu trữ > Chương 1 > Bài 1");
      expect(getFolderIdForExam({ id: "exam-in-bai1" })).toBe(bai1.id);

      // MoveFolderModal loại bỏ chính thư mục và hậu duệ khỏi danh sách đích
      const optionsForCh1 = buildFolderTreeOptions(foldersAfter, {
        excludeFolderAndDescendantsId: ch1.id,
      });
      const optionIds = optionsForCh1.map((o) => o.folder.id);
      expect(optionIds).not.toContain(ch1.id);
      expect(optionIds).not.toContain(bai1.id);
      expect(optionIds).toContain(rootA.id);
      expect(optionIds).toContain(rootB.id);
    });

    it("2.3. Đổi tên thư mục con giữ nguyên parent_id; Xóa thư mục cha giữ nguyên thư mục con và toàn bộ đề thi", async () => {
      const root = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });

      await moveExamToFolder("exam-ch1", ch1.id);
      await moveExamToFolder("exam-bai1", bai1.id);

      // Đổi tên thư mục con giữ nguyên parent_id
      const renamed = await updateFolder(ch1.id, { name: "Chương 1 - Cơ sở" }, TEACHER_A_ID);
      expect(renamed.name).toBe("Chương 1 - Cơ sở");
      expect(renamed.parent_id).toBe(root.id);

      // Xóa Chương 1:
      // - Đề thi trực tiếp trong Chương 1 (exam-ch1) về Chưa phân loại (null), không bị xóa
      // - Thư mục con Bài 1 được nâng lên parent_id = root.id và giữ nguyên exam-bai1 bên trong!
      await deleteFolder(ch1.id, TEACHER_A_ID);

      const remaining = await getFolders(TEACHER_A_ID);
      expect(remaining.some((f) => f.id === ch1.id)).toBe(false);
      const updatedBai1 = remaining.find((f) => f.id === bai1.id);
      expect(updatedBai1?.parent_id).toBe(root.id);
      expect(getFolderIdForExam({ id: "exam-ch1" })).toBeNull();
      expect(getFolderIdForExam({ id: "exam-bai1" })).toBe(bai1.id);
    });
  });

  describe("3. Giao diện nhiều cấp, Breadcrumb, Cây thư mục, Modals & Tạo đề trong thư mục con", () => {
    it("3.1. Hiển thị trang chủ chỉ gồm thư mục gốc, mở sâu 3 cấp, Breadcrumb bấm ngược cấp cha và nút '+ Tạo đề mới' trỏ đúng subfolder", async () => {
      const root = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });

      renderAppAt("/");

      // Trang chủ hiển thị thư mục gốc và cây thư mục
      expect(await screen.findByText("Cây thư mục (3)")).toBeInTheDocument();
      const rootMatches = await screen.findAllByText("Tin học 12");
      expect(rootMatches.length).toBeGreaterThanOrEqual(1);

      // Mở Tin học 12 -> thấy Chương 1 và 2 nút '+ Tạo thư mục con' + '+ Tạo đề mới'
      fireEvent.click(rootMatches[0]);
      expect(await screen.findByText("Thư mục con (1)")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /\+ Tạo thư mục con/i }).length).toBeGreaterThanOrEqual(1);

      // Mở tiếp Chương 1 -> thấy Bài 1
      const ch1Elements = await screen.findAllByText("Chương 1");
      fireEvent.click(ch1Elements[ch1Elements.length - 1]);

      // Mở tiếp Bài 1 (cấp 3)
      const bai1Elements = await screen.findAllByText("Bài 1");
      fireEvent.click(bai1Elements[bai1Elements.length - 1]);

      // Kiểm tra Breadcrumb 3 cấp đầy đủ và nút '+ Tạo đề mới' mang ?folder=<bai1.id>
      const breadcrumb = await screen.findByRole("navigation", { name: /Breadcrumb/i });
      expect(breadcrumb).toHaveTextContent("Trang chủ");
      expect(breadcrumb).toHaveTextContent("Tin học 12");
      expect(breadcrumb).toHaveTextContent("Chương 1");
      expect(breadcrumb).toHaveTextContent("Bài 1");

      const createExamLinks = screen.getAllByRole("link", { name: /\+ Tạo đề mới/i });
      expect(createExamLinks.some((el) => el.getAttribute("href") === `/teacher?folder=${bai1.id}`)).toBe(true);

      // Bấm vào nút tạo đề từ trong Bài 1 -> mở trang Teacher với đúng đường dẫn thư mục con
      fireEvent.click(createExamLinks[0]);
      expect(await screen.findByText("Tạo bài thi mới")).toBeInTheDocument();
      expect(await screen.findByText("Tin học 12 > Chương 1 > Bài 1")).toBeInTheDocument();
    });

    it("3.2. Click phần tử cha trên Breadcrumb nhảy ngược về đúng cấp cha", async () => {
      const root = await createFolder({ name: "Toán 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Giải tích", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Cực trị", parent_id: ch1.id, teacher_id: TEACHER_A_ID });

      renderAppAt(`/?folder=${bai1.id}`);

      const breadcrumb = await screen.findByRole("navigation", { name: /Breadcrumb/i });
      expect(breadcrumb).toHaveTextContent("Cực trị");

      const rootBtn = Array.from(breadcrumb.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Toán 12"
      );
      expect(rootBtn).toBeDefined();
      fireEvent.click(rootBtn!);

      await waitFor(() => {
        expect(screen.getByText('Đề thi trong "Toán 12" (0)')).toBeInTheDocument();
      });
    });

    it("3.3. Modals: CreateOrEditFolderModal (thư mục con), DeleteFolderModal (cảnh báo thư mục con), MoveExamModal (cây phân cấp), MoveFolderModal", async () => {
      const root = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
      const ch1 = await createFolder({ name: "Chương 1", parent_id: root.id, teacher_id: TEACHER_A_ID });
      const bai1 = await createFolder({ name: "Bài 1", parent_id: ch1.id, teacher_id: TEACHER_A_ID });
      const all: ExamFolder[] = [root, ch1, bai1];

      // 1. DeleteFolderModal hiển thị cảnh báo thư mục con
      const { unmount: u1 } = render(
        <DeleteFolderModal
          open={true}
          onOpenChange={() => {}}
          folder={root}
          examCount={1}
          subfolderCount={2}
          totalNestedExamCount={4}
          teacherId={TEACHER_A_ID}
          onSuccess={() => {}}
        />
      );
      expect(screen.getByText(/Cảnh báo thư mục đang chứa dữ liệu phân cấp/i)).toBeInTheDocument();
      expect(screen.getByText(/Đề thi chưa phân loại/i)).toBeInTheDocument();
      u1();

      // 2. MoveExamModal hiển thị đường dẫn phân cấp của Bài 1
      const { unmount: u2 } = render(
        <MoveExamModal
          open={true}
          onOpenChange={() => {}}
          examIds={["ex-1"]}
          examTitles={["Đề kiểm tra"]}
          folders={all}
          currentFolderId={null}
          onSuccess={() => {}}
        />
      );
      expect(screen.getByText("Tin học 12 / Chương 1 / Bài 1")).toBeInTheDocument();
      u2();

      // 3. MoveFolderModal ẩn chính thư mục và các con/cháu khỏi lựa chọn đích
      const { unmount: u3 } = render(
        <MoveFolderModal
          open={true}
          onOpenChange={() => {}}
          folder={ch1}
          folders={all}
          teacherId={TEACHER_A_ID}
          onSuccess={() => {}}
        />
      );
      expect(screen.getByText("Cấp gốc (Trang chủ)")).toBeInTheDocument();
      expect(screen.getByText("Tin học 12")).toBeInTheDocument();
      expect(screen.queryByText("Bài 1")).toBeNull();
      u3();

      // 4. CreateOrEditFolderModal hiển thị chế độ tạo thư mục con
      render(
        <CreateOrEditFolderModal
          open={true}
          onOpenChange={() => {}}
          parentId={ch1.id}
          parentPathLabel="Tin học 12 > Chương 1"
          teacherId={TEACHER_A_ID}
          onSuccess={() => {}}
        />
      );
      expect(screen.getByText("Tạo thư mục con")).toBeInTheDocument();
      expect(screen.getByText(/Trong: Tin học 12 > Chương 1/i)).toBeInTheDocument();
    });
  });

  describe("4. Cách ly dữ liệu giáo viên, Lưu trữ bền vững & Kiểm tra RLS/Migration SQL", () => {
    it("4.1. Giáo viên A và Giáo viên B hoàn toàn tách biệt thư mục: không thể xem, tạo con, sửa, di chuyển hoặc xóa thư mục của nhau", async () => {
      const folderA = await createFolder({ name: "Thư mục Cô A", teacher_id: TEACHER_A_ID });
      const subA = await createFolder({
        name: "Chương A1",
        parent_id: folderA.id,
        teacher_id: TEACHER_A_ID,
      });

      const folderB = await createFolder({ name: "Thư mục Thầy B", teacher_id: TEACHER_B_ID });

      const listA = await getFolders(TEACHER_A_ID);
      const listB = await getFolders(TEACHER_B_ID);

      expect(listA.map((f) => f.id).sort()).toEqual([folderA.id, subA.id].sort());
      expect(listB.map((f) => f.id)).toEqual([folderB.id]);

      // Giáo viên B không thể tạo thư mục con vào thư mục của Giáo viên A
      await expect(
        createFolder({ name: "Xâm nhập", parent_id: folderA.id, teacher_id: TEACHER_B_ID })
      ).rejects.toThrow();

      // Giáo viên B không thể sửa, di chuyển hay xóa thư mục của Giáo viên A
      await expect(
        updateFolder(folderA.id, { name: "Bị sửa" }, TEACHER_B_ID)
      ).rejects.toThrow(/không có quyền/i);

      await expect(
        deleteFolder(folderA.id, TEACHER_B_ID)
      ).rejects.toThrow(/không có quyền/i);

      // Dữ liệu của Giáo viên A vẫn còn nguyên vẹn sau khi đăng nhập lại
      const listAReload = await getFolders(TEACHER_A_ID);
      expect(listAReload.map((f) => f.id).sort()).toEqual([folderA.id, subA.id].sort());
    });

    it("4.2. Migration SQL hỗ trợ parent_id, chống vòng lặp cha-con và siết chặt RLS trên public.exam_folders", () => {
      const migrationPath = path.resolve(
        process.cwd(),
        "supabase/migrations/20261119000000_multilevel_exam_folders.sql"
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, "utf-8");

      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.exam_folders");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.exam_folders(id) ON DELETE SET NULL");
      expect(sql).toContain("exam_folders_no_self_parent");
      expect(sql).toContain("validate_exam_folder_hierarchy");
      expect(sql).toContain("WITH RECURSIVE descendants");
      expect(sql).toContain('DROP POLICY IF EXISTS "Public read folders" ON public.exam_folders;');
      expect(sql).toContain("public.is_admin(auth.uid())");
      expect(sql).toContain("teacher_id = auth.uid()");
      expect(sql).toContain("public.can_access_exam_folder(parent_id, auth.uid())");
      expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
    });
  });

  describe("5. Khắc phục lỗi không hiển thị thư mục con & đồng bộ Supabase thực tế", () => {
    it("5.1. Tạo thư mục con qua giao diện Index -> CreateOrEditFolderModal truyền đúng parent_id và hiển thị ngay trong thư mục mẹ", async () => {
      const root = await createFolder({ name: "Mẹ Test", teacher_id: TEACHER_A_ID });

      renderAppAt(`/?folder=${root.id}`);

      expect(await screen.findByText("Thư mục con (0)")).toBeInTheDocument();

      const createSubBtn = screen.getAllByRole("button", { name: /\+ Tạo thư mục con/i })[0];
      fireEvent.click(createSubBtn);

      expect(await screen.findByText("Tạo thư mục con")).toBeInTheDocument();
      const input = screen.getByLabelText(/tên thư mục/i);
      fireEvent.change(input, { target: { value: "Con 1" } });

      const submitBtn = screen.getByRole("button", { name: "Tạo thư mục" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Thư mục con (1)")).toBeInTheDocument();
      });
      expect(screen.getAllByText("Con 1").length).toBeGreaterThanOrEqual(1);

      const stored = await getFolders(TEACHER_A_ID);
      const createdSub = stored.find((f) => f.name === "Con 1");
      expect(createdSub).toBeDefined();
      expect(createdSub?.parent_id).toBe(root.id);
    });

    it("5.2. Admin tạo thư mục con bên trong thư mục của giáo viên vẫn truyền isAdmin và kế thừa đúng parent_id", async () => {
      const teacherFolder = await createFolder({ name: "Thư mục GV", teacher_id: TEACHER_A_ID });

      setCurrentAuth({
        user: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "admin@admin.com" },
        profile: { full_name: "Admin", role: "admin" },
        isAdmin: true,
        isSuperAdmin: true,
        loading: false,
        signOut: vi.fn(),
      });

      const onSuccess = vi.fn();
      render(
        <CreateOrEditFolderModal
          open={true}
          onOpenChange={() => {}}
          parentId={teacherFolder.id}
          parentPathLabel="Thư mục GV"
          teacherId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
          isAdmin={true}
          onSuccess={onSuccess}
        />
      );

      fireEvent.change(screen.getByLabelText(/tên thư mục/i), { target: { value: "Thư mục con Admin tạo" } });
      fireEvent.click(screen.getByRole("button", { name: "Tạo thư mục" }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });

      const savedArg = onSuccess.mock.calls[0][0] as ExamFolder;
      expect(savedArg.parent_id).toBe(teacherFolder.id);
      expect(savedArg.teacher_id).toBe(TEACHER_A_ID);
    });

    it("5.3. KHÔNG bao giờ cắt bỏ parent_id khi gặp lỗi 42703/PGRST204/42501 hoặc khi PGRST205 + schools cũng lỗi — rollback localStorage và báo lỗi rõ ràng", async () => {
      const root = await createFolder({ name: "Thư mục Mẹ", teacher_id: TEACHER_A_ID });

      // Case A: 42703 (thiếu cột parent_id) không bao giờ cắt bỏ parent_id hay fallback sang schools
      const insertCalls42703: any[] = [];
      let schoolsInsertCalledFor42703 = false;
      let fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "exam_folders") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            order: vi.fn(() => chain),
            insert: vi.fn((payload: any) => {
              insertCalls42703.push(payload);
              return Promise.resolve({
                data: null,
                error: { code: "42703", message: 'column "parent_id" of relation "exam_folders" does not exist' },
              });
            }),
            then: (resolve: any, reject: any) =>
              Promise.resolve({ data: [root], error: null }).then(resolve, reject),
          };
          return chain;
        }
        if (table === "schools") {
          const sChain: any = {
            select: vi.fn(() => sChain),
            eq: vi.fn(() => sChain),
            like: vi.fn(() => sChain),
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            insert: vi.fn(() => {
              schoolsInsertCalledFor42703 = true;
              return Promise.resolve({ data: null, error: null });
            }),
            then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
          };
          return sChain;
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        } as any;
      });

      try {
        await expect(
          createFolder({ name: "Con Bị Lỗi Cột", parent_id: root.id, teacher_id: TEACHER_A_ID })
        ).rejects.toThrow(/parent_id/);

        expect(insertCalls42703.length).toBe(1);
        expect(insertCalls42703[0].parent_id).toBe(root.id);
        expect(schoolsInsertCalledFor42703).toBe(false);

        const afterFailA = await getFolders(TEACHER_A_ID);
        expect(afterFailA.some((f) => f.name === "Con Bị Lỗi Cột")).toBe(false);
        expect(afterFailA.some((f) => f.id === root.id)).toBe(true);
      } finally {
        fromSpy.mockRestore();
      }

      // Case B: PGRST205 trên exam_folders VÀ fallback schools cũng bị lỗi RLS (42501) -> rollback và báo lỗi
      const insertCallsPgrst: any[] = [];
      fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "exam_folders") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            order: vi.fn(() => chain),
            insert: vi.fn((payload: any) => {
              insertCallsPgrst.push(payload);
              return Promise.resolve({
                data: null,
                error: { code: "PGRST205", message: "Could not find the table 'public.exam_folders' in the schema cache" },
              });
            }),
            then: (resolve: any, reject: any) =>
              Promise.resolve({ data: [root], error: null }).then(resolve, reject),
          };
          return chain;
        }
        if (table === "schools") {
          const sChain: any = {
            select: vi.fn(() => sChain),
            eq: vi.fn(() => sChain),
            like: vi.fn(() => sChain),
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            insert: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: { code: "42501", message: "new row violates row-level security policy" },
              })
            ),
            then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
          };
          return sChain;
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        } as any;
      });

      try {
        await expect(
          createFolder({ name: "Con Bị Lỗi", parent_id: root.id, teacher_id: TEACHER_A_ID })
        ).rejects.toThrow(/exam_folders/);

        expect(insertCallsPgrst.length).toBe(1);
        expect(insertCallsPgrst[0].parent_id).toBe(root.id);

        const afterFailB = await getFolders(TEACHER_A_ID);
        expect(afterFailB.some((f) => f.name === "Con Bị Lỗi")).toBe(false);
      } finally {
        fromSpy.mockRestore();
      }
    });

    it("5.4. Tự động đồng bộ thư mục cha lên Supabase khi gặp lỗi khóa ngoại 23503 và thử lưu lại thành công với đúng parent_id", async () => {
      const root = await createFolder({ name: "Cha Cục Bộ", teacher_id: TEACHER_A_ID });

      let insertAttempt = 0;
      const upsertedPayloads: any[] = [];
      const insertPayloads: any[] = [];

      const fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "exam_folders") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            order: vi.fn(() => chain),
            upsert: vi.fn((payload: any) => {
              upsertedPayloads.push(payload);
              return Promise.resolve({ data: [payload], error: null });
            }),
            insert: vi.fn((payload: any) => {
              insertAttempt += 1;
              insertPayloads.push(payload);
              if (insertAttempt === 1) {
                return Promise.resolve({
                  data: null,
                  error: { code: "23503", message: "insert or update on table exam_folders violates foreign key constraint" },
                });
              }
              return Promise.resolve({ data: [payload], error: null });
            }),
            then: (resolve: any, reject: any) =>
              Promise.resolve({ data: [root], error: null }).then(resolve, reject),
          };
          return chain;
        }
        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        } as any;
      });

      try {
        const sub = await createFolder({
          name: "Con Đồng Bộ Cha",
          parent_id: root.id,
          teacher_id: TEACHER_A_ID,
        });

        expect(upsertedPayloads.length).toBe(1);
        expect(upsertedPayloads[0].id).toBe(root.id);
        expect(insertAttempt).toBe(2);
        expect(insertPayloads[1].parent_id).toBe(root.id);
        expect(sub.parent_id).toBe(root.id);
      } finally {
        fromSpy.mockRestore();
      }
    });

    it("5.5. Khi exam_folders trả PGRST205 (chưa chạy migration), tự động fallback sang bảng schools với 0 console.error, không gọi upsert, bảo toàn nguyên parent_id", async () => {
      const schoolsStore = new Map<string, { id: string; name_key: string; name: string }>();
      let schoolsUpsertCalled = false;

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const fromSpy = vi.spyOn(supabase, "from").mockImplementation((table: string) => {
        if (table === "exam_folders") {
          const chain: any = {
            select: vi.fn(() => chain),
            eq: vi.fn(() => chain),
            order: vi.fn(() => chain),
            insert: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: {
                  code: "PGRST205",
                  message: "Could not find the table 'public.exam_folders' in the schema cache",
                },
              })
            ),
            update: vi.fn(() => chain),
            delete: vi.fn(() => chain),
            then: (resolve: any, reject: any) =>
              Promise.resolve({
                data: null,
                error: {
                  code: "PGRST205",
                  message: "Could not find the table 'public.exam_folders' in the schema cache",
                },
              }).then(resolve, reject),
          };
          return chain;
        }

        if (table === "schools") {
          let filterEqKey: string | null = null;
          let filterLikePrefix: string | null = null;
          let pendingUpdatePayload: any = null;
          let isDelete = false;

          const sChain: any = {
            select: vi.fn(() => sChain),
            eq: vi.fn((col: string, val: string) => {
              if (col === "name_key") filterEqKey = val;
              return sChain;
            }),
            like: vi.fn((col: string, pattern: string) => {
              if (col === "name_key") filterLikePrefix = pattern.replace(/%$/, "");
              return sChain;
            }),
            upsert: vi.fn(() => {
              schoolsUpsertCalled = true;
              return Promise.resolve({ data: null, error: { code: "42501" } });
            }),
            maybeSingle: vi.fn(() => {
              const row = filterEqKey ? schoolsStore.get(filterEqKey) || null : null;
              return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
            }),
            insert: vi.fn((payload: any) => {
              schoolsStore.set(payload.name_key, {
                id: `school-${schoolsStore.size + 1}`,
                name_key: payload.name_key,
                name: payload.name,
              });
              return Promise.resolve({ data: [payload], error: null });
            }),
            update: vi.fn((payload: any) => {
              pendingUpdatePayload = payload;
              return sChain;
            }),
            delete: vi.fn(() => {
              isDelete = true;
              return sChain;
            }),
            then: (resolve: any, reject: any) => {
              if (isDelete && filterEqKey) {
                schoolsStore.delete(filterEqKey);
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              }
              if (pendingUpdatePayload && filterEqKey) {
                const prev = schoolsStore.get(filterEqKey);
                if (prev) {
                  schoolsStore.set(filterEqKey, { ...prev, name: pendingUpdatePayload.name });
                }
                return Promise.resolve({ data: null, error: null }).then(resolve, reject);
              }
              const rows = Array.from(schoolsStore.values()).filter((r) =>
                filterLikePrefix ? r.name_key.startsWith(filterLikePrefix) : true
              );
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            },
          };
          return sChain;
        }

        return {
          select: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        } as any;
      });

      try {
        // 1. Khởi tạo getFolders khi exam_folders chưa tồn tại -> không phát sinh console.error
        const initial = await getFolders(TEACHER_A_ID);
        expect(initial).toEqual([]);
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        // 2. Tạo thư mục cha -> con -> cháu qua fallback schools
        const parent = await createFolder({ name: "Tin học 12", teacher_id: TEACHER_A_ID });
        const child = await createFolder({ name: "Chương 1", parent_id: parent.id, teacher_id: TEACHER_A_ID });
        const grandchild = await createFolder({ name: "Bài 1", parent_id: child.id, teacher_id: TEACHER_A_ID });

        expect(schoolsUpsertCalled).toBe(false);
        expect(schoolsStore.has(`exam_folder:${parent.id}`)).toBe(true);
        expect(schoolsStore.has(`exam_folder:${child.id}`)).toBe(true);
        expect(schoolsStore.has(`exam_folder:${grandchild.id}`)).toBe(true);

        // 3. Mô phỏng tải lại trang (xóa localStorage) -> getFolders đọc lại đầy đủ cây từ schools
        localStorage.clear();
        const reloaded = await getFolders(TEACHER_A_ID);
        expect(reloaded.length).toBe(3);
        const reloadedChild = reloaded.find((f) => f.id === child.id);
        const reloadedGrandchild = reloaded.find((f) => f.id === grandchild.id);
        expect(reloadedChild?.parent_id).toBe(parent.id);
        expect(reloadedGrandchild?.parent_id).toBe(child.id);

        // 4. Đổi tên thư mục con & xóa thư mục giữa -> nâng cấp cháu lên parent
        await updateFolder(grandchild.id, { name: "Bài 1 - Mới" }, TEACHER_A_ID);
        await deleteFolder(child.id, TEACHER_A_ID);

        localStorage.clear();
        const afterDelete = await getFolders(TEACHER_A_ID);
        expect(afterDelete.map((f) => f.id).sort()).toEqual([parent.id, grandchild.id].sort());
        expect(afterDelete.find((f) => f.id === grandchild.id)?.name).toBe("Bài 1 - Mới");
        expect(afterDelete.find((f) => f.id === grandchild.id)?.parent_id).toBe(parent.id);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        fromSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });
});
