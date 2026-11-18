import { describe, it, expect, beforeEach } from "vitest";
import {
  getAllAdmins,
  getRootAdmin,
  getAdminByUsernameOrEmail,
  changeAdminPassword,
  hashPassword,
  ROOT_SUPER_ADMIN_ID,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_USERNAME,
  upsertAdmin,
} from "@/lib/teacherStorage";

describe("Admin Account Idempotency & RBAC Verification", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("1. Initializes exactly 1 Super Admin with bichthuylqd@gmail.com and default password hash (123456)", () => {
    const admins = getAllAdmins();
    expect(admins).toHaveLength(1);

    const admin = admins[0];
    expect(admin.username).toBe(SUPER_ADMIN_USERNAME);
    expect(admin.email).toBe(SUPER_ADMIN_EMAIL);
    expect(admin.status).toBe("active");
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).toBe(hashPassword("123456"));
  });

  it("2. Idempotency test: calling initialization 10 times results in exactly 1 Super Admin", () => {
    for (let i = 0; i < 10; i++) {
      getAllAdmins();
    }
    const admins = getAllAdmins();
    const adminCount = admins.filter(
      (a) =>
        a.username.toLowerCase() === SUPER_ADMIN_USERNAME ||
        a.email.toLowerCase() === SUPER_ADMIN_EMAIL
    ).length;
    expect(adminCount).toBe(1);
    expect(admins).toHaveLength(1);
  });

  it("3. Password change: updates password, sets mustChangePassword to false, and never resets back on re-deploy", () => {
    const initial = getAllAdmins();
    expect(initial[0].mustChangePassword).toBe(true);

    const changeRes = changeAdminPassword(ROOT_SUPER_ADMIN_ID, "Abc@123456");
    expect(changeRes.ok).toBe(true);

    const updated = getRootAdmin();
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.passwordHash).toBe(hashPassword("Abc@123456"));

    for (let i = 0; i < 5; i++) {
      getAllAdmins();
    }

    const reloaded = getRootAdmin();
    expect(reloaded.passwordHash).toBe(hashPassword("Abc@123456"));
    expect(reloaded.passwordHash).not.toBe(hashPassword("123456"));
    expect(reloaded.mustChangePassword).toBe(false);
  });

  it("4. Case-insensitive lookup for bichthuylqd and bichthuylqd@gmail.com only", () => {
    getAllAdmins();

    expect(getAdminByUsernameOrEmail("bichthuylqd")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("BICHTHUYLQD")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("bichthuylqd@gmail.com")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("BICHTHUYLQD@GMAIL.COM")).not.toBeNull();
    expect(getAdminByUsernameOrEmail("random@gmail.com")).toBeNull();
  });

  it("5. Rejects privilege escalation or adding any second admin account", () => {
    getAllAdmins();

    const dupRes = upsertAdmin({
      id: "another-uuid",
      username: "second_admin",
      name: "Duplicate Admin",
      email: "second@school.edu.vn",
      role: "super_admin",
      passwordHash: hashPassword("Abc@123456"),
      status: "active",
      createdAt: new Date().toISOString(),
    });

    expect(dupRes.ok).toBe(false);
    expect(getAllAdmins()).toHaveLength(1);
  });
});
