import { useEffect, useState, useCallback } from "react";
import {
  StudentUser,
  getCurrentStudent,
  loginStudent as doLogin,
  registerStudent as doRegister,
  logoutStudent as doLogout,
} from "@/lib/studentStorage";
import { performFullLogout } from "@/lib/authCleanup";

export function useStudentAuth() {
  const [student, setStudent] = useState<StudentUser | null>(() => getCurrentStudent());
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setStudent(getCurrentStudent());
  }, []);

  useEffect(() => {
    const handleAuthChange = () => {
      setStudent(getCurrentStudent());
    };
    window.addEventListener("student_auth_change", handleAuthChange);
    window.addEventListener("storage", handleAuthChange);
    return () => {
      window.removeEventListener("student_auth_change", handleAuthChange);
      window.removeEventListener("storage", handleAuthChange);
    };
  }, []);

  const login = (account: string, pass: string) => {
    setLoading(true);
    const res = doLogin(account, pass);
    setLoading(false);
    if (res.success && res.student) {
      setStudent(res.student);
    }
    return res;
  };

  const register = (params: { fullName: string; className: string; account: string; password: string }) => {
    setLoading(true);
    const res = doRegister(params);
    setLoading(false);
    if (res.success && res.student) {
      setStudent(res.student);
    }
    return res;
  };

  const logout = useCallback(async (options?: { redirectTo?: string; redirect?: boolean }) => {
    doLogout();
    setStudent(null);
    await performFullLogout({
      redirectTo: options?.redirectTo || "/student/auth",
      type: "student",
      redirect: options?.redirect !== false,
    });
  }, []);

  return {
    student,
    isLoggedIn: !!student,
    loading,
    login,
    register,
    logout,
    refresh,
  };
}
