export interface WrongQuestionRecord {
  id: string;
  type: "mc" | "tf";
  questionText: string;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  topic: string;
}

export interface StudentLearningProgress {
  id: string;
  studentAccount: string;
  studentName: string;
  className: string;
  grade: string;
  subject: string;
  topic: string;
  studyCount: number;
  lastStudiedAt: string;
  quickTest?: {
    total: number;
    correct: number;
    score: number; // 0-10
    passed: boolean;
    date: string;
    masteredAspects: string[];
    needReviewAspects: string[];
  };
  practiceQuiz?: {
    mode: 10 | 20;
    total: number;
    correct: number;
    percentage: number;
    date: string;
    masteredNotes: string[];
    mistakeNotes: string[];
    reviewRecommendations: string[];
    nextAction: string;
  };
  wrongQuestions: WrongQuestionRecord[];
}

const STORAGE_KEY = "app_student_learning_progress_v1";

export function getAllStudentProgress(): StudentLearningProgress[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveAllStudentProgress(list: StudentLearningProgress[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function getStudentProgressForTopic(studentAccount: string, subject: string, topic: string): StudentLearningProgress | null {
  const list = getAllStudentProgress();
  return (
    list.find(
      (p) =>
        p.studentAccount.toLowerCase() === studentAccount.toLowerCase() &&
        p.subject.toLowerCase() === subject.toLowerCase() &&
        p.topic.toLowerCase() === topic.toLowerCase()
    ) || null
  );
}

export function recordQuickTestResult(params: {
  studentAccount: string;
  studentName: string;
  className: string;
  grade: string;
  subject: string;
  topic: string;
  total: number;
  correct: number;
  masteredAspects: string[];
  needReviewAspects: string[];
}): StudentLearningProgress {
  const list = getAllStudentProgress();
  const existingIdx = list.findIndex(
    (p) =>
      p.studentAccount.toLowerCase() === params.studentAccount.toLowerCase() &&
      p.subject.toLowerCase() === params.subject.toLowerCase() &&
      p.topic.toLowerCase() === params.topic.toLowerCase()
  );

  const score = Math.round((params.correct / Math.max(params.total, 1)) * 10 * 10) / 10;
  const passed = score >= 6.0;

  let record: StudentLearningProgress;
  if (existingIdx >= 0) {
    record = {
      ...list[existingIdx],
      studyCount: (list[existingIdx].studyCount || 0) + 1,
      lastStudiedAt: new Date().toISOString(),
      quickTest: {
        total: params.total,
        correct: params.correct,
        score,
        passed,
        date: new Date().toISOString(),
        masteredAspects: params.masteredAspects,
        needReviewAspects: params.needReviewAspects,
      },
    };
    list[existingIdx] = record;
  } else {
    record = {
      id: "prog-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      studentAccount: params.studentAccount,
      studentName: params.studentName,
      className: params.className,
      grade: params.grade,
      subject: params.subject,
      topic: params.topic,
      studyCount: 1,
      lastStudiedAt: new Date().toISOString(),
      quickTest: {
        total: params.total,
        correct: params.correct,
        score,
        passed,
        date: new Date().toISOString(),
        masteredAspects: params.masteredAspects,
        needReviewAspects: params.needReviewAspects,
      },
      wrongQuestions: [],
    };
    list.unshift(record);
  }

  saveAllStudentProgress(list);
  return record;
}

export function recordPracticeQuizResult(params: {
  studentAccount: string;
  studentName: string;
  className: string;
  grade: string;
  subject: string;
  topic: string;
  mode: 10 | 20;
  total: number;
  correct: number;
  wrongQuestions: WrongQuestionRecord[];
  masteredNotes: string[];
  mistakeNotes: string[];
  reviewRecommendations: string[];
  nextAction: string;
}): StudentLearningProgress {
  const list = getAllStudentProgress();
  const existingIdx = list.findIndex(
    (p) =>
      p.studentAccount.toLowerCase() === params.studentAccount.toLowerCase() &&
      p.subject.toLowerCase() === params.subject.toLowerCase() &&
      p.topic.toLowerCase() === params.topic.toLowerCase()
  );

  const percentage = Math.round((params.correct / Math.max(params.total, 1)) * 100);

  let record: StudentLearningProgress;
  if (existingIdx >= 0) {
    const existing = list[existingIdx];
    record = {
      ...existing,
      lastStudiedAt: new Date().toISOString(),
      practiceQuiz: {
        mode: params.mode,
        total: params.total,
        correct: params.correct,
        percentage,
        date: new Date().toISOString(),
        masteredNotes: params.masteredNotes,
        mistakeNotes: params.mistakeNotes,
        reviewRecommendations: params.reviewRecommendations,
        nextAction: params.nextAction,
      },
      wrongQuestions: [...params.wrongQuestions, ...existing.wrongQuestions.filter((q) => !params.wrongQuestions.some((wq) => wq.questionText === q.questionText))],
    };
    list[existingIdx] = record;
  } else {
    record = {
      id: "prog-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      studentAccount: params.studentAccount,
      studentName: params.studentName,
      className: params.className,
      grade: params.grade,
      subject: params.subject,
      topic: params.topic,
      studyCount: 1,
      lastStudiedAt: new Date().toISOString(),
      practiceQuiz: {
        mode: params.mode,
        total: params.total,
        correct: params.correct,
        percentage,
        date: new Date().toISOString(),
        masteredNotes: params.masteredNotes,
        mistakeNotes: params.mistakeNotes,
        reviewRecommendations: params.reviewRecommendations,
        nextAction: params.nextAction,
      },
      wrongQuestions: params.wrongQuestions,
    };
    list.unshift(record);
  }

  saveAllStudentProgress(list);
  return record;
}
