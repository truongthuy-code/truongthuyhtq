import { KnowledgeBase } from "./learningMaterials";

export interface QuickTestQuestion {
  id: string;
  type: "mc" | "tf" | "short";
  conceptAspect: string;
  question: string;
  options?: { key: string; text: string }[];
  tfItems?: { key: string; text: string; correct: boolean }[];
  correctAnswer: string;
  explanation: string;
}

export interface PracticeQuizQuestion {
  id: string;
  number: number;
  type: "mc" | "tf";
  level: "Cơ bản" | "Thông hiểu" | "Vận dụng";
  concept: string;
  stem: string;
  options?: { key: "A" | "B" | "C" | "D"; text: string }[];
  mcAnswer?: "A" | "B" | "C" | "D";
  tfItems?: { key: "a" | "b" | "c" | "d"; text: string; isCorrect: boolean; explanation: string }[];
  explanation: string;
}

export async function analyzeDocumentWithAI(params: {
  text: string;
  subject: string;
  grade: string;
  topic: string;
  title: string;
  imageBase64?: string;
}): Promise<KnowledgeBase> {
  const res = await fetch("/api/ai/analyze-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Không thể phân tích tài liệu bằng AI");
  }

  const data = await res.json();
  return data.knowledgeBase;
}

export async function summarizeLessonWithAI(params: {
  materialText: string;
  subject: string;
  grade: string;
  topic: string;
}): Promise<string> {
  const res = await fetch("/api/ai/summarize-lesson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Không thể tóm tắt bài học");
  }

  const data = await res.json();
  return data.summary;
}

export async function generateQuickTestWithAI(params: {
  materialText: string;
  subject: string;
  grade: string;
  topic: string;
}): Promise<QuickTestQuestion[]> {
  const res = await fetch("/api/ai/quick-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Không thể tạo câu hỏi kiểm tra nhanh");
  }

  const data = await res.json();
  return data.questions || [];
}

export async function generatePracticeQuizWithAI(params: {
  materialText: string;
  subject: string;
  grade: string;
  topic: string;
  count: 10 | 20;
}): Promise<PracticeQuizQuestion[]> {
  const res = await fetch("/api/ai/practice-quiz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Không thể tạo bài tập ôn luyện");
  }

  const data = await res.json();
  return data.questions || [];
}

export async function chatWithTutorAI(params: {
  message: string;
  history?: { role: "user" | "model"; text: string }[];
  materialText: string;
  subject: string;
  grade: string;
  topic: string;
  currentQuestionContext?: any;
  weakTopics?: string[];
}): Promise<string> {
  const res = await fetch("/api/ai/tutor-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Không thể kết nối với Gia sư AI");
  }

  const data = await res.json();
  return data.reply;
}
