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
  getAdminByUsernameOrEmail,
} from "@/lib/teacherStorage";

describe("Super Admin & Admin System", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("should initialize exactly 1 root Super Admin on first run with correct attributes", () => {
    const admins = getAllAdmins();
    expect(admins).toHaveLength(1);

    const root = admins[0];
    expect(root.id).toBe(ROOT_SUPER_ADMIN_ID);
    expect(root.username).toBe("admin");
    expect(root.email).toBe("admin@admin.com");
    expect(root.role).toBe("super_admin");
    expect(root.status).toBe("active");
    expect(root.passwordHash).toBe(DEFAULT_ROOT_ADMIN.passwordHash);
  });

  it("should find root admin by username 'admin' or email 'admin@admin.com'", () => {
    getAllAdmins();
    const byUname = getAdminByUsernameOrEmail("admin");
    expect(byUname).not.toBeNull();
    expect(byUname?.role).toBe("super_admin");

    const byEmail = getAdminByUsernameOrEmail("admin@admin.com");
    expect(byEmail).not.toBeNull();
    expect(byEmail?.id).toBe(ROOT_SUPER_ADMIN_ID);

    // Case insensitive
    const byUpper = getAdminByUsernameOrEmail("ADMIN");
    expect(byUpper).not.toBeNull();
  });

  it("should not recreate or duplicate root Super Admin on multiple calls", () => {
    getAllAdmins();
    getAllAdmins();
    const admins = getAllAdmins();
    expect(admins.filter((a) => a.role === "super_admin")).toHaveLength(1);
  });

  it("should change root admin password and never reset it back to default", () => {
    getAllAdmins();

    // Change password to a strong new password
    const res = changeAdminPassword(ROOT_SUPER_ADMIN_ID, "NewSecurePass@2026");
    expect(res.ok).toBe(true);

    const updatedRoot = getRootAdmin();
    expect(updatedRoot.mustChangePassword).toBe(false);
    expect(updatedRoot.passwordHash).toBe(hashPassword("NewSecurePass@2026"));
    expect(updatedRoot.passwordHash).not.toBe(hashPassword("Admin@123456"));

    // Simulate system restarts / multiple loads
    const reloadedAdmins = getAllAdmins();
    const reloadedRoot = reloadedAdmins.find((a) => a.id === ROOT_SUPER_ADMIN_ID)!;

    // Password must remain the new password, not reset to default!
    expect(reloadedRoot.mustChangePassword).toBe(false);
    expect(reloadedRoot.passwordHash).toBe(hashPassword("NewSecurePass@2026"));
  });

  it("should allow Super Admin to create secondary Admins with role 'admin'", () => {
    getAllAdmins();

    const newAdmin = {
      id: "admin-sub-001",
      username: "admin_toan",
      name: "Nguyễn Văn Toán",
      email: "admin_toan@lqd.edu.vn",
      role: "admin" as const,
      passwordHash: hashPassword("Toan@123456"),
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };

    const res = upsertAdmin(newAdmin);
    expect(res.ok).toBe(true);

    const all = getAllAdmins();
    expect(all).toHaveLength(2);

    const sub = all.find((a) => a.username === "admin_toan");
    expect(sub).toBeDefined();
    expect(sub?.role).toBe("admin");
  });

  it("should reject creating a second super_admin", () => {
    getAllAdmins();

    const fakeSuper = {
      id: "admin-fake-002",
      username: "super_2",
      name: "Fake Super",
      email: "fake@super.com",
      role: "super_admin" as const,
      passwordHash: hashPassword("Secret@123"),
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };

    const res = upsertAdmin(fakeSuper);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("duy nhất 01 tài khoản Super Admin");
  });

  it("should never allow deleting or demoting the root Super Admin", () => {
    getAllAdmins();

    const deleteRes = deleteAdmin(ROOT_SUPER_ADMIN_ID);
    expect(deleteRes.ok).toBe(false);
    expect(deleteRes.message).toContain("không thể xóa");

    // Root admin must still exist
    const admins = getAllAdmins();
    expect(admins.find((a) => a.id === ROOT_SUPER_ADMIN_ID)).toBeDefined();
  });
});
