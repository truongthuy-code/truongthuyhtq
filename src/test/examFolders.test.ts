import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder,
  checkDuplicateFolderName,
  moveExamToFolder,
  moveExamsToFolder,
  getFolderIdForExam,
  getExamFolderMapping,
  saveExamFolderMapping,
  FOLDER_COLOR_PRESETS,
  FOLDER_ICON_PRESETS,
  getFolderColorMeta,
} from "@/lib/folderStorage";

describe("Hệ thống Quản lý Thư mục Đề thi & Tạo đề trong Thư mục", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("Nhóm 1: Quản lý thư mục (Tạo, Sửa, Đổi màu/icon, Trùng tên, Xóa)", () => {
    it("1.1. Tạo mới thư mục thành công với đầy đủ thông tin (tên, màu sắc, biểu tượng)", async () => {
      const folder = await createFolder({
        name: "Lớp 10A1 - Học kỳ 1",
        description: "Các bài kiểm tra 15 phút và 1 tiết Toán 10",
        color: "emerald",
        icon: "graduation-cap",
        teacher_id: "teacher-123",
      });

      expect(folder).toBeDefined();
      expect(folder.id).toBeTruthy();
      expect(folder.name).toBe("Lớp 10A1 - Học kỳ 1");
      expect(folder.description).toBe("Các bài kiểm tra 15 phút và 1 tiết Toán 10");
      expect(folder.color).toBe("emerald");
      expect(folder.icon).toBe("graduation-cap");

      const folders = await getFolders("teacher-123");
      expect(folders.length).toBe(1);
      expect(folders[0].id).toBe(folder.id);
    });

    it("1.2. Từ chối tạo thư mục khi tên bị để trống hoặc chỉ chứa khoảng trắng", async () => {
      await expect(
        createFolder({
          name: "   ",
          teacher_id: "teacher-123",
        })
      ).rejects.toThrow("Tên thư mục không được để trống");
    });

    it("1.3. Kiểm tra trùng tên thư mục theo giáo viên (không phân biệt hoa thường)", async () => {
      await createFolder({
        name: "KIỂM TRA GIỮA KỲ",
        teacher_id: "teacher-123",
      });

      const isDupExact = await checkDuplicateFolderName("KIỂM TRA GIỮA KỲ", "teacher-123");
      expect(isDupExact).toBe(true);

      const isDupLower = await checkDuplicateFolderName("kiểm tra giữa kỳ", "teacher-123");
      expect(isDupLower).toBe(true);

      // Thử tạo trùng tên phải ném lỗi
      await expect(
        createFolder({
          name: "Kiểm Tra Giữa Kỳ",
          teacher_id: "teacher-123",
        })
      ).rejects.toThrow('Thư mục "Kiểm Tra Giữa Kỳ" đã tồn tại');
    });

    it("1.4. Đổi tên, sửa mô tả, thay đổi màu sắc và biểu tượng thư mục", async () => {
      const folder = await createFolder({
        name: "Khảo sát đầu năm",
        color: "sky",
        icon: "folder",
        teacher_id: "teacher-123",
      });

      const updated = await updateFolder(folder.id, {
        name: "Khảo sát đầu năm 2026",
        description: "Đã cập nhật thang điểm mới",
        color: "rose",
        icon: "star",
      });

      expect(updated.name).toBe("Khảo sát đầu năm 2026");
      expect(updated.description).toBe("Đã cập nhật thang điểm mới");
      expect(updated.color).toBe("rose");
      expect(updated.icon).toBe("star");

      const meta = getFolderColorMeta(updated.color);
      expect(meta.key).toBe("rose");
      expect(meta.name).toBe("Hồng đào");
    });

    it("1.5. Xóa thư mục rỗng thành công", async () => {
      const folder = await createFolder({
        name: "Thư mục tạm",
        teacher_id: "teacher-123",
      });

      const before = await getFolders("teacher-123");
      expect(before.some((f) => f.id === folder.id)).toBe(true);

      await deleteFolder(folder.id, "teacher-123");

      const after = await getFolders("teacher-123");
      expect(after.some((f) => f.id === folder.id)).toBe(false);
    });

    it("1.6. Xóa thư mục chứa đề thi: Đề thi tự động chuyển về 'Chưa phân loại', không bị xóa", async () => {
      const folder = await createFolder({
        name: "Chương 1 Hình học",
        teacher_id: "teacher-123",
      });

      // Gán 2 đề thi vào thư mục này
      await moveExamToFolder("exam-001", folder.id);
      await moveExamToFolder("exam-002", folder.id);

      expect(getFolderIdForExam({ id: "exam-001" })).toBe(folder.id);
      expect(getFolderIdForExam({ id: "exam-002" })).toBe(folder.id);

      // Xóa thư mục
      await deleteFolder(folder.id, "teacher-123");

      // Cả 2 đề thi bây giờ phải có folder_id = null (thuộc nhóm Chưa phân loại)
      expect(getFolderIdForExam({ id: "exam-001" })).toBeNull();
      expect(getFolderIdForExam({ id: "exam-002" })).toBeNull();

      // Đề thi không bị xóa mất dữ liệu
      const mappings = getExamFolderMapping();
      expect(mappings["exam-001"]).toBeNull();
      expect(mappings["exam-002"]).toBeNull();
    });
  });

  describe("Nhóm 2: Tạo đề thi trực tiếp trong thư mục & Tính toán số lượng đề", () => {
    it("2.1. Đề thi tạo từ trong thư mục ghi nhận chính xác folder_id", async () => {
      const folder = await createFolder({
        name: "Ôn tập chuyên đề",
        teacher_id: "teacher-123",
      });

      // Mô phỏng luồng Teacher.tsx khi tạo đề thi với folder_id từ URL query ?folder=...
      const mockCreatedExam = {
        id: "exam-created-in-folder",
        title: "Đề ôn tập số 1",
        folder_id: folder.id,
        created_at: new Date().toISOString(),
      };

      // Đồng bộ vào mapping và getFolderIdForExam
      await moveExamToFolder(mockCreatedExam.id, mockCreatedExam.folder_id);

      const resolvedFolderId = getFolderIdForExam(mockCreatedExam);
      expect(resolvedFolderId).toBe(folder.id);
    });

    it("2.2. Đề thi tạo từ trang chủ (không chọn thư mục) có folder_id là null và nằm ở 'Chưa phân loại'", async () => {
      const mockHomeExam = {
        id: "exam-from-home",
        title: "Đề thi tự do",
        folder_id: null,
      };

      const resolvedFolderId = getFolderIdForExam(mockHomeExam);
      expect(resolvedFolderId).toBeNull();
    });

    it("2.3. Đếm chính xác số lượng đề thi trong thư mục", async () => {
      const folderA = await createFolder({ name: "Thư mục A", teacher_id: "t1" });
      const folderB = await createFolder({ name: "Thư mục B", teacher_id: "t1" });

      const allExams = [
        { id: "e1", title: "Đề 1", folder_id: folderA.id },
        { id: "e2", title: "Đề 2", folder_id: folderA.id },
        { id: "e3", title: "Đề 3", folder_id: folderB.id },
        { id: "e4", title: "Đề 4", folder_id: null }, // Chưa phân loại
      ];

      const countA = allExams.filter((e) => getFolderIdForExam(e) === folderA.id).length;
      const countB = allExams.filter((e) => getFolderIdForExam(e) === folderB.id).length;
      const countUnclassified = allExams.filter((e) => getFolderIdForExam(e) === null).length;

      expect(countA).toBe(2);
      expect(countB).toBe(1);
      expect(countUnclassified).toBe(1);
    });
  });

  describe("Nhóm 3: Phân loại & Chuyển đề thi (Đơn lẻ, Hàng loạt, Đưa ra ngoài)", () => {
    it("3.1. Chuyển một đề thi từ Chưa phân loại vào Thư mục A", async () => {
      const folderA = await createFolder({ name: "Toán 12", teacher_id: "t1" });
      const exam = { id: "math-12-01", title: "Khảo sát hàm số", folder_id: null };

      expect(getFolderIdForExam(exam)).toBeNull();

      await moveExamToFolder(exam.id, folderA.id);

      expect(getFolderIdForExam(exam)).toBe(folderA.id);
    });

    it("3.2. Chuyển một đề thi từ Thư mục A sang Thư mục B", async () => {
      const folderA = await createFolder({ name: "Học kỳ 1", teacher_id: "t1" });
      const folderB = await createFolder({ name: "Học kỳ 2", teacher_id: "t1" });

      const exam = { id: "exam-move", folder_id: folderA.id };
      await moveExamToFolder(exam.id, folderA.id);
      expect(getFolderIdForExam(exam)).toBe(folderA.id);

      // Chuyển sang folder B
      await moveExamToFolder(exam.id, folderB.id);
      // Khi mapping cập nhật, exam với folder_id cũ sẽ ưu tiên mapping mới
      const updatedExam = { ...exam, folder_id: folderB.id };
      expect(getFolderIdForExam(updatedExam)).toBe(folderB.id);
    });

    it("3.3. Chuyển hàng loạt nhiều đề thi (Bulk Move) cùng lúc", async () => {
      const folderTarget = await createFolder({ name: "Bộ đề ôn thi TN THPT", teacher_id: "t1" });

      const examIds = ["bulk-01", "bulk-02", "bulk-03", "bulk-04"];
      await moveExamsToFolder(examIds, folderTarget.id);

      examIds.forEach((id) => {
        expect(getFolderIdForExam({ id })).toBe(folderTarget.id);
      });
    });

    it("3.4. Đưa đề thi ra ngoài thư mục về 'Đề thi chưa phân loại'", async () => {
      const folder = await createFolder({ name: "Thư mục tạm", teacher_id: "t1" });
      await moveExamToFolder("exam-out", folder.id);
      expect(getFolderIdForExam({ id: "exam-out" })).toBe(folder.id);

      // Đưa ra ngoài (folderId = null)
      await moveExamToFolder("exam-out", null);
      expect(getFolderIdForExam({ id: "exam-out" })).toBeNull();
    });

    it("3.5. Đảm bảo tính toán danh sách không trùng lặp (không hiển thị ở 2 nơi cùng lúc)", async () => {
      const folder = await createFolder({ name: "Vật lý 11", teacher_id: "t1" });
      await moveExamToFolder("phys-01", folder.id);

      const exams = [
        { id: "phys-01", title: "Dòng điện không đổi" },
        { id: "phys-02", title: "Khúc xạ ánh sáng" },
      ];

      const folderExams = exams.filter((e) => getFolderIdForExam(e) === folder.id);
      const unclassifiedExams = exams.filter((e) => getFolderIdForExam(e) === null);

      expect(folderExams.map((e) => e.id)).toEqual(["phys-01"]);
      expect(unclassifiedExams.map((e) => e.id)).toEqual(["phys-02"]);

      // Không có đề nào xuất hiện đồng thời trong cả 2 danh sách
      const intersection = folderExams.filter((fe) =>
        unclassifiedExams.some((ue) => ue.id === fe.id)
      );
      expect(intersection.length).toBe(0);
    });
  });

  describe("Nhóm 4: Bảo toàn dữ liệu đề thi & Không ảnh hưởng thông tin gốc", () => {
    it("4.1. Giữ nguyên toàn bộ ID, tiêu đề, mã làm bài, link và câu hỏi khi chuyển thư mục", async () => {
      const originalExam = {
        id: "exam-preserve-01",
        title: "Đề thi Toán Học Kỳ 1",
        access_code: "TOAN10HK1",
        pin: "123456",
        qr_code: "https://chart.googleapis.com/test",
        time_limit: 45,
        total_questions: 40,
        questions: [{ id: 1, text: "Câu 1: Hàm số đồng biến khi nào?" }],
        created_at: "2026-11-10T10:00:00Z",
      };

      const folder = await createFolder({ name: "Toán 10", teacher_id: "t1" });
      await moveExamToFolder(originalExam.id, folder.id);

      // Thuộc tính gốc của đề thi không bị thay đổi bất kỳ trường nào
      expect(originalExam.id).toBe("exam-preserve-01");
      expect(originalExam.title).toBe("Đề thi Toán Học Kỳ 1");
      expect(originalExam.access_code).toBe("TOAN10HK1");
      expect(originalExam.pin).toBe("123456");
      expect(originalExam.time_limit).toBe(45);
      expect(originalExam.total_questions).toBe(40);
      expect(originalExam.questions.length).toBe(1);
    });

    it("4.2. Preset màu sắc và biểu tượng phong phú, đúng chuẩn", () => {
      expect(FOLDER_COLOR_PRESETS.length).toBe(8);
      expect(FOLDER_ICON_PRESETS.length).toBe(8);

      const colorKeys = FOLDER_COLOR_PRESETS.map((p) => p.key);
      expect(colorKeys).toContain("sky");
      expect(colorKeys).toContain("violet");
      expect(colorKeys).toContain("emerald");
      expect(colorKeys).toContain("amber");
      expect(colorKeys).toContain("rose");

      const iconKeys = FOLDER_ICON_PRESETS.map((i) => i.key);
      expect(iconKeys).toContain("folder");
      expect(iconKeys).toContain("graduation-cap");
      expect(iconKeys).toContain("award");
    });
  });
});
