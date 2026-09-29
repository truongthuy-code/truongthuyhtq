import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

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
