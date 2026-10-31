import { describe, it, expect } from "vitest";
import { parseTextExam } from "@/lib/textExamParser";
import {
  parseDocx,
  isQuestionMissingAnswer,
  getMissingAnswerQuestions,
  type ParsedExam,
} from "@/lib/docxParser";
import { shuffleMC } from "@/lib/shuffleEngine";
import JSZip from "jszip";

// Helper to build a minimal DOCX file in memory
async function createMockDocx(bodyXml: string): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`
  );

  const blob = await zip.generateAsync({ type: "arraybuffer" });
  return {
    name: "test_exam.docx",
    arrayBuffer: async () => blob,
  } as unknown as File;
}

describe("NO ANSWER GUESSING & STRICT EVIDENCE-BASED ANSWER PARSING", () => {
  // TEST 1 – Có đáp án A
  it("TEST 1: Có đáp án A -> correctAnswer = A", () => {
    const raw = `PHẦN I
Câu 1. Thủ đô của Việt Nam là gì?
*A. Hà Nội.
B. Huế.
C. Đà Nẵng.
D. Hải Phòng.`;
    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(1);
    expect(exam.partI[0].answer).toBe("A");
    expect(isQuestionMissingAnswer(exam.partI[0])).toBe(false);
  });

  // TEST 2 – Không có đáp án
  it("TEST 2: Không có đáp án -> correctAnswer = null (Tuyệt đối không được tự động chọn A)", () => {
    const raw = `PHẦN I
Câu 1. Thủ đô của Việt Nam là gì?
A. Hà Nội.
B. Huế.
C. Đà Nẵng.
D. Hải Phòng.`;
    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(1);
    expect(exam.partI[0].answer).toBeNull();
    expect(exam.partI[0].answer).not.toBe("A");
    expect(isQuestionMissingAnswer(exam.partI[0])).toBe(true);
  });

  // TEST 3 – Có đáp án B
  it("TEST 3: Có đáp án B -> correctAnswer = B", () => {
    const raw = `PHẦN I
Câu 1. Số nguyên tố chẵn duy nhất là?
A. 0.
*B. 2.
C. 4.
D. 6.`;
    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(1);
    expect(exam.partI[0].answer).toBe("B");
    expect(isQuestionMissingAnswer(exam.partI[0])).toBe(false);
  });

  // TEST 4 – Có đáp án C
  it("TEST 4: Có đáp án C -> correctAnswer = C", () => {
    const raw = `PHẦN I
Câu 1. 2 + 3 bằng mấy?
A. 1.
B. 4.
*C. 5.
D. 6.`;
    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(1);
    expect(exam.partI[0].answer).toBe("C");
    expect(isQuestionMissingAnswer(exam.partI[0])).toBe(false);
  });

  // TEST 5 – Có đáp án D
  it("TEST 5: Có đáp án D -> correctAnswer = D", () => {
    const raw = `PHẦN I
Câu 1. 10 - 2 bằng mấy?
A. 5.
B. 6.
C. 7.
*D. 8.`;
    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(1);
    expect(exam.partI[0].answer).toBe("D");
    expect(isQuestionMissingAnswer(exam.partI[0])).toBe(false);
  });

  // TEST 6 – Đề có 20 câu, trong đó 3 câu thiếu đáp án
  it("TEST 6: Đề có 20 câu, trong đó 3 câu thiếu đáp án -> báo chính xác 3 câu thiếu đáp án và liệt kê đúng số câu", () => {
    const lines = ["PHẦN I"];
    for (let i = 1; i <= 20; i++) {
      lines.push(`Câu ${i}. Nội dung câu hỏi số ${i}`);
      if (i === 3 || i === 8 || i === 15) {
        // Missing answer
        lines.push("A. Phương án A");
        lines.push("B. Phương án B");
        lines.push("C. Phương án C");
        lines.push("D. Phương án D");
      } else {
        // Has answer B
        lines.push("A. Phương án A");
        lines.push("*B. Phương án B");
        lines.push("C. Phương án C");
        lines.push("D. Phương án D");
      }
    }
    const exam = parseTextExam(lines.join("\n"));
    expect(exam.partI.length).toBe(20);

    const missing = getMissingAnswerQuestions(exam);
    expect(missing.length).toBe(3);
    expect(missing.map((m) => m.idx + 1)).toEqual([3, 8, 15]);
    expect(missing.map((m) => m.label)).toEqual([
      "Câu 3 – Phần I",
      "Câu 8 – Phần I",
      "Câu 15 – Phần I",
    ]);

    // Check specific answers
    expect(exam.partI[2].answer).toBeNull(); // Câu 3
    expect(exam.partI[7].answer).toBeNull(); // Câu 8
    expect(exam.partI[14].answer).toBeNull(); // Câu 15
    expect(exam.partI[0].answer).toBe("B"); // Câu 1
    expect(exam.partI[1].answer).toBe("B"); // Câu 2
  });

  // TEST 7 – Một đề hoàn toàn không có đáp án
  it("TEST 7: Một đề hoàn toàn không có đáp án -> không có câu nào tự động chọn đáp án", () => {
    const raw = `PHẦN I
Câu 1. Câu hỏi 1 không có đáp án
A. Lựa chọn 1
B. Lựa chọn 2
C. Lựa chọn 3
D. Lựa chọn 4
Câu 2. Câu hỏi 2 không có đáp án
A. Lựa chọn 1
B. Lựa chọn 2
C. Lựa chọn 3
D. Lựa chọn 4
Câu 3. Câu hỏi 3 không có đáp án
A. Lựa chọn 1
B. Lựa chọn 2
C. Lựa chọn 3
D. Lựa chọn 4
PHẦN II
Câu 1. Cho các mệnh đề sau:
a) Mệnh đề 1
b) Mệnh đề 2
c) Mệnh đề 3
d) Mệnh đề 4
PHẦN III
Câu 1. Tính giá trị của biểu thức A`;

    const exam = parseTextExam(raw);
    expect(exam.partI.length).toBe(3);
    expect(exam.partII.length).toBe(1);
    expect(exam.partIII.length).toBe(1);

    // Verify all Part I questions have answer === null (none defaulted to A)
    expect(exam.partI.every((q) => q.answer === null)).toBe(true);

    // Verify Part II items have correct === null (none defaulted to false/Sai or true/Đúng)
    expect(exam.partII[0].items.every((it) => it.correct === null)).toBe(true);

    // Verify Part III has empty answer
    expect(exam.partIII[0].answer).toBe("");

    // Missing questions count should be 5
    const missing = getMissingAnswerQuestions(exam);
    expect(missing.length).toBe(5);
  });

  // TEST 8 - DOCX file without answer marks
  it("TEST 8: DOCX file with unmarked options preserves answer: null and does NOT fallback to A", async () => {
    const bodyXml = `
      <w:p><w:r><w:t>PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Cho hàm số y = f(x) liên tục trên đoạn [a; b].</w:t></w:r></w:p>
      <w:p><w:r><w:t>A. Phương án 1</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Phương án 2</w:t></w:r></w:p>
      <w:p><w:r><w:t>C. Phương án 3</w:t></w:r></w:p>
      <w:p><w:r><w:t>D. Phương án 4</w:t></w:r></w:p>
    `;
    const docx = await createMockDocx(bodyXml);
    const parsed = await parseDocx(docx);

    expect(parsed.partI.length).toBe(1);
    expect(parsed.partI[0].answer).toBeNull();
    expect(isQuestionMissingAnswer(parsed.partI[0])).toBe(true);
  });

  // TEST 9 - DOCX file with underlined answer C
  it("TEST 9: DOCX file with underlined or red answer C preserves answer: C", async () => {
    const bodyXml = `
      <w:p><w:r><w:t>PHẦN I</w:t></w:r></w:p>
      <w:p><w:r><w:t>Câu 1. Câu hỏi mẫu với đáp án C gạch chân</w:t></w:r></w:p>
      <w:p><w:r><w:t>A. Lựa chọn A</w:t></w:r></w:p>
      <w:p><w:r><w:t>B. Lựa chọn B</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>C. Lựa chọn C</w:t></w:r></w:p>
      <w:p><w:r><w:t>D. Lựa chọn D</w:t></w:r></w:p>
    `;
    const docx = await createMockDocx(bodyXml);
    const parsed = await parseDocx(docx);

    expect(parsed.partI.length).toBe(1);
    expect(parsed.partI[0].answer).toBe("C");
    expect(isQuestionMissingAnswer(parsed.partI[0])).toBe(false);
  });

  // TEST 10 - Shuffle does not convert null answer into A
  it("TEST 10: ShuffleEngine does not turn answer: null into A", () => {
    const q: any = {
      type: "mc",
      id: "q1",
      text: "Câu hỏi chưa có đáp án",
      options: [
        { key: "A", text: "Phương án 1" },
        { key: "B", text: "Phương án 2" },
        { key: "C", text: "Phương án 3" },
        { key: "D", text: "Phương án 4" },
      ],
      answer: null,
    };
    const shuffled = shuffleMC(q, { shuffle_o_p1: true });
    expect(shuffled.answer).toBeNull();
  });
});
