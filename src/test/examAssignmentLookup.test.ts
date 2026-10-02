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

  it("should generate strictly 6-digit numeric exam codes without letters or symbols", async () => {
    const { generateNumericExamCode, generateUniqueNumericExamCode } = await import("@/lib/examAssignments");
    for (let i = 0; i < 50; i++) {
      const code = generateNumericExamCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
      expect(/^[0-9]{6}$/.test(code)).toBe(true);
      expect(/[a-zA-Z]/.test(code)).toBe(false);
    }

    const uniqueCode = await generateUniqueNumericExamCode();
    expect(uniqueCode).toMatch(/^\d{6}$/);
    expect(uniqueCode.length).toBe(6);
  });

  it("should generate distinct unique codes and avoid collisions", async () => {
    const { generateUniqueNumericExamCode } = await import("@/lib/examAssignments");
    const codeSet = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const code = await generateUniqueNumericExamCode();
      expect(code).toMatch(/^\d{6}$/);
      codeSet.add(code);
    }
    // High probability of 20 unique codes in 1,000,000 space
    expect(codeSet.size).toBe(20);
  });

  it("should resolve 6-digit numeric code with leading zero (e.g. 012345)", async () => {
    const fakeAssignment = {
      id: "assign_test_leading_zero",
      examId: "99999999-0000-4000-8000-000000000001",
      code: "012345", // Leading zero preserved as string
      className: "12A2",
      title: "Bài kiểm tra Toán học 12",
      teacherName: "Trương Thị Bích Thủy",
      schoolName: "THPT Phan Bội Châu",
      subjectName: "Toán",
      durationMinutes: 45,
      openAt: null,
      closeAt: null,
      createdAt: new Date().toISOString(),
    };

    saveLocalAssignments([fakeAssignment]);

    const res = await findAssignmentOrExamByCode("012345");
    expect(res.success).toBe(true);
    expect(res.exam.id).toBe("99999999-0000-4000-8000-000000000001");
    expect(res.assignment?.code).toBe("012345");
    expect(res.assignment?.code.startsWith("0")).toBe(true);
  });

  it("should resolve standard 6-digit numeric code (e.g. 583214)", async () => {
    const fakeAssignment = {
      id: "assign_test_numeric",
      examId: "88888888-0000-4000-8000-000000000002",
      code: "583214",
      className: "11B1",
      title: "Bài kiểm tra Tin học 11",
      teacherName: "Trương Thị Bích Thủy",
      schoolName: "THPT Phan Bội Châu",
      subjectName: "Tin học",
      durationMinutes: 30,
      openAt: null,
      closeAt: null,
      createdAt: new Date().toISOString(),
    };

    saveLocalAssignments([fakeAssignment]);

    // Student enters "583214"
    const res = await findAssignmentOrExamByCode("583214");
    expect(res.success).toBe(true);
    expect(res.exam.id).toBe("88888888-0000-4000-8000-000000000002");
    expect(res.assignment?.code).toBe("583214");
  });
});
