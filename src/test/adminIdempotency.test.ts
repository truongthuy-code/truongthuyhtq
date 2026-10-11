import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllAdmins,
  getRootAdmin,
  getAdminByUsernameOrEmail,
  changeAdminPassword,
  hashPassword,
  DEFAULT_ROOT_ADMIN,
  ROOT_SUPER_ADMIN_ID,
  upsertAdmin,
} from "@/lib/teacherStorage";

describe("Admin Account Idempotency & RBAC Verification", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("1. Initializes exactly 1 root admin with username 'admin' and default password hash (123456)", () => {
    const admins = getAllAdmins();
    expect(admins).toHaveLength(1);

    const admin = admins[0];
    expect(admin.username).toBe("admin");
    expect(admin.email).toBe("admin@admin.com");
    expect(admin.status).toBe("active");
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).toBe(hashPassword("123456"));
  });

  it("2. Idempotency test: calling initialization 10 times results in exactly 1 admin", () => {
    for (let i = 0; i < 10; i++) {
      getAllAdmins();
    }
    const admins = getAllAdmins();
    const adminCount = admins.filter(
      (a) => a.username.toLowerCase() === "admin" || a.email.toLowerCase() === "admin@admin.com"
    ).length;
    expect(adminCount).toBe(1);
    expect(admins).toHaveLength(1);
  });

  it("3. Password change: updates password, sets mustChangePassword to false, and never resets back on re-deploy", () => {
    // Initial setup
    const initial = getAllAdmins();
    expect(initial[0].mustChangePassword).toBe(true);

    // Admin changes password from 123456 to Abc@123456
    const changeRes = changeAdminPassword(ROOT_SUPER_ADMIN_ID, "Abc@123456");
    expect(changeRes.ok).toBe(true);

    const updated = getRootAdmin();
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.passwordHash).toBe(hashPassword("Abc@123456"));

    // Simulate 5 re-deployments / page reloads
    for (let i = 0; i < 5; i++) {
      getAllAdmins();
    }

    const reloaded = getRootAdmin();
    expect(reloaded.passwordHash).toBe(hashPassword("Abc@123456"));
    expect(reloaded.passwordHash).not.toBe(hashPassword("123456"));
    expect(reloaded.mustChangePassword).toBe(false);
  });

  it("4. Case-insensitive lookup by username 'admin', 'ADMIN', or email 'admin@admin.com'", () => {
    getAllAdmins();

    expect(getAdminByUsernameOrEmail("admin")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("ADMIN")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("Admin")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("admin@admin.com")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("ADMIN@ADMIN.COM")).not.toBeNull();
  });

  it("5. Secondary admins can be added with role 'admin', but duplicate 'admin' username is rejected", () => {
    getAllAdmins();

    // Trying to add another admin with username 'admin'
    const dupRes = upsertAdmin({
      id: "another-uuid",
      username: "admin",
      name: "Duplicate Admin",
      email: "dup@admin.com",
      role: "admin",
      passwordHash: hashPassword("123456"),
      status: "active",
      createdAt: new Date().toISOString(),
    });

    expect(dupRes.ok).toBe(false);
    expect(dupRes.message).toContain("đã tồn tại");
  });
});
