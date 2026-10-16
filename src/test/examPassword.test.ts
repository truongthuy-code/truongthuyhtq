import { describe, it, expect } from "vitest";
import { sha256, sha256Sync, encryptExamPassword, decryptExamPassword } from "@/lib/examSecurity";

describe("Exam Password Feature (Bổ sung mật khẩu bài thi)", () => {
  it("should correctly compute SHA-256 hash for passwords", async () => {
    const rawPassword = "ThiGK1_2026";
    const hash = await sha256(rawPassword);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThanOrEqual(16);

    // Same password produces identical hash
    const hash2 = await sha256(rawPassword);
    expect(hash2).toBe(hash);

    // Different password produces different hash
    const hashWrong = await sha256("WrongPass123");
    expect(hashWrong).not.toBe(hash);
  });

  it("should encrypt and decrypt passwords reliably across exam IDs and defaults", () => {
    const originalPassword = "SecretExamKey999@";
    const examId = "exam-uuid-12345-67890";

    const encryptedWithExamId = encryptExamPassword(originalPassword, examId);
    expect(encryptedWithExamId).not.toBe(originalPassword);

    const decrypted1 = decryptExamPassword(encryptedWithExamId, examId);
    expect(decrypted1).toBe(originalPassword);

    // Fallback decryption should work even if examId is 'default' or vice-versa
    const encryptedDefault = encryptExamPassword(originalPassword, "default");
    const decryptedDefault = decryptExamPassword(encryptedDefault, "default");
    expect(decryptedDefault).toBe(originalPassword);

    const decryptedFallback = decryptExamPassword(encryptedDefault, "some-other-id");
    expect(decryptedFallback).toBe(originalPassword);
  });

  it("should handle empty or whitespace passwords gracefully", async () => {
    expect(await sha256("")).toBe("");
    expect(await sha256("   ")).toBe("");
    expect(encryptExamPassword("")).toBe("");
    expect(decryptExamPassword("")).toBe("");
  });

  it("should correctly verify student entered password against password_hash", async () => {
    const teacherPassword = "ThiToan12_KHTN";
    const storedHash = await sha256(teacherPassword);

    // Student enters correct password
    const studentInputCorrect = "ThiToan12_KHTN";
    const studentHashCorrect = await sha256(studentInputCorrect.trim());
    expect(studentHashCorrect.toLowerCase()).toBe(storedHash.toLowerCase());

    // Student enters wrong password
    const studentInputWrong = "ThiToan12_KHTN_Wrong";
    const studentHashWrong = await sha256(studentInputWrong.trim());
    expect(studentHashWrong.toLowerCase()).not.toBe(storedHash.toLowerCase());
  });

  it("should enforce validation: require non-empty password when requirePassword is true", () => {
    const configOnWithoutPassword = {
      requirePassword: true,
      password: "   ",
    };
    const isValid = !configOnWithoutPassword.requirePassword || !!configOnWithoutPassword.password.trim();
    expect(isValid).toBe(false);

    const configOnWithPassword = {
      requirePassword: true,
      password: "MySecurePassword123",
    };
    const isValid2 = !configOnWithPassword.requirePassword || !!configOnWithPassword.password.trim();
    expect(isValid2).toBe(true);

    const configOff = {
      requirePassword: false,
      password: "",
    };
    const isValid3 = !configOff.requirePassword || !!configOff.password.trim();
    expect(isValid3).toBe(true);
  });
});
