import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import fs from "fs";
import path from "path";
import Take from "@/pages/Take";
import { setCurrentStudent } from "@/lib/studentStorage";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "mocked-offline" } }),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

const TABLE_MARKER =
  "\u27E6TBL:" +
  encodeURIComponent(
    JSON.stringify([
      ["Thiết bị", "Vai trò"],
      ["Switch", "Kết nối LAN"],
      ["Router", "Định tuyến Internet"],
    ])
  ) +
  "\u27E7";

const IMG_MARKER = "\u27E6IMG:" + encodeURIComponent("https://example.com/diagram.png") + "\u27E7";

function buildSingleQuestionExam(overrides?: Partial<any>) {
  return {
    id: "quiz-presentation-test-1",
    code: "PRS2026",
    title: "Đề kiểm tra Tin học – Chế độ Từng câu hỏi",
    duration_minutes: 30,
    display_mode: "quizizz",
    allow_back: true,
    shuffle_questions: false,
    shuffle_options: false,
    instant_feedback: false,
    allow_review: true,
    questions: {
      partI: [
        {
          id: "q_p1_1",
          text:
            "Đoạn 1: Trong ngôn ngữ lập trình Python, câu lệnh nào sau đây dùng để in kết quả?\n" +
            "<i>Đoạn 2: Xem kỹ đề bài.</i>\n" +
            "Biểu thức toán $a^2 + b^2 = c^2$, công thức H<sub>2</sub>O với <u>lưu ý</u> quan trọng.\n" +
            "```python\ndef hello():\n    print('Xin chao')\n```\n" +
            IMG_MARKER,
          options: [
            { key: "A", text: "Hàm <code>print()</code> để xuất dữ liệu" },
            { key: "B", text: "Hàm input() để nhập dữ liệu" },
            { key: "C", text: "Hàm len() để đếm độ dài" },
            { key: "D", text: "Hàm range() tạo dãy số" },
          ],
          answer: "A",
        },
      ],
      partII: [
        {
          id: "q_p2_1",
          text:
            "Xét tình huống mạng máy tính trong trường học:\n" +
            "Một phòng máy thực hành kết nối 30 máy tính qua Switch.\n" +
            TABLE_MARKER,
          items: [
            { key: "a", text: "Switch dùng để kết nối các máy trong mạng LAN.", correct: true },
            { key: "b", text: "Router không cần thiết khi truy cập Internet.", correct: false },
            { key: "c", text: "Cáp xoắn đôi có thể dùng trong phòng máy.", correct: true },
            { key: "d", text: "Mỗi máy có một địa chỉ IP trong mạng.", correct: true },
          ],
        },
      ],
      partIII: [
        {
          id: "q_p3_1",
          text: "Tính giá trị biểu thức $2^3 + 4$:",
          answer: "12",
        },
      ],
    },
    ...overrides,
  };
}

function renderTakeWithExam(exam: any) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/take/${exam.id}`, state: { exam } }]}>
      <Routes>
        <Route path="/take/:id" element={<Take />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PRESENTATION MODE ('Trình chiếu') IN SINGLE QUESTION MODE", () => {
  const indexCssPath = path.resolve(process.cwd(), "src/index.css");
  const indexCss = fs.readFileSync(indexCssPath, "utf-8");
  const takePath = path.resolve(process.cwd(), "src/pages/Take.tsx");
  const takeCode = fs.readFileSync(takePath, "utf-8");
  const teamTakePath = path.resolve(process.cwd(), "src/pages/TeamTake.tsx");
  const teamTakeCode = fs.readFileSync(teamTakePath, "utf-8");

  beforeEach(() => {
    localStorage.clear();
    setCurrentStudent({
      id: "stu_prs_1",
      fullName: "Trần Minh Khoa",
      className: "12A2",
      account: "khoa.tran@test.local",
      passwordHash: "00000000",
      createdAt: new Date().toISOString(),
    });
  });

  it("1. Defaults to 'Tắt Trình chiếu' (OFF) on entry and renders the 'Trình chiếu' toggle in Single-Question mode only", () => {
    const quizExam = buildSingleQuestionExam();
    const { container } = renderTakeWithExam(quizExam);

    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    const toggle = screen.getByRole("switch", { name: /Trình chiếu/i });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Trình chiếu");

    const card = container.querySelector('[data-presentation="off"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain("quiz-presentation-off");
    expect(card?.className).not.toContain("quiz-presentation-on");
  });

  it("2. Standard mode and Team mode do NOT render the 'Trình chiếu' toggle and remain completely unaffected", () => {
    const stdExam = buildSingleQuestionExam({ id: "std-no-prs", display_mode: "standard" });
    renderTakeWithExam(stdExam);
    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    expect(screen.queryByRole("switch", { name: /Trình chiếu/i })).toBeNull();
    expect(teamTakeCode).not.toContain("presentation-mode-toggle");
    expect(teamTakeCode).not.toContain("quiz-presentation-off");
  });

  it("3. Toggling 'Trình chiếu' switches immediately between OFF (normal sizes) and ON (TV sizes) without losing answers, question index, or timer", () => {
    const quizExam = buildSingleQuestionExam();
    const { container } = renderTakeWithExam(quizExam);
    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    const toggle = screen.getByRole("switch", { name: /Trình chiếu/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    // 1) Answer Part I (select Option B)
    const optionBText = screen.getByText(/Hàm input\(\) để nhập dữ liệu/i);
    const optionBLabel = optionBText.closest("label") as HTMLLabelElement;
    fireEvent.click(optionBLabel);
    const radioB = optionBLabel.querySelector('button[role="radio"]') as HTMLElement;
    expect(radioB.getAttribute("aria-checked")).toBe("true");

    // Toggle ON while on Part I
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[data-presentation="on"]')).not.toBeNull();
    expect(radioB.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/CÂU 1/i)).toBeTruthy();

    // Toggle OFF again and move to Part II (Câu 2)
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /CÂU TIẾP THEO/i }));
    expect(screen.getByText(/CÂU 2/i)).toBeTruthy();

    // Select ĐÚNG for item a) and SAI for item b)
    const tfItemA = container.querySelector('[data-tf-item="a"]') as HTMLElement;
    const tfItemB = container.querySelector('[data-tf-item="b"]') as HTMLElement;
    fireEvent.click(within(tfItemA).getByRole("button", { name: "ĐÚNG" }));
    fireEvent.click(within(tfItemB).getByRole("button", { name: "SAI" }));

    // Toggle ON & OFF on Part II -> verify TF answers and Câu 2 index preserved
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(within(tfItemA).getByRole("button", { name: "ĐÚNG" }).className).toContain("bg-emerald-500");
    expect(within(tfItemB).getByRole("button", { name: "SAI" }).className).toContain("bg-rose-500");
    expect(screen.getByText(/CÂU 2/i)).toBeTruthy();

    // Move to Part III (Câu 3) and enter Short Answer
    fireEvent.click(screen.getByRole("button", { name: /CÂU TIẾP THEO/i }));
    expect(screen.getByText(/CÂU 3/i)).toBeTruthy();
    const saInput = screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i) as HTMLInputElement;
    fireEvent.change(saInput, { target: { value: "12" } });
    expect(saInput.value).toBe("12");

    // Toggle OFF -> verify SA input preserved and still on Câu 3
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByPlaceholderText(/Nhập câu trả lời hoặc số liệu/i) as HTMLInputElement).value).toBe("12");
    expect(screen.getByText(/CÂU 3/i)).toBeTruthy();

    // Navigate back to Câu 1 -> verify Part I answer still preserved
    fireEvent.click(screen.getByRole("button", { name: /CÂU TRƯỚC/i }));
    fireEvent.click(screen.getByRole("button", { name: /CÂU TRƯỚC/i }));
    expect(screen.getByText(/CÂU 1/i)).toBeTruthy();
    const restoredLabel = screen.getByText(/Hàm input\(\) để nhập dữ liệu/i).closest("label") as HTMLLabelElement;
    expect(restoredLabel.querySelector('button[role="radio"]')?.getAttribute("aria-checked")).toBe("true");
  });

  it("4. Question stem is ALWAYS bold (quiz-question-stem-bold) in both ON and OFF states across Parts I, II, III, while options & helper texts are NOT", () => {
    const quizExam = buildSingleQuestionExam();
    const { container } = renderTakeWithExam(quizExam);
    fireEvent.click(screen.getByRole("button", { name: /BẮT ĐẦU LÀM BÀI/i }));

    const toggle = screen.getByRole("switch", { name: /Trình chiếu/i });

    const assertQuestionBoldOnly = () => {
      const qStem = container.querySelector(".question-content") as HTMLElement;
      expect(qStem).not.toBeNull();
      expect(qStem.className).toContain("quiz-question-stem-bold");
      expect(qStem.className).toContain("font-bold");

      // Options must NEVER have quiz-question-stem-bold
      container.querySelectorAll(".quiz-option-tv, .quiz-option-text-70, .quiz-helper-prompt").forEach((el) => {
        expect(el.className).not.toContain("quiz-question-stem-bold");
      });
    };

    // Part I OFF & ON
    assertQuestionBoldOnly();
    // Preserves italic, underline, sub, KaTeX, code block, and image in Part I
    const stemP1 = container.querySelector(".question-content") as HTMLElement;
    expect(stemP1.querySelector("i")?.textContent).toContain("Đoạn 2");
    expect(stemP1.querySelector("u")?.textContent).toBe("lưu ý");
    expect(stemP1.querySelector("sub")?.textContent).toBe("2");
    expect(stemP1.querySelector(".katex")).not.toBeNull();
    expect(stemP1.querySelector("pre.code-content code.hljs")).not.toBeNull();
    expect(stemP1.querySelector("img")).not.toBeNull();

    fireEvent.click(toggle);
    assertQuestionBoldOnly();

    // Part II ON & OFF (includes table)
    fireEvent.click(screen.getByRole("button", { name: /CÂU TIẾP THEO/i }));
    assertQuestionBoldOnly();
    expect(container.querySelector(".question-content table.rich-table")).not.toBeNull();
    fireEvent.click(toggle);
    assertQuestionBoldOnly();

    // Part III OFF & ON
    fireEvent.click(screen.getByRole("button", { name: /CÂU TIẾP THEO/i }));
    assertQuestionBoldOnly();
    fireEvent.click(toggle);
    assertQuestionBoldOnly();
  });

  it("5. Defines exact responsive normal font sizes when Trình chiếu is OFF while preserving TV sizes when ON", () => {
    // Question stem bold rule excludes code, KaTeX, tables, SVG
    expect(indexCss).toContain(".quiz-question-stem-bold");
    expect(indexCss).toMatch(/\.quiz-question-stem-bold[\s\S]*?font-weight:\s*700\s*!important/);
    expect(indexCss).toMatch(/\.quiz-question-stem-bold \.code-content[\s\S]*?font-weight:\s*400\s*!important/);
    expect(indexCss).toMatch(/\.quiz-question-stem-bold \.katex[\s\S]*?font-weight:\s*400\s*!important/);

    // Presentation OFF Desktop (>=1024px): Q = 21px (compact 20px), Options = 19px (compact 18px)
    expect(indexCss).toMatch(/\.quiz-presentation-off \.quiz-question-tv[\s\S]*?font-size:\s*21px\s*!important/);
    expect(indexCss).toMatch(/\.quiz-presentation-off \.quiz-q-compact[\s\S]*?font-size:\s*20px\s*!important/);
    expect(indexCss).toMatch(/\.quiz-presentation-off \.quiz-option-tv[\s\S]*?font-size:\s*19px\s*!important/);
    expect(indexCss).toMatch(/\.quiz-presentation-off \.quiz-opt-compact[\s\S]*?font-size:\s*18px\s*!important/);

    // Presentation OFF Tablet (640px - <1024px): Q = 20px, Options = 18px
    expect(indexCss).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?\.quiz-presentation-off \.quiz-question-tv[\s\S]*?font-size:\s*20px\s*!important/);
    expect(indexCss).toMatch(/@media\s*\(\s*min-width:\s*640px\s*\)\s*and\s*\(\s*max-width:\s*1023\.98px\s*\)[\s\S]*?\.quiz-presentation-off \.quiz-option-tv[\s\S]*?font-size:\s*18px\s*!important/);

    // Presentation OFF Mobile (<640px): Q = 18px (17-19px), Options = 17px (16-18px)
    expect(indexCss).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?\.quiz-presentation-off \.quiz-question-tv[\s\S]*?font-size:\s*18px\s*!important/);
    expect(indexCss).toMatch(/@media\s*\(\s*max-width:\s*639\.98px\s*\)[\s\S]*?\.quiz-presentation-off \.quiz-option-tv[\s\S]*?font-size:\s*17px\s*!important/);

    // Presentation ON preserves original TV classes untouched
    expect(takeCode).toContain('const [isPresentationMode, setIsPresentationMode] = useState(false);');
    expect(takeCode).toContain('const qFontSizeClass = "text-[clamp(35px,2.45vw,47px)] quiz-question-tv quiz-question-text-80";');
    expect(takeCode).toContain('const optFontSizeClass = "text-[clamp(27px,1.95vw,37px)] quiz-option-tv quiz-option-text-70";');
  });
});
