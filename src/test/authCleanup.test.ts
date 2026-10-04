import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearAuthCookies,
  clearAuthSessionStorage,
  clearAuthLocalStorage,
  performFullLogout,
} from "@/lib/authCleanup";

describe("authCleanup utilities", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "";
  });

  it("should clear auth session tokens while preserving user registries in localStorage", () => {
    // Populate localStorage with registries and auth session keys
    localStorage.setItem("qc_teachers_registry_v2", JSON.stringify([{ id: "t1", name: "Teacher 1" }]));
    localStorage.setItem("qc_admin_accounts_list_v3", JSON.stringify([{ id: "a1", name: "Admin 1" }]));
    localStorage.setItem("exam_students", JSON.stringify([{ id: "s1", name: "Student 1" }]));
    localStorage.setItem("theme", "dark");

    // Session keys that should be deleted
    localStorage.setItem("qc_current_auth_user_v2", JSON.stringify({ id: "t1" }));
    localStorage.setItem("exam_current_student", JSON.stringify({ id: "s1" }));
    localStorage.setItem("sb-project-id-auth-token", "eyJhbGciOi...");
    localStorage.setItem("session_token", "sample_token");
    localStorage.setItem("auth_redirect", "/teacher");

    expect(localStorage.getItem("qc_current_auth_user_v2")).toBeTruthy();
    expect(localStorage.getItem("sb-project-id-auth-token")).toBeTruthy();

    clearAuthLocalStorage("all");

    // Session keys must be gone
    expect(localStorage.getItem("qc_current_auth_user_v2")).toBeNull();
    expect(localStorage.getItem("exam_current_student")).toBeNull();
    expect(localStorage.getItem("sb-project-id-auth-token")).toBeNull();
    expect(localStorage.getItem("session_token")).toBeNull();
    expect(localStorage.getItem("auth_redirect")).toBeNull();

    // Registries must be intact
    expect(localStorage.getItem("qc_teachers_registry_v2")).toBeTruthy();
    expect(localStorage.getItem("qc_admin_accounts_list_v3")).toBeTruthy();
    expect(localStorage.getItem("exam_students")).toBeTruthy();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("should clear all sessionStorage", () => {
    sessionStorage.setItem("draft_answer", "A");
    sessionStorage.setItem("user_temp_state", "123");
    expect(sessionStorage.getItem("draft_answer")).toBe("A");

    clearAuthSessionStorage();

    expect(sessionStorage.getItem("draft_answer")).toBeNull();
    expect(sessionStorage.getItem("user_temp_state")).toBeNull();
  });

  it("should clear cookies when document.cookie is set", () => {
    document.cookie = "sb-access-token=xyz123";
    document.cookie = "session_id=abc456";

    clearAuthCookies();

    // After clearing, cookies should have been expired or cleared
    // In jsdom document.cookie clearing sets empty or expired values
    expect(document.cookie.includes("xyz123")).toBe(false);
  });

  it("should run performFullLogout without throwing and dispatch events", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    localStorage.setItem("qc_current_auth_user_v2", JSON.stringify({ id: "t1" }));
    sessionStorage.setItem("temp", "val");

    await performFullLogout({ redirect: false });

    expect(localStorage.getItem("qc_current_auth_user_v2")).toBeNull();
    expect(sessionStorage.getItem("temp")).toBeNull();
    expect(dispatchSpy).toHaveBeenCalled();
  });
});
