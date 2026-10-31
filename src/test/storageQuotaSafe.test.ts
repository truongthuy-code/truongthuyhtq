import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveUnifiedExam,
  getLocalStoredExams,
  setLocalStoredExams,
  SystemExam,
} from "@/lib/allExamsStorage";
import { saveStudentSubmission, getStudentSubmissions } from "@/lib/studentStorage";
import { saveLocalAssignments, getLocalAssignments, ExamAssignment } from "@/lib/examAssignments";

describe("STORAGE QUOTA EXCEEDED ERROR HANDLING & PREVENTION", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("TEST 1: saveUnifiedExam and setLocalStoredExams gracefully handle QuotaExceededError without throwing", () => {
    // Mock localStorage.setItem to throw QuotaExceededError on full payload
    let callCount = 0;
    const originalSetItem = localStorage.setItem.bind(localStorage);
    
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      callCount++;
      if (value.length > 500) {
        const quotaError = new Error("QuotaExceededError: Setting the value exceeded the quota.");
        quotaError.name = "QuotaExceededError";
        throw quotaError;
      }
      return originalSetItem(key, value);
    });

    const hugeExam: SystemExam = {
      id: "huge-exam-1",
      title: "Đề thi dung lượng cực lớn",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      questions: {
        partI: Array.from({ length: 50 }, (_, i) => ({
          id: `q_${i}`,
          text: `Câu hỏi số ${i} kèm ảnh lớn data:image/png;base64,${"A".repeat(1000)}`,
          options: [
            { key: "A", text: "Phương án A" },
            { key: "B", text: "Phương án B" },
          ],
          answer: "A",
        })),
      },
    };

    // Must NOT throw QuotaExceededError
    expect(() => {
      saveUnifiedExam(hugeExam);
    }).not.toThrow();

    // Verify it can still be retrieved via getLocalStoredExams
    const exams = getLocalStoredExams();
    expect(exams.length).toBeGreaterThan(0);
    expect(exams.some((e) => e.id === "huge-exam-1")).toBe(true);
  });

  it("TEST 2: If localStorage is completely blocked (always throws), memory cache preserves all exams", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const quotaError = new Error("Failed to execute 'setItem' on 'Storage': quota exceeded");
      quotaError.name = "QuotaExceededError";
      throw quotaError;
    });

    const exam: SystemExam = {
      id: "memory-fallback-exam",
      title: "Đề thi lưu trong memory khi bộ nhớ máy đầy",
      duration_minutes: 60,
      created_at: new Date().toISOString(),
      questions: { partI: [{ id: "q1", text: "1+1=?", answer: "2" }] },
    };

    expect(() => {
      saveUnifiedExam(exam);
    }).not.toThrow();

    const stored = getLocalStoredExams();
    expect(stored.some((e) => e.id === "memory-fallback-exam")).toBe(true);
  });

  it("TEST 3: saveStudentSubmission gracefully degrades when storage quota is exceeded", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === "qc_student_submissions_v1" && value.length > 200) {
        const quotaError = new Error("QuotaExceededError");
        quotaError.name = "QuotaExceededError";
        throw quotaError;
      }
    });

    const sub = {
      id: "sub-heavy-1",
      examId: "exam-heavy",
      examTitle: "Bài thi nặng",
      studentAccount: "hs1@school.edu",
      studentName: "Nguyễn Văn Test",
      studentClass: "12A",
      score: 10,
      maxScore: 10,
      correctCount: 10,
      wrongCount: 0,
      answers: { q1: "A", q2: "B" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 600,
      status: "completed" as const,
      questions: { partI: [{ id: "q1", text: "Heavy questions payload" }] },
    };

    expect(() => {
      saveStudentSubmission(sub);
    }).not.toThrow();

    const list = getStudentSubmissions("hs1@school.edu");
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe("sub-heavy-1");
  });

  it("TEST 4: saveLocalAssignments safely persists without error even when quota is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const assignments: ExamAssignment[] = [
      {
        id: "assign-1",
        examId: "exam-1",
        code: "TESTCODE",
        className: "12A1",
        title: "Bài kiểm tra Toán",
        teacherName: "Thầy A",
        durationMinutes: 45,
        createdAt: new Date().toISOString(),
      },
    ];

    expect(() => {
      saveLocalAssignments(assignments);
    }).not.toThrow();

    const result = getLocalAssignments();
    expect(result.length).toBe(1);
    expect(result[0].code).toBe("TESTCODE");
  });
});
