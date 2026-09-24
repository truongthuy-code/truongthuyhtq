import { describe, it, expect } from "vitest";
import { generateVariants, shuffleMC, shuffleTF, estimateMaxVariants } from "../lib/shuffleEngine";
import { generateExamCodes } from "../lib/examCodeGenerator";
import { buildAnswerKeyBlob } from "../lib/examExporter";
import type { ParsedExam, MCQuestion, TFQuestion } from "../lib/docxParser";

describe("Shuffle Engine & Exam Generation", () => {
  const sampleExam: ParsedExam = {
    partI: [
      {
        id: "q1",
        text: "Hàm số nào đồng biến trên R?",
        options: [
          { key: "A", text: "y = x^3 + x" },
          { key: "B", text: "y = x^4" },
          { key: "C", text: "y = -2x + 1" },
          { key: "D", text: "y = 1/x" },
        ],
        answer: "A",
      },
      {
        id: "q2",
        text: "Tập nghiệm của phương trình log2(x) = 3 là:",
        options: [
          { key: "A", text: "{6}" },
          { key: "B", text: "{8}" },
          { key: "C", text: "{9}" },
          { key: "D", text: "{5}" },
        ],
        answer: "B",
      },
    ],
    partII: [
      {
        id: "q3",
        text: "Cho hàm số f(x) = sin(x). Xét tính đúng sai:",
        items: [
          { key: "a", text: "Hàm số tuần hoàn chu kỳ 2pi", correct: true },
          { key: "b", text: "Hàm số là hàm chẵn", correct: false },
          { key: "c", text: "Tập giá trị là [-1; 1]", correct: true },
          { key: "d", text: "Đạo hàm f'(x) = -cos(x)", correct: false },
        ],
      },
    ],
    partIII: [
      {
        id: "q4",
        text: "Tìm giá trị lớn nhất của biểu thức P = x + y",
        answer: "10",
      },
    ],
  };

  it("cho phép tạo đúng 1 mã đề (tối thiểu = 1)", () => {
    const codeRes = generateExamCodes({
      prefix: "7",
      codeLength: 3,
      quantity: 1,
    });
    expect(codeRes.ok).toBe(true);
    if (codeRes.ok) {
      expect(codeRes.codes).toEqual(["701"]);
    }

    const variants = generateVariants(sampleExam, 1, {
      shuffleQuestions: true,
      shuffleAnswers: true,
      keepSaOrder: false,
    });
    expect(variants.length).toBe(1);
    expect(variants[0].partI.length).toBe(2);
    expect(variants[0].partII.length).toBe(1);
    expect(variants[0].partIII.length).toBe(1);
  });

  it("tạo nhiều mã đề (ví dụ 4 mã đề) với mã đề chính xác", () => {
    const codeRes = generateExamCodes({
      prefix: "7",
      codeLength: 3,
      quantity: 4,
    });
    expect(codeRes.ok).toBe(true);
    if (codeRes.ok) {
      expect(codeRes.codes).toEqual(["701", "702", "703", "704"]);
    }

    const variants = generateVariants(sampleExam, 4, {
      shuffleQuestions: true,
      shuffleAnswers: true,
      keepSaOrder: false,
    });
    expect(variants.length).toBe(4);
  });

  it("đáp án của mỗi câu trắc nghiệm sau khi xáo phương án luôn trỏ đúng phương án gốc", () => {
    const originalQ = sampleExam.partI[0];
    const correctOriginalText = originalQ.options.find((o) => o.key === originalQ.answer)!.text;

    // Test shuffleMC 20 times to ensure random permutations all preserve the right answer
    for (let i = 0; i < 20; i++) {
      const shuffledQ = shuffleMC(originalQ, {
        shuffleQuestions: true,
        shuffleAnswers: true,
        keepSaOrder: false,
      });

      // The new answer letter
      const newAnswerLetter = shuffledQ.answer;
      // The option text with that letter
      const chosenOption = shuffledQ.options.find((o) => o.key === newAnswerLetter);
      expect(chosenOption).toBeDefined();
      expect(chosenOption!.text).toBe(correctOriginalText);
    }
  });

  it("đáp án Đúng/Sai sau khi xáo items vẫn giữ đúng tính đúng/sai của từng ý", () => {
    const originalTF = sampleExam.partII[0];

    for (let i = 0; i < 20; i++) {
      const shuffledTF = shuffleTF(originalTF, {
        shuffleQuestions: true,
        shuffleAnswers: true,
        keepSaOrder: false,
      });

      shuffledTF.items.forEach((item) => {
        const origItem = originalTF.items.find((x) => x.text === item.text);
        expect(origItem).toBeDefined();
        expect(item.correct).toBe(origItem!.correct);
      });
    }
  });

  it("buildAnswerKeyBlob tạo thành công cho cả trường hợp 1 mã đề và nhiều mã đề", async () => {
    // 1 variant
    const v1 = generateVariants(sampleExam, 1, {
      shuffleQuestions: false,
      shuffleAnswers: false,
      keepSaOrder: true,
    });
    const blob1 = await buildAnswerKeyBlob(v1, ["701"]);
    expect(blob1).toBeDefined();
    expect(blob1.size).toBeGreaterThan(0);

    // 4 variants
    const v4 = generateVariants(sampleExam, 4, {
      shuffleQuestions: true,
      shuffleAnswers: true,
      keepSaOrder: false,
    });
    const blob4 = await buildAnswerKeyBlob(v4, ["701", "702", "703", "704"]);
    expect(blob4).toBeDefined();
    expect(blob4.size).toBeGreaterThan(0);
  });
});
