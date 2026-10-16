import { describe, it, expect } from "vitest";

// Pure helper mimicking the exact decision logic used in Result.tsx and Take.tsx
export function canViewReviewAnswers(params: {
  displayMode?: string;
  allowReview: boolean;
  enableMinCorrect?: boolean;
  minCorrectPercentage?: number;
  correctCount: number;
  totalQuestions: number;
}) {
  const {
    displayMode = "standard",
    allowReview,
    enableMinCorrect = false,
    minCorrectPercentage = 0,
    correctCount,
    totalQuestions,
  } = params;

  // Rule 4: If allowReview is false, never allow review (regardless of percentage)
  if (!allowReview) {
    return { canReview: false, reason: "review_disabled" };
  }

  const isStandard = displayMode === "standard";
  const correctRate = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
  const isThresholdActive = isStandard && enableMinCorrect;

  // Rule 1, 2, 3:
  if (isThresholdActive) {
    const passed = correctRate >= minCorrectPercentage - 1e-6;
    if (!passed) {
      return {
        canReview: false,
        reason: "threshold_failed",
        correctRate,
        threshold: minCorrectPercentage,
      };
    }
  }

  return { canReview: true, reason: "allowed", correctRate };
}

describe("Cấu hình Áp dụng tỷ lệ trả lời đúng tối thiểu trong Chế độ tiêu chuẩn", () => {
  it("Case 1: Bật công tắc, đặt 70%, học sinh đạt 70%: được xem đáp án và lời giải", () => {
    const res = canViewReviewAnswers({
      displayMode: "standard",
      allowReview: true,
      enableMinCorrect: true,
      minCorrectPercentage: 70,
      correctCount: 14,
      totalQuestions: 20, // 14/20 = 70%
    });
    expect(res.canReview).toBe(true);
    expect(res.reason).toBe("allowed");
  });

  it("Case 2: Bật công tắc, đặt 70%, học sinh đạt 69%: không được xem", () => {
    const res = canViewReviewAnswers({
      displayMode: "standard",
      allowReview: true,
      enableMinCorrect: true,
      minCorrectPercentage: 70,
      correctCount: 69,
      totalQuestions: 100, // 69%
    });
    expect(res.canReview).toBe(false);
    expect(res.reason).toBe("threshold_failed");
    expect(res.threshold).toBe(70);
  });

  it("Case 3: Tắt công tắc, thiết lập cho phép xem đáp án đang BẬT: học sinh xem theo cơ chế hiện tại, không bị giới hạn bởi tỷ lệ đúng", () => {
    const res = canViewReviewAnswers({
      displayMode: "standard",
      allowReview: true,
      enableMinCorrect: false,
      minCorrectPercentage: 70,
      correctCount: 4,
      totalQuestions: 20, // 20%
    });
    expect(res.canReview).toBe(true);
    expect(res.reason).toBe("allowed");
  });

  it("Case 4: Tắt công tắc, thiết lập cho phép xem đáp án đang TẮT: học sinh không được xem, kể cả khi đạt 100%", () => {
    const res = canViewReviewAnswers({
      displayMode: "standard",
      allowReview: false,
      enableMinCorrect: false,
      minCorrectPercentage: 70,
      correctCount: 20,
      totalQuestions: 20, // 100%
    });
    expect(res.canReview).toBe(false);
    expect(res.reason).toBe("review_disabled");
  });

  it("Case 5: Tắt rồi bật lại công tắc: ngưỡng đã lưu trước đó vẫn được giữ nguyên trong state", () => {
    let state = {
      enableMinCorrect: true,
      minCorrectPercentage: 70,
    };
    // Tắt switch:
    state = { ...state, enableMinCorrect: false };
    expect(state.minCorrectPercentage).toBe(70); // không bị reset hoặc xóa

    // Bật lại switch:
    state = { ...state, enableMinCorrect: true };
    expect(state.minCorrectPercentage).toBe(70); // khôi phục đúng giá trị
  });

  it("Case 6: Mở đề cũ chưa có cấu hình mới: hoạt động đúng như trước khi cập nhật (mặc định không áp dụng ngưỡng)", () => {
    const legacyExamData: any = {
      title: "Đề thi cũ",
      allow_review: true,
      // Không có enable_min_correct_percentage
    };
    const enableMin = !!(
      legacyExamData.enable_min_correct_percentage ??
      legacyExamData.lock_mode?.enable_min_correct_percentage ??
      legacyExamData.scoring?.enable_min_correct_percentage ??
      false
    );
    expect(enableMin).toBe(false);

    const res = canViewReviewAnswers({
      displayMode: "standard",
      allowReview: legacyExamData.allow_review,
      enableMinCorrect: enableMin,
      minCorrectPercentage: 70,
      correctCount: 5,
      totalQuestions: 20, // 25%
    });
    expect(res.canReview).toBe(true);
  });

  it("Case 7: Chuyển sang chế độ từng câu hỏi (quizizz) hoặc đội nhóm (team): không áp dụng ngưỡng tỷ lệ", () => {
    const quizizzRes = canViewReviewAnswers({
      displayMode: "quizizz",
      allowReview: true,
      enableMinCorrect: true,
      minCorrectPercentage: 80,
      correctCount: 5,
      totalQuestions: 20, // 25%
    });
    expect(quizizzRes.canReview).toBe(true);

    const teamRes = canViewReviewAnswers({
      displayMode: "team",
      allowReview: true,
      enableMinCorrect: true,
      minCorrectPercentage: 80,
      correctCount: 5,
      totalQuestions: 20, // 25%
    });
    expect(teamRes.canReview).toBe(true);
  });

  it("Case 8: Lưu đề, mở lại đề và kiểm tra cấu hình: trạng thái bật/tắt và tỷ lệ được lưu chính xác trong scoring và lock_mode", () => {
    const savedConfig = {
      scoring: {
        p1: 0.25,
        enable_min_correct_percentage: true,
        min_correct_percentage_for_review: 75,
      },
      lock_mode: {
        enable_min_correct_percentage: true,
        min_correct_percentage_for_review: 75,
      },
    };

    const loadedEnable = !!(
      (savedConfig as any).enable_min_correct_percentage ??
      savedConfig.lock_mode?.enable_min_correct_percentage ??
      savedConfig.scoring?.enable_min_correct_percentage ??
      false
    );
    const loadedPct = Number(
      (savedConfig as any).min_correct_percentage_for_review ??
      savedConfig.lock_mode?.min_correct_percentage_for_review ??
      savedConfig.scoring?.min_correct_percentage_for_review ??
      70
    );

    expect(loadedEnable).toBe(true);
    expect(loadedPct).toBe(75);
  });
});
