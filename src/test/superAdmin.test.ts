import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllAdmins,
  getRootAdmin,
  upsertAdmin,
  deleteAdmin,
  changeAdminPassword,
  hashPassword,
  ROOT_SUPER_ADMIN_ID,
  DEFAULT_ROOT_ADMIN,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_USERNAME,
  getAdminByUsernameOrEmail,
} from "@/lib/teacherStorage";

describe("Single Super Admin System (bichthuylqd@gmail.com)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should initialize exactly 1 root Super Admin on first run with bichthuylqd@gmail.com", () => {
    const admins = getAllAdmins();
    expect(admins).toHaveLength(1);

    const root = admins[0];
    expect(root.id).toBe(ROOT_SUPER_ADMIN_ID);
    expect(root.username).toBe(SUPER_ADMIN_USERNAME);
    expect(root.email).toBe(SUPER_ADMIN_EMAIL);
    expect(root.role).toBe("super_admin");
    expect(root.status).toBe("active");
    expect(root.passwordHash).toBe(DEFAULT_ROOT_ADMIN.passwordHash);
  });

  it("should find root admin by username 'bichthuylqd' or email 'bichthuylqd@gmail.com' (case-insensitive)", () => {
    getAllAdmins();
    const byUname = getAdminByUsernameOrEmail("bichthuylqd");
    expect(byUname).not.toBeNull();
    expect(byUname?.role).toBe("super_admin");

    const byEmail = getAdminByUsernameOrEmail("bichthuylqd@gmail.com");
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(ROOT_SUPER_ADMIN_ID);

    const byUpper = getAdminByUsernameOrEmail("BICHTHUYLQD@GMAIL.COM");
    expect(byUpper).not.toBeNull();

    // Legacy 'admin@admin.com' must NOT match Super Admin
    expect(getAdminByUsernameOrEmail("admin@admin.com")).toBeNull();
    expect(getAdminByUsernameOrEmail("admin")).toBeNull();
  });

  it("should not recreate or duplicate root Super Admin on multiple calls", () => {
    getAllAdmins();
    getAllAdmins();
    const admins = getAllAdmins();
    expect(admins.filter((a) => a.role === "super_admin")).toHaveLength(1);
    expect(admins).toHaveLength(1);
  });

  it("should change root admin password and never reset it back to 123456", () => {
    getAllAdmins();

    const res = changeAdminPassword(ROOT_SUPER_ADMIN_ID, "NewSecurePass@2026");
    expect(res.ok).toBe(true);

    const updatedRoot = getRootAdmin();
    expect(updatedRoot.mustChangePassword).toBe(false);
    expect(updatedRoot.passwordHash).toBe(hashPassword("NewSecurePass@2026"));
    expect(updatedRoot.passwordHash).not.toBe(hashPassword("123456"));

    // Simulate system restarts / multiple loads
    const reloadedAdmins = getAllAdmins();
    const reloadedRoot = reloadedAdmins.find((a) => a.id === ROOT_SUPER_ADMIN_ID)!;

    expect(reloadedRoot.mustChangePassword).toBe(false);
    expect(reloadedRoot.passwordHash).toBe(hashPassword("NewSecurePass@2026"));
  });

  it("should reject reusing default password '123456' during password change", () => {
    getAllAdmins();
    const res = changeAdminPassword(ROOT_SUPER_ADMIN_ID, "123456");
    expect(res.ok).toBe(false);
  });

  it("should enforce single Super Admin lock and reject creating any second admin/super_admin", () => {
    getAllAdmins();

    const secondaryAdminAttempt = {
      id: "admin-sub-001",
      username: "admin_toan",
      name: "Nguyễn Văn Toán",
      email: "admin_toan@lqd.edu.vn",
      role: "super_admin" as const,
      passwordHash: hashPassword("Toan@123456"),
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };

    const res = upsertAdmin(secondaryAdminAttempt);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SUPER_ADMIN_EMAIL);
    expect(getAllAdmins()).toHaveLength(1);
  });

  it("should never allow deleting or demoting the root Super Admin", () => {
    getAllAdmins();

    const deleteRes = deleteAdmin(ROOT_SUPER_ADMIN_ID);
    expect(deleteRes.ok).toBe(false);
    expect(deleteRes.message).toContain("không thể xóa");

    const admins = getAllAdmins();
    expect(admins.find((a) => a.id === ROOT_SUPER_ADMIN_ID)).toBeDefined();
  });
});
