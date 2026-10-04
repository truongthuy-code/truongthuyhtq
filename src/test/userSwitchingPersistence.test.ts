import { describe, it, expect, beforeEach } from "vitest";
import {
  getCurrentAuthUser,
  setCurrentAuthUser,
  getTeacherById,
  upsertTeacher,
  TeacherUser,
  DEFAULT_TEACHER_ID,
  getAllTeachers,
} from "@/lib/teacherStorage";
import {
  getCurrentStudent,
  setCurrentStudent,
  registerStudent,
  loginStudent,
} from "@/lib/studentStorage";

describe("User Account & Name Switching Persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("should switch to a new teacher account and never revert to initial default teacher", () => {
    // 1. Initial state: verify default teacher exists in registry
    const initialTeachers = getAllTeachers();
    expect(initialTeachers.length).toBeGreaterThan(0);

    // 2. Teacher 1 logs in
    const teacher1: TeacherUser = {
      id: "11111111-1111-4000-8000-111111111111",
      username: "gv_nguyenvana",
      name: "Nguyễn Văn A",
      email: "vana@school.edu.vn",
      school: "THPT Chu Văn An",
      subject: "Toán",
      status: "active",
      passwordHash: "hash1",
      createdAt: new Date().toISOString(),
    };
    upsertTeacher(teacher1);
    setCurrentAuthUser({
      id: teacher1.id,
      username: teacher1.username,
      name: teacher1.name,
      email: teacher1.email,
      school: teacher1.school,
      subject: teacher1.subject,
      role: "teacher",
    });

    let current = getCurrentAuthUser();
    expect(current?.id).toBe(teacher1.id);
    expect(current?.name).toBe("Nguyễn Văn A");

    // 3. Teacher 2 logs in with a different name and username
    const teacher2: TeacherUser = {
      id: "22222222-2222-4000-8000-222222222222",
      username: "gv_tranthib",
      name: "Trần Thị B",
      email: "thib@school.edu.vn",
      school: "THPT Lê Quý Đôn",
      subject: "Hóa học",
      status: "active",
      passwordHash: "hash2",
      createdAt: new Date().toISOString(),
    };
    upsertTeacher(teacher2);
    setCurrentAuthUser({
      id: teacher2.id,
      username: teacher2.username,
      name: teacher2.name,
      email: teacher2.email,
      school: teacher2.school,
      subject: teacher2.subject,
      role: "teacher",
    });

    // Verify current user is strictly Teacher 2 and NOT Teacher 1 and NOT Default Teacher
    current = getCurrentAuthUser();
    expect(current?.id).toBe(teacher2.id);
    expect(current?.name).toBe("Trần Thị B");
    expect(current?.username).toBe("gv_tranthib");
    expect(current?.id).not.toBe(DEFAULT_TEACHER_ID);
    expect(current?.name).not.toBe("Trương Thị Bích Thủy");

    // Check registry consistency
    const registeredT2 = getTeacherById(teacher2.id);
    expect(registeredT2?.name).toBe("Trần Thị B");
  });

  it("should preserve updated name and never revert to original name", () => {
    const teacher: TeacherUser = {
      id: "33333333-3333-4000-8000-333333333333",
      username: "gv_lethic",
      name: "Lê Thị C",
      email: "lethic@school.edu.vn",
      school: "THPT Chuyên",
      subject: "Vật lí",
      status: "active",
      passwordHash: "hash3",
      createdAt: new Date().toISOString(),
    };
    upsertTeacher(teacher);
    setCurrentAuthUser({
      id: teacher.id,
      username: teacher.username,
      name: teacher.name,
      email: teacher.email,
      role: "teacher",
    });

    // Update name to a new name
    const newName = "Lê Thị Cẩm Tú";
    setCurrentAuthUser({
      ...getCurrentAuthUser()!,
      name: newName,
    });

    const updated = getCurrentAuthUser();
    expect(updated?.name).toBe(newName);
    expect(updated?.name).not.toBe("Lê Thị C");

    const registryT = getTeacherById(teacher.id);
    expect(registryT?.name).toBe(newName);
  });

  it("should switch student accounts cleanly without retaining old student name", () => {
    // Student 1 registers and logs in
    const s1 = registerStudent({
      fullName: "Học Sinh 1",
      className: "10A1",
      account: "hs1@school.edu.vn",
      password: "password123",
    });
    expect(s1.success).toBe(true);
    expect(getCurrentStudent()?.fullName).toBe("Học Sinh 1");

    // Student 2 registers and logs in
    const s2 = registerStudent({
      fullName: "Học Sinh 2",
      className: "11B2",
      account: "hs2@school.edu.vn",
      password: "password456",
    });
    expect(s2.success).toBe(true);

    const currentStudent = getCurrentStudent();
    expect(currentStudent?.fullName).toBe("Học Sinh 2");
    expect(currentStudent?.className).toBe("11B2");
    expect(currentStudent?.account).toBe("hs2@school.edu.vn");
  });
});
