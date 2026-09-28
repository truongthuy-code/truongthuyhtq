import { describe, it, expect, beforeEach } from "vitest";
import {
  findAssignmentOrExamByCode,
  createAssignment,
  getDeterministicPrimaryCode,
  saveLocalAssignments,
  getLocalAssignments,
} from "@/lib/examAssignments";

describe("Exam Assignment & Code Resolution", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should return friendly error when empty code is passed", async () => {
    const res = await findAssignmentOrExamByCode("");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Vui lòng nhập");
  });

  it("should resolve exam when code is in local assignments cache without database permission error", async () => {
    const fakeAssignment = {
      id: "assign_test_01",
      examId: "76b7c02b-a8e1-4c4c-83b6-97e3f89d3119",
      code: "TIN12-7A3K9",
      className: "12A1",
      title: "Kiểm tra 15 phút Tin học 12",
      teacherName: "Trương Thị Bích Thủy",
      schoolName: "THPT Phan Bội Châu",
      subjectName: "Tin học",
      durationMinutes: 15,
      openAt: null,
      closeAt: null,
      createdAt: new Date().toISOString(),
    };

    saveLocalAssignments([fakeAssignment]);

    // Test with exact code
    const res = await findAssignmentOrExamByCode("TIN12-7A3K9");
    expect(res.success).toBe(true);
    expect(res.exam).toBeDefined();
    expect(res.exam.id).toBe("76b7c02b-a8e1-4c4c-83b6-97e3f89d3119");
    expect(res.assignment?.className).toBe("12A1");

    // Test with lower case
    const resLower = await findAssignmentOrExamByCode("tin12-7a3k9");
    expect(resLower.success).toBe(true);
  });

  it("should extract UUID from full URL and resolve without database permission error", async () => {
    const fakeAssignment = {
      id: "assign_test_02",
      examId: "81286e88-a211-4cae-80ad-91fa214ed64b",
      code: "TOAN-8899A",
      className: "10A1",
      title: "Đề kiểm tra Toán 10",
      teacherName: "Nguyễn Văn A",
      schoolName: "THPT Lê Quý Đôn",
      subjectName: "Toán",
      durationMinutes: 45,
      openAt: null,
      closeAt: null,
      createdAt: new Date().toISOString(),
    };

    saveLocalAssignments([fakeAssignment]);

    const url = "https://example.com/take/81286e88-a211-4cae-80ad-91fa214ed64b?code=TOAN-8899A&targetClass=10A1";
    const res = await findAssignmentOrExamByCode(url);
    expect(res.success).toBe(true);
    expect(res.exam.id).toBe("81286e88-a211-4cae-80ad-91fa214ed64b");
  });

  it("should resolve sample exam TIN12-7A3K9 with complete questions across Part I, II, III", async () => {
    const res = await findAssignmentOrExamByCode("TIN12-7A3K9");
    expect(res.success).toBe(true);
    expect(res.exam).toBeDefined();
    expect(res.exam.questions).toBeDefined();
    expect(res.exam.questions.partI.length).toBeGreaterThan(0);
    expect(res.exam.questions.partII.length).toBeGreaterThan(0);
    expect(res.exam.questions.partIII.length).toBeGreaterThan(0);
    expect(res.assignment?.className).toBe("12A1");
  });

  it("should resolve sample exam A1K8P2 with questions", async () => {
    const res = await findAssignmentOrExamByCode("A1K8P2");
    expect(res.success).toBe(true);
    expect(res.exam).toBeDefined();
    expect(res.exam.questions.partI.length).toBeGreaterThan(0);
  });

  it("should handle code with leading/trailing whitespace and lower case", async () => {
    const res = await findAssignmentOrExamByCode("   tin12-7a3k9   ");
    expect(res.success).toBe(true);
    expect(res.exam.title).toContain("Tin học 12");
  });

  it("should extract code from full URL path like /take/TIN12-7A3K9", async () => {
    const res = await findAssignmentOrExamByCode("https://myapp.com/take/TIN12-7A3K9");
    expect(res.success).toBe(true);
    expect(res.exam.title).toContain("Tin học 12");
  });

  it("should return exact error message if code not found and never throw permission denied", async () => {
    const res = await findAssignmentOrExamByCode("INVALID-CODE-999");
    expect(res.success).toBe(false);
    expect(res.error).not.toContain("permission denied");
    expect(res.error).toBe("Mã bài thi không hợp lệ hoặc không tồn tại.");
  });
});
