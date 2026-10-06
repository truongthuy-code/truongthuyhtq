import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { SAMPLE_EXAMS, findSampleExam, getSampleExamById, getSampleExamByCode } from "./src/lib/sampleExams";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize GoogleGenAI SDK with required headers
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

const MODEL_NAME = "gemini-3.8-flash";

// -------------------------------------------------------------
// HEURISTIC DOCUMENT FALLBACKS (Guarantees 100% uptime when API quota is exhausted)
// -------------------------------------------------------------
function extractConceptsFromText(text: string, topic: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const concepts: { name: string; definition: string }[] = [];
  const rules: string[] = [];
  const examples: string[] = [];
  const mainTopics: string[] = [];

  for (const line of lines) {
    if (/^[0-9IVX]+\./.test(line) || /^Bài\s+\d+/i.test(line)) {
      mainTopics.push(line.replace(/^[0-9IVX.]+\s*/, ""));
    }
    const colonMatch = line.match(/^([^:]{3,40}):\s*(.+)$/);
    if (colonMatch && concepts.length < 10) {
      concepts.push({ name: colonMatch[1].replace(/^[-•*]\s*/, ""), definition: colonMatch[2] });
    }
    if (/quy tắc|lưu ý|bắt buộc|chú ý|phải|không được/i.test(line) && rules.length < 6) {
      rules.push(line.replace(/^[-•*]\s*/, ""));
    }
    if (/ví dụ|ví dụ\s*\d+/i.test(line) && examples.length < 5) {
      examples.push(line);
    }
  }

  if (concepts.length === 0) {
    concepts.push(
      { name: topic || "Khái niệm bài học", definition: "Nội dung trọng tâm theo tài liệu học tập của giáo viên." },
      { name: "Cấu trúc & Cú pháp", definition: "Các quy định và cú pháp sử dụng trong bài học." }
    );
  }

  return { concepts, rules, examples, mainTopics };
}

function fallbackAnalyzeDocument(text: string, subject: string, grade: string, topic: string, title: string) {
  const { concepts, rules, examples, mainTopics } = extractConceptsFromText(text, topic);
  return {
    summary: `Tài liệu bài học "${topic || title}" môn ${subject} lớp ${grade}. Cung cấp các kiến thức trọng tâm, khái niệm, quy tắc và ví dụ áp dụng cụ thể.`,
    mainTopics: mainTopics.length > 0 ? mainTopics : [topic || "Kiến thức bài học"],
    concepts,
    rules: rules.length > 0 ? rules : ["Tuân thủ đúng cú pháp và quy chuẩn theo tài liệu của giáo viên."],
    procedures: ["Bước 1: Nắm vững định nghĩa và khái niệm cơ bản", "Bước 2: Vận dụng đúng quy tắc vào bài tập"],
    examples: examples.length > 0 ? examples : ["(Các ví dụ minh họa chi tiết có trong tài liệu của giáo viên)"],
    keyTakeaways: ["Ghi nhớ các khái niệm chính và quy tắc sử dụng trong tài liệu giáo viên."],
  };
}

function fallbackSummarizeLesson(materialText: string, subject: string, grade: string, topic: string) {
  const { concepts, rules, examples, mainTopics } = extractConceptsFromText(materialText, topic);

  return `# 📖 TÓM TẮT KIẾN THỨC: ${topic}
*Môn: ${subject} – Lớp ${grade}*

*(Tài liệu do giáo viên cung cấp làm nguồn tri thức chính)*

### 1. Khái niệm
${concepts.map((c) => `- **${c.name}**: ${c.definition}`).join("\n")}

### 2. Nội dung quan trọng
${mainTopics.length > 0 ? mainTopics.map((t) => `- ${t}`).join("\n") : "- Toàn bộ nội dung trọng tâm theo tài liệu bài học của giáo viên."}

### 3. Quy tắc cần nhớ
${rules.length > 0 ? rules.map((r) => `- ${r}`).join("\n") : "- Áp dụng đúng cú pháp và các thuộc tính theo tài liệu."}

### 4. Ví dụ
${examples.length > 0 ? examples.map((ex) => "```\n" + ex + "\n```").join("\n") : "*(Các ví dụ minh họa được giáo viên trình bày chi tiết trong tài liệu)*"}

### 5. Kiến thức cần ghi nhớ
- Nắm vững định nghĩa các khái niệm cốt lõi.
- Tuân thủ quy tắc kết hợp và cấu trúc trong bài học.
- Đọc kỹ yêu cầu và các trường hợp lưu ý đặc biệt.`;
}

function fallbackQuickTest(materialText: string, subject: string, grade: string, topic: string) {
  const { concepts } = extractConceptsFromText(materialText, topic);
  const questions = [];

  for (let i = 0; i < Math.min(concepts.length, 4); i++) {
    const c = concepts[i];
    questions.push({
      id: `qt-${i + 1}`,
      type: "mc",
      conceptAspect: c.name,
      question: `Trong bài "${topic}", phát biểu nào sau đây đúng nhất về "${c.name}"?`,
      options: [
        { key: "A", text: c.definition },
        { key: "B", text: "Khái niệm này không được đề cập trong bài học." },
        { key: "C", text: "Chỉ được sử dụng khi bắt đầu một tài liệu mới." },
        { key: "D", text: "Là một thuộc tính phụ không bắt buộc." },
      ],
      correctAnswer: "A",
      explanation: `Theo tài liệu giáo viên: ${c.name} được định nghĩa là: ${c.definition}. Các phương án B, C, D không chính xác.`,
    });
  }

  if (questions.length === 0) {
    questions.push({
      id: "qt-1",
      type: "mc",
      conceptAspect: topic,
      question: `Nội dung cốt lõi của bài "${topic}" là gì?`,
      options: [
        { key: "A", text: "Trang bị các kiến thức và kỹ năng áp dụng theo tài liệu giáo viên." },
        { key: "B", text: "Không có hướng dẫn áp dụng cụ thể." },
        { key: "C", text: "Chỉ phục vụ cho phần mở rộng nâng cao." },
        { key: "D", text: "Một nội dung nằm ngoài chương trình." },
      ],
      correctAnswer: "A",
      explanation: "Theo tài liệu học tập của giáo viên, bài học trang bị kiến thức và kỹ năng áp dụng thực tế.",
    });
  }

  return questions;
}

function fallbackPracticeQuiz(materialText: string, subject: string, grade: string, topic: string, count: number) {
  const { concepts, rules } = extractConceptsFromText(materialText, topic);
  const total = count === 20 ? 20 : 10;
  const questions = [];

  // Generate Multiple Choice questions (A, B, C, D separate lines, balanced length)
  const mcCount = Math.round(total * 0.7);
  for (let i = 1; i <= mcCount; i++) {
    const c = concepts[(i - 1) % concepts.length];
    const level = i <= Math.round(total * 0.4) ? "Cơ bản" : i <= Math.round(total * 0.8) ? "Thông hiểu" : "Vận dụng";

    questions.push({
      id: `pq-mc-${i}`,
      number: i,
      type: "mc",
      level,
      concept: c.name,
      stem: `Câu ${i}. Theo tài liệu học tập "${topic}", khẳng định nào sau đây là ĐÚNG về ${c.name}?`,
      options: [
        { key: "A", text: c.definition },
        { key: "B", text: `Được dùng để thay thế hoàn toàn toàn bộ tài liệu.` },
        { key: "C", text: `Không có bất kỳ tác dụng nào trong bài học.` },
        { key: "D", text: `Chỉ xuất hiện trong các bài thực hành nâng cao.` },
      ],
      mcAnswer: "A",
      explanation: `Đáp án: A.\nLời giải: Theo tài liệu giáo viên, ${c.name} có định nghĩa: "${c.definition}". Các phương án B, C, D diễn đạt không đúng với nội dung giáo trình.`,
    });
  }

  // Generate True/False questions (Situation + a, b, c, d)
  const tfCount = total - mcCount;
  for (let j = 1; j <= tfCount; j++) {
    const qNum = mcCount + j;
    const c = concepts[(j - 1) % concepts.length];
    const r = rules[(j - 1) % Math.max(rules.length, 1)] || "Tuân thủ cú pháp quy định trong bài học.";

    questions.push({
      id: `pq-tf-${j}`,
      number: qNum,
      type: "tf",
      level: "Thông hiểu",
      concept: c.name,
      stem: `Câu ${qNum}. Cho tình huống sau: Khi tìm hiểu về nội dung "${topic}" và kiến thức về "${c.name}":`,
      tfItems: [
        { key: "a", text: `${c.name} có đặc điểm: ${c.definition}.`, isCorrect: true, explanation: "Đúng. Đây là khái niệm chính xác theo tài liệu giáo viên." },
        { key: "b", text: `${c.name} hoàn toàn không có quy tắc sử dụng nào.`, isCorrect: false, explanation: "Sai. Tài liệu đã quy định rõ ràng các quy tắc sử dụng." },
        { key: "c", text: `Quy tắc bài học: ${r}.`, isCorrect: true, explanation: "Đúng. Khẳng định này trùng khớp với quy tắc trong tài liệu." },
        { key: "d", text: `Không được phép sử dụng ${c.name} trong bất kỳ trường hợp nào.`, isCorrect: false, explanation: "Sai. Đây là thành phần được khuyến khích sử dụng đúng mục đích." },
      ],
      explanation: `Đáp án: a) Đúng; b) Sai; c) Đúng; d) Sai.\nLời giải:\na) Đúng. Đúng theo định nghĩa tài liệu bài học.\nb) Sai. Luôn có quy tắc cụ thể.\nc) Đúng. Trùng khớp với quy tắc bài học.\nd) Sai. Có thể sử dụng bình thường.`,
    });
  }

  return questions;
}

function heuristicSplitMultiLessonDocument(
  text: string,
  subject: string,
  grade: string,
  topicContext?: string,
  title?: string
) {
  // 1. Check if text matches multi-lesson patterns (Bài 1, Bài 2, Tiết 1, Chương 1, etc.)
  const lessonRegex = /(?:^|\n)\s*(?:Bài|BAI|Tiết|TIET|Chương|CHUONG|Phần|PHAN)\s*([0-9IVX]+)[\s:.\-–—]+([^\n]+)/gi;
  const matches: { index: number; fullMatch: string; num: string; title: string }[] = [];
  let m: RegExpExecArray | null;

  while ((m = lessonRegex.exec(text)) !== null) {
    matches.push({
      index: m.index,
      fullMatch: m[0],
      num: m[1],
      title: m[2].trim(),
    });
  }

  // If we have >= 2 distinct lessons detected
  if (matches.length >= 2) {
    const lessons = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i < matches.length - 1 ? matches[i + 1].index : text.length;
      const sliceContent = text.slice(start, end).trim();
      const rawTitle = matches[i].title;
      const lessonTitle = rawTitle.toLowerCase().startsWith("bài") ? rawTitle : `Bài ${matches[i].num}. ${rawTitle}`;
      const kb = fallbackAnalyzeDocument(sliceContent, subject, grade, lessonTitle, lessonTitle);

      lessons.push({
        id: `lesson-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
        lessonNumber: i + 1,
        lessonTitle,
        topic: topicContext || `Chủ đề ${subject} ${grade}`,
        content: sliceContent,
        isAiProposed: false,
        knowledgeBase: kb,
      });
    }

    return {
      isMultiLesson: true,
      isAiProposed: false,
      lessons,
      summary: `Đã tự động nhận diện và tách chính xác ${lessons.length} bài học riêng biệt từ tài liệu.`,
    };
  }

  // 2. If matches < 2, check for major numbered sections (e.g. I., II. or 1., 2.)
  const sectionRegex = /(?:^|\n)\s*([0-9IVX]+)[.)]\s*([^\n]{3,60})/gi;
  const secMatches: { index: number; num: string; title: string }[] = [];
  while ((m = sectionRegex.exec(text)) !== null) {
    secMatches.push({ index: m.index, num: m[1], title: m[2].trim() });
  }

  if (secMatches.length >= 2 && text.length > 300) {
    const lessons = [];
    for (let i = 0; i < secMatches.length; i++) {
      const start = secMatches[i].index;
      const end = i < secMatches.length - 1 ? secMatches[i + 1].index : text.length;
      const sliceContent = text.slice(start, end).trim();
      const lessonTitle = `Bài ${i + 1}. ${secMatches[i].title}`;
      const kb = fallbackAnalyzeDocument(sliceContent, subject, grade, lessonTitle, lessonTitle);

      lessons.push({
        id: `lesson-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
        lessonNumber: i + 1,
        lessonTitle,
        topic: topicContext || title || `Chủ đề ${subject} ${grade}`,
        content: sliceContent,
        isAiProposed: true, // Marked as "AI đề xuất – cần giáo viên xác nhận"
        knowledgeBase: kb,
      });
    }

    return {
      isMultiLesson: true,
      isAiProposed: true,
      lessons,
      summary: `Tài liệu không có cấu trúc bài rõ ràng. AI đã đề xuất chia thành ${lessons.length} bài học tương ứng (cần giáo viên kiểm tra và xác nhận).`,
    };
  }

  // 3. Single lesson
  const singleTitle = topicContext || title || `Bài học ${subject} ${grade}`;
  const kb = fallbackAnalyzeDocument(text, subject, grade, singleTitle, singleTitle);
  return {
    isMultiLesson: false,
    isAiProposed: false,
    lessons: [
      {
        id: `lesson-${Date.now()}-1-${Math.random().toString(36).slice(2, 6)}`,
        lessonNumber: 1,
        lessonTitle: singleTitle,
        topic: topicContext || singleTitle,
        content: text,
        isAiProposed: false,
        knowledgeBase: kb,
      },
    ],
    summary: `Nhận diện 1 bài học: "${singleTitle}".`,
  };
}

// -------------------------------------------------------------
// 0. AI Tự nhận biết & Tách bài học từ tài liệu nhiều bài (Multi-Lesson Separation)
// -------------------------------------------------------------
app.post("/api/ai/split-lessons", async (req, res) => {
  const { text, subject, grade, topic, title, imageBase64 } = req.body;

  if (!text && !imageBase64) {
    return res.status(400).json({ error: "Thiếu nội dung văn bản hoặc tài liệu để phân tích bài học." });
  }

  try {
    const systemInstruction = `Bạn là Trợ lý AI Quản lý Kho Học liệu Sư phạm.
Nhiệm vụ của bạn là:
1. Đọc nội dung tài liệu do giáo viên tải lên hoặc nhập vào.
2. Xác định tài liệu này chứa 1 bài học hay NHIỀU BÀI HỌC (ví dụ: Bài 1, Bài 2, Bài 3, Bài 4...).
3. NẾU TÀI LIỆU CHỨA NHIỀU BÀI:
   - Tự động xác định điểm bắt đầu và kết thúc của từng bài.
   - Tách nội dung từng bài riêng biệt, tuyệt đối KHÔNG làm mất nội dung và KHÔNG trộn nội dung giữa các bài.
   - Đặt tiêu đề chuẩn cho từng bài: "Bài [Số]. [Tên bài]".
4. NẾU TÀI LIỆU KHÔNG CÓ TIÊU ĐỀ RÕ RÀNG:
   - Phân tích nội dung và ĐỀ XUẤT CẤU TRÚC BÀI HỌC (đánh dấu isAiProposed = true để giáo viên kiểm tra và xác nhận).
5. Trích xuất kiến thức trọng tâm cho từng bài.`;

    const prompt = `Phân tích cấu trúc và tách bài học từ tài liệu sau:
Môn: ${subject || "Tin học"} | Khối/Lớp: ${grade || "12"} | Chủ đề tham khảo: ${topic || ""} | Tiêu đề file: ${title || ""}

NỘI DUNG TÀI LIỆU:
"""
${(text || "").slice(0, 100000)}
"""`;

    let parts: any[] = [];
    if (imageBase64) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isMultiLesson: { type: Type.BOOLEAN },
            isAiProposed: { type: Type.BOOLEAN },
            detectedTopic: { type: Type.STRING },
            summary: { type: Type.STRING },
            lessons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lessonNumber: { type: Type.INTEGER },
                  lessonTitle: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  content: { type: Type.STRING },
                  isAiProposed: { type: Type.BOOLEAN },
                },
                required: ["lessonNumber", "lessonTitle", "content", "isAiProposed"],
              },
            },
          },
          required: ["isMultiLesson", "isAiProposed", "lessons", "summary"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    if (!parsed.lessons || parsed.lessons.length === 0) {
      throw new Error("AI không trích xuất được bài học nào");
    }

    // Attach knowledge bases for each lesson
    const enrichedLessons = parsed.lessons.map((l: any, idx: number) => {
      const kb = fallbackAnalyzeDocument(l.content || "", subject || "Tin học", grade || "12", l.lessonTitle, l.lessonTitle);
      return {
        id: `lesson-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
        lessonNumber: l.lessonNumber || idx + 1,
        lessonTitle: l.lessonTitle || `Bài ${idx + 1}`,
        topic: l.topic || topic || parsed.detectedTopic || `Chủ đề ${subject}`,
        content: l.content || "",
        isAiProposed: !!l.isAiProposed,
        knowledgeBase: kb,
      };
    });

    return res.json({
      success: true,
      isMultiLesson: parsed.isMultiLesson,
      isAiProposed: parsed.isAiProposed,
      summary: parsed.summary,
      lessons: enrichedLessons,
    });
  } catch (err: any) {
    console.warn("Gemini split-lessons error (quota/network), executing heuristic fallback:", err.message);
    const fallback = heuristicSplitMultiLessonDocument(text || "", subject || "Tin học", grade || "12", topic || "", title || "");
    return res.json({
      success: true,
      isMultiLesson: fallback.isMultiLesson,
      isAiProposed: fallback.isAiProposed,
      summary: fallback.summary,
      lessons: fallback.lessons,
      fallback: true,
    });
  }
});

// -------------------------------------------------------------
// 1. Phân tích tài liệu & xây dựng kho kiến thức (Knowledge Extraction)
// -------------------------------------------------------------
app.post("/api/ai/analyze-document", async (req, res) => {
  const { text, subject, grade, topic, title, imageBase64 } = req.body;

  if (!text && !imageBase64) {
    return res.status(400).json({ error: "Thiếu nội dung tài liệu để phân tích." });
  }

  try {
    const systemInstruction = `Bạn là chuyên gia sư phạm và quản lý tri thức giáo dục.
Nhiệm vụ của bạn là đọc và phân tích cấu trúc tài liệu học tập của giáo viên:
1. Đọc nội dung.
2. Phân tích cấu trúc.
3. Xác định bài/chủ đề.
4. Xác định các mục kiến thức.
5. Xác định khái niệm.
6. Xác định định nghĩa.
7. Xác định quy tắc.
8. Xác định quy trình.
9. Xác định ví dụ.
10. Xác định bài tập và kiến thức liên quan.

NGUYÊN TẮC BẮT BUỘC:
- Tuyệt đối trung thực với tài liệu giáo viên cung cấp. Không tự ý thay đổi nội dung kiến thức.
- Xuất kết quả theo định dạng JSON chuẩn.`;

    const prompt = `Phân tích tài liệu sau đây để tạo Kho kiến thức:
Môn: ${subject || "Chung"}
Khối/Lớp: ${grade || "12"}
Chủ đề/Bài: ${topic || ""}
Tên tài liệu: ${title || ""}

NỘI DUNG TÀI LIỆU:
"""
${(text || "").slice(0, 100000)}
"""`;

    let parts: any[] = [];
    if (imageBase64) {
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      }
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            mainTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: { name: { type: Type.STRING }, definition: { type: Type.STRING } },
                required: ["name", "definition"],
              },
            },
            rules: { type: Type.ARRAY, items: { type: Type.STRING } },
            procedures: { type: Type.ARRAY, items: { type: Type.STRING } },
            examples: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["summary", "mainTopics", "concepts", "rules", "procedures", "examples", "keyTakeaways"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    return res.json({ success: true, knowledgeBase: parsed });
  } catch (err: any) {
    console.warn("Gemini analyze error (quota/network), using heuristic fallback:", err.message);
    const fallback = fallbackAnalyzeDocument(text || "", subject || "Tin học", grade || "12", topic || "", title || "");
    return res.json({ success: true, knowledgeBase: fallback, fallback: true });
  }
});

// -------------------------------------------------------------
// 2. Tóm tắt lý thuyết bài học (Summarize Lesson - BƯỚC 1)
// -------------------------------------------------------------
app.post("/api/ai/summarize-lesson", async (req, res) => {
  const { materialText, subject, grade, topic } = req.body;

  if (!materialText) {
    return res.status(400).json({ error: "Không có tài liệu để tóm tắt lý thuyết." });
  }

  try {
    const systemInstruction = `Bạn là Trợ lý Học tập AI dành cho học sinh.
Nhiệm vụ của bạn là đọc tài liệu của bài học do giáo viên cung cấp và tạo phần:
# 📖 TÓM TẮT KIẾN THỨC

YÊU CẦU BẮT BUỘC VỀ NỘI DUNG:
- Ngắn gọn, dễ hiểu, có cấu trúc rõ ràng.
- Chia thành các ý chính, làm nổi bật khái niệm quan trọng.
- Có ví dụ cụ thể nếu tài liệu có ví dụ.
- Không sao chép nguyên văn toàn bộ tài liệu nếu không cần thiết.
- Không làm sai lệch nội dung giáo viên cung cấp.

BẮT BUỘC TRÌNH BÀY THEO 5 MỤC:
### 1. Khái niệm
### 2. Nội dung quan trọng
### 3. Quy tắc cần nhớ
### 4. Ví dụ
### 5. Kiến thức cần ghi nhớ

NGUYÊN TẮC NGUỒN KIẾN THỨC:
- Ưu tiên tuyệt đối tài liệu giáo viên cung cấp.
- Ưu tiên 1: Nội dung trong tài liệu giáo viên.
- Ưu tiên 2: Kiến thức bổ sung của AI nếu tài liệu chưa đủ.
- NẾU sử dụng kiến thức ngoài tài liệu, BẮT BUỘC phải thông báo rõ:
  "*(Phần giải thích bổ sung này không có trực tiếp trong tài liệu giáo viên cung cấp.)*"
- NẾU không có đủ thông tin để trả lời:
  "*(Nội dung này chưa được tìm thấy trong tài liệu học tập do giáo viên cung cấp.)*"
- Tuyệt đối không bịa kiến thức hoặc tự tạo nội dung trái với tài liệu giáo viên.`;

    const prompt = `Tóm tắt lý thuyết cho học sinh:
Môn học: ${subject}
Lớp: ${grade}
Bài/Chủ đề: ${topic}

TÀI LIỆU GIÁO VIÊN CUNG CẤP:
"""
${materialText.slice(0, 80000)}
"""`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
      },
    });

    return res.json({ success: true, summary: response.text });
  } catch (err: any) {
    console.warn("Gemini summarize error (quota/network), using fallback summary:", err.message);
    const fallbackText = fallbackSummarizeLesson(materialText, subject || "Tin học", grade || "12", topic || "");
    return res.json({ success: true, summary: fallbackText, fallback: true });
  }
});

// -------------------------------------------------------------
// 3. Tạo câu hỏi kiểm tra nhanh sau khi học (Quick Test - BƯỚC 2)
// -------------------------------------------------------------
app.post("/api/ai/quick-test", async (req, res) => {
  const { materialText, subject, grade, topic } = req.body;

  try {
    const systemInstruction = `Bạn là Trợ lý Học tập AI.
Sau phần tóm tắt lý thuyết, bạn tạo khoảng 3 đến 5 câu hỏi ngắn để học sinh tự kiểm tra mức độ nắm kiến thức.
Câu hỏi phải dựa sát vào tài liệu giáo viên cung cấp.
Có thể kết hợp:
- Trắc nghiệm 4 lựa chọn (A, B, C, D)
- Đúng/Sai
- Câu hỏi trả lời ngắn / giải thích đơn giản.`;

    const prompt = `Tạo 4 câu hỏi kiểm tra nhanh cho bài:
Môn: ${subject} - Lớp: ${grade} - Bài: ${topic}
Dựa trên tài liệu:
"""
${(materialText || "").slice(0, 50000)}
"""`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              type: { type: Type.STRING },
              conceptAspect: { type: Type.STRING },
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ["key", "text"],
                },
              },
              tfItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    key: { type: Type.STRING },
                    text: { type: Type.STRING },
                    correct: { type: Type.BOOLEAN },
                  },
                  required: ["key", "text", "correct"],
                },
              },
              correctAnswer: { type: Type.STRING },
              explanation: { type: Type.STRING },
            },
            required: ["id", "type", "conceptAspect", "question", "correctAnswer", "explanation"],
          },
        },
      },
    });

    const questions = JSON.parse(response.text || "[]");
    return res.json({ success: true, questions });
  } catch (err: any) {
    console.warn("Gemini quick-test error (quota/network), using fallback test:", err.message);
    const questions = fallbackQuickTest(materialText || "", subject || "Tin học", grade || "12", topic || "");
    return res.json({ success: true, questions, fallback: true });
  }
});

// -------------------------------------------------------------
// 4. Tạo bài tập ôn luyện 10 hoặc 20 câu (Practice Quiz - BƯỚC 4, D, E, F, G)
// -------------------------------------------------------------
app.post("/api/ai/practice-quiz", async (req, res) => {
  const { materialText, subject, grade, topic, count = 10 } = req.body;
  const numQuestions = count === 20 ? 20 : 10;

  try {
    const systemInstruction = `Bạn là Trợ lý Học tập AI và chuyên gia khảo thí biên soạn đề trắc nghiệm chuẩn.
Nhiệm vụ: Tạo bài tập ôn luyện gồm ĐÚNG ${numQuestions} CÂU dựa trên tài liệu giáo viên cung cấp.

QUY TẮC PHÂN BỔ ĐỘ KHÓ (PHẦN F):
- Cơ bản (khoảng 40%): Kiểm tra khả năng nhớ và hiểu kiến thức.
- Thông hiểu (khoảng 40%): Yêu cầu giải thích, phân biệt, áp dụng trực tiếp.
- Vận dụng (khoảng 20%): Tình huống thực tiễn, phân tích, xử lý tình huống.

QUY ĐỊNH BẮT BUỘC VỀ HAI DẠNG CÂU HỎI:
DẠNG 1 – TRẮC NGHIỆM NHIỀU LỰA CHỌN:
- Mỗi câu có ĐÚNG 4 phương án: A, B, C, D.
- BẮT BUỘC: Mỗi phương án xuống dòng riêng. Độ dài tương đương nhau.
DẠNG 2 – TRẮC NGHIỆM ĐÚNG/SAI:
- Tình huống mở đầu + 4 ý a), b), c), d) mỗi ý xuống dòng riêng.
- Lời giải phân tích chi tiết từng ý a, b, c, d.`;

    const prompt = `Hãy tạo đúng ${numQuestions} câu hỏi trắc nghiệm (Dạng 1 nhiều lựa chọn và Dạng 2 đúng/sai) cho:
Môn: ${subject} - Lớp: ${grade} - Bài: ${topic}
TÀI LIỆU NGUỒN CỦA GIÁO VIÊN:
"""
${(materialText || "").slice(0, 80000)}
"""`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              number: { type: Type.INTEGER },
              type: { type: Type.STRING },
              level: { type: Type.STRING },
              concept: { type: Type.STRING },
              stem: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { key: { type: Type.STRING }, text: { type: Type.STRING } },
                  required: ["key", "text"],
                },
              },
              mcAnswer: { type: Type.STRING },
              tfItems: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { key: { type: Type.STRING }, text: { type: Type.STRING }, isCorrect: { type: Type.BOOLEAN }, explanation: { type: Type.STRING } },
                  required: ["key", "text", "isCorrect", "explanation"],
                },
              },
              explanation: { type: Type.STRING },
            },
            required: ["id", "number", "type", "level", "concept", "stem", "explanation"],
          },
        },
      },
    });

    const questions = JSON.parse(response.text || "[]");
    return res.json({ success: true, total: questions.length, questions });
  } catch (err: any) {
    console.warn("Gemini practice-quiz error (quota/network), using fallback quiz:", err.message);
    const questions = fallbackPracticeQuiz(materialText || "", subject || "Tin học", grade || "12", topic || "", numQuestions);
    return res.json({ success: true, total: questions.length, questions, fallback: true });
  }
});

// -------------------------------------------------------------
// 5. Trợ lý Chat Gia sư (Tutor Chat - PHẦN J, K)
// -------------------------------------------------------------
app.post("/api/ai/tutor-chat", async (req, res) => {
  const {
    message,
    history = [],
    materialText,
    subject,
    grade,
    topic,
    currentQuestionContext,
    weakTopics = [],
  } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Thiếu tin nhắn của học sinh." });
  }

  try {
    const systemInstruction = `Bạn là TRỢ LÝ HỌC TẬP AI - GIA SƯ HỌC TẬP của học sinh.
Môn học: ${subject || "Tin học"} | Lớp: ${grade || "12"} | Bài học: ${topic || ""}

NGUYÊN TẮC QUAN TRỌNG NHẤT - CHẾ ĐỘ GIA SƯ (KHÔNG LÀM BÀI THAY):
- Bạn là GIA SƯ ĐỒNG HÀNH, KHÔNG PHẢI CÔNG CỤ LÀM BÀI THAY!
- Khi học sinh hỏi bài tập, quy trình của bạn là:
  Gợi ý → Hướng dẫn phương pháp → Cho học sinh tự thử sức → Kiểm tra câu trả lời → Giải thích cặn kẽ.
- TUYỆT ĐỐI KHÔNG mặc định đưa ra đáp án cuối cùng ngay lập tức khi học sinh chưa thử tư duy.
- Nếu học sinh hỏi "Em chưa hiểu câu...", hãy giải thích bản chất kiến thức đằng sau câu hỏi đó và đối chiếu với tài liệu giáo viên.
- Nếu học sinh hỏi "Tại sao đáp án của em sai?", hãy phân tích:
  1. Câu hỏi đang kiểm tra điều gì?
  2. Đáp án học sinh chọn mắc bẫy hoặc nhầm lẫn ở điểm nào?
  3. Đáp án đúng là gì và vì sao dựa trên tài liệu bài học?

NGUYÊN TẮC NGUỒN KIẾN THỨC:
- Ưu tiên tuyệt đối tài liệu giáo viên cung cấp bên dưới.
- Nếu giải thích bổ sung kiến thức mở rộng ngoài tài liệu: phải ghi chú rõ:
  "*(Phần giải thích bổ sung này không có trực tiếp trong tài liệu giáo viên cung cấp.)*"
- Nếu hoàn toàn không có thông tin trong tài liệu:
  "*(Nội dung này chưa được tìm thấy trong tài liệu học tập do giáo viên cung cấp.)*"`;

    const contextPrompt = `TÀI LIỆU HỌC TẬP GIÁO VIÊN CUNG CẤP:
"""
${(materialText || "").slice(0, 50000)}
"""

${currentQuestionContext ? `NGỮ CẢNH CÂU HỎI HỌC SINH ĐANG LÀM:\n"""\n${JSON.stringify(currentQuestionContext, null, 2)}\n"""\n` : ""}
${weakTopics.length > 0 ? `NỘI DUNG HỌC SINH CÒN YẾU CẦN CHÚ Ý: ${weakTopics.join(", ")}\n` : ""}
`;

    const contents: any[] = [{ role: "user", parts: [{ text: contextPrompt + "\nBắt đầu phiên hỗ trợ gia sư." }] }];
    contents.push({ role: "model", parts: [{ text: "Chào em! Thầy/Cô là Trợ lý Học tập AI của em. Em đang gặp khó khăn ở phần kiến thức hay câu hỏi nào, hãy chia sẻ để chúng ta cùng giải quyết nhé!" }] });

    for (const h of history.slice(-8)) {
      if (h.role === "user" || h.role === "model") {
        contents.push({
          role: h.role,
          parts: [{ text: h.text }],
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents,
      config: {
        systemInstruction,
      },
    });

    return res.json({ success: true, reply: response.text });
  } catch (err: any) {
    console.warn("Gemini tutor-chat error (quota/network), using fallback tutor reply:", err.message);
    const reply = `Chào em! Theo tài liệu bài học **"${topic}"** (${subject} lớp ${grade}):
Đối với câu hỏi của em: *" ${message} "*:
Thầy/Cô khuyên em hãy chú ý:
1. Xem lại định nghĩa và các quy tắc chính trong mục **Tóm tắt lý thuyết**.
2. Để tìm ra câu trả lời chính xác, em hãy thử xác định từ khóa và quy tắc tương ứng trong tài liệu bài học nhé!
*(Gia sư AI luôn đồng hành hướng dẫn em tư duy từng bước mà không giải bài hộ)*`;
    return res.json({ success: true, reply, fallback: true });
  }
});

// -------------------------------------------------------------
// Instant Question Feedback API (/api/check-question-answer)
// Evaluates a single question answer for Standard or Quizizz mode
// when instant_feedback is enabled by the teacher.
// -------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://zhixpglctyfffpwamixv.supabase.co";
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoaXhwZ2xjdHlmZmZwd2FtaXh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjAxODYsImV4cCI6MjA5MzUzNjE4Nn0.cjGa8bgMIVlJ_LrEbW_0qDYBxAC4ykhlgmxd9OFq1e4";

const SYSTEM_BRIDGE = {
  email: "system_bridge_admin@system.local",
  password: "BridgeAdmin@Secret2026",
};

let serverSupabaseClient: any = null;

async function getServerSupabase() {
  if (!serverSupabaseClient) {
    serverSupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    await serverSupabaseClient.auth.signInWithPassword(SYSTEM_BRIDGE);
  }
  return serverSupabaseClient;
}

app.post("/api/check-question-answer", async (req, res) => {
  try {
    const { examId, questionId, answer, examCode, fallbackQuestion } = req.body || {};
    if (!examId || !questionId) {
      return res.status(400).json({ error: "Missing examId or questionId" });
    }

    const isUuid = (str: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || "").trim());

    let examData: any = null;

    // 1. Try finding in sample exams first
    let sample =
      findSampleExam(examId) ||
      getSampleExamById(examId) ||
      getSampleExamByCode(examId) ||
      (examCode ? findSampleExam(examCode) || getSampleExamByCode(examCode) : null);

    if (!sample) {
      // Also try finding sample exam by scanning all sample questions for questionId
      for (const s of SAMPLE_EXAMS) {
        const p1 = s.questions?.partI || [];
        const p2 = s.questions?.partII || [];
        const p3 = s.questions?.partIII || [];
        if (
          p1.some((q: any) => q.id === questionId) ||
          p2.some((q: any) => q.id === questionId) ||
          p3.some((q: any) => q.id === questionId)
        ) {
          sample = s;
          break;
        }
      }
    }

    if (sample) {
      examData = sample;
    } else {
      // 2. Fetch from Supabase exams table using system bridge
      try {
        const sb = await getServerSupabase();
        let targetUuid = isUuid(examId) ? examId : "";

        // If not UUID, try looking up code in schools registry or team_config
        const codeToTry = !targetUuid ? examId : examCode;
        if (!targetUuid && codeToTry) {
          const { data: sch } = await sb
            .from("schools")
            .select("name")
            .eq("name_key", `assign_code:${codeToTry}`)
            .maybeSingle();
          if (sch?.name) {
            try {
              const parsed = JSON.parse(sch.name);
              if (parsed?.examId && isUuid(parsed.examId)) targetUuid = parsed.examId;
            } catch {}
          }
        }

        if (!targetUuid && codeToTry) {
          const { data: exRow } = await sb
            .from("exams")
            .select("id")
            .filter("team_config->>primary_code", "eq", codeToTry)
            .maybeSingle();
          if (exRow?.id && isUuid(exRow.id)) targetUuid = exRow.id;
        }

        if (targetUuid) {
          let { data } = await sb
            .from("exams")
            .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
            .eq("id", targetUuid)
            .single();

          if (!data) {
            // Retry re-auth once in case session expired
            serverSupabaseClient = null;
            const freshSb = await getServerSupabase();
            const retry = await freshSb
              .from("exams")
              .select("id, questions, instant_feedback, display_mode, open_at, close_at, manual_closed")
              .eq("id", targetUuid)
              .single();
            data = retry.data;
          }

          if (data) {
            examData = data;
          }
        }
      } catch (err: any) {
        console.warn("Error fetching exam from Supabase in server:", err?.message);
      }
    }

    // 3. Fallback to client-provided fallbackQuestion if examData is not in DB
    if (!examData && fallbackQuestion && (fallbackQuestion.answer !== undefined || fallbackQuestion.items)) {
      const fbQ = fallbackQuestion;
      examData = {
        id: examId,
        questions: {
          partI: fbQ._part === 1 || fbQ.type === "mc" ? [fbQ] : [],
          partII: fbQ._part === 2 || fbQ.type === "tf" ? [fbQ] : [],
          partIII: fbQ._part === 3 || fbQ.type === "sa" ? [fbQ] : [],
        },
      };
    }

    if (!examData) {
      return res.status(404).json({ error: "Không tìm thấy đề thi" });
    }

    let qs = examData.questions || {};
    if (typeof qs === "string") {
      try {
        qs = JSON.parse(qs);
      } catch {
        qs = {};
      }
    }
    if (qs.questions && !qs.partI && !qs.partII && !qs.partIII) {
      qs = qs.questions;
      if (typeof qs === "string") {
        try {
          qs = JSON.parse(qs);
        } catch {
          qs = {};
        }
      }
    }

    let p1 = Array.isArray(qs.partI) ? qs.partI : Array.isArray(qs.part1) ? qs.part1 : Array.isArray(qs.PartI) ? qs.PartI : [];
    let p2 = Array.isArray(qs.partII) ? qs.partII : Array.isArray(qs.part2) ? qs.part2 : Array.isArray(qs.PartII) ? qs.PartII : [];
    let p3 = Array.isArray(qs.partIII) ? qs.partIII : Array.isArray(qs.part3) ? qs.part3 : Array.isArray(qs.PartIII) ? qs.PartIII : [];

    if (Array.isArray(qs)) {
      p1 = qs.filter((q: any) => q.type === "mc" || q._part === 1);
      p2 = qs.filter((q: any) => q.type === "tf" || q._part === 2);
      p3 = qs.filter((q: any) => q.type === "sa" || q._part === 3);
    }

    const matchQ = (q: any, i: number, prefix: string) => {
      if (!q) return false;
      const qid = String(q.id || "").toLowerCase();
      const targetId = String(questionId || "").toLowerCase();
      if (qid && qid === targetId) return true;
      if (targetId === `${prefix}_q_${i + 1}` || targetId === `q_${i + 1}`) return true;
      if (qid && qid.replace(new RegExp(`^${prefix}_`), "") === targetId.replace(new RegExp(`^${prefix}_`), "")) return true;
      return false;
    };

    // Part I: MC
    const q1 = p1.find((q: any, i: number) => matchQ(q, i, "p1"));
    if (q1) {
      const isCorrect = String(answer ?? "").trim().toUpperCase() === String(q1.answer ?? "").trim().toUpperCase();
      return res.json({
        type: "mc",
        correct: isCorrect,
        answer: q1.answer,
        explanation: q1.explanation || "",
      });
    }

    // Part II: TF
    const q2 = p2.find((q: any, i: number) => matchQ(q, i, "p2"));
    if (q2) {
      const items = Array.isArray(q2.items) ? q2.items : [];
      let okItems = 0;
      const chosen = answer || {};
      const evaluatedItems = items.map((it: any) => {
        let studentVal: boolean | null = null;
        if (Array.isArray(chosen)) {
          studentVal = chosen.includes(it.key);
        } else if (typeof chosen === "object" && chosen !== null) {
          if (typeof chosen[it.key] === "boolean") studentVal = chosen[it.key];
        }
        const correctVal = !!it.correct;
        const isItemOk = studentVal !== null && studentVal === correctVal;
        if (isItemOk) okItems++;
        return {
          key: it.key,
          correct: correctVal,
          student: studentVal,
        };
      });
      const isCorrect = items.length > 0 && okItems === items.length;
      return res.json({
        type: "tf",
        correct: isCorrect,
        okItems,
        totalItems: items.length,
        items: evaluatedItems,
        explanation: q2.explanation || "",
      });
    }

    // Part III: SA
    const q3 = p3.find((q: any, i: number) => matchQ(q, i, "p3"));
    if (q3) {
      const strip = (t: string) => (t || "").replace(/<[^>]*>/g, "").trim().toLowerCase();
      const correctAns = strip(q3.answer || "");
      const given = strip(String(answer ?? ""));
      let isCorrect = given !== "" && given === correctAns;
      if (!isCorrect && given !== "" && correctAns !== "") {
        const numGiven = parseFloat(given.replace(",", "."));
        const numAns = parseFloat(correctAns.replace(",", "."));
        if (!isNaN(numGiven) && !isNaN(numAns) && Math.abs(numGiven - numAns) < 1e-6) {
          isCorrect = true;
        }
      }
      return res.json({
        type: "sa",
        correct: isCorrect,
        answer: q3.answer,
        explanation: q3.explanation || "",
      });
    }

    return res.status(404).json({ error: "Không tìm thấy câu hỏi trong đề" });
  } catch (err: any) {
    console.error("check-question-answer server error:", err);
    return res.status(500).json({ error: "Lỗi hệ thống khi kiểm tra đáp án" });
  }
});

// -------------------------------------------------------------
// Vite Server Integration (Middleware in Dev, Static in Prod)
// -------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port: PORT },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
