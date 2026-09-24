import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import {
  StudentSubmissionRecord,
  getStudentSubmissions,
  getPublishedExamAnswerKey,
  isExamOfficiallyClosed,
} from "@/lib/studentStorage";
import { supabase } from "@/integrations/supabase/client";
import { getTFValue } from "@/lib/grading";
import { stripRich } from "@/lib/docxParser";
import RichText from "@/components/RichText";
import { toast } from "sonner";
import {
  GraduationCap,
  LogOut,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Play,
  Search,
  ExternalLink,
  BookOpen,
  Award,
  Check,
  X,
  AlertCircle,
} from "lucide-react";

export default function StudentDashboard() {
  const navigate = useNavigate();
  const { student, logout } = useStudentAuth();
  const [submissions, setSubmissions] = useState<StudentSubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterClosed, setFilterClosed] = useState<"all" | "closed" | "open">("all");
  const [examInput, setExamInput] = useState("");

  // Review modal state
  const [selectedSub, setSelectedSub] = useState<StudentSubmissionRecord | null>(null);
  const [reviewExamData, setReviewExamData] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Redirect to login if not logged in
  useEffect(() => {
    if (!student) {
      navigate("/student/auth", { replace: true, state: { from: "/student" } });
    }
  }, [student, navigate]);

  const loadSubmissions = () => {
    if (!student) return;
    setLoading(true);
    const list = getStudentSubmissions(student.account);
    setSubmissions(list);
    setLoading(false);
  };

  useEffect(() => {
    loadSubmissions();
    const handleSubChange = () => loadSubmissions();
    window.addEventListener("student_submissions_change", handleSubChange);
    window.addEventListener("exam_answers_published", handleSubChange);
    return () => {
      window.removeEventListener("student_submissions_change", handleSubChange);
      window.removeEventListener("exam_answers_published", handleSubChange);
    };
  }, [student]);

  // Open exam by code or full URL
  const handleOpenExam = (e: React.FormEvent) => {
    e.preventDefault();
    const val = examInput.trim();
    if (!val) return;
    let examId = val;
    // Extract ID if a full URL was pasted
    const match = val.match(/\/take\/([a-zA-Z0-9-]+)/);
    if (match) examId = match[1];
    navigate(`/take/${examId}`);
  };

  // Inspect submission & determine if exam is closed
  const openReviewModal = async (sub: StudentSubmissionRecord) => {
    setSelectedSub(sub);
    setReviewLoading(true);
    setReviewExamData(null);

    try {
      // 1. Check published answer keys first (instant, guaranteed upon GV closing exam)
      const published = getPublishedExamAnswerKey(sub.examId);
      if (published?.questions) {
        setReviewExamData({
          title: published.examTitle || sub.examTitle,
          isClosed: true,
          questions: published.questions,
          allowReview: true,
        });
        setReviewLoading(false);
        return;
      }

      // 2. Fetch from Supabase RPC get_submission_for_student
      const { data, error } = await supabase.rpc("get_submission_for_student", {
        p_submission_id: sub.id,
      });

      if (!error && data) {
        const payload: any = data;
        const examObj = payload.exam || {};
        // If Supabase returned full questions, exam is open for review / closed
        if (examObj.questions) {
          setReviewExamData({
            title: examObj.title || sub.examTitle,
            isClosed: true,
            questions: examObj.questions,
            allowReview: true,
          });
          setReviewLoading(false);
          return;
        }
      }

      // 3. Fallback: check exam status directly from public RPC get_exam_for_student
      const { data: exData } = await supabase.rpc("get_exam_for_student", {
        p_exam_id: sub.examId,
      });
      const isClosed =
        (exData as any)?.status === "closed" ||
        (exData as any)?.manual_closed === true ||
        isExamOfficiallyClosed(sub.examId);

      setReviewExamData({
        title: (exData as any)?.title || sub.examTitle,
        isClosed,
        questions: (exData as any)?.questions || null,
        allowReview: !!(exData as any)?.allow_review || isClosed,
      });
    } catch (err) {
      console.error("Error loading review:", err);
    } finally {
      setReviewLoading(false);
    }
  };

  const filteredSubs = useMemo(() => {
    return submissions.filter((s) => {
      const matchSearch =
        !search ||
        (s.examTitle || "").toLowerCase().includes(search.toLowerCase()) ||
        s.examId.toLowerCase().includes(search.toLowerCase());

      const isClosed = s.isExamClosed || isExamOfficiallyClosed(s.examId);
      if (filterClosed === "closed" && !isClosed) return false;
      if (filterClosed === "open" && isClosed) return false;

      return matchSearch;
    });
  }, [submissions, search, filterClosed]);

  // Statistics
  const stats = useMemo(() => {
    const total = submissions.length;
    if (total === 0) return { total: 0, avg: 0, max: 0, closedCount: 0 };
    const totalScore = submissions.reduce((sum, s) => sum + (s.score || 0), 0);
    const maxScore = Math.max(...submissions.map((s) => s.score || 0));
    const closedCount = submissions.filter((s) => s.isExamClosed || isExamOfficiallyClosed(s.examId)).length;
    return {
      total,
      avg: Math.round((totalScore / total) * 10) / 10,
      max: maxScore,
      closedCount,
    };
  }, [submissions]);

  if (!student) return null;

  return (
    <div className="min-h-screen bg-gradient-soft">
      {/* HEADER */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="container max-w-5xl flex items-center justify-between py-3.5 px-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-primary grid place-items-center text-primary-foreground shadow-soft">
              <GraduationCap className="size-5" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight">Cổng Học Sinh</div>
              <div className="text-[11px] text-muted-foreground font-medium">
                Tác giả: Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold">{student.fullName}</div>
              <div className="text-[11px] text-muted-foreground">
                Lớp {student.className} • Tài khoản: {student.account}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                logout();
                toast.info("Đã đăng xuất tài khoản học sinh");
                navigate("/student/auth");
              }}
              className="rounded-xl gap-1 text-xs"
            >
              <LogOut className="size-3.5" /> Đăng xuất
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl py-6 px-4 space-y-6">
        {/* WELCOME BANNER */}
        <div className="rounded-2xl bg-gradient-primary text-primary-foreground p-5 sm:p-6 shadow-soft relative overflow-hidden">
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-wider font-semibold opacity-85">
                Trang cá nhân học sinh • Tác giả: Trương Thị Bích Thủy – THPT Phan Bội Châu - TP Đà Nẵng
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold mt-0.5">
                Xin chào, {student.fullName}!
              </h1>
              <p className="text-xs sm:text-sm opacity-90 mt-1">
                Lớp <b>{student.className}</b> • Theo dõi lịch sử làm bài, điểm số và đáp án chính thức sau khi giáo viên đóng đề.
              </p>
            </div>
          </div>
        </div>

        {/* STATS OVERVIEW */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-4 rounded-xl shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Bài đã làm</span>
              <FileText className="size-4 text-primary" />
            </div>
            <div className="text-2xl font-bold mt-2">{stats.total}</div>
          </Card>
          <Card className="p-4 rounded-xl shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Điểm trung bình</span>
              <Award className="size-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold mt-2 text-amber-600 dark:text-amber-400">
              {stats.avg}
            </div>
          </Card>
          <Card className="p-4 rounded-xl shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Điểm cao nhất</span>
              <Award className="size-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold mt-2 text-emerald-600 dark:text-emerald-400">
              {stats.max}
            </div>
          </Card>
          <Card className="p-4 rounded-xl shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Đã có đáp án</span>
              <CheckCircle2 className="size-4 text-sky-500" />
            </div>
            <div className="text-2xl font-bold mt-2 text-sky-600 dark:text-sky-400">
              {stats.closedCount}
            </div>
          </Card>
        </div>

        {/* QUICK EXAM ENTRY */}
        <Card className="p-4 sm:p-5 rounded-2xl shadow-soft border-border/70">
          <form onSubmit={handleOpenExam} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
            <div className="flex items-center gap-2 flex-1">
              <Play className="size-4 text-primary shrink-0" />
              <Input
                placeholder="Dán link bài thi hoặc mã đề thi giáo viên gửi..."
                value={examInput}
                onChange={(e) => setExamInput(e.target.value)}
                className="rounded-xl flex-1"
              />
            </div>
            <Button type="submit" className="rounded-xl bg-gradient-primary shrink-0">
              Vào làm bài ngay
            </Button>
          </form>
        </Card>

        {/* SUBMISSION HISTORY */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Lịch Sử Làm Bài Của Bạn</h2>
              <p className="text-xs text-muted-foreground">
                Tất cả bài thi đã hoàn thành và điểm số tương ứng.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative min-w-[180px]">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Tìm tên đề thi..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-xs rounded-xl"
                />
              </div>
              <div className="flex rounded-xl border p-0.5 bg-muted/40 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterClosed("all")}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    filterClosed === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  Tất cả ({submissions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterClosed("closed")}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    filterClosed === "closed" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  Đã đóng đề
                </button>
                <button
                  type="button"
                  onClick={() => setFilterClosed("open")}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    filterClosed === "open" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground"
                  }`}
                >
                  Đang mở
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <Card className="p-8 text-center text-muted-foreground rounded-2xl">Đang tải lịch sử...</Card>
          ) : filteredSubs.length === 0 ? (
            <Card className="p-10 text-center text-muted-foreground rounded-2xl space-y-3">
              <BookOpen className="size-10 text-muted-foreground/50 mx-auto" />
              <div className="font-medium">Chưa có bài thi nào</div>
              <p className="text-xs max-w-sm mx-auto">
                Khi bạn mở link đề thi từ giáo viên để làm bài, kết quả sẽ tự động lưu vào tài khoản của bạn tại đây.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredSubs.map((sub) => {
                const isClosed = sub.isExamClosed || isExamOfficiallyClosed(sub.examId);
                const subDate = new Date(sub.submittedAt).toLocaleString("vi-VN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                });

                return (
                  <Card
                    key={sub.id}
                    className="p-4 sm:p-5 rounded-2xl shadow-soft border-border/70 hover:border-primary/40 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base truncate">{sub.examTitle}</span>
                        <Badge variant="secondary" className="text-[10px] rounded-md font-mono">
                          Lần {sub.attemptNumber || 1}
                        </Badge>
                      </div>

                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" /> Nộp lúc: {subDate}
                        </span>
                        {sub.durationSeconds ? (
                          <span>
                            Thời gian: {Math.floor(sub.durationSeconds / 60)}p {sub.durationSeconds % 60}s
                          </span>
                        ) : null}
                      </div>

                      {/* Status indicator */}
                      <div className="pt-1">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/20">
                            <Lock className="size-3" /> Đã đóng đề • Đã công bố đáp án & lời giải
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20">
                            <Unlock className="size-3" /> Đề đang mở • Chờ GV đóng đề để xem đáp án
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Score & Review Action */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0">
                      <div className="text-left sm:text-right">
                        <div className="text-2xl font-black text-primary leading-none">
                          {sub.score}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            / {sub.maxScore || 10}đ
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2">
                          <span className="text-emerald-600 font-medium">{sub.correctCount} đúng</span>
                          <span>•</span>
                          <span className="text-rose-600 font-medium">{sub.wrongCount} sai</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => openReviewModal(sub)}
                          className={`rounded-xl text-xs font-medium shadow-xs ${
                            isClosed
                              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                              : "bg-gradient-primary text-primary-foreground"
                          }`}
                        >
                          {isClosed ? "👁️ Xem đáp án & Lời giải" : "Xem bài làm"}
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* DETAILED EXAM REVIEW MODAL */}
      <Dialog open={!!selectedSub} onOpenChange={(o) => { if (!o) setSelectedSub(null); }}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl p-5 sm:p-6">
          {selectedSub && (
            <div className="space-y-5">
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="text-xl font-bold">{selectedSub.examTitle}</DialogTitle>
                  <Badge variant="secondary">Lần làm {selectedSub.attemptNumber || 1}</Badge>
                </div>
                <DialogDescription className="text-xs">
                  Học sinh: <b>{selectedSub.studentName}</b> (Lớp {selectedSub.studentClass}) • Nộp bài:{" "}
                  {new Date(selectedSub.submittedAt).toLocaleString("vi-VN")}
                </DialogDescription>
              </DialogHeader>

              {/* Score header */}
              <div className="rounded-xl bg-gradient-primary text-primary-foreground p-4 text-center">
                <div className="text-xs uppercase tracking-wider opacity-90 font-medium">Tổng điểm</div>
                <div className="text-5xl font-extrabold my-1">{selectedSub.score}</div>
                <div className="text-xs opacity-90">/ {selectedSub.maxScore || 10} điểm</div>
                <div className="mt-2 text-xs flex justify-center gap-4">
                  <span className="bg-white/20 px-2 py-0.5 rounded">
                    ✓ Đúng: {selectedSub.correctCount} câu
                  </span>
                  <span className="bg-white/20 px-2 py-0.5 rounded">
                    ✗ Sai: {selectedSub.wrongCount} câu
                  </span>
                </div>
              </div>

              {/* Status and answer key availability */}
              {reviewLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Đang tải đáp án chi tiết...</div>
              ) : reviewExamData?.isClosed && reviewExamData?.questions ? (
                <div className="space-y-6">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    <div>
                      <b>Đề thi đã được giáo viên đóng.</b> Toàn bộ đáp án chính thức và lời giải chi tiết đã được công bố bên dưới.
                    </div>
                  </div>

                  {/* Render questions review */}
                  <ExamReviewQuestions
                    questions={reviewExamData.questions}
                    answers={selectedSub.answers || {}}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-sm text-amber-900 dark:text-amber-200">
                    <AlertCircle className="size-4" /> Đề thi đang mở (Giáo viên chưa đóng đề)
                  </div>
                  <p>
                    Theo quy định, đáp án chính thức, lời giải chi tiết và đối chiếu câu đúng/sai sẽ <b>tự động hiển thị tại đây ngay sau khi Giáo viên bấm "Đóng đề thi"</b>.
                  </p>
                  <p className="text-[11px] opacity-80">
                    Điểm số và câu trả lời của bạn đã được ghi nhận an toàn trên hệ thống.
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Component to render questions, answers, and explanations */
function ExamReviewQuestions({ questions, answers }: { questions: any; answers: Record<string, any> }) {
  const p1 = questions.partI || [];
  const p2 = questions.partII || [];
  const p3 = questions.partIII || [];

  const numCorrect = (sa: string, expected: string) => {
    const a = String(sa ?? "").trim().toLowerCase();
    const b = stripRich(String(expected ?? "")).trim().toLowerCase();
    if (a === b) return true;
    const na = parseFloat(a.replace(",", "."));
    const nb = parseFloat(b.replace(",", "."));
    return !isNaN(na) && !isNaN(nb) && Math.abs(na - nb) < 1e-6;
  };

  return (
    <div className="space-y-6 pt-2">
      {/* PHẦN I */}
      {p1.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-sm text-primary uppercase">PHẦN I — Trắc nghiệm 4 phương án</h3>
          {p1.map((q: any, i: number) => {
            const chosen = answers[q.id];
            const isCorrect = chosen === q.answer;
            return (
              <div
                key={q.id || i}
                className={`rounded-xl border p-3.5 space-y-2.5 ${
                  isCorrect ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"
                }`}
              >
                <div className="flex items-start gap-2">
                  {isCorrect ? (
                    <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <X className="size-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="text-sm font-medium">
                    <span className="font-bold mr-1">Câu {i + 1}.</span>
                    <RichText text={q.text} />
                  </div>
                </div>

                <div className="space-y-1.5 pl-6">
                  {(q.options || []).map((opt: any) => {
                    const isRightOption = opt.key === q.answer;
                    const isChosenOption = opt.key === chosen;
                    const cls = isRightOption
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
                      : isChosenOption
                      ? "border-rose-500 bg-rose-500/10 text-rose-950 dark:text-rose-200"
                      : "border-border bg-background/50";
                    return (
                      <div key={opt.key} className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${cls}`}>
                        <b className="min-w-4">{opt.key}.</b>
                        <span className="flex-1">
                          <RichText text={opt.text} />
                        </span>
                        {isRightOption && <span className="font-bold text-emerald-600">✓ Đáp án đúng</span>}
                        {isChosenOption && !isRightOption && (
                          <span className="font-bold text-rose-600">✗ Bạn đã chọn</span>
                        )}
                      </div>
                    );
                  })}
                  {!chosen && <div className="text-xs text-muted-foreground italic">Học sinh chưa trả lời</div>}
                </div>

                {q.explanation && (
                  <div className="mt-2.5 ml-6 rounded-lg border-l-2 border-primary bg-primary/5 p-2.5 text-xs">
                    <div className="font-bold text-primary mb-0.5">💡 Lời giải / Hướng dẫn:</div>
                    <RichText text={q.explanation} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* PHẦN II */}
      {p2.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-sm text-primary uppercase">PHẦN II — Trắc nghiệm Đúng / Sai</h3>
          {p2.map((q: any, i: number) => (
            <div key={q.id || i} className="rounded-xl border p-3.5 space-y-2.5">
              <div className="text-sm font-medium">
                <span className="font-bold mr-1">Câu {i + 1}.</span>
                <RichText text={q.text} />
              </div>

              <div className="space-y-1.5 pl-4">
                {(q.items || []).map((it: any) => {
                  const val = getTFValue(answers[q.id], it.key);
                  const ok = val !== null && val === !!it.correct;
                  const borderCls = val === null ? "border-border" : ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5";
                  return (
                    <div key={it.key} className={`flex items-start justify-between gap-2 rounded-lg border p-2 text-xs ${borderCls}`}>
                      <div className="flex items-start gap-1.5 flex-1">
                        <b className="min-w-4">{it.key})</b>
                        <RichText text={it.text} />
                      </div>
                      <div className="text-[11px] shrink-0 font-medium flex items-center gap-1.5">
                        <span>
                          Đáp án đúng:{" "}
                          <b className={it.correct ? "text-emerald-600" : "text-rose-600"}>
                            {it.correct ? "Đúng" : "Sai"}
                          </b>
                        </span>
                        <span>•</span>
                        <span>
                          Bạn chọn:{" "}
                          <b>{val === null ? "Chưa làm" : val ? "Đúng" : "Sai"}</b>
                        </span>
                        {val !== null && (
                          ok ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-rose-600" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {q.explanation && (
                <div className="mt-2.5 ml-4 rounded-lg border-l-2 border-primary bg-primary/5 p-2.5 text-xs">
                  <div className="font-bold text-primary mb-0.5">💡 Lời giải / Hướng dẫn:</div>
                  <RichText text={q.explanation} />
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* PHẦN III */}
      {p3.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold text-sm text-primary uppercase">PHẦN III — Trả lời ngắn</h3>
          {p3.map((q: any, i: number) => {
            const given = answers[q.id] ?? "";
            const isOk = numCorrect(given, q.answer);
            return (
              <div
                key={q.id || i}
                className={`rounded-xl border p-3.5 space-y-2.5 ${
                  isOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"
                }`}
              >
                <div className="flex items-start gap-2">
                  {isOk ? (
                    <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <X className="size-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="text-sm font-medium">
                    <span className="font-bold mr-1">Câu {i + 1}.</span>
                    <RichText text={q.text} />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-2 text-xs pl-6">
                  <div className={`rounded-lg border p-2 ${isOk ? "border-emerald-500 bg-emerald-500/10" : "border-rose-500 bg-rose-500/10"}`}>
                    <div className="text-[10px] text-muted-foreground">Đáp án bạn điền:</div>
                    <div className="font-bold">{String(given) || "(bỏ trống)"}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-500 bg-emerald-500/10 p-2">
                    <div className="text-[10px] text-muted-foreground">Đáp án đúng chính thức:</div>
                    <div className="font-bold text-emerald-700 dark:text-emerald-300">
                      <RichText text={String(q.answer)} />
                    </div>
                  </div>
                </div>

                {q.explanation && (
                  <div className="mt-2.5 ml-6 rounded-lg border-l-2 border-primary bg-primary/5 p-2.5 text-xs">
                    <div className="font-bold text-primary mb-0.5">💡 Lời giải / Hướng dẫn:</div>
                    <RichText text={q.explanation} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
