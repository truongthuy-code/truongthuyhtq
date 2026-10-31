import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MissingAnswersAlertModal, { MissingItem } from "@/components/MissingAnswersAlertModal";

describe("MissingAnswersAlertModal Component Tests", () => {
  const sampleMissingQuestions: MissingItem[] = [
    { id: "q1", label: "Câu 3 – Phần I", part: "I", idx: 2 },
    { id: "q2", label: "Câu 8 – Phần I", part: "I", idx: 7 },
    { id: "q3", label: "Câu 12 – Phần I", part: "I", idx: 11 },
    { id: "q4", label: "Câu 2 – Phần II", part: "II", idx: 1 },
    { id: "q5", label: "Câu 6 – Phần II", part: "II", idx: 5 },
  ];

  it("renders modal at center of screen when isOpen=true and questions are missing", () => {
    const onConfirm = vi.fn();
    render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={sampleMissingQuestions}
      />
    );

    // Check title and warning
    expect(screen.getByText("⚠️ CẢNH BÁO")).toBeInTheDocument();
    expect(screen.getByText("Phát hiện câu hỏi chưa có đáp án!")).toBeInTheDocument();

    // Check count
    expect(screen.getByText(/5 câu chưa xác định được đáp án đúng/)).toBeInTheDocument();

    // Check all missing questions listed
    expect(screen.getByText("Câu 3 – Phần I")).toBeInTheDocument();
    expect(screen.getByText("Câu 8 – Phần I")).toBeInTheDocument();
    expect(screen.getByText("Câu 12 – Phần I")).toBeInTheDocument();
    expect(screen.getByText("Câu 2 – Phần II")).toBeInTheDocument();
    expect(screen.getByText("Câu 6 – Phần II")).toBeInTheDocument();

    // Check confirm button
    const okBtn = screen.getByRole("button", { name: "OK, TÔI ĐÃ BIẾT" });
    expect(okBtn).toBeInTheDocument();
  });

  it("does not render when isOpen=false", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <MissingAnswersAlertModal
        isOpen={false}
        onConfirm={onConfirm}
        missingQuestions={sampleMissingQuestions}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when missingQuestions is empty", () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={[]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("triggers onConfirm ONLY when clicking the 'OK, TÔI ĐÃ BIẾT' button", () => {
    const onConfirm = vi.fn();
    render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={sampleMissingQuestions}
      />
    );

    const okBtn = screen.getByRole("button", { name: "OK, TÔI ĐÃ BIẾT" });
    fireEvent.click(okBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does NOT close or call onConfirm when clicking outside (backdrop)", () => {
    const onConfirm = vi.fn();
    render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={sampleMissingQuestions}
      />
    );

    const backdrop = screen.getByRole("alertdialog");
    fireEvent.click(backdrop);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does NOT close or call onConfirm when pressing Escape key", () => {
    const onConfirm = vi.fn();
    render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={sampleMissingQuestions}
      />
    );

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("displays 10 questions cleanly in a single modal without duplicating modals", () => {
    const onConfirm = vi.fn();
    const tenMissing: MissingItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i + 1}`,
      label: `Câu ${i + 1} – Phần I`,
      part: "I",
      idx: i,
    }));

    render(
      <MissingAnswersAlertModal
        isOpen={true}
        onConfirm={onConfirm}
        missingQuestions={tenMissing}
      />
    );

    expect(screen.getByText(/10 câu chưa xác định được đáp án đúng/)).toBeInTheDocument();
    expect(screen.getByText("Câu 1 – Phần I")).toBeInTheDocument();
    expect(screen.getByText("Câu 10 – Phần I")).toBeInTheDocument();

    // Verify exactly one confirm button is rendered
    const buttons = screen.getAllByRole("button", { name: "OK, TÔI ĐÃ BIẾT" });
    expect(buttons).toHaveLength(1);
  });
});
