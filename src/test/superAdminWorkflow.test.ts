import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const emptyChain: any = {
    select: vi.fn(() => emptyChain),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    update: vi.fn(() => emptyChain),
    delete: vi.fn(() => emptyChain),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    eq: vi.fn(() => emptyChain),
    in: vi.fn(() => emptyChain),
    like: vi.fn(() => emptyChain),
    ilike: vi.fn(() => emptyChain),
    or: vi.fn(() => emptyChain),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
    limit: vi.fn(() => emptyChain),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return {
    supabase: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signInWithPassword: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
        updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        signOut: vi.fn(async () => ({ error: null })),
      },
      from: vi.fn(() => emptyChain),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  };
});

import {
  SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
  isReservedAdminIdentifier,
  upsertTeacher,
  getAllTeachers,
  getTeacherById,
  TeacherUser,
  hashPassword,
} from "@/lib/teacherStorage";
import {
  approveTeacherAccount,
  rejectTeacherAccount,
  lockTeacherAccount,
  unlockTeacherAccount,
  updateTeacherProfileByAdmin,
  deleteTeacherAccount,
  saveExamByAdmin,
  deleteExamByAdmin,
  getExamCodeBadgeForAdmin,
} from "@/lib/adminService";
import { saveUnifiedExam, fetchAllExamsForAdmin, SystemExam } from "@/lib/allExamsStorage";

describe("Super Admin End-to-End Workflows & Security Guardrails", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("1. Reserved admin identifiers and Super Admin email matching block impersonation", () => {
    expect(isSuperAdminEmail("bichthuylqd@gmail.com")).toBe(true);
    expect(isSuperAdminEmail(" BICHTHUYLQD@GMAIL.COM ")).toBe(true);
    expect(isSuperAdminEmail("teacher@gmail.com")).toBe(false);

    expect(isReservedAdminIdentifier("bichthuylqd@gmail.com")).toBe(true);
    expect(isReservedAdminIdentifier("bichthuylqd")).toBe(true);
    expect(isReservedAdminIdentifier("admin")).toBe(true);
    expect(isReservedAdminIdentifier("admin@admin.com")).toBe(true);
    expect(isReservedAdminIdentifier("super_admin")).toBe(true);
    expect(isReservedAdminIdentifier("root")).toBe(true);
    expect(isReservedAdminIdentifier("gv_nguyenvana")).toBe(false);

    // Ensure upsertTeacher refuses to insert Super Admin email into teachers list
    upsertTeacher({
      id: "attacker-id",
      username: "fake",
      name: "Attacker",
      email: SUPER_ADMIN_EMAIL,
      school: "School",
      subject: "Toán",
      status: "active",
      approvalStatus: "APPROVED",
      passwordHash: hashPassword("123456"),
      createdAt: new Date().toISOString(),
    });
    expect(getAllTeachers().some((t) => t.email === SUPER_ADMIN_EMAIL)).toBe(false);
  });

  it("2. Teacher registration starts as PENDING and transitions cleanly through Approve / Reject / Lock / Unlock", async () => {
    const teacherId = "pending-teacher-001";
    const pendingTeacher: TeacherUser = {
      id: teacherId,
      username: "gv_pending",
      name: "Nguyễn Văn Chờ",
      email: "pending@school.edu.vn",
      school: "THPT Lê Quý Đôn",
      subject: "Tin học",
      status: "pending",
      approvalStatus: "PENDING",
      passwordHash: hashPassword("Pass@123"),
      createdAt: new Date().toISOString(),
    };
    upsertTeacher(pendingTeacher);

    expect(getTeacherById(teacherId)?.approvalStatus).toBe("PENDING");

    // Reject with reason
    const rejRes = await rejectTeacherAccount(teacherId, "Thiếu thông tin trường");
    expect(rejRes.ok).toBe(true);
    expect(getTeacherById(teacherId)?.approvalStatus).toBe("REJECTED");
    expect(getTeacherById(teacherId)?.rejectionReason).toBe("Thiếu thông tin trường");

    // Approve overrides rejection and unlocks login
    const appRes = await approveTeacherAccount(teacherId);
    expect(appRes.ok).toBe(true);
    expect(getTeacherById(teacherId)?.approvalStatus).toBe("APPROVED");
    expect(getTeacherById(teacherId)?.status).toBe("active");

    // Lock preserves record & exams, Unlock restores
    const lockRes = await lockTeacherAccount(teacherId, "Tạm khóa kiểm tra");
    expect(lockRes.ok).toBe(true);
    expect(getTeacherById(teacherId)?.approvalStatus).toBe("LOCKED");
    expect(getTeacherById(teacherId)?.status).toBe("locked");

    const unlockRes = await unlockTeacherAccount(teacherId);
    expect(unlockRes.ok).toBe(true);
    expect(getTeacherById(teacherId)?.approvalStatus).toBe("APPROVED");
    expect(getTeacherById(teacherId)?.status).toBe("active");
  });

  it("3. Super Admin can update teacher profile and archive vs permanently delete accounts", async () => {
    const t1: TeacherUser = {
      id: "teacher-edit-001",
      username: "gv_edit",
      name: "Trần Thị Cũ",
      email: "edit@school.edu.vn",
      school: "THPT Cũ",
      subject: "Toán",
      status: "active",
      approvalStatus: "APPROVED",
      passwordHash: hashPassword("Pass@123"),
      createdAt: new Date().toISOString(),
    };
    upsertTeacher(t1);

    const updRes = await updateTeacherProfileByAdmin(t1.id, {
      fullName: "Trần Thị Mới",
      username: "gv_moi",
      phone: "0988777666",
      schoolName: "THPT Chuyên Lê Quý Đôn",
      subjectName: "Tin học",
    });
    expect(updRes.ok).toBe(true);
    const updated = getTeacherById(t1.id)!;
    expect(updated.name).toBe("Trần Thị Mới");
    expect(updated.school).toBe("THPT Chuyên Lê Quý Đôn");
    expect(updated.subject).toBe("Tin học");

    // Archive preserves teacher profile locked without erasing
    const archiveRes = await deleteTeacherAccount(t1.id, true);
    expect(archiveRes.ok).toBe(true);
    expect(getTeacherById(t1.id)?.approvalStatus).toBe("LOCKED");

    // Hard delete removes teacher from local registry
    const hardRes = await deleteTeacherAccount(t1.id, false);
    expect(hardRes.ok).toBe(true);
    expect(getTeacherById(t1.id)).toBeNull();
  });

  it("4. Super Admin can inspect, edit questions/settings, lock, and delete teacher exams", async () => {
    const exam: SystemExam = {
      id: "local-exam-admin-001",
      title: "Đề kiểm tra Tin học 12",
      duration_minutes: 45,
      created_at: new Date().toISOString(),
      created_by: "teacher-001",
      teacher_name: "Cô Hoa",
      subject_name: "Tin học",
      manual_closed: false,
      team_config: { primary_code: "654321" },
      questions: {
        partI: [
          {
            id: "q1",
            text: "HTML là viết tắt của gì?",
            options: [
              { key: "A", text: "HyperText Markup Language" },
              { key: "B", text: "High Text Machine Language" },
            ],
            answer: "A",
          },
        ],
        partII: [],
        partIII: [],
      },
    };
    saveUnifiedExam(exam);

    expect(getExamCodeBadgeForAdmin(exam)).toBe("654321");

    const editRes = await saveExamByAdmin({
      ...exam,
      title: "Đề kiểm tra Tin học 12 (Đã duyệt)",
      duration_minutes: 60,
    });
    expect(editRes.ok).toBe(true);

    const allAfterEdit = await fetchAllExamsForAdmin();
    const updated = allAfterEdit.find((e) => e.id === exam.id);
    expect(updated?.title).toBe("Đề kiểm tra Tin học 12 (Đã duyệt)");
    expect(updated?.duration_minutes).toBe(60);

    const delRes = await deleteExamByAdmin(exam.id, true);
    expect(delRes.ok).toBe(true);
    const allAfterDel = await fetchAllExamsForAdmin();
    expect(allAfterDel.some((e) => e.id === exam.id)).toBe(false);
  });
});
