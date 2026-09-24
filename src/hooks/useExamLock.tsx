import { useCallback, useEffect, useRef, useState } from "react";

export type LockMode = {
  enabled: boolean;
  warnOnly: boolean;
  autoLog: boolean;
  penalty: boolean;
  penaltyPerViolation: number;
  autoSubmit: boolean;
  maxViolations: number;
};

export const DEFAULT_LOCK: LockMode = {
  enabled: false, warnOnly: true, autoLog: true,
  penalty: false, penaltyPerViolation: 0.25,
  autoSubmit: true, maxViolations: 3,
};

export type Violation = { at: string; type: string; duration_ms?: number };

type Opts = {
  active: boolean;
  lock?: LockMode | null;
  onAutoSubmit: () => void;
};

export function useExamLock({ active, lock, onAutoSubmit }: Opts) {
  const cfg = lock || DEFAULT_LOCK;
  const enabled = active && cfg.enabled;
  const [violations, setViolations] = useState<Violation[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const awayAt = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const recordViolation = useCallback((type: string) => {
    if (!enabled) return;
    const now = Date.now();
    const duration_ms = awayAt.current ? now - awayAt.current : undefined;
    awayAt.current = null;
    setViolations((prev) => {
      const next = [...prev, { at: new Date(now).toISOString(), type, duration_ms }];
      const count = next.length;
      if (cfg.warnOnly) {
        setWarning(`Bạn vừa rời khỏi màn hình làm bài (${type}). Lần vi phạm: ${count}.`);
      } else if (count >= cfg.maxViolations) {
        if (cfg.autoSubmit) {
          setLocked(true);
          setWarning(`Bạn đã vi phạm ${count} lần. Bài thi sẽ được tự động nộp.`);
          if (!submittedRef.current) {
            submittedRef.current = true;
            setTimeout(() => onAutoSubmit(), 1500);
          }
        } else {
          setWarning(`Bạn đã vi phạm ${count} lần. Đây là vi phạm cuối cùng.`);
        }
      } else if (count === cfg.maxViolations - 1) {
        setWarning(`Bạn đã vi phạm ${count} lần. Nếu tiếp tục, bài thi có thể bị nộp tự động.`);
      } else {
        setWarning(`Bạn vừa rời khỏi màn hình. Hệ thống đã ghi nhận ${count} lần vi phạm.`);
      }
      return next;
    });
  }, [enabled, cfg, onAutoSubmit]);

  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.hidden) {
        awayAt.current = Date.now();
        recordViolation("Chuyển tab / khóa màn hình");
      }
    };
    const onBlur = () => {
      if (!document.hidden) {
        awayAt.current = Date.now();
        recordViolation("Mất focus cửa sổ");
      }
    };
    const onFocus = () => { awayAt.current = null; };
    const onContext = (e: Event) => e.preventDefault();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("contextmenu", onContext);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("contextmenu", onContext);
    };
  }, [enabled, recordViolation]);

  const requestFullscreen = useCallback(async () => {
    try {
      const el = document.documentElement as any;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (fn) await fn.call(el);
    } catch {}
  }, []);

  const exitFullscreen = useCallback(async () => {
    try {
      const d = document as any;
      const fn = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
      if (fn && (d.fullscreenElement || d.webkitFullscreenElement)) await fn.call(d);
    } catch {}
  }, []);

  return {
    enabled,
    violations,
    violationCount: violations.length,
    warning,
    locked,
    dismissWarning: () => setWarning(null),
    requestFullscreen,
    exitFullscreen,
  };
}
