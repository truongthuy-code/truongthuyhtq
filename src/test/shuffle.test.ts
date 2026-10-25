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

  it("xáo độc lập theo từng phần: bật phần I, tắt phần II và III", () => {
    const v = generateVariants(sampleExam, 1, {
      shuffle_q_p1: true,
      shuffle_o_p1: true,
      shuffle_q_p2: false,
      shuffle_o_p2: false,
      shuffle_q_p3: false,
    });
    expect(v.length).toBe(1);
    const variant = v[0];

    // Phần II giữ nguyên thứ tự câu và thứ tự items
    expect(variant.partII[0].id).toBe(sampleExam.partII[0].id);
    expect(variant.partII[0].items[0].text).toBe(sampleExam.partII[0].items[0].text);
    expect(variant.partII[0].items[1].text).toBe(sampleExam.partII[0].items[1].text);

    // Phần III giữ nguyên thứ tự câu
    expect(variant.partIII[0].id).toBe(sampleExam.partIII[0].id);
    expect(variant.partIII[0].text).toBe(sampleExam.partIII[0].text);
  });

  it("bảo toàn nguyên vẹn công thức MathType/OMML khi xáo câu hỏi và xáo phương án", () => {
    const SENT_OPEN = "\u27E6";
    const SENT_CLOSE = "\u27E7";
    const math1 = `${SENT_OPEN}MATH:y=\\frac{x^2+1}{x-1}${SENT_CLOSE}`;
    const mathOptA = `${SENT_OPEN}MATH:x=1${SENT_CLOSE}`;
    const mathOptB = `${SENT_OPEN}MATH:x=-1${SENT_CLOSE}`;
    const mathOptC = `${SENT_OPEN}MATH:x=\\pm\\sqrt{2}${SENT_CLOSE}`;
    const mathOptD = `${SENT_OPEN}MATH:x\\in\\mathbb{R}${SENT_CLOSE}`;

    const mathExam: ParsedExam = {
      partI: [
        {
          id: "qm1",
          text: `Cho hàm số ${math1}. Khảo sát tiệm cận:`,
          options: [
            { key: "A", text: mathOptA },
            { key: "B", text: mathOptB },
            { key: "C", text: mathOptC },
            { key: "D", text: mathOptD },
          ],
          answer: "C",
        },
      ],
      partII: [
        {
          id: "qm2",
          text: `Cho phương trình ${SENT_OPEN}MATH:\\log_2(x-1)=3${SENT_CLOSE}:`,
          items: [
            { key: "a", text: `Nghiệm ${SENT_OPEN}MATH:x=9${SENT_CLOSE}`, correct: true },
            { key: "b", text: `Nghiệm ${SENT_OPEN}MATH:x=7${SENT_CLOSE}`, correct: false },
            { key: "c", text: `Tập xác định ${SENT_OPEN}MATH:D=(1;+\\infty)${SENT_CLOSE}`, correct: true },
            { key: "d", text: `Có 2 nghiệm`, correct: false },
          ],
        },
      ],
      partIII: [
        {
          id: "qm3",
          text: `Tính tích phân ${SENT_OPEN}MATH:I=\\int_0^1 x e^x dx${SENT_CLOSE}`,
          answer: "1",
        },
      ],
    };

    // Run 10 times with shuffling enabled
    for (let i = 0; i < 10; i++) {
      const variants = generateVariants(mathExam, 1, {
        shuffleQuestions: true,
        shuffleAnswers: true,
      });
      const v = variants[0];

      // Question 1 stem still contains math1
      expect(v.partI[0].text).toContain(math1);

      // All 4 options still contain their formulas
      const optTexts = v.partI[0].options.map((o) => o.text);
      expect(optTexts).toContain(mathOptA);
      expect(optTexts).toContain(mathOptB);
      expect(optTexts).toContain(mathOptC);
      expect(optTexts).toContain(mathOptD);

      // The correct answer option is the one with mathOptC
      const correctOpt = v.partI[0].options.find((o) => o.key === v.partI[0].answer);
      expect(correctOpt).toBeDefined();
      expect(correctOpt!.text).toBe(mathOptC);

      // Part II items retain their formulas and correct boolean
      const itA = v.partII[0].items.find((it) => it.text.includes("x=9"));
      expect(itA).toBeDefined();
      expect(itA!.correct).toBe(true);

      const itB = v.partII[0].items.find((it) => it.text.includes("x=7"));
      expect(itB).toBeDefined();
      expect(itB!.correct).toBe(false);
    }
  });

  it("xuất file Word đề thi và đáp án chứa công thức toán mà không bị lỗi", async () => {
    const SENT_OPEN = "\u27E6";
    const SENT_CLOSE = "\u27E7";
    const mathExam: ParsedExam = {
      partI: [
        {
          id: "q1",
          text: `Cho hàm số ${SENT_OPEN}MATH:y=\\frac{x+1}{x-1}${SENT_CLOSE}.`,
          options: [
            { key: "A", text: `${SENT_OPEN}MATH:x=1${SENT_CLOSE}` },
            { key: "B", text: `${SENT_OPEN}MATH:x=2${SENT_CLOSE}` },
            { key: "C", text: `${SENT_OPEN}MATH:x=3${SENT_CLOSE}` },
            { key: "D", text: `${SENT_OPEN}MATH:x=4${SENT_CLOSE}` },
          ],
          answer: "A",
        },
      ],
      partII: [],
      partIII: [],
    };
    const keyBlob = await buildAnswerKeyBlob([mathExam], ["701"]);
    expect(keyBlob.size).toBeGreaterThan(0);
  });
});
