import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles,
  Bot,
  GraduationCap,
  BookOpen,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  Send,
  MessageSquare,
  Trophy,
  RotateCcw,
  Check,
  X,
  Lightbulb,
  FileCheck2,
  ChevronRight,
  Target,
  Edit3,
  Flame,
  Award,
  BookMarked,
  Library,
  Home,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  getAllMaterials,
  getActiveMaterialsForAI,
  getAvailableSubjects,
  getAvailableTopics,
  LearningMaterial,
} from "@/lib/learningMaterials";
import {
  summarizeLessonWithAI,
  generateQuickTestWithAI,
  generatePracticeQuizWithAI,
  chatWithTutorAI,
  QuickTestQuestion,
  PracticeQuizQuestion,
} from "@/lib/aiAssistantClient";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import {
  recordQuickTestResult,
  recordPracticeQuizResult,
  getStudentProgressForTopic,
  getAllStudentProgress,
  WrongQuestionRecord,
} from "@/lib/studentLearningProgress";

export type StepType =
  | "intent" // 1. Chọn nhu cầu
  | "grade" // 2. Chọn lớp
  | "subject" // 3. Chọn môn
  | "topic" // 4. Chọn bài/chủ đề
  | "summary" // 5. Tóm tắt lý thuyết
  | "quick_test" // 6. Kiểm tra nhanh (3-5 câu)
  | "practice" // 7. Luyện tập 10/20 câu
  | "results" // 8. Kết quả & Phân tích
  | "tutor_chat"; // 9. Gia sư AI / Hỏi đáp

// Progress Bar Steps Definition
const STEPS_NAV = [
  { key: "intent", label: "Nhu cầu" },
  { key: "grade", label: "Lớp" },
  { key: "subject", label: "Môn" },
  { key: "topic", label: "Bài học" },
  { key: "summary", label: "Lý thuyết" },
  { key: "quick_test", label: "Kiểm tra nhanh" },
  { key: "practice", label: "Luyện tập" },
  { key: "results", label: "Kết quả" },
  { key: "tutor_chat", label: "Gia sư AI" },
];

export default function AiLearningAssistantStudent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { student } = useStudentAuth();

  // Wizard State
  const [currentStep, setCurrentStep] = useState<StepType>("intent");
  const [selectedIntent, setSelectedIntent] = useState<"learn" | "tutor_homework" | "practice" | "review" | "chat">("learn");

  // Selection
  const [selectedGrade, setSelectedGrade] = useState<string>("12");
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [currentMaterial, setCurrentMaterial] = useState<LearningMaterial | null>(null);

  // Step 5: Summary State
  const [summaryText, setSummaryText] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Step 6: Quick Test State (3-5 questions)
  const [quickTestQuestions, setQuickTestQuestions] = useState<QuickTestQuestion[]>([]);
  const [quickTestAnswers, setQuickTestAnswers] = useState<Record<string, string>>({});
  const [loadingQuickTest, setLoadingQuickTest] = useState(false);
  const [quickTestSubmitted, setQuickTestSubmitted] = useState(false);
  const [quickTestAnalysis, setQuickTestAnalysis] = useState<{
    correctCount: number;
    totalCount: number;
    masteredAspects: string[];
    needReviewAspects: string[];
  } | null>(null);

  // Step 7: Practice Quiz State (10 or 20 questions)
  const [quizCountChoice, setQuizCountChoice] = useState<10 | 20>(10);
  const [quizQuestions, setQuizQuestions] = useState<PracticeQuizQuestion[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, any>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizStartTime, setQuizStartTime] = useState<number>(0);
  const [timeSpentSeconds, setTimeSpentSeconds] = useState(0);

  // Step 8: Quiz Evaluation State
  const [quizResultAnalysis, setQuizResultAnalysis] = useState<{
    correctCount: number;
    totalCount: number;
    percentage: number;
    masteredNotes: string[];
    mistakeNotes: string[];
    reviewRecommendations: string[];
    wrongQuestionsList: WrongQuestionRecord[];
  } | null>(null);

  // Step 9: Tutor Chat State
  const [chatMessages, setChatMessages] = useState<
    { id: string; role: "user" | "model"; text: string; timestamp: string }[]
  >([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Student identification info
  const studentAccount = student?.account || "student_guest";
  const studentName = student?.fullName || "Học sinh";
  const className = student?.className || "12A1";

  // Pre-fill grade if student logged in
  useEffect(() => {
    if (student?.className) {
      const match = student.className.match(/^(\d+)/);
      if (match && ["10", "11", "12", "9", "8", "7", "6"].includes(match[1])) {
        setSelectedGrade(match[1]);
      }
    }
  }, [student]);

  // Available subjects for the selected grade
  const availableSubjects = useMemo(() => {
    return getAvailableSubjects(selectedGrade);
  }, [selectedGrade]);

  // Available topics for the selected subject and grade
  const availableTopics = useMemo(() => {
    if (!selectedSubject) return [];
    return getAvailableTopics(selectedSubject, selectedGrade);
  }, [selectedSubject, selectedGrade]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isSendingChat]);

  // Step index calculation for progress bar
  const currentStepIndex = useMemo(() => {
    const idx = STEPS_NAV.findIndex((s) => s.key === currentStep);
    return idx >= 0 ? idx : 0;
  }, [currentStep]);

  const progressPercent = useMemo(() => {
    return Math.round(((currentStepIndex + 1) / STEPS_NAV.length) * 100);
  }, [currentStepIndex]);

  // --------------------------------------------------------------------------
  // ACTIONS: Navigation & Step Handling
  // --------------------------------------------------------------------------

  const handleSelectIntent = (intent: "learn" | "tutor_homework" | "practice" | "review" | "chat") => {
    setSelectedIntent(intent);
    if (intent === "review") {
      // Go to review of past results / weak topics
      setCurrentStep("results");
    } else {
      setCurrentStep("grade");
    }
  };

  const handleSelectGrade = (grade: string) => {
    setSelectedGrade(grade);
    setCurrentStep("subject");
  };

  const handleSelectSubject = (subject: string) => {
    setSelectedSubject(subject);
    setCurrentStep("topic");
  };

  const handleSelectTopic = async (topic: string, materialId?: string) => {
    setSelectedTopic(topic);

    // Find the material
    const activeList = getActiveMaterialsForAI(selectedSubject, selectedGrade, topic);
    const mat = activeList[0] || (materialId ? getAllMaterials().find((m) => m.id === materialId) : null);
    setCurrentMaterial(mat || null);

    if (!mat) {
      toast.error("Không tìm thấy tài liệu bài học này!");
      return;
    }

    if (selectedIntent === "chat" || selectedIntent === "tutor_homework") {
      // Jump directly to tutor chat
      setCurrentStep("tutor_chat");
      initializeChat(mat);
    } else if (selectedIntent === "practice") {
      // Jump directly to practice quiz
      setCurrentStep("practice");
      startPracticeQuiz(mat, quizCountChoice);
    } else {
      // Standard flow: Start with Step 5: Tóm tắt lý thuyết
      setCurrentStep("summary");
      loadSummary(mat);
    }
  };

  // --------------------------------------------------------------------------
  // STEP 5: Tóm tắt lý thuyết (Summarize Lesson)
  // --------------------------------------------------------------------------
  const loadSummary = async (mat: LearningMaterial) => {
    setLoadingSummary(true);
    try {
      if (mat.knowledgeBase?.summary && mat.knowledgeBase.concepts.length > 0) {
        // Build structured rich markdown summary immediately from knowledge base
        const structured = `# 📖 TÓM TẮT KIẾN THỨC: ${mat.topic}
*Môn: ${mat.subject} – Lớp ${mat.grade}*

${mat.knowledgeBase.summary}

### 1. Khái niệm & Định nghĩa
${mat.knowledgeBase.concepts.map((c) => `- **${c.name}**: ${c.definition}`).join("\n")}

### 2. Nội dung quan trọng
${mat.knowledgeBase.mainTopics.map((t) => `- ${t}`).join("\n")}

### 3. Quy tắc cần nhớ
${mat.knowledgeBase.rules.length > 0 ? mat.knowledgeBase.rules.map((r) => `- ${r}`).join("\n") : "- Tuân thủ cú pháp và quy chuẩn theo tài liệu của giáo viên."}

### 4. Ví dụ áp dụng
${mat.knowledgeBase.examples.length > 0 ? mat.knowledgeBase.examples.map((ex) => "```\n" + ex + "\n```").join("\n") : "*(Các ví dụ minh họa chi tiết trong tài liệu giáo viên)*"}

### 5. Kiến thức cần ghi nhớ
${mat.knowledgeBase.keyTakeaways.map((k) => `✅ **${k}**`).join("\n")}`;

        setSummaryText(structured);
      } else {
        // Request Gemini to generate 5-part summary
        const text = await summarizeLessonWithAI({
          materialText: mat.rawContent,
          subject: mat.subject,
          grade: mat.grade,
          topic: mat.topic,
        });
        setSummaryText(text);
      }
    } catch (err: any) {
      toast.error("Lỗi tạo tóm tắt: " + err.message);
      setSummaryText(mat.rawContent || "Nội dung bài học theo tài liệu giáo viên.");
    } finally {
      setLoadingSummary(false);
    }
  };

  // --------------------------------------------------------------------------
  // STEP 6: Kiểm tra nhanh sau khi học (Quick Test 3-5 câu)
  // --------------------------------------------------------------------------
  const startQuickTest = async () => {
    if (!currentMaterial) return;
    setCurrentStep("quick_test");
    setLoadingQuickTest(true);
    setQuickTestSubmitted(false);
    setQuickTestAnswers({});
    setQuickTestAnalysis(null);

    try {
      const questions = await generateQuickTestWithAI({
        materialText: currentMaterial.rawContent,
        subject: currentMaterial.subject,
        grade: currentMaterial.grade,
        topic: currentMaterial.topic,
      });

      if (questions.length === 0) {
        // Fallback quick questions from concepts
        const fallbackQs: QuickTestQuestion[] = (currentMaterial.knowledgeBase?.concepts || []).slice(0, 3).map((c, idx) => ({
          id: `q-fallback-${idx}`,
          type: "mc",
          conceptAspect: c.name,
          question: `Khái niệm "${c.name}" trong bài học có ý nghĩa gì?`,
          options: [
            { key: "A", text: c.definition },
            { key: "B", text: "Một phương thức không liên quan đến bài học." },
            { key: "C", text: "Thẻ chỉ dùng để kết thúc văn bản." },
            { key: "D", text: "Thuộc tính chỉ dùng để đổi màu nền." },
          ],
          correctAnswer: "A",
          explanation: `Theo tài liệu bài học: ${c.name} là ${c.definition}.`,
        }));
        setQuickTestQuestions(fallbackQs);
      } else {
        setQuickTestQuestions(questions);
      }
    } catch (err: any) {
      toast.error("Lỗi tạo kiểm tra nhanh: " + err.message);
    } finally {
      setLoadingQuickTest(false);
    }
  };

  const handleAnswerQuickTest = (qId: string, val: string) => {
    if (quickTestSubmitted) return;
    setQuickTestAnswers((prev) => ({ ...prev, [qId]: val }));
  };

  const handleSubmitQuickTest = () => {
    let correct = 0;
    const mastered: string[] = [];
    const needReview: string[] = [];

    quickTestQuestions.forEach((q) => {
      const userAns = quickTestAnswers[q.id]?.trim();
      const isCorrect = userAns && userAns.toUpperCase() === q.correctAnswer.trim().toUpperCase();
      if (isCorrect) {
        correct++;
        mastered.push(q.conceptAspect);
      } else {
        needReview.push(q.conceptAspect);
      }
    });

    const analysis = {
      correctCount: correct,
      totalCount: quickTestQuestions.length,
      masteredAspects: Array.from(new Set(mastered)),
      needReviewAspects: Array.from(new Set(needReview)),
    };

    setQuickTestAnalysis(analysis);
    setQuickTestSubmitted(true);

    // Save record
    if (currentMaterial) {
      recordQuickTestResult({
        studentAccount,
        studentName,
        className,
        grade: selectedGrade,
        subject: selectedSubject,
        topic: selectedTopic,
        total: quickTestQuestions.length,
        correct,
        masteredAspects: analysis.masteredAspects,
        needReviewAspects: analysis.needReviewAspects,
      });
    }

    toast.success(`Đã nộp bài kiểm tra nhanh! Kết quả: ${correct}/${quickTestQuestions.length} câu đúng.`);
  };

  // --------------------------------------------------------------------------
  // STEP 7: Luyện tập 10 hoặc 20 câu (Practice Quiz)
  // --------------------------------------------------------------------------
  const startPracticeQuiz = async (mat?: LearningMaterial, countChoice: 10 | 20 = 10) => {
    const targetMat = mat || currentMaterial;
    if (!targetMat) return;
    setQuizCountChoice(countChoice);
    setCurrentStep("practice");
    setLoadingQuiz(true);
    setQuizSubmitted(false);
    setUserAnswers({});
    setQuizResultAnalysis(null);
    setQuizStartTime(Date.now());

    try {
      const questions = await generatePracticeQuizWithAI({
        materialText: targetMat.rawContent,
        subject: targetMat.subject,
        grade: targetMat.grade,
        topic: targetMat.topic,
        count: countChoice,
      });

      setQuizQuestions(questions);
    } catch (err: any) {
      toast.error("Lỗi tạo bài tập ôn luyện: " + err.message);
    } finally {
      setLoadingQuiz(false);
    }
  };

  const handleAnswerMC = (qId: string, optKey: string) => {
    if (quizSubmitted) return;
    setUserAnswers((prev) => ({ ...prev, [qId]: optKey }));
  };

  const handleAnswerTF = (qId: string, itemKey: string, val: boolean) => {
    if (quizSubmitted) return;
    setUserAnswers((prev) => {
      const current = prev[qId] || {};
      return {
        ...prev,
        [qId]: {
          ...current,
          [itemKey]: val,
        },
      };
    });
  };

  const handleSubmitPracticeQuiz = () => {
    const spentSecs = Math.round((Date.now() - quizStartTime) / 1000);
    setTimeSpentSeconds(spentSecs);

    let correctCount = 0;
    const mastered: string[] = [];
    const mistakes: string[] = [];
    const wrongList: WrongQuestionRecord[] = [];

    quizQuestions.forEach((q) => {
      if (q.type === "mc") {
        const userChoice = userAnswers[q.id];
        const isRight = userChoice === q.mcAnswer;
        if (isRight) {
          correctCount++;
          mastered.push(q.concept);
        } else {
          mistakes.push(q.concept);
          wrongList.push({
            id: q.id,
            type: "mc",
            questionText: q.stem,
            userAnswer: userChoice || "Chưa chọn",
            correctAnswer: q.mcAnswer || "A",
            explanation: q.explanation,
            topic: q.concept,
          });
        }
      } else if (q.type === "tf") {
        // True/False: all 4 items must be correct or calculate partial
        const userTf = userAnswers[q.id] || {};
        let itemsRight = 0;
        q.tfItems?.forEach((item) => {
          if (userTf[item.key] === item.isCorrect) {
            itemsRight++;
          }
        });
        if (itemsRight === (q.tfItems?.length || 4)) {
          correctCount++;
          mastered.push(q.concept);
        } else {
          mistakes.push(q.concept);
          wrongList.push({
            id: q.id,
            type: "tf",
            questionText: q.stem,
            userAnswer: `Đúng ${itemsRight}/4 ý`,
            correctAnswer: (q.tfItems || []).map((it) => `${it.key}) ${it.isCorrect ? "Đúng" : "Sai"}`).join("; "),
            explanation: q.explanation,
            topic: q.concept,
          });
        }
      }
    });

    const totalCount = quizQuestions.length;
    const percentage = Math.round((correctCount / Math.max(totalCount, 1)) * 100);

    const masteredUnique = Array.from(new Set(mastered));
    const mistakesUnique = Array.from(new Set(mistakes));

    const analysis = {
      correctCount,
      totalCount,
      percentage,
      masteredNotes: masteredUnique,
      mistakeNotes: mistakesUnique,
      reviewRecommendations: mistakesUnique.length > 0
        ? mistakesUnique.map((m) => `Em nên đọc lại phần "${m}" trong mục Tóm tắt lý thuyết.`)
        : ["Em đã nắm rất vững toàn bộ bài học này! Có thể thử sức với bài học tiếp theo."],
      wrongQuestionsList: wrongList,
    };

    setQuizResultAnalysis(analysis);
    setQuizSubmitted(true);
    setCurrentStep("results");

    // Record progress
    recordPracticeQuizResult({
      studentAccount,
      studentName,
      className,
      grade: selectedGrade,
      subject: selectedSubject,
      topic: selectedTopic,
      mode: quizCountChoice,
      total: totalCount,
      correct: correctCount,
      wrongQuestions: wrongList,
      masteredNotes: analysis.masteredNotes,
      mistakeNotes: analysis.mistakeNotes,
      reviewRecommendations: analysis.reviewRecommendations,
      nextAction: mistakesUnique.length > 0 ? "Ôn lại các câu sai" : "Tiếp tục bài mới",
    });

    toast.success(`Đã nộp bài ôn luyện! Đúng: ${correctCount}/${totalCount} câu (${percentage}%).`);
  };

  // --------------------------------------------------------------------------
  // STEP 9: Gia sư AI Chat (Tutor Chat)
  // --------------------------------------------------------------------------
  const initializeChat = (mat: LearningMaterial, initialMsg?: string) => {
    setChatMessages([
      {
        id: "msg-welcome",
        role: "model",
        text: `Chào ${studentName}! Thầy/Cô là Trợ lý Học tập AI bài **"${mat.topic}"** (${mat.subject} lớp ${mat.grade}).\n\nThầy/Cô sẽ đồng hành, gợi ý và hướng dẫn em từng bước để hiểu sâu bản chất kiến thức. Em đang cần giải đáp câu hỏi nào, hay chưa rõ khái niệm nào? Hãy nhắn cho Thầy/Cô nhé!`,
        timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    if (initialMsg) {
      setTimeout(() => sendChatMessage(initialMsg), 300);
    }
  };

  const sendChatMessage = async (msgOverride?: string) => {
    const textToSend = (msgOverride || inputMessage).trim();
    if (!textToSend || !currentMaterial) return;

    const userMsg = {
      id: "msg-user-" + Date.now(),
      role: "user" as const,
      text: textToSend,
      timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setIsSendingChat(true);

    try {
      const history = chatMessages.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const reply = await chatWithTutorAI({
        message: textToSend,
        history,
        materialText: currentMaterial.rawContent,
        subject: currentMaterial.subject,
        grade: currentMaterial.grade,
        topic: currentMaterial.topic,
        weakTopics: quizResultAnalysis?.mistakeNotes || [],
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: "msg-ai-" + Date.now(),
          role: "model",
          text: reply,
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      toast.error("Lỗi gia sư AI: " + err.message);
      setChatMessages((prev) => [
        ...prev,
        {
          id: "msg-err-" + Date.now(),
          role: "model",
          text: "*(Hệ thống đang gặp gián đoạn tạm thời. Em vui lòng thử lại sau giây lát nhé!)*",
          timestamp: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsSendingChat(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* HEADER */}
      <header className="border-b bg-white/90 backdrop-blur sticky top-0 z-30 shadow-xs">
        <div className="container max-w-5xl flex items-center justify-between py-3 px-4">
          <div className="flex items-center gap-3">
            <Link to="/student" className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition">
              <ArrowLeft className="size-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="size-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white grid place-items-center shadow-soft">
                <Bot className="size-5" />
              </div>
              <div>
                <div className="font-extrabold text-sm md:text-base text-slate-900 flex items-center gap-1.5">
                  TRỢ LÝ HỌC TẬP AI
                  <Badge variant="outline" className="text-[10px] bg-indigo-50 border-indigo-200 text-indigo-700 py-0">
                    Gia sư thông minh
                  </Badge>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {selectedTopic ? `${selectedSubject} ${selectedGrade} • ${selectedTopic}` : "Đồng hành học tập cá nhân hóa"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-right">
            <div className="hidden sm:block">
              <div className="text-xs font-bold text-slate-800">{studentName}</div>
              <div className="text-[11px] text-muted-foreground">Lớp {className}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentStep("intent")}
              className="text-xs h-8 border-slate-200 hover:bg-slate-100"
            >
              <Home className="size-3.5 mr-1" /> Trang đầu
            </Button>
          </div>
        </div>

        {/* PROGRESS BAR 9 BƯỚC */}
        <div className="border-t bg-slate-50/70 px-4 py-2 overflow-x-auto">
          <div className="container max-w-5xl">
            <div className="flex items-center justify-between min-w-[620px] gap-1 text-[11px] font-semibold text-slate-500">
              {STEPS_NAV.map((step, idx) => {
                const isPassed = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                return (
                  <div
                    key={step.key}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all ${
                      isCurrent
                        ? "bg-indigo-600 text-white shadow-xs font-bold"
                        : isPassed
                        ? "text-emerald-700 bg-emerald-50/80"
                        : "text-slate-400"
                    }`}
                  >
                    <span
                      className={`size-4 rounded-full text-[9px] grid place-items-center ${
                        isCurrent
                          ? "bg-white text-indigo-700 font-extrabold"
                          : isPassed
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {isPassed ? "✓" : idx + 1}
                    </span>
                    <span>{step.label}</span>
                    {idx < STEPS_NAV.length - 1 && <span className="text-slate-300 ml-1">›</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="container max-w-4xl py-6 px-4">
        {/* ==================================================================== */}
        {/* BƯỚC 1: CHỌN NHU CẦU (INTENT) */}
        {/* ==================================================================== */}
        {currentStep === "intent" && (
          <div className="space-y-6 animate-fade-in">
            {/* Lời chào chủ động của AI */}
            <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-600 text-white shadow-soft relative overflow-hidden">
              <div className="absolute -right-6 -bottom-6 size-40 rounded-full bg-white/10 blur-xl pointer-events-none" />
              <div className="flex items-center gap-3 mb-2">
                <div className="size-10 rounded-full bg-white/20 backdrop-blur grid place-items-center shadow-inner">
                  <Bot className="size-6 text-white" />
                </div>
                <div className="text-xs uppercase font-extrabold tracking-wider bg-white/20 px-2.5 py-0.5 rounded-full">
                  Trợ lý gia sư đồng hành
                </div>
              </div>
              <h2 className="text-xl md:text-2xl font-black mb-2">
                “Chào {studentName}! Hôm nay em muốn học tập hoặc ôn luyện nội dung nào?”
              </h2>
              <p className="text-xs md:text-sm text-indigo-100 max-w-2xl leading-relaxed">
                Thầy/Cô AI sẽ căn cứ chính xác vào tài liệu học tập của Giáo viên để hướng dẫn em học bài, tóm tắt lý thuyết,
                luyện tập trắc nghiệm và giải đáp câu hỏi một cách tận tình!
              </p>
            </div>

            {/* 5 Thẻ lựa chọn lớn */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Target className="size-4 text-indigo-600" /> Chọn nhu cầu học tập của em:
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. HỌC BÀI */}
                <Card
                  onClick={() => handleSelectIntent("learn")}
                  className="p-5 rounded-2xl border-2 border-indigo-100 hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all bg-white group"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="size-12 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center text-2xl group-hover:scale-105 transition-transform shrink-0">
                      📚
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
                        HỌC BÀI THEO QUY TRÌNH
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Quy trình học chuẩn: <strong>Tóm tắt lý thuyết</strong> → <strong>Kiểm tra nhanh 3–5 câu</strong> →{" "}
                        <strong>Luyện tập 10/20 câu</strong>.
                      </p>
                    </div>
                  </div>
                </Card>

                {/* 2. HỖ TRỢ BÀI TẬP */}
                <Card
                  onClick={() => handleSelectIntent("tutor_homework")}
                  className="p-5 rounded-2xl border-2 border-amber-100 hover:border-amber-500 hover:shadow-md cursor-pointer transition-all bg-white group"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="size-12 rounded-xl bg-amber-50 text-amber-600 grid place-items-center text-2xl group-hover:scale-105 transition-transform shrink-0">
                      ✏️
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-base text-slate-900 group-hover:text-amber-600 transition-colors">
                        HỖ TRỢ BÀI TẬP (CHẾ ĐỘ GIA SƯ)
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Gia sư gợi ý phương pháp, định hướng tư duy từng bước, <strong>không làm bài thay</strong> học sinh.
                      </p>
                    </div>
                  </div>
                </Card>

                {/* 3. LUYỆN TẬP */}
                <Card
                  onClick={() => handleSelectIntent("practice")}
                  className="p-5 rounded-2xl border-2 border-emerald-100 hover:border-emerald-500 hover:shadow-md cursor-pointer transition-all bg-white group"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="size-12 rounded-xl bg-emerald-50 text-emerald-600 grid place-items-center text-2xl group-hover:scale-105 transition-transform shrink-0">
                      🎯
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-base text-slate-900 group-hover:text-emerald-600 transition-colors">
                        LUYỆN TẬP 10 / 20 CÂU
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Làm ngay bài tập ôn luyện trắc nghiệm 4 lựa chọn và Đúng/Sai được tạo tự động từ tài liệu giáo viên.
                      </p>
                    </div>
                  </div>
                </Card>

                {/* 4. ÔN TẬP */}
                <Card
                  onClick={() => handleSelectIntent("review")}
                  className="p-5 rounded-2xl border-2 border-rose-100 hover:border-rose-500 hover:shadow-md cursor-pointer transition-all bg-white group"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="size-12 rounded-xl bg-rose-50 text-rose-600 grid place-items-center text-2xl group-hover:scale-105 transition-transform shrink-0">
                      🔄
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-base text-slate-900 group-hover:text-rose-600 transition-colors">
                        ÔN TẬP & XEM NỘI DUNG YẾU
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Xem lại các câu hỏi đã làm sai, phân tích điểm yếu và ôn lại kiến thức cần bổ sung.
                      </p>
                    </div>
                  </div>
                </Card>

                {/* 5. HỎI AI */}
                <Card
                  onClick={() => handleSelectIntent("chat")}
                  className="p-5 rounded-2xl border-2 border-sky-100 hover:border-sky-500 hover:shadow-md cursor-pointer transition-all bg-white group md:col-span-2"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="size-12 rounded-xl bg-sky-50 text-sky-600 grid place-items-center text-2xl group-hover:scale-105 transition-transform shrink-0">
                      ❓
                    </div>
                    <div className="space-y-1">
                      <div className="font-extrabold text-base text-slate-900 group-hover:text-sky-600 transition-colors">
                        HỎI ĐÁP GIA SƯ AI TRỰC TIẾP
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Trò chuyện tự do với Gia sư AI, đặt bất kỳ câu hỏi nào về nội dung bài học trong tài liệu.
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 2: CHỌN LỚP (GRADE) */}
        {/* ==================================================================== */}
        {currentStep === "grade" && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center space-y-1">
              <Badge className="bg-indigo-100 text-indigo-700">Bước 2</Badge>
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Em đang học Lớp mấy?</h2>
              <p className="text-xs text-muted-foreground">Chọn khối lớp để hiển thị tài liệu học tập phù hợp</p>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-3 gap-4 max-w-lg mx-auto pt-2">
              {["10", "11", "12"].map((g) => (
                <Card
                  key={g}
                  onClick={() => handleSelectGrade(g)}
                  className={`p-6 text-center cursor-pointer rounded-2xl border-2 hover:shadow-md transition-all ${
                    selectedGrade === g
                      ? "border-indigo-600 bg-indigo-50/50 shadow-sm"
                      : "border-slate-200 hover:border-indigo-400 bg-white"
                  }`}
                >
                  <div className="text-3xl mb-2">🎓</div>
                  <div className="font-black text-xl text-slate-900">LỚP {g}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">THPT</div>
                </Card>
              ))}
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep("intent")} className="text-xs">
                <ArrowLeft className="size-3.5 mr-1" /> Quay lại
              </Button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 3: CHỌN MÔN (SUBJECT) - LẤY ĐỘNG TỪ DỮ LIỆU */}
        {/* ==================================================================== */}
        {currentStep === "subject" && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center space-y-1">
              <Badge className="bg-indigo-100 text-indigo-700">Bước 3 • Lớp {selectedGrade}</Badge>
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Em muốn học Môn nào?</h2>
              <p className="text-xs text-muted-foreground">
                Danh sách các môn học hiện có tài liệu do giáo viên cung cấp trên hệ thống
              </p>
            </div>

            {availableSubjects.length === 0 ? (
              <div className="text-center py-12 p-6 rounded-2xl border border-dashed bg-white text-muted-foreground space-y-2">
                <BookOpen className="size-10 mx-auto text-slate-300" />
                <div className="text-sm font-semibold">Chưa có tài liệu cho Lớp {selectedGrade}.</div>
                <p className="text-xs">Vui lòng chọn khối lớp khác hoặc liên hệ giáo viên để tải tài liệu lên.</p>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep("grade")} className="mt-2 text-xs">
                  Chọn lớp khác
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
                {availableSubjects.map((sub) => (
                  <Card
                    key={sub}
                    onClick={() => handleSelectSubject(sub)}
                    className="p-5 rounded-2xl border-2 border-slate-200 hover:border-indigo-500 hover:shadow-md cursor-pointer transition-all bg-white text-center space-y-2 group"
                  >
                    <div className="size-12 rounded-xl bg-indigo-50 text-indigo-600 grid place-items-center mx-auto text-2xl group-hover:scale-105 transition-transform">
                      {sub.includes("Tin")
                        ? "💻"
                        : sub.includes("Toán")
                        ? "📐"
                        : sub.includes("Văn")
                        ? "📖"
                        : sub.includes("Lý")
                        ? "⚡"
                        : sub.includes("Hóa")
                        ? "🧪"
                        : sub.includes("Sinh")
                        ? "🌱"
                        : sub.includes("Anh")
                        ? "🌐"
                        : "📚"}
                    </div>
                    <div className="font-extrabold text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {sub}
                    </div>
                    <div className="text-xs text-muted-foreground">Khối {selectedGrade}</div>
                  </Card>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep("grade")} className="text-xs">
                <ArrowLeft className="size-3.5 mr-1" /> Quay lại
              </Button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 4: CHỌN BÀI / CHỦ ĐỀ (TOPIC) - LẤY ĐỘNG TỪ TÀI LIỆU */}
        {/* ==================================================================== */}
        {currentStep === "topic" && (
          <div className="space-y-5 animate-fade-in">
            <div className="text-center space-y-1">
              <Badge className="bg-indigo-100 text-indigo-700">
                Bước 4 • Môn {selectedSubject} Lớp {selectedGrade}
              </Badge>
              <h2 className="text-xl md:text-2xl font-extrabold text-slate-900">Em muốn học bài nào?</h2>
              <p className="text-xs text-muted-foreground">Các bài học được tổng hợp từ nguồn tài liệu giáo viên đã tải lên</p>
            </div>

            {availableTopics.length === 0 ? (
              <div className="text-center py-12 p-6 rounded-2xl border border-dashed bg-white text-muted-foreground space-y-2">
                <BookOpen className="size-10 mx-auto text-slate-300" />
                <div className="text-sm font-semibold">Chưa có bài học nào được kích hoạt.</div>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep("subject")} className="mt-2 text-xs">
                  Chọn môn khác
                </Button>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                {availableTopics.map((item, idx) => (
                  <Card
                    key={item.topic}
                    onClick={() => handleSelectTopic(item.topic, item.materialId)}
                    className="p-4 md:p-5 rounded-2xl border-2 border-slate-200 hover:border-indigo-600 hover:shadow-md cursor-pointer transition-all bg-white flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-xl bg-indigo-50 text-indigo-700 font-extrabold text-sm grid place-items-center shrink-0">
                        📘
                      </div>
                      <div>
                        <div className="font-extrabold text-base text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {item.topic}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{item.title}</div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <Badge variant="secondary" className="hidden sm:inline-flex text-[11px] bg-slate-100">
                        {selectedIntent === "practice" ? "Luyện tập" : "Bắt đầu học"}
                      </Badge>
                      <ChevronRight className="size-5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="ghost" onClick={() => setCurrentStep("subject")} className="text-xs">
                <ArrowLeft className="size-3.5 mr-1" /> Chọn môn khác
              </Button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 5: TÓM TẮT LÝ THUYẾT (SUMMARY - 5 PHẦN BẮT BUỘC) */}
        {/* ==================================================================== */}
        {currentStep === "summary" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
              <div>
                <div className="flex items-center gap-2 text-xs text-indigo-700 font-bold uppercase tracking-wider">
                  <BookMarked className="size-4" /> BƯỚC 1: TÓM TẮT LÝ THUYẾT BÀI HỌC
                </div>
                <h2 className="text-lg md:text-xl font-black text-slate-900 mt-0.5">{selectedTopic}</h2>
                <div className="text-xs text-muted-foreground">
                  Môn: <strong>{selectedSubject}</strong> • Lớp: <strong>{selectedGrade}</strong> • Nguồn:{" "}
                  <strong>{currentMaterial?.title || "Tài liệu giáo viên"}</strong>
                </div>
              </div>

              <Button
                onClick={startQuickTest}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-soft shrink-0"
              >
                Tiếp tục: Kiểm tra nhanh sau khi học <ArrowRight className="size-4 ml-1.5" />
              </Button>
            </div>

            {/* Nội dung tóm tắt */}
            <Card className="p-6 md:p-8 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-6">
              {loadingSummary ? (
                <div className="py-16 text-center space-y-3">
                  <RefreshCw className="size-8 text-indigo-600 animate-spin mx-auto" />
                  <div className="font-bold text-slate-800 text-sm">AI đang đọc tài liệu và đúc kết tóm tắt kiến thức...</div>
                  <p className="text-xs text-muted-foreground">Đảm bảo cấu trúc 5 phần: Khái niệm, Nội dung quan trọng, Quy tắc, Ví dụ, Ghi nhớ.</p>
                </div>
              ) : (
                <div className="prose prose-slate max-w-none prose-headings:font-black prose-headings:text-slate-900 prose-p:text-slate-800 prose-li:text-slate-800 leading-relaxed text-sm md:text-base">
                  <div className="whitespace-pre-wrap font-sans">{summaryText}</div>
                </div>
              )}
            </Card>

            <div className="flex justify-between items-center pt-2">
              <Button variant="ghost" onClick={() => setCurrentStep("topic")} className="text-xs">
                <ArrowLeft className="size-3.5 mr-1" /> Chọn bài khác
              </Button>

              <Button
                onClick={startQuickTest}
                size="lg"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md"
              >
                Hoàn thành đọc lý thuyết • Sang Kiểm tra nhanh (3–5 câu) <ArrowRight className="size-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 6: KIỂM TRA NHANH SAU KHI HỌC (QUICK TEST 3-5 CÂU) */}
        {/* ==================================================================== */}
        {currentStep === "quick_test" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
                  BƯỚC 2: KIỂM TRA NHANH SAU KHI HỌC
                </div>
                <h3 className="font-black text-slate-900 text-base md:text-lg">
                  “Bây giờ em hãy trả lời một số câu hỏi ngắn để kiểm tra xem mình đã nắm được kiến thức chưa nhé!”
                </h3>
              </div>
              <Badge className="bg-indigo-600 text-white font-bold shrink-0">
                {quickTestQuestions.length} câu hỏi
              </Badge>
            </div>

            {loadingQuickTest ? (
              <div className="py-16 text-center space-y-3 bg-white rounded-2xl border p-6">
                <RefreshCw className="size-8 text-indigo-600 animate-spin mx-auto" />
                <div className="font-bold text-slate-800 text-sm">AI đang tạo câu hỏi kiểm tra nhanh theo bài học...</div>
              </div>
            ) : (
              <div className="space-y-4">
                {quickTestQuestions.map((q, idx) => {
                  const userAns = quickTestAnswers[q.id];
                  const isChecked = quickTestSubmitted;
                  const isRight = userAns && userAns.toUpperCase() === q.correctAnswer.trim().toUpperCase();

                  return (
                    <Card
                      key={q.id}
                      className={`p-5 rounded-2xl border transition-all bg-white ${
                        isChecked
                          ? isRight
                            ? "border-emerald-300 bg-emerald-50/20"
                            : "border-rose-300 bg-rose-50/20"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="size-6 rounded-full bg-indigo-100 text-indigo-800 font-extrabold text-xs grid place-items-center">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Kiến thức: {q.conceptAspect}
                          </span>
                        </div>
                        {isChecked && (
                          <Badge className={isRight ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}>
                            {isRight ? "Đúng ✓" : "Chưa chính xác ✗"}
                          </Badge>
                        )}
                      </div>

                      <div className="font-bold text-slate-900 text-sm md:text-base mb-3 leading-snug">
                        {q.question}
                      </div>

                      {/* Options nếu có */}
                      {q.options && q.options.length > 0 ? (
                        <div className="space-y-2">
                          {q.options.map((opt) => {
                            const isSelected = userAns === opt.key;
                            return (
                              <div
                                key={opt.key}
                                onClick={() => handleAnswerQuickTest(q.id, opt.key)}
                                className={`p-3 rounded-xl border text-xs md:text-sm flex items-center justify-between cursor-pointer transition-all ${
                                  isSelected
                                    ? "border-indigo-600 bg-indigo-50 font-bold text-indigo-900"
                                    : "border-slate-200 hover:border-indigo-300 bg-slate-50/50 text-slate-800"
                                }`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <span
                                    className={`size-6 rounded-full text-xs font-bold grid place-items-center border ${
                                      isSelected
                                        ? "bg-indigo-600 text-white border-indigo-600"
                                        : "bg-white text-slate-600 border-slate-300"
                                    }`}
                                  >
                                    {opt.key}
                                  </span>
                                  <span>{opt.text}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <Input
                          placeholder="Nhập câu trả lời ngắn của em..."
                          value={userAns || ""}
                          onChange={(e) => handleAnswerQuickTest(q.id, e.target.value)}
                          disabled={isChecked}
                          className="mt-2 text-sm"
                        />
                      )}

                      {/* Giải thích khi đã nộp */}
                      {isChecked && (
                        <div className="mt-3 p-3 rounded-xl bg-slate-100 text-xs text-slate-800 space-y-1">
                          <div className="font-bold text-indigo-900">
                            Đáp án chính xác: <span className="text-emerald-700">{q.correctAnswer}</span>
                          </div>
                          <div>{q.explanation}</div>
                        </div>
                      )}
                    </Card>
                  );
                })}

                {/* Kết quả phân tích & Nút chuyển tiếp */}
                {!quickTestSubmitted ? (
                  <div className="flex justify-end pt-3">
                    <Button
                      onClick={handleSubmitQuickTest}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-2.5 rounded-xl shadow-soft"
                    >
                      Nộp câu trả lời kiểm tra nhanh
                    </Button>
                  </div>
                ) : (
                  <div className="p-5 rounded-2xl bg-white border border-indigo-100 shadow-sm space-y-4 animate-slide-up">
                    <div className="flex items-center justify-between">
                      <h4 className="font-black text-slate-900 text-base">
                        📊 Kết quả kiểm tra nhanh: {quickTestAnalysis?.correctCount}/{quickTestAnalysis?.totalCount} câu đúng
                      </h4>
                      <Badge
                        className={
                          (quickTestAnalysis?.correctCount || 0) >= Math.ceil((quickTestAnalysis?.totalCount || 4) / 2)
                            ? "bg-emerald-600 text-white"
                            : "bg-amber-600 text-white"
                        }
                      >
                        {(quickTestAnalysis?.correctCount || 0) >= Math.ceil((quickTestAnalysis?.totalCount || 4) / 2)
                          ? "Nắm bài tốt"
                          : "Cần xem lại"}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 space-y-1">
                        <div className="font-bold text-emerald-900 flex items-center gap-1">
                          <CheckCircle2 className="size-4 text-emerald-600" /> Em đã nắm khá tốt:
                        </div>
                        {quickTestAnalysis?.masteredAspects && quickTestAnalysis.masteredAspects.length > 0 ? (
                          <ul className="list-disc pl-5 text-emerald-800 space-y-0.5">
                            {quickTestAnalysis.masteredAspects.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-emerald-700 italic">Cần ôn lại thêm để nắm chắc các khái niệm.</p>
                        )}
                      </div>

                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 space-y-1">
                        <div className="font-bold text-amber-900 flex items-center gap-1">
                          <AlertTriangle className="size-4 text-amber-600" /> Em cần xem lại:
                        </div>
                        {quickTestAnalysis?.needReviewAspects && quickTestAnalysis.needReviewAspects.length > 0 ? (
                          <ul className="list-disc pl-5 text-amber-800 space-y-0.5">
                            {quickTestAnalysis.needReviewAspects.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-emerald-700 font-semibold">Tuyệt vời! Em không bị hổng kiến thức nào.</p>
                        )}
                      </div>
                    </div>

                    {/* 2 Nút điều hướng theo yêu cầu BƯỚC 3 */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => setCurrentStep("summary")}
                        className="w-full sm:w-auto border-amber-300 text-amber-900 hover:bg-amber-50 rounded-xl"
                      >
                        🔄 HỌC LẠI PHẦN CHƯA NẮM
                      </Button>

                      <div className="flex gap-2 w-full sm:w-auto">
                        <Button
                          onClick={() => startPracticeQuiz(currentMaterial || undefined, 10)}
                          className="flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
                        >
                          🎯 BẮT ĐẦU LUYỆN TẬP 10 CÂU
                        </Button>
                        <Button
                          onClick={() => startPracticeQuiz(currentMaterial || undefined, 20)}
                          className="flex-1 sm:flex-initial bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl"
                        >
                          🎯 LUYỆN TẬP 20 CÂU
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 7: BÀI TẬP ÔN LUYỆN (10 CÂU HOẶC 20 CÂU - BẮT BUỘC DẠNG 1 & 2) */}
        {/* ==================================================================== */}
        {currentStep === "practice" && (
          <div className="space-y-6 animate-fade-in">
            {/* Header Mode */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
              <div>
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
                  BƯỚC 4: HỆ THỐNG BÀI TẬP ÔN LUYỆN
                </div>
                <h3 className="font-black text-slate-900 text-base md:text-lg">
                  {selectedTopic} ({quizQuestions.length} câu trắc nghiệm)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Gồm Trắc nghiệm 4 lựa chọn (A, B, C, D) & Trắc nghiệm Đúng/Sai (a, b, c, d) từ tài liệu giáo viên.
                </p>
              </div>

              {/* Lựa chọn 10 hoặc 20 câu */}
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0">
                <Button
                  size="sm"
                  variant={quizCountChoice === 10 ? "default" : "ghost"}
                  onClick={() => startPracticeQuiz(currentMaterial || undefined, 10)}
                  className={`text-xs h-8 rounded-lg ${quizCountChoice === 10 ? "bg-indigo-600 text-white font-bold" : ""}`}
                >
                  10 câu
                </Button>
                <Button
                  size="sm"
                  variant={quizCountChoice === 20 ? "default" : "ghost"}
                  onClick={() => startPracticeQuiz(currentMaterial || undefined, 20)}
                  className={`text-xs h-8 rounded-lg ${quizCountChoice === 20 ? "bg-indigo-600 text-white font-bold" : ""}`}
                >
                  20 câu
                </Button>
              </div>
            </div>

            {loadingQuiz ? (
              <div className="py-20 text-center space-y-3 bg-white rounded-2xl border p-6">
                <RefreshCw className="size-8 text-indigo-600 animate-spin mx-auto" />
                <div className="font-bold text-slate-800 text-sm">AI đang biên soạn đúng {quizCountChoice} câu hỏi ôn luyện...</div>
                <p className="text-xs text-muted-foreground">
                  Kiểm soát chất lượng: mỗi phương án xuống dòng riêng, độ dài cân đối, phân bố Cơ bản → Thông hiểu → Vận dụng.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {quizQuestions.map((q, qIndex) => {
                  return (
                    <Card key={q.id} className="p-5 md:p-6 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4">
                      {/* Tiêu đề câu hỏi */}
                      <div className="flex items-center justify-between gap-2 border-b pb-2.5">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-indigo-600 text-white font-extrabold text-xs">
                            Câu {qIndex + 1}
                          </Badge>
                          <Badge variant="outline" className="text-[11px] text-slate-600 border-slate-200">
                            {q.type === "mc" ? "Trắc nghiệm 4 lựa chọn" : "Trắc nghiệm Đúng/Sai"}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {q.level}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">{q.concept}</span>
                      </div>

                      {/* Nội dung câu hỏi (Stem) */}
                      <div className="font-bold text-slate-900 text-sm md:text-base leading-relaxed whitespace-pre-wrap">
                        {q.stem}
                      </div>

                      {/* DẠNG 1: TRẮC NGHIỆM 4 LỰA CHỌN (A, B, C, D) - MỖI PHƯƠNG ÁN XUỐNG DÒNG RIÊNG */}
                      {q.type === "mc" && q.options && (
                        <div className="space-y-2 pt-1">
                          {q.options.map((opt) => {
                            const isSelected = userAnswers[q.id] === opt.key;
                            return (
                              <div
                                key={opt.key}
                                onClick={() => handleAnswerMC(q.id, opt.key)}
                                className={`p-3 rounded-xl border text-sm flex items-center gap-3 cursor-pointer transition-all ${
                                  isSelected
                                    ? "border-indigo-600 bg-indigo-50 font-bold text-indigo-900 shadow-xs"
                                    : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50 bg-white text-slate-800"
                                }`}
                              >
                                <span
                                  className={`size-6 rounded-full text-xs font-bold grid place-items-center shrink-0 border ${
                                    isSelected
                                      ? "bg-indigo-600 text-white border-indigo-600"
                                      : "bg-slate-100 text-slate-700 border-slate-300"
                                  }`}
                                >
                                  {opt.key}
                                </span>
                                <span className="leading-snug">{opt.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* DẠNG 2: TRẮC NGHIỆM ĐÚNG / SAI (a, b, c, d) - MỖI Ý XUỐNG DÒNG RIÊNG */}
                      {q.type === "tf" && q.tfItems && (
                        <div className="space-y-2 pt-1">
                          <div className="text-xs font-semibold text-slate-500 mb-1">
                            Chọn Đúng hoặc Sai cho từng nhận định dưới đây:
                          </div>
                          {q.tfItems.map((item) => {
                            const currentVal = userAnswers[q.id]?.[item.key];
                            return (
                              <div
                                key={item.key}
                                className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-sm"
                              >
                                <div className="flex items-start gap-2.5 leading-snug text-slate-800">
                                  <span className="font-bold text-indigo-700 shrink-0">{item.key})</span>
                                  <span>{item.text}</span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={currentVal === true ? "default" : "outline"}
                                    onClick={() => handleAnswerTF(q.id, item.key, true)}
                                    className={`h-7 px-3 text-xs font-bold rounded-lg ${
                                      currentVal === true
                                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                        : "hover:bg-emerald-50 text-emerald-800 border-emerald-200"
                                    }`}
                                  >
                                    Đúng
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={currentVal === false ? "default" : "outline"}
                                    onClick={() => handleAnswerTF(q.id, item.key, false)}
                                    className={`h-7 px-3 text-xs font-bold rounded-lg ${
                                      currentVal === false
                                        ? "bg-rose-600 text-white hover:bg-rose-700"
                                        : "hover:bg-rose-50 text-rose-800 border-rose-200"
                                    }`}
                                  >
                                    Sai
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}

                {/* Nút nộp bài */}
                <div className="flex justify-end pt-4">
                  <Button
                    onClick={handleSubmitPracticeQuiz}
                    size="lg"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-8 py-3 rounded-xl shadow-soft"
                  >
                    Hoàn thành & Xem phân tích kết quả <ArrowRight className="size-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 8: KẾT QUẢ & PHÂN TÍCH CHUYÊN SÂU (PHẦN H, I) */}
        {/* ==================================================================== */}
        {currentStep === "results" && (
          <div className="space-y-6 animate-fade-in">
            {/* Thẻ Thống kê điểm số */}
            <Card className="p-6 md:p-8 rounded-2xl bg-white border border-slate-200 shadow-sm text-center space-y-4">
              <div className="size-16 rounded-full bg-indigo-50 text-indigo-600 grid place-items-center mx-auto text-3xl shadow-inner">
                🏆
              </div>

              <div>
                <Badge className="bg-indigo-600 text-white font-bold text-xs uppercase px-3 py-1">
                  KẾT QUẢ LUYỆN TẬP BÀI HỌC
                </Badge>
                <h2 className="text-2xl md:text-3xl font-black text-slate-900 mt-2">
                  {selectedTopic || "Bài tập ôn luyện"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Thời gian hoàn thành: {Math.floor(timeSpentSeconds / 60)} phút {timeSpentSeconds % 60} giây
                </p>
              </div>

              {/* Số liệu thống kê */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-xl mx-auto pt-2">
                <div className="p-3.5 rounded-xl bg-slate-50 border">
                  <div className="text-xs text-muted-foreground font-semibold">Tổng số câu</div>
                  <div className="text-2xl font-black text-slate-900 mt-0.5">
                    {quizResultAnalysis?.totalCount || quizQuestions.length || 0}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-100">
                  <div className="text-xs text-emerald-800 font-semibold">Số câu đúng</div>
                  <div className="text-2xl font-black text-emerald-600 mt-0.5">
                    {quizResultAnalysis?.correctCount || 0}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-100">
                  <div className="text-xs text-rose-800 font-semibold">Số câu sai</div>
                  <div className="text-2xl font-black text-rose-600 mt-0.5">
                    {(quizResultAnalysis?.totalCount || 0) - (quizResultAnalysis?.correctCount || 0)}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-100">
                  <div className="text-xs text-indigo-800 font-semibold">Tỷ lệ đạt</div>
                  <div className="text-2xl font-black text-indigo-700 mt-0.5">
                    {quizResultAnalysis?.percentage || 0}%
                  </div>
                </div>
              </div>

              {/* 4 Nút chức năng bắt buộc theo PHẦN H */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-4">
                {quizResultAnalysis?.wrongQuestionsList && quizResultAnalysis.wrongQuestionsList.length > 0 && (
                  <Button
                    onClick={() => {
                      // Filter and re-do wrong questions
                      toast.info("Đang chuyển sang danh sách câu sai để em làm lại!");
                      setCurrentStep("practice");
                    }}
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl font-bold"
                  >
                    🔄 LÀM LẠI CÂU SAI
                  </Button>
                )}

                <Button
                  onClick={() => setCurrentStep("summary")}
                  variant="outline"
                  className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-xl font-bold"
                >
                  📖 HỌC LẠI KIẾN THỨC
                </Button>

                <Button
                  onClick={() => startPracticeQuiz(currentMaterial || undefined, 10)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
                >
                  🎯 LUYỆN THÊM 10 CÂU
                </Button>

                <Button
                  onClick={() => setCurrentStep("intent")}
                  variant="secondary"
                  className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl"
                >
                  🏠 VỀ TRANG TRỢ LÝ
                </Button>
              </div>
            </Card>

            {/* Phân tích AI sâu sắc (PHẦN H) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nội dung đã nắm tốt */}
              <Card className="p-5 rounded-2xl border border-emerald-100 bg-emerald-50/40 space-y-2">
                <div className="font-extrabold text-emerald-900 flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-emerald-600" /> ✅ Nội dung em đã nắm tốt:
                </div>
                {quizResultAnalysis?.masteredNotes && quizResultAnalysis.masteredNotes.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-emerald-800 space-y-1">
                    {quizResultAnalysis.masteredNotes.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-emerald-700 italic">Hãy cố gắng ôn tập thêm để nắm vững các phần.</p>
                )}
              </Card>

              {/* Nội dung còn nhầm */}
              <Card className="p-5 rounded-2xl border border-amber-100 bg-amber-50/40 space-y-2">
                <div className="font-extrabold text-amber-900 flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-amber-600" /> ⚠️ Nội dung em còn nhầm:
                </div>
                {quizResultAnalysis?.mistakeNotes && quizResultAnalysis.mistakeNotes.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-amber-800 space-y-1">
                    {quizResultAnalysis.mistakeNotes.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-emerald-700 font-semibold">Xuất sắc! Em không bị nhầm lẫn nội dung nào.</p>
                )}
              </Card>

              {/* Kiến thức nên học lại */}
              <Card className="p-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 space-y-2">
                <div className="font-extrabold text-indigo-900 flex items-center gap-2 text-sm">
                  <BookOpen className="size-4 text-indigo-600" /> 📖 Kiến thức nên học lại:
                </div>
                <div className="text-xs text-indigo-800 space-y-1 leading-relaxed">
                  {quizResultAnalysis?.reviewRecommendations?.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span>•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Đề xuất luyện tập tiếp theo */}
              <Card className="p-5 rounded-2xl border border-violet-100 bg-violet-50/40 space-y-2">
                <div className="font-extrabold text-violet-900 flex items-center gap-2 text-sm">
                  <Sparkles className="size-4 text-violet-600" /> 🎯 Đề xuất luyện tập tiếp theo:
                </div>
                <p className="text-xs text-violet-800 leading-relaxed">
                  {quizResultAnalysis && quizResultAnalysis.percentage >= 80
                    ? `Em đã đạt kết quả rất tốt ở bài "${selectedTopic}". Thầy/Cô khuyên em có thể chuyển sang bài học tiếp theo hoặc bấm "Hỏi Gia sư AI" nếu còn bất kỳ thắc mắc nào.`
                    : `Em nên xem lại phần tóm tắt lý thuyết và làm lại các câu bị sai để củng cố kiến thức trước khi làm bài thi chính thức.`}
                </p>
                <div className="pt-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setCurrentStep("tutor_chat");
                      if (currentMaterial) initializeChat(currentMaterial);
                    }}
                    className="bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-xl"
                  >
                    💬 Hỏi Gia sư AI về các câu vừa làm
                  </Button>
                </div>
              </Card>
            </div>

            {/* Chi tiết từng câu hỏi & lời giải phân tích */}
            <div className="space-y-4 pt-2">
              <h3 className="font-extrabold text-slate-800 text-base flex items-center gap-2">
                <FileCheck2 className="size-4 text-indigo-600" /> Chi tiết đáp án và lời giải giải thích từng câu
              </h3>

              {quizQuestions.map((q, idx) => {
                const userChoice = userAnswers[q.id];
                const isMC = q.type === "mc";
                const isRight = isMC
                  ? userChoice === q.mcAnswer
                  : (q.tfItems || []).every((it) => userAnswers[q.id]?.[it.key] === it.isCorrect);

                return (
                  <Card
                    key={q.id}
                    className={`p-5 rounded-2xl border transition-all bg-white ${
                      isRight ? "border-emerald-200" : "border-rose-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-6 rounded-full text-xs font-bold grid place-items-center ${
                            isRight ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-slate-600">{q.concept}</span>
                      </div>
                      <Badge className={isRight ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}>
                        {isRight ? "Làm đúng ✓" : "Làm sai ✗"}
                      </Badge>
                    </div>

                    <div className="font-bold text-slate-900 text-sm mb-3">{q.stem}</div>

                    {/* MC options */}
                    {isMC && q.options && (
                      <div className="space-y-1.5 text-xs">
                        {q.options.map((opt) => {
                          const isCorrectOpt = opt.key === q.mcAnswer;
                          const isUserPick = userChoice === opt.key;
                          return (
                            <div
                              key={opt.key}
                              className={`p-2 rounded-lg flex items-center gap-2 border ${
                                isCorrectOpt
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 font-bold"
                                  : isUserPick
                                  ? "border-rose-300 bg-rose-50 text-rose-900 line-through"
                                  : "border-slate-100 text-slate-700 bg-slate-50/50"
                              }`}
                            >
                              <span className="font-bold">{opt.key}.</span>
                              <span>{opt.text}</span>
                              {isCorrectOpt && <span className="ml-auto text-emerald-600 text-xs">Đáp án đúng</span>}
                              {isUserPick && !isCorrectOpt && <span className="ml-auto text-rose-600 text-xs">Em chọn</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* TF items */}
                    {!isMC && q.tfItems && (
                      <div className="space-y-1.5 text-xs">
                        {q.tfItems.map((item) => {
                          const userVal = userAnswers[q.id]?.[item.key];
                          const itemRight = userVal === item.isCorrect;
                          return (
                            <div
                              key={item.key}
                              className={`p-2 rounded-lg flex items-center justify-between border ${
                                itemRight
                                  ? "border-emerald-200 bg-emerald-50/50"
                                  : "border-rose-200 bg-rose-50/50"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-indigo-700">{item.key})</span>
                                <span className="text-slate-800">{item.text}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-xs">
                                <span className="text-slate-500">Em chọn: {userVal === true ? "Đúng" : userVal === false ? "Sai" : "Chưa chọn"}</span>
                                <Badge className={item.isCorrect ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"}>
                                  {item.isCorrect ? "Đáp án: Đúng" : "Đáp án: Sai"}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Lời giải phân tích */}
                    <div className="mt-3 p-3 rounded-xl bg-slate-100 text-xs text-slate-800 space-y-1 border border-slate-200">
                      <div className="font-bold text-indigo-900">💡 Lời giải phân tích chi tiết:</div>
                      <div className="whitespace-pre-wrap leading-relaxed">{q.explanation}</div>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          setCurrentStep("tutor_chat");
                          if (currentMaterial) {
                            initializeChat(
                              currentMaterial,
                              `Em chưa hiểu câu ${idx + 1}: "${q.stem}". Thầy/Cô giải thích giúp em tại sao đáp án lại như vậy với ạ!`
                            );
                          }
                        }}
                        className="text-indigo-600 hover:text-indigo-800 font-bold p-0 h-auto text-xs mt-1"
                      >
                        💬 Em chưa hiểu câu {idx + 1}? Hỏi ngay Gia sư AI →
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* BƯỚC 9: GIA SƯ AI CHAT (TUTOR CHAT - PHẦN J, K) */}
        {/* ==================================================================== */}
        {currentStep === "tutor_chat" && (
          <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Bot className="size-4" /> CHẾ ĐỘ GIA SƯ HỌC TẬP AI
                </div>
                <h3 className="font-black text-slate-900 text-base md:text-lg">
                  {selectedTopic || "Trao đổi cùng Gia sư AI"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  AI ưu tiên gợi ý và hướng dẫn phương pháp giải, không làm bài thay học sinh.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentStep("summary")}
                className="text-xs h-8 border-slate-200 hover:bg-slate-100"
              >
                Xem lại lý thuyết
              </Button>
            </div>

            {/* Chat Frame */}
            <Card className="h-[540px] flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 bg-slate-50/50">
                {chatMessages.map((msg) => {
                  const isAI = msg.role === "model";
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-2.5 max-w-[85%] ${
                        isAI ? "self-start" : "self-end ml-auto flex-row-reverse"
                      }`}
                    >
                      <div
                        className={`size-8 rounded-xl grid place-items-center text-xs shrink-0 ${
                          isAI ? "bg-indigo-600 text-white shadow-soft" : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {isAI ? <Bot className="size-4" /> : "👤"}
                      </div>

                      <div
                        className={`p-3.5 rounded-2xl text-xs md:text-sm leading-relaxed shadow-xs ${
                          isAI
                            ? "bg-white text-slate-900 border border-slate-200 rounded-tl-sm"
                            : "bg-indigo-600 text-white rounded-tr-sm"
                        }`}
                      >
                        <div className="whitespace-pre-wrap font-sans">{msg.text}</div>
                        <div
                          className={`text-[10px] mt-1.5 ${
                            isAI ? "text-slate-400" : "text-indigo-200 text-right"
                          }`}
                        >
                          {msg.timestamp}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isSendingChat && (
                  <div className="flex items-start gap-2.5 max-w-[85%]">
                    <div className="size-8 rounded-xl bg-indigo-600 text-white grid place-items-center shrink-0">
                      <Bot className="size-4" />
                    </div>
                    <div className="p-3.5 rounded-2xl bg-white border border-slate-200 rounded-tl-sm text-xs text-slate-500 flex items-center gap-2">
                      <RefreshCw className="size-3.5 animate-spin text-indigo-600" />
                      Gia sư AI đang suy nghĩ hướng dẫn cho em...
                    </div>
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Quick suggestions */}
              <div className="px-4 py-2 border-t bg-slate-50 flex items-center gap-2 overflow-x-auto text-xs">
                <span className="text-muted-foreground whitespace-nowrap text-[11px] font-semibold">Gợi ý câu hỏi:</span>
                <button
                  type="button"
                  onClick={() => sendChatMessage("Em chưa hiểu quy tắc gộp ô trong bảng HTML.")}
                  className="px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-indigo-400 text-slate-700 whitespace-nowrap text-[11px] transition-colors"
                >
                  Quy tắc gộp ô là gì?
                </button>
                <button
                  type="button"
                  onClick={() => sendChatMessage("Phân biệt giúp em danh sách ul và ol khi nào nên dùng?")}
                  className="px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-indigo-400 text-slate-700 whitespace-nowrap text-[11px] transition-colors"
                >
                  Phân biệt ul và ol
                </button>
                <button
                  type="button"
                  onClick={() => sendChatMessage("Cho em xin thêm 1 ví dụ cụ thể về bảng có colspan!")}
                  className="px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-indigo-400 text-slate-700 whitespace-nowrap text-[11px] transition-colors"
                >
                  Ví dụ về colspan
                </button>
              </div>

              {/* Input Box */}
              <div className="p-3 border-t bg-white flex items-center gap-2">
                <Input
                  placeholder="Nhập câu hỏi hoặc phần kiến thức em muốn Gia sư giải thích..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  disabled={isSendingChat}
                  className="text-sm rounded-xl focus-visible:ring-indigo-500"
                />
                <Button
                  onClick={() => sendChatMessage()}
                  disabled={isSendingChat || !inputMessage.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shrink-0 px-4"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
