import { useEffect, useState, useCallback } from "react";
import {
  StudentUser,
  getCurrentStudent,
  loginStudent as doLogin,
  registerStudent as doRegister,
  logoutStudent as doLogout,
} from "@/lib/studentStorage";

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

  const logout = () => {
    doLogout();
    setStudent(null);
  };

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
