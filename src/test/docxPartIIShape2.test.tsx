import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JSZip from "jszip";
import {
  parseDocx,
  parseAnswerKeySection,
  findPartIIRowIndices,
  type MCQuestion,
  type TFQuestion,
  type SAQuestion,
} from "@/lib/docxParser";
import {
  buildScale100Scoring,
  DEFAULT_PART_II_RATES,
  gradeExam,
} from "@/lib/grading";
import Result from "@/pages/Result";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "mocked-offline" } }),
    from: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function runXml(text: string, opts?: { bold?: boolean; underline?: boolean; red?: boolean }) {
  const rPrParts: string[] = [];
  if (opts?.bold) rPrParts.push("<w:b/>");
  if (opts?.underline) rPrParts.push('<w:u w:val="single"/>');
  if (opts?.red) rPrParts.push('<w:color w:val="FF0000"/>');
  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

function paraXml(inner: string) {
  return `<w:p>${inner}</w:p>`;
}

type CellSpec =
  | string
  | {
      text: string;
      bold?: boolean;
      underline?: boolean;
      red?: boolean;
      gridSpan?: number;
      vMerge?: "restart" | "continue";
      width?: number;
    };

function cellXml(spec: CellSpec) {
  const obj = typeof spec === "string" ? { text: spec } : spec;
  const tcPrParts: string[] = [];
  if (obj.width) tcPrParts.push(`<w:tcW w:w="${obj.width}" w:type="dxa"/>`);
  if (obj.gridSpan && obj.gridSpan > 1) tcPrParts.push(`<w:gridSpan w:val="${obj.gridSpan}"/>`);
  if (obj.vMerge === "restart") tcPrParts.push('<w:vMerge w:val="restart"/>');
  else if (obj.vMerge === "continue") tcPrParts.push("<w:vMerge/>");
  const tcPr = tcPrParts.length ? `<w:tcPr>${tcPrParts.join("")}</w:tcPr>` : "";
  return `<w:tc>${tcPr}${paraXml(runXml(obj.text, obj))}</w:tc>`;
}

function tableXml(rows: CellSpec[][]) {
  return `<w:tbl>${rows.map((r) => `<w:tr>${r.map(cellXml).join("")}</w:tr>`).join("")}</w:tbl>`;
}

async function parseDocxXmlNodes(bodyNodes: string[]) {
  const xml = `<?xml version="1.0"?><w:document ${W_NS}><w:body>${bodyNodes.join("")}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  const file = {
    arrayBuffer: async () => blob,
  } as unknown as File;
  return parseDocx(file);
}

function tfQuestionBody(num: number) {
  return [
    paraXml(runXml(`Câu ${num}. Xét tính đúng sai của các mệnh đề sau:`)),
    paraXml(runXml(`a) Mệnh đề a của câu ${num}`)),
    paraXml(runXml(`b) Mệnh đề b của câu ${num}`)),
    paraXml(runXml(`c) Mệnh đề c của câu ${num}`)),
    paraXml(runXml(`d) Mệnh đề d của câu ${num}`)),
  ];
}

function mcQuestionBody(num: number) {
  return [
    paraXml(runXml(`Câu ${num}. Nội dung câu hỏi trắc nghiệm ${num}?`)),
    paraXml(runXml("A. Phương án A   B. Phương án B   C. Phương án C   D. Phương án D")),
  ];
}

function saQuestionBody(num: number) {
  return [paraXml(runXml(`Câu ${num}. Tính giá trị biểu thức câu ${num}?`))];
}

function makeTFPlaceholders(count: number): TFQuestion[] {
  return Array.from({ length: count }, (_, idx) => ({
    type: "tf",
    id: `q_tf_${idx + 1}`,
    text: `Câu ${idx + 1}`,
    items: [
      { key: "a", text: "Ý a", correct: null },
      { key: "b", text: "Ý b", correct: null },
      { key: "c", text: "Ý c", correct: null },
      { key: "d", text: "Ý d", correct: null },
    ],
  }));
}

describe("DOCX Parser - Bảng đáp án Phần II Hình 2 & Tương thích ngược", () => {
  it("Kiểm thử 1: Bảng đáp án theo cấu trúc Hình 1 (hàng a,b,c,d - cột Câu 1..4) vẫn nhận dạng chính xác 100%", async () => {
    const tableGrid = [
      ["Câu", "1", "2", "3", "4"],
      ["a)", "Đ", "Đ", "Đ", "Đ"],
      ["b)", "S", "S", "S", "S"],
      ["c)", "S", "S", "Đ", "S"],
      ["d)", "Đ", "S", "Đ", "S"],
    ];

    expect(findPartIIRowIndices(tableGrid)).not.toBeNull();

    const partII = makeTFPlaceholders(4);
    parseAnswerKeySection(
      [{ toks: [{ kind: "tbl", rows: tableGrid }], plain: " ", rich: " ", hasAnyMark: false }],
      [],
      partII,
      []
    );

    expect(partII[0].items.map((x) => x.correct)).toEqual([true, false, false, true]);
    expect(partII[1].items.map((x) => x.correct)).toEqual([true, false, false, false]);
    expect(partII[2].items.map((x) => x.correct)).toEqual([true, false, true, true]);
    expect(partII[3].items.map((x) => x.correct)).toEqual([true, false, false, false]);

    // Cũng kiểm tra trên file DOCX thực với ô inline "a) Đ ... d) S"
    const parsed = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II. TRẮC NGHIỆM ĐÚNG SAI")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("--------- HẾT ---------")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        ["1", "2", "3", "4"],
        ["a) Đ", "a) Đ", "a) Đ", "a) Đ"],
        ["b) S", "b) S", "b) S", "b) S"],
        ["c) S", "c) S", "c) Đ", "c) S"],
        ["d) Đ", "d) S", "d) Đ", "d) S"],
      ]),
    ]);

    expect(parsed.partII).toHaveLength(4);
    expect(parsed.partII[0].items.map((x) => x.correct)).toEqual([true, false, false, true]);
    expect(parsed.partII[1].items.map((x) => x.correct)).toEqual([true, false, false, false]);
    expect(parsed.partII[2].items.map((x) => x.correct)).toEqual([true, false, true, true]);
    expect(parsed.partII[3].items.map((x) => x.correct)).toEqual([true, false, false, false]);
  });

  it("Kiểm thử 2: Bảng đáp án theo cấu trúc Hình 2 (cột a,b,c,d - hàng Câu 1..N) với đầy đủ biến thể, định dạng Word, merge ô và đánh số liên tiếp", async () => {
    // Biến thể A: Tiêu đề chuẩn "| Câu | a) | b) | c) | d) |" trong DOCX
    const parsedA = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II. CÂU TRẮC NGHIỆM ĐÚNG SAI")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("--- HẾT ---")),
      paraXml(runXml("ĐÁP ÁN PHẦN II")),
      tableXml([
        ["Câu", "a)", "b)", "c)", "d)"],
        ["Câu 1", "Đ", "Đ", "Đ", "Đ"],
        ["Câu 2", "S", "Đ", "Đ", "S"],
        ["Câu 3", "Đ", "Đ", "S", "Đ"],
        ["Câu 4", "S", "S", "Đ", "Đ"],
      ]),
    ]);

    expect(parsedA.partII).toHaveLength(4);
    expect(parsedA.partII[0].items.map((x) => x.correct)).toEqual([true, true, true, true]);
    expect(parsedA.partII[1].items.map((x) => x.correct)).toEqual([false, true, true, false]);
    expect(parsedA.partII[2].items.map((x) => x.correct)).toEqual([true, true, false, true]);
    expect(parsedA.partII[3].items.map((x) => x.correct)).toEqual([false, false, true, true]);
    expect(parsedA.answerWarnings).toBeUndefined();

    // Biến thể B: Tiêu đề "| Câu hỏi | Đáp án a | Đáp án b | Đáp án c | Đáp án d |"
    // + độ rộng cột không đều + định dạng in đậm, gạch chân, tô màu đỏ
    const parsedB = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("HẾT")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        [
          { text: "Câu hỏi", bold: true, width: 2800 },
          { text: "Đáp án a", bold: true, width: 1200 },
          { text: "Đáp án b", bold: true, width: 1500 },
          { text: "Đáp án c", bold: true, width: 1100 },
          { text: "Đáp án d", bold: true, width: 1900 },
        ],
        [
          { text: "Câu 1", bold: true },
          { text: "Đ", bold: true, red: true },
          { text: "S", underline: true },
          { text: "Đúng", red: true },
          { text: "Sai", bold: true },
        ],
        ["Câu 2", "S", "S", "Đ", "Đ"],
        ["Câu 3", "Đ", "S", "S", "Đ"],
        ["Câu 4", "S", "Đ", "S", "S"],
      ]),
    ]);

    expect(parsedB.partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(parsedB.partII[1].items.map((x) => x.correct)).toEqual([false, false, true, true]);
    expect(parsedB.partII[2].items.map((x) => x.correct)).toEqual([true, false, false, true]);
    expect(parsedB.partII[3].items.map((x) => x.correct)).toEqual([false, true, false, false]);

    // Biến thể C: Merge ô tiêu đề (w:vMerge + w:gridSpan=4) + đánh số liên tiếp Câu 19..22 sau 18 câu Phần I
    const partINodes18: string[] = [paraXml(runXml("PHẦN I"))];
    for (let i = 1; i <= 18; i++) partINodes18.push(...mcQuestionBody(i));

    const parsedC = await parseDocxXmlNodes([
      ...partINodes18,
      paraXml(runXml("PHẦN II")),
      ...tfQuestionBody(19),
      ...tfQuestionBody(20),
      ...tfQuestionBody(21),
      ...tfQuestionBody(22),
      paraXml(runXml("--- HẾT ---")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        [
          { text: "Câu hỏi", vMerge: "restart", bold: true },
          { text: "Đáp án đúng / sai theo ý", gridSpan: 4, bold: true },
        ],
        [
          { text: "", vMerge: "continue" },
          "Ý a",
          "Ý b",
          "Ý c",
          "Ý d",
        ],
        ["Câu 19", "Đ", "S", "Đ", "S"],
        ["Câu 20", "S", "Đ", "S", "Đ"],
        ["Câu 21", "Đ", "Đ", "S", "S"],
        ["Câu 22", "S", "S", "Đ", "Đ"],
      ]),
    ]);

    expect(parsedC.partI).toHaveLength(18);
    expect(parsedC.partII).toHaveLength(4);
    expect(parsedC.partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(parsedC.partII[1].items.map((x) => x.correct)).toEqual([false, true, false, true]);
    expect(parsedC.partII[2].items.map((x) => x.correct)).toEqual([true, true, false, false]);
    expect(parsedC.partII[3].items.map((x) => x.correct)).toEqual([false, false, true, true]);

    // Biến thể D: Bảng Hình 2 chỉ có 2 câu và KHÔNG có dòng HẾT
    const parsedNoHet = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      paraXml(runXml("PHẦN II")),
      tableXml([
        ["Câu", "a)", "b)", "c)", "d)"],
        ["Câu 1", "Đ", "S", "S", "Đ"],
        ["Câu 2", "S", "Đ", "Đ", "S"],
      ]),
    ]);

    expect(parsedNoHet.partII).toHaveLength(2);
    expect(parsedNoHet.partII[0].items.map((x) => x.correct)).toEqual([true, false, false, true]);
    expect(parsedNoHet.partII[1].items.map((x) => x.correct)).toEqual([false, true, true, false]);
  });

  it("Kiểm thử 3: Đề thi kết hợp cả bảng Hình 1 và Hình 2 trong CÙNG MỘT FILE DOCX", async () => {
    const parsed = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN I. TRẮC NGHIỆM NHIỀU LỰA CHỌN")),
      ...mcQuestionBody(1),
      ...mcQuestionBody(2),
      paraXml(runXml("PHẦN II. TRẮC NGHIỆM ĐÚNG SAI")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("PHẦN III. TRẢ LỜI NGẮN")),
      ...saQuestionBody(1),
      ...saQuestionBody(2),
      paraXml(runXml("---------------------------HẾT------------------------")),
      paraXml(runXml("PHẦN I")),
      tableXml([
        ["Câu", "1", "2"],
        ["Chọn", "B", "D"],
      ]),
      paraXml(runXml("PHẦN II")),
      // Bảng 1 theo Hình 1 cho Câu 1 và Câu 2
      tableXml([
        ["Câu", "1", "2"],
        ["a)", "Đ", "S"],
        ["b)", "S", "Đ"],
        ["c)", "Đ", "S"],
        ["d)", "S", "Đ"],
      ]),
      // Bảng 2 theo Hình 2 cho Câu 3 và Câu 4
      tableXml([
        ["Câu", "a)", "b)", "c)", "d)"],
        ["Câu 3", "Đ", "Đ", "Đ", "S"],
        ["Câu 4", "S", "S", "Đ", "Đ"],
      ]),
      paraXml(runXml("PHẦN III")),
      tableXml([
        ["Câu", "1", "2"],
        ["Chọn", "2025", "-4,5"],
      ]),
    ]);

    expect(parsed.partI.map((q) => q.answer)).toEqual(["B", "D"]);
    expect(parsed.partII[0].items.map((x) => x.correct)).toEqual([true, false, true, false]);
    expect(parsed.partII[1].items.map((x) => x.correct)).toEqual([false, true, false, true]);
    expect(parsed.partII[2].items.map((x) => x.correct)).toEqual([true, true, true, false]);
    expect(parsed.partII[3].items.map((x) => x.correct)).toEqual([false, false, true, true]);
    expect(parsed.partIII.map((q) => q.answer)).toEqual(["2025", "-4,5"]);
  });

  it("Kiểm thử 4: Tích hợp chấm điểm (thang điểm 100, chia đều 4 ý và tỷ lệ theo số ý đúng) hoạt động chính xác với dữ liệu từ Hình 2", async () => {
    const parsed = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II. TRẮC NGHIỆM ĐÚNG SAI")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("--- HẾT ---")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        ["Câu", "a)", "b)", "c)", "d)"],
        ["Câu 1", "Đ", "Đ", "Đ", "Đ"],
        ["Câu 2", "S", "Đ", "Đ", "S"],
        ["Câu 3", "Đ", "Đ", "S", "Đ"],
        ["Câu 4", "S", "S", "Đ", "Đ"],
      ]),
    ]);

    // 4 câu Phần II = 100 điểm -> 25 điểm/câu
    const studentAnswers: Record<string, any> = {
      // Câu 1: đúng 4/4 -> 100% của 25 = 25đ
      [parsed.partII[0].id]: { a: true, b: true, c: true, d: true },
      // Câu 2: đáp án [S, Đ, Đ, S], chọn đúng 3/4 (a,b,c đúng; d chọn Đ sai) -> 50% của 25 = 12.5đ
      [parsed.partII[1].id]: { a: false, b: true, c: true, d: true },
      // Câu 3: đáp án [Đ, Đ, S, Đ], chọn đúng 2/4 -> 25% của 25 = 6.25đ
      [parsed.partII[2].id]: { a: true, b: true, c: true, d: false },
      // Câu 4: đáp án [S, S, Đ, Đ], chọn đúng 1/4 -> 10% của 25 = 2.5đ
      [parsed.partII[3].id]: { a: false, b: true, c: false, d: false },
    };

    // Chế độ 1: Chia đều (4 ý -> 6.25đ/ý)
    const equalScoring = buildScale100Scoring(parsed, { p1: 0, p2: 100, p3: 0 }, { p2Method: "equal" });
    const equalGrade = gradeExam(parsed, studentAnswers, equalScoring);
    // Tổng số ý đúng: 4 + 3 + 2 + 1 = 10/16 ý -> 10 * 6.25 = 62.5đ
    expect(equalGrade.score).toBe(62.5);
    expect(equalGrade.maxScore).toBe(100);
    expect(equalGrade.partIISummary.map((s) => s.okItems)).toEqual([4, 3, 2, 1]);

    // Chế độ 2: Tỷ lệ theo số ý đúng (10% / 25% / 50% / 100%)
    const customScoring = buildScale100Scoring(
      parsed,
      { p1: 0, p2: 100, p3: 0 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const customGrade = gradeExam(parsed, studentAnswers, customScoring);
    // 25 + 12.5 + 6.25 + 2.5 = 46.25đ
    expect(customGrade.score).toBe(46.25);
    expect(customGrade.maxScore).toBe(100);
    expect(customGrade.partIISummary.map((s) => s.ratePercent)).toEqual([100, 50, 25, 10]);
    expect(customGrade.partIISummary.map((s) => s.earnedScore)).toEqual([25, 12.5, 6.25, 2.5]);
  });

  it("Kiểm thử 5: Giao diện kết quả học sinh hiển thị chính xác từng ý a,b,c,d, số ý đúng, tỷ lệ và điểm khi đề dùng bảng Hình 2", async () => {
    const parsed = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      paraXml(runXml("HẾT")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        ["Câu", "a)", "b)", "c)", "d)"],
        ["Câu 1", "Đ", "Đ", "Đ", "Đ"],
        ["Câu 2", "S", "Đ", "Đ", "S"],
      ]),
    ]);

    const scoring = buildScale100Scoring(
      parsed,
      { p1: 0, p2: 100, p3: 0 },
      { p2Method: "custom_rates", p2Rates: DEFAULT_PART_II_RATES }
    );
    const answers = {
      [parsed.partII[0].id]: { a: true, b: true, c: true, d: false }, // 3/4 -> 50% -> 25/50
      [parsed.partII[1].id]: { a: false, b: true, c: false, d: true }, // 2/4 -> 25% -> 12.5/50
    };
    const graded = gradeExam(parsed, answers, scoring);

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/result/sub-shape2-1",
            state: {
              submission: {
                id: "sub-shape2-1",
                exam_id: "exam-shape2",
                student_name: "Trần Thị B",
                student_class: "12A2",
                score: graded.score,
                max_score: graded.maxScore,
                correct_count: graded.correct,
                wrong_count: graded.wrong,
                answers,
                scoring_snapshot: scoring,
                part2_summary: graded.partIISummary,
              },
              exam: {
                id: "exam-shape2",
                title: "Đề kiểm tra Phần II Hình 2",
                allow_review: true,
                scoring,
                questions: parsed,
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/result/:id" element={<Result />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("3/4")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("25/50")).toBeTruthy();
    expect(screen.getByText("2/4")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("12.5/50")).toBeTruthy();
    expect(screen.getByText(/Mệnh đề a của câu 1/i)).toBeTruthy();
    expect(screen.getByText(/Mệnh đề d của câu 2/i)).toBeTruthy();
  });

  it("Kiểm thử 6: Bảng Phần I, Phần III cũ giữ nguyên & bảng Phần II mơ hồ/sai định dạng phát cảnh báo, không gán bừa đáp án", async () => {
    // 6a. Kiểm tra các bảng Phần I và Phần III cũ hoạt động bình thường
    const partI: MCQuestion[] = [
      { type: "mc", id: "m1", text: "MC 1", options: [], answer: null },
      { type: "mc", id: "m2", text: "MC 2", options: [], answer: null },
      { type: "mc", id: "m3", text: "MC 3", options: [], answer: null },
    ];
    const partIII: SAQuestion[] = [
      { type: "sa", id: "s1", text: "SA 1", answer: "" },
      { type: "sa", id: "s2", text: "SA 2", answer: "" },
    ];

    parseAnswerKeySection(
      [
        {
          toks: [
            {
              kind: "tbl",
              rows: [
                ["Câu", "1", "2", "3"],
                ["Chọn", "C", "A", "D"],
              ],
            },
          ],
          plain: "PHẦN I",
          rich: "PHẦN I",
          hasAnyMark: false,
        },
        {
          toks: [
            {
              kind: "tbl",
              rows: [
                ["Câu 1", "12,5"],
                ["Câu 2", "-8"],
              ],
            },
          ],
          plain: "PHẦN III",
          rich: "PHẦN III",
          hasAnyMark: false,
        },
      ],
      partI,
      [],
      partIII
    );

    expect(partI.map((q) => q.answer)).toEqual(["C", "A", "D"]);
    expect(partIII.map((q) => q.answer)).toEqual(["12,5", "-8"]);

    // 6b. Bảng Phần II không có nhãn hàng/cột rõ ràng (mơ hồ) -> không đoán bừa & sinh cảnh báo
    const ambiguousParsed = await parseDocxXmlNodes([
      paraXml(runXml("PHẦN II")),
      ...tfQuestionBody(1),
      ...tfQuestionBody(2),
      ...tfQuestionBody(3),
      ...tfQuestionBody(4),
      paraXml(runXml("--- HẾT ---")),
      paraXml(runXml("PHẦN II")),
      tableXml([
        ["Đ", "Đ", "S", "Đ"],
        ["S", "Đ", "S", "S"],
        ["Đ", "S", "Đ", "S"],
        ["S", "S", "Đ", "Đ"],
      ]),
    ]);

    expect(ambiguousParsed.answerWarnings?.length).toBeGreaterThan(0);
    for (const q of ambiguousParsed.partII) {
      expect(q.items.every((it) => it.correct === null)).toBe(true);
    }

    // 6c. Bảng trùng nhãn a,b,c,d ở cả hàng và cột -> không gán bừa & sinh cảnh báo
    const conflictWarnings: string[] = [];
    const partIIConflict = makeTFPlaceholders(2);
    parseAnswerKeySection(
      [
        {
          toks: [
            {
              kind: "tbl",
              rows: [
                ["Câu", "a)", "b)", "c)", "d)"],
                ["a)", "Đ", "S", "Đ", "S"],
                ["b)", "S", "Đ", "S", "Đ"],
                ["c)", "Đ", "Đ", "S", "S"],
                ["d)", "S", "S", "Đ", "Đ"],
              ],
            },
          ],
          plain: "PHẦN II",
          rich: "PHẦN II",
          hasAnyMark: false,
        },
      ],
      [],
      partIIConflict,
      [],
      conflictWarnings
    );
    expect(conflictWarnings.length).toBeGreaterThan(0);
    expect(partIIConflict[0].items.every((it) => it.correct === null)).toBe(true);

    // 6d. Bảng Hình 2 chứa ký tự lạ không hợp lệ ("X") -> cảnh báo giáo viên, giữ nguyên null ở ô lỗi
    const invalidWarnings: string[] = [];
    const partIIInvalid = makeTFPlaceholders(2);
    parseAnswerKeySection(
      [
        {
          toks: [
            {
              kind: "tbl",
              rows: [
                ["Câu", "a)", "b)", "c)", "d)"],
                ["Câu 1", "Đ", "X", "S", "Đ"],
                ["Câu 2", "S", "Đ", "S", "Đ"],
              ],
            },
          ],
          plain: "PHẦN II",
          rich: "PHẦN II",
          hasAnyMark: false,
        },
      ],
      [],
      partIIInvalid,
      [],
      invalidWarnings
    );
    expect(invalidWarnings.length).toBeGreaterThan(0);
    expect(partIIInvalid[0].items.map((x) => x.correct)).toEqual([true, null, false, true]);
    expect(partIIInvalid[1].items.map((x) => x.correct)).toEqual([false, true, false, true]);
  });
});
