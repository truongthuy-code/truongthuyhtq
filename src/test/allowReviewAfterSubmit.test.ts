import { describe, it, expect, beforeEach } from "vitest";
import {
  canStudentReviewSubmission,
  saveStudentSubmission,
  getStudentSubmissions,
  publishExamClosed,
  StudentSubmissionRecord,
} from "@/lib/studentStorage";
import { saveUnifiedExam, getLocalStoredExams } from "@/lib/allExamsStorage";

describe("Tính năng: Cho học sinh xem đáp án ngay sau khi nộp bài", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // TEST 1: Giáo viên TẮT tính năng. Học sinh nộp bài. → Không được xem đáp án trước khi giáo viên đóng đề.
  it("TEST 1 - GV TẮT tính năng, HS đã nộp bài, đề chưa đóng -> KHÔNG được xem đáp án", () => {
    const examId = "exam-test-1";
    saveUnifiedExam({
      id: examId,
      title: "Đề kiểm tra Tin học",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: false, // TẮT
      questions: { partI: [{ id: "q1", text: "Câu 1?", answer: "A", options: [{ key: "A", text: "1" }] }] },
    });

    const sub = saveStudentSubmission({
      id: "sub-1",
      examId,
      examTitle: "Đề kiểm tra Tin học",
      studentAccount: "hocsinh_a",
      studentName: "Nguyễn Văn A",
      studentClass: "12A1",
      score: 8,
      maxScore: 10,
      correctCount: 4,
      wrongCount: 1,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1200,
      status: "completed",
      isExamClosed: false,
      allowReview: false,
    });

    const canReview = canStudentReviewSubmission(sub, false);
    expect(canReview).toBe(false);
  });

  // TEST 2: Giáo viên TẮT tính năng. Giáo viên đóng đề. → Học sinh vẫn xem được đáp án như cơ chế hiện tại.
  it("TEST 2 - GV TẮT tính năng, nhưng đề đã ĐÓNG -> HS ĐƯỢC xem đáp án theo cơ chế hiện tại", () => {
    const examId = "exam-test-2";
    saveUnifiedExam({
      id: examId,
      title: "Đề kiểm tra Tin học",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: true, // ĐÃ ĐÓNG
      allow_review: false, // TẮT
      questions: { partI: [{ id: "q1", text: "Câu 1?", answer: "A", options: [{ key: "A", text: "1" }] }] },
    });

    publishExamClosed(examId, { partI: [{ id: "q1", answer: "A" }] }, "Đề kiểm tra Tin học");

    const sub = saveStudentSubmission({
      id: "sub-2",
      examId,
      examTitle: "Đề kiểm tra Tin học",
      studentAccount: "hocsinh_a",
      studentName: "Nguyễn Văn A",
      studentClass: "12A1",
      score: 8,
      maxScore: 10,
      correctCount: 4,
      wrongCount: 1,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1200,
      status: "completed",
      isExamClosed: true,
      allowReview: false,
    });

    const canReview = canStudentReviewSubmission(sub, false);
    expect(canReview).toBe(true);
  });

  // TEST 3: Giáo viên BẬT tính năng. Học sinh chưa nộp bài. → Không được xem đáp án.
  it("TEST 3 - GV BẬT tính năng, nhưng HS CHƯA nộp bài -> KHÔNG được xem đáp án", () => {
    const examId = "exam-test-3";
    saveUnifiedExam({
      id: examId,
      title: "Đề kiểm tra Tin học",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: true, // BẬT
      questions: { partI: [{ id: "q1", text: "Câu 1?", answer: "A", options: [{ key: "A", text: "1" }] }] },
    });

    const inProgressSub = {
      id: "sub-3",
      examId,
      studentAccount: "hocsinh_b",
      status: "in_progress", // CHƯA NỘP
      isExamClosed: false,
      allowReview: true,
    };

    const canReview = canStudentReviewSubmission(inProgressSub as any, true);
    expect(canReview).toBe(false);
  });

  // TEST 4: Giáo viên BẬT tính năng. Học sinh nộp bài thành công. → Được xem đáp án ngay lập tức trong tài khoản.
  it("TEST 4 - GV BẬT tính năng, HS đã nộp bài thành công -> ĐƯỢC xem đáp án ngay trong tài khoản mà không cần chờ đóng đề", () => {
    const examId = "exam-test-4";
    saveUnifiedExam({
      id: examId,
      title: "Đề kiểm tra Tin học",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false, // ĐỀ VẪN ĐANG MỞ
      allow_review: true,  // BẬT
      questions: { partI: [{ id: "q1", text: "Câu 1?", answer: "A", options: [{ key: "A", text: "1" }] }] },
    });

    const sub = saveStudentSubmission({
      id: "sub-4",
      examId,
      examTitle: "Đề kiểm tra Tin học",
      studentAccount: "hocsinh_a",
      studentName: "Nguyễn Văn A",
      studentClass: "12A1",
      score: 10,
      maxScore: 10,
      correctCount: 5,
      wrongCount: 0,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1200,
      status: "completed", // ĐÃ NỘP BÀI
      isExamClosed: false,
      allowReview: true,
    });

    const canReview = canStudentReviewSubmission(sub, true);
    expect(canReview).toBe(true);

    // Kiểm tra danh sách bài đã làm của tài khoản học sinh
    const list = getStudentSubmissions("hocsinh_a");
    expect(list.length).toBe(1);
    expect(list[0].allowReview).toBe(true);
    expect(canStudentReviewSubmission(list[0])).toBe(true);
  });

  // TEST 5: Giáo viên BẬT tính năng. Học sinh đã nộp bài. → Đăng xuất rồi đăng nhập lại. → Vẫn được xem đáp án.
  it("TEST 5 - Đăng xuất rồi đăng nhập lại -> Quyền xem đáp án vẫn được duy trì", () => {
    const examId = "exam-test-5";
    saveUnifiedExam({
      id: examId,
      title: "Đề kiểm tra Tin học 12",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: true,
    });

    saveStudentSubmission({
      id: "sub-5",
      examId,
      examTitle: "Đề kiểm tra Tin học 12",
      studentAccount: "hocsinh_c",
      studentName: "Trần Thị C",
      studentClass: "12A2",
      score: 9,
      maxScore: 10,
      correctCount: 4,
      wrongCount: 1,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1500,
      status: "completed",
      isExamClosed: false,
      allowReview: true,
    });

    // Giả lập học sinh đăng xuất rồi đăng nhập lại bằng tài khoản hocsinh_c
    const subsAfterLogin = getStudentSubmissions("hocsinh_c");
    expect(subsAfterLogin.length).toBe(1);
    const item = subsAfterLogin[0];
    expect(item.status).toBe("completed");
    expect(item.allowReview).toBe(true);
    expect(canStudentReviewSubmission(item)).toBe(true);
  });

  // TEST 6: Giáo viên BẬT tính năng. Học sinh A đã nộp bài. → A xem được. Học sinh B chưa nộp bài. → B không xem được.
  it("TEST 6 - Học sinh A đã nộp bài xem được, Học sinh B chưa nộp bài không được xem", () => {
    const examId = "exam-test-6";
    saveUnifiedExam({
      id: examId,
      title: "Đề thi chung",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: true,
    });

    const subA = saveStudentSubmission({
      id: "sub-6-a",
      examId,
      examTitle: "Đề thi chung",
      studentAccount: "hocsinh_a",
      studentName: "Nguyễn Văn A",
      studentClass: "12A1",
      score: 10,
      maxScore: 10,
      correctCount: 5,
      wrongCount: 0,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1000,
      status: "completed",
      isExamClosed: false,
      allowReview: true,
    });

    const subB = {
      id: "sub-6-b",
      examId,
      examTitle: "Đề thi chung",
      studentAccount: "hocsinh_b",
      studentName: "Lê Văn B",
      studentClass: "12A1",
      score: 0,
      maxScore: 10,
      correctCount: 0,
      wrongCount: 0,
      answers: {},
      startedAt: new Date().toISOString(),
      submittedAt: "",
      durationSeconds: null,
      status: "in_progress", // B chưa nộp
      isExamClosed: false,
      allowReview: true,
    };

    expect(canStudentReviewSubmission(subA, true)).toBe(true);
    expect(canStudentReviewSubmission(subB as any, true)).toBe(false);
  });

  // TEST 7: Đề chưa đóng nhưng giáo viên bật tính năng. → Học sinh đã nộp bài được xem đáp án.
  it("TEST 7 - Đề chưa đóng nhưng GV bật tính năng -> HS đã nộp bài xem được đáp án", () => {
    const examId = "exam-test-7";
    saveUnifiedExam({
      id: examId,
      title: "Đề thi mở",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false, // CHƯA ĐÓNG
      allow_review: true,  // BẬT
    });

    const sub = {
      examId,
      isExamClosed: false,
      status: "completed",
      allowReview: true,
    };

    expect(canStudentReviewSubmission(sub as any)).toBe(true);
  });

  // TEST 8: Giáo viên tắt tính năng sau khi một số học sinh đã nộp bài.
  it("TEST 8 - Giáo viên thay đổi cài đặt -> Hệ thống tuân thủ cấu hình đề hiện tại", () => {
    const examId = "exam-test-8";
    saveUnifiedExam({
      id: examId,
      title: "Đề thi",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: true,
    });

    const sub = saveStudentSubmission({
      id: "sub-8",
      examId,
      examTitle: "Đề thi",
      studentAccount: "hocsinh_d",
      studentName: "Phạm Văn D",
      studentClass: "12A3",
      score: 7,
      maxScore: 10,
      correctCount: 3,
      wrongCount: 2,
      answers: { q1: "A" },
      startedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      durationSeconds: 1200,
      status: "completed",
      isExamClosed: false,
      allowReview: true,
    });

    // Khi giáo viên tắt tính năng trong đề thi:
    saveUnifiedExam({
      id: examId,
      title: "Đề thi",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      manual_closed: false,
      allow_review: false, // GV ĐÃ TẮT
    });

    const canReviewWhenGvTurnedOff = canStudentReviewSubmission(sub, false);
    expect(canReviewWhenGvTurnedOff).toBe(false);
  });
});
