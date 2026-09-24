import { describe, it, expect } from "vitest";
import {
  isHetLine,
  isExplHeader,
  parseTFVal,
  findPartIIRowIndices,
  parseAnswerKeySection,
  parseExplSection,
  parsePostHetSection,
  type MCQuestion,
  type TFQuestion,
  type SAQuestion,
} from "../lib/docxParser";

describe("DOCX Parser - Post HẾT & New Format Recognition", () => {
  it("nhận dạng chính xác dòng ranh giới HẾT", () => {
    expect(isHetLine("---------------------------HẾT------------------------")).toBe(true);
    expect(isHetLine("--------- HẾT ---------")).toBe(true);
    expect(isHetLine("--- HẾT ---")).toBe(true);
    expect(isHetLine("HẾT")).toBe(true);
    expect(isHetLine("HẾT.")).toBe(true);
    expect(isHetLine("--- HET ---")).toBe(true);
    expect(isHetLine("=== HẾT ===")).toBe(true);

    // Không nhận dạng nhầm các dòng câu hỏi hoặc nội dung khác
    expect(isHetLine("Câu 1. Hàm số y = f(x) đồng biến trên R")).toBe(false);
    expect(isHetLine("PHẦN I. TRẮC NGHIỆM")).toBe(false);
    expect(isHetLine("Hết sức chú ý không làm ẩu")).toBe(false);
    expect(isHetLine("HẾT GIỜ LÀM BÀI")).toBe(false);
  });

  it("nhận dạng tiêu đề Lời giải / Hướng dẫn giải", () => {
    expect(isExplHeader("LỜI GIẢI")).toBe(true);
    expect(isExplHeader("LỜI GIẢI CHI TIẾT")).toBe(true);
    expect(isExplHeader("HƯỚNG DẪN GIẢI")).toBe(true);
    expect(isExplHeader("GIẢI CHI TIẾT")).toBe(true);
    expect(isExplHeader("ĐÁP ÁN VÀ LỜI GIẢI CHI TIẾT")).toBe(true);
    expect(isExplHeader("PHẦN I")).toBe(false);
  });

  it("nhận dạng giá trị Đúng (Đ) / Sai (S)", () => {
    expect(parseTFVal("Đ")).toBe(true);
    expect(parseTFVal("đ")).toBe(true);
    expect(parseTFVal("a) Đ")).toBe(true);
    expect(parseTFVal("S")).toBe(false);
    expect(parseTFVal("s")).toBe(false);
    expect(parseTFVal("b) S")).toBe(false);
  });

  it("nhận dạng đáp án Phần II theo CỘT chính xác 100%", () => {
    // 4 câu hỏi Phần II ban đầu
    const partII: TFQuestion[] = [
      {
        type: "tf",
        id: "q1",
        text: "Câu 1 stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q2",
        text: "Câu 2 stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q3",
        text: "Câu 3 stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q4",
        text: "Câu 4 stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
    ];

    // Bảng đáp án Phần II dạng bảng (Word Table grid):
    // 1    2    3    4
    // a) Đ a) Đ a) Đ a) Đ
    // b) S b) S b) S b) S
    // c) S c) S c) Đ c) S
    // d) Đ d) S d) Đ d) S
    const tableGrid = [
      ["Câu", "1", "2", "3", "4"],
      ["a)", "Đ", "Đ", "Đ", "Đ"],
      ["b)", "S", "S", "S", "S"],
      ["c)", "S", "S", "Đ", "S"],
      ["d)", "Đ", "S", "Đ", "S"],
    ];

    const tfIndices = findPartIIRowIndices(tableGrid);
    expect(tfIndices).not.toBeNull();
    expect(tfIndices!.rowA).toBe(1);
    expect(tfIndices!.rowB).toBe(2);
    expect(tfIndices!.rowC).toBe(3);
    expect(tfIndices!.rowD).toBe(4);
    expect(tfIndices!.headerRow).toBe(0);

    const paras = [
      {
        toks: [{ kind: "tbl" as const, rows: tableGrid }],
        plain: " ",
        rich: " ",
        hasAnyMark: false,
      },
    ];

    parseAnswerKeySection(paras, [], partII, []);

    // Cột 1 -> Câu 1: a=Đ, b=S, c=S, d=Đ
    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, false, true]);

    // Cột 2 -> Câu 2: a=Đ, b=S, c=S, d=S
    expect(partII[1].items.map((x) => x.correct)).toEqual([true, false, false, false]);

    // Cột 3 -> Câu 3: a=Đ, b=S, c=Đ, d=Đ
    expect(partII[2].items.map((x) => x.correct)).toEqual([true, false, true, true]);

    // Cột 4 -> Câu 4: a=Đ, b=S, c=S, d=S
    expect(partII[3].items.map((x) => x.correct)).toEqual([true, false, false, false]);
  });

  it("nhận dạng đáp án Phần II dạng đoạn văn bản (text paragraph)", () => {
    const partII: TFQuestion[] = [
      {
        type: "tf",
        id: "q1",
        text: "Câu 1",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q2",
        text: "Câu 2",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
    ];

    const paras = [
      { toks: [{ kind: "text" as const, text: "PHẦN II", props: { red: false, underline: false, mono: false, bold: false } }], plain: "PHẦN II", rich: "PHẦN II", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "1\t2", props: { red: false, underline: false, mono: false, bold: false } }], plain: "1\t2", rich: "1\t2", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "a) Đ\ta) S", props: { red: false, underline: false, mono: false, bold: false } }], plain: "a) Đ\ta) S", rich: "a) Đ\ta) S", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "b) S\tb) Đ", props: { red: false, underline: false, mono: false, bold: false } }], plain: "b) S\tb) Đ", rich: "b) S\tb) Đ", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "c) Đ\tc) Đ", props: { red: false, underline: false, mono: false, bold: false } }], plain: "c) Đ\tc) Đ", rich: "c) Đ\tc) Đ", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "d) S\td) S", props: { red: false, underline: false, mono: false, bold: false } }], plain: "d) S\td) S", rich: "d) S\td) S", hasAnyMark: false },
    ];

    parseAnswerKeySection(paras, [], partII, []);

    // Cột 1 -> Câu 1: a=Đ (true), b=S (false), c=Đ (true), d=S (false)
    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    // Cột 2 -> Câu 2: a=S (false), b=Đ (true), c=Đ (true), d=S (false)
    expect(partII[1].items.map((x) => x.correct)).toEqual([false, true, true, false]);
  });

  it("nhận dạng đáp án Phần I và Phần III sau HẾT", () => {
    const partI: MCQuestion[] = [
      { type: "mc", id: "q1", text: "Câu 1", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "A" },
      { type: "mc", id: "q2", text: "Câu 2", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "A" },
      { type: "mc", id: "q3", text: "Câu 3", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "A" },
      { type: "mc", id: "q4", text: "Câu 4", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "A" },
    ];

    const partIII: SAQuestion[] = [
      { type: "sa", id: "q5", text: "Câu 1 Phần III", answer: "" },
      { type: "sa", id: "q6", text: "Câu 2 Phần III", answer: "" },
    ];

    // Pattern:
    // Câu 1 2 3 4
    // Chọn D A B C
    const paras = [
      { toks: [], plain: "PHẦN I", rich: "PHẦN I", hasAnyMark: false },
      { toks: [], plain: "Câu 1 2 3 4", rich: "Câu 1 2 3 4", hasAnyMark: false },
      { toks: [], plain: "Chọn D A B C", rich: "Chọn D A B C", hasAnyMark: false },
      { toks: [], plain: "PHẦN III", rich: "PHẦN III", hasAnyMark: false },
      { toks: [], plain: "Câu 1 2", rich: "Câu 1 2", hasAnyMark: false },
      { toks: [], plain: "Chọn 10 31", rich: "Chọn 10 31", hasAnyMark: false },
    ];

    parseAnswerKeySection(paras, partI, [], partIII);

    expect(partI[0].answer).toBe("D");
    expect(partI[1].answer).toBe("A");
    expect(partI[2].answer).toBe("B");
    expect(partI[3].answer).toBe("C");

    expect(partIII[0].answer).toBe("10");
    expect(partIII[1].answer).toBe("31");
  });

  it("ghép Lời giải sau HẾT vào đúng câu và KHÔNG tạo câu hỏi mới", () => {
    const partI: MCQuestion[] = [
      { type: "mc", id: "q1", text: "Câu 1", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "D" },
      { type: "mc", id: "q2", text: "Câu 2", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "A" },
    ];
    const partII: TFQuestion[] = [
      {
        type: "tf",
        id: "q3",
        text: "Câu 1 Phần II",
        items: [
          { key: "a", text: "Ý a", correct: true },
          { key: "b", text: "Ý b", correct: false },
        ],
      },
    ];

    const explParas = [
      { toks: [], plain: "LỜI GIẢI CHI TIẾT", rich: "LỜI GIẢI CHI TIẾT", hasAnyMark: false },
      { toks: [], plain: "PHẦN I", rich: "PHẦN I", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 1. Lời giải chi tiết câu 1...", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 1. Lời giải chi tiết câu 1...", rich: "Câu 1. Lời giải chi tiết câu 1...", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Do đó chọn đáp án D.", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Do đó chọn đáp án D.", rich: "Do đó chọn đáp án D.", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 2. Giải thích câu 2", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 2. Giải thích câu 2", rich: "Câu 2. Giải thích câu 2", hasAnyMark: false },
      { toks: [], plain: "PHẦN II", rich: "PHẦN II", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 1. Lời giải ý a đúng vì... ý b sai vì...", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 1. Lời giải ý a đúng vì... ý b sai vì...", rich: "Câu 1. Lời giải ý a đúng vì... ý b sai vì...", hasAnyMark: false },
    ];

    parseExplSection(explParas, partI, partII, []);

    // Không làm tăng số lượng câu hỏi
    expect(partI.length).toBe(2);
    expect(partII.length).toBe(1);

    // Ghép đúng lời giải
    expect(partI[0].explanation).toContain("Lời giải chi tiết câu 1");
    expect(partI[0].explanation).toContain("Do đó chọn đáp án D");
    expect(partI[1].explanation).toContain("Giải thích câu 2");
    expect(partII[0].explanation).toContain("Lời giải ý a đúng vì");
  });

  it("khớp toàn bộ Đề thi với Đáp án và Lời giải qua parsePostHetSection", () => {
    const partI: MCQuestion[] = [
      { type: "mc", id: "q1", text: "Câu 1 stem", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "" },
      { type: "mc", id: "q2", text: "Câu 2 stem", options: [{ key: "A", text: "A" }, { key: "B", text: "B" }, { key: "C", text: "C" }, { key: "D", text: "D" }], answer: "" },
    ];

    const partII: TFQuestion[] = [
      {
        type: "tf",
        id: "q3",
        text: "Câu 1 Phần II",
        items: [
          { key: "a", text: "Ý a", correct: false, order: 0, level: "NB" },
          { key: "b", text: "Ý b", correct: false, order: 1, level: "NB" },
          { key: "c", text: "Ý c", correct: false, order: 2, level: "TH" },
          { key: "d", text: "Ý d", correct: false, order: 3, level: "VD" },
        ],
      },
    ];

    const partIII: SAQuestion[] = [
      { type: "sa", id: "q4", text: "Câu 1 Phần III", answer: "" },
    ];

    const postHetParas = [
      // BẢNG ĐÁP ÁN
      { toks: [], plain: "BẢNG ĐÁP ÁN", rich: "BẢNG ĐÁP ÁN", hasAnyMark: false },
      { toks: [], plain: "PHẦN I", rich: "PHẦN I", hasAnyMark: false },
      { toks: [], plain: "Câu 1 2", rich: "Câu 1 2", hasAnyMark: false },
      { toks: [], plain: "Chọn C B", rich: "Chọn C B", hasAnyMark: false },
      { toks: [], plain: "PHẦN II", rich: "PHẦN II", hasAnyMark: false },
      { toks: [], plain: "1", rich: "1", hasAnyMark: false },
      { toks: [], plain: "a) Đ", rich: "a) Đ", hasAnyMark: false },
      { toks: [], plain: "b) S", rich: "b) S", hasAnyMark: false },
      { toks: [], plain: "c) Đ", rich: "c) Đ", hasAnyMark: false },
      { toks: [], plain: "d) S", rich: "d) S", hasAnyMark: false },
      { toks: [], plain: "PHẦN III", rich: "PHẦN III", hasAnyMark: false },
      { toks: [], plain: "Câu 1", rich: "Câu 1", hasAnyMark: false },
      { toks: [], plain: "Chọn 42", rich: "Chọn 42", hasAnyMark: false },
      // LỜI GIẢI
      { toks: [], plain: "LỜI GIẢI CHI TIẾT", rich: "LỜI GIẢI CHI TIẾT", hasAnyMark: false },
      { toks: [], plain: "PHẦN I", rich: "PHẦN I", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 1. Lời giải câu 1 trắc nghiệm", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 1. Lời giải câu 1 trắc nghiệm", rich: "Câu 1. Lời giải câu 1 trắc nghiệm", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 2. Lời giải câu 2 trắc nghiệm", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 2. Lời giải câu 2 trắc nghiệm", rich: "Câu 2. Lời giải câu 2 trắc nghiệm", hasAnyMark: false },
      { toks: [], plain: "PHẦN II", rich: "PHẦN II", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 1. Lời giải đúng sai câu 1", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 1. Lời giải đúng sai câu 1", rich: "Câu 1. Lời giải đúng sai câu 1", hasAnyMark: false },
      { toks: [], plain: "PHẦN III", rich: "PHẦN III", hasAnyMark: false },
      { toks: [{ kind: "text" as const, text: "Câu 1. Lời giải trả lời ngắn câu 1", props: { red: false, underline: false, mono: false, bold: false } }], plain: "Câu 1. Lời giải trả lời ngắn câu 1", rich: "Câu 1. Lời giải trả lời ngắn câu 1", hasAnyMark: false },
    ];

    parsePostHetSection(postHetParas, partI, partII, partIII);

    // Phần I
    expect(partI[0].answer).toBe("C");
    expect(partI[0].explanation).toBe("Lời giải câu 1 trắc nghiệm");
    expect(partI[1].answer).toBe("B");
    expect(partI[1].explanation).toBe("Lời giải câu 2 trắc nghiệm");

    // Phần II
    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(partII[0].explanation).toBe("Lời giải đúng sai câu 1");
    expect(partII[0].items[0].order).toBe(0);
    expect(partII[0].items[0].level).toBe("NB");

    // Phần III
    expect(partIII[0].answer).toBe("42");
    expect(partIII[0].explanation).toBe("Lời giải trả lời ngắn câu 1");

    // Tuyệt đối không tạo câu hỏi mới
    expect(partI.length).toBe(2);
    expect(partII.length).toBe(1);
    expect(partIII.length).toBe(1);
  });

  it("nhận dạng chính xác bảng đáp án Phần II và Phần III theo đúng định dạng ảnh người dùng cung cấp", () => {
    // 4 câu Phần II
    const partII: TFQuestion[] = [
      {
        type: "tf",
        id: "q1",
        text: "Câu 1 Stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q2",
        text: "Câu 2 Stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q3",
        text: "Câu 3 Stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
      {
        type: "tf",
        id: "q4",
        text: "Câu 4 Stem",
        items: [
          { key: "a", text: "Ý a", correct: false },
          { key: "b", text: "Ý b", correct: false },
          { key: "c", text: "Ý c", correct: false },
          { key: "d", text: "Ý d", correct: false },
        ],
      },
    ];

    // 6 câu Phần III
    const partIII: SAQuestion[] = [
      { type: "sa", id: "sa1", text: "Câu 1", answer: "" },
      { type: "sa", id: "sa2", text: "Câu 2", answer: "" },
      { type: "sa", id: "sa3", text: "Câu 3", answer: "" },
      { type: "sa", id: "sa4", text: "Câu 4", answer: "" },
      { type: "sa", id: "sa5", text: "Câu 5", answer: "" },
      { type: "sa", id: "sa6", text: "Câu 6", answer: "" },
    ];

    // Khớp y nguyên Hình 1:
    // PHẦN II
    // Điểm tối đa của 01 câu hỏi là 1 điểm...
    // Bảng 4 cột:
    // Câu 1. | Câu 2. | Câu 3. | Câu 4.
    // a) Đ   | a) Đ   | a) Đ   | a) Đ
    // b) S   | b) S   | b) S   | b) S
    // c) S   | c) S   | c) Đ   | c) S
    // d) Đ   | d) S   | d) Đ   | d) S
    const tableImage1 = [
      ["Câu 1.", "Câu 2.", "Câu 3.", "Câu 4."],
      ["a) Đ", "a) Đ", "a) Đ", "a) Đ"],
      ["b) S", "b) S", "b) S", "b) S"],
      ["c) S", "c) S", "c) Đ", "c) S"],
      ["d) Đ", "d) S", "d) Đ", "d) S"],
    ];

    // Khớp y nguyên Hình 2:
    // PHẦN III
    // (Mỗi câu trả lời Đúng thí sinh Được 0,5 Điểm)
    // Bảng 7 cột:
    // Câu  | 1  | 2  | 3  | 4  | 5  | 6
    // Chọn | 10 | 31 | 21 | 50 | 45 | 3
    const tableImage2 = [
      ["Câu", "1", "2", "3", "4", "5", "6"],
      ["Chọn", "10", "31", "21", "50", "45", "3"],
    ];

    const postHetParas = [
      { toks: [], plain: "PHẦN II", rich: "PHẦN II", hasAnyMark: false },
      { toks: [], plain: "Điểm tối đa của 01 câu hỏi là 1 điểm.", rich: "Điểm tối đa của 01 câu hỏi là 1 điểm.", hasAnyMark: false },
      { toks: [], plain: "□Thí sinh chỉ lựa chọn chính xác 01 ý trong 1 câu hỏi được 0,1 điểm.", rich: "□Thí sinh chỉ lựa chọn chính xác 01 ý trong 1 câu hỏi được 0,1 điểm.", hasAnyMark: false },
      {
        toks: [{ kind: "tbl" as const, rows: tableImage1 }],
        plain: " ",
        rich: " ",
        hasAnyMark: false,
      },
      { toks: [], plain: "PHẦN III", rich: "PHẦN III", hasAnyMark: false },
      { toks: [], plain: "(Mỗi câu trả lời Đúng thí sinh Được 0,5 Điểm)", rich: "(Mỗi câu trả lời Đúng thí sinh Được 0,5 Điểm)", hasAnyMark: false },
      {
        toks: [{ kind: "tbl" as const, rows: tableImage2 }],
        plain: " ",
        rich: " ",
        hasAnyMark: false,
      },
    ];

    parsePostHetSection(postHetParas, [], partII, partIII);

    // Kiểm tra kết quả Phần II theo đúng Hình 1:
    // Câu 1: a=Đ(true), b=S(false), c=S(false), d=Đ(true)
    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, false, true]);
    // Câu 2: a=Đ(true), b=S(false), c=S(false), d=S(false)
    expect(partII[1].items.map((x) => x.correct)).toEqual([true, false, false, false]);
    // Câu 3: a=Đ(true), b=S(false), c=Đ(true), d=Đ(true)
    expect(partII[2].items.map((x) => x.correct)).toEqual([true, false, true, true]);
    // Câu 4: a=Đ(true), b=S(false), c=S(false), d=S(false)
    expect(partII[3].items.map((x) => x.correct)).toEqual([true, false, false, false]);

    // Kiểm tra kết quả Phần III theo đúng Hình 2:
    expect(partIII[0].answer).toBe("10");
    expect(partIII[1].answer).toBe("31");
    expect(partIII[2].answer).toBe("21");
    expect(partIII[3].answer).toBe("50");
    expect(partIII[4].answer).toBe("45");
    expect(partIII[5].answer).toBe("3");
  });

  it("nhận dạng Phần II và Phần III khi số thứ tự câu hỏi đánh số liên tục (13..16 và 17..22)", () => {
    const partII: TFQuestion[] = [
      { type: "tf", id: "q13", text: "Câu 13", items: [{ key: "a", text: "", correct: false }, { key: "b", text: "", correct: false }, { key: "c", text: "", correct: false }, { key: "d", text: "", correct: false }] },
      { type: "tf", id: "q14", text: "Câu 14", items: [{ key: "a", text: "", correct: false }, { key: "b", text: "", correct: false }, { key: "c", text: "", correct: false }, { key: "d", text: "", correct: false }] },
      { type: "tf", id: "q15", text: "Câu 15", items: [{ key: "a", text: "", correct: false }, { key: "b", text: "", correct: false }, { key: "c", text: "", correct: false }, { key: "d", text: "", correct: false }] },
      { type: "tf", id: "q16", text: "Câu 16", items: [{ key: "a", text: "", correct: false }, { key: "b", text: "", correct: false }, { key: "c", text: "", correct: false }, { key: "d", text: "", correct: false }] },
    ];
    const partIII: SAQuestion[] = [
      { type: "sa", id: "q17", text: "Câu 17", answer: "" },
      { type: "sa", id: "q18", text: "Câu 18", answer: "" },
      { type: "sa", id: "q19", text: "Câu 19", answer: "" },
      { type: "sa", id: "q20", text: "Câu 20", answer: "" },
      { type: "sa", id: "q21", text: "Câu 21", answer: "" },
      { type: "sa", id: "q22", text: "Câu 22", answer: "" },
    ];

    const tablePart2 = [
      ["Câu 13", "Câu 14", "Câu 15", "Câu 16"],
      ["a) Đ", "a) S", "a) Đ", "a) S"],
      ["b) S", "b) Đ", "b) S", "b) Đ"],
      ["c) Đ", "c) S", "c) Đ", "c) S"],
      ["d) S", "d) Đ", "d) S", "d) Đ"],
    ];

    const tablePart3 = [
      ["Câu", "17", "18", "19", "20", "21", "22"],
      ["Đáp án", "2,5", "-1/2", "100", "0,25", "3.14", "8"],
    ];

    const paras = [
      { toks: [{ kind: "tbl" as const, rows: tablePart2 }], plain: " ", rich: " ", hasAnyMark: false },
      { toks: [{ kind: "tbl" as const, rows: tablePart3 }], plain: " ", rich: " ", hasAnyMark: false },
    ];

    parsePostHetSection(paras, [], partII, partIII);

    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(partII[1].items.map((x) => x.correct)).toEqual([false, true, false, true]);
    expect(partII[2].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(partII[3].items.map((x) => x.correct)).toEqual([false, true, false, true]);

    expect(partIII[0].answer).toBe("2,5");
    expect(partIII[1].answer).toBe("-1/2");
    expect(partIII[2].answer).toBe("100");
    expect(partIII[3].answer).toBe("0,25");
    expect(partIII[4].answer).toBe("3.14");
    expect(partIII[5].answer).toBe("8");
  });
});
