import { useCallback, useEffect, useRef, useState } from "react";
import { resolvePlayableAudioUrl } from "@/lib/audioStorage";

/**
 * Nhạc nền tổng hợp bằng Web Audio API (khi không có file nhạc import hoặc chọn nhạc mặc định).
 */
const DEFAULT_LOOP: { note: number; dur: number }[] = [
  { note: 440, dur: 0.2 }, { note: 523.25, dur: 0.2 }, { note: 659.25, dur: 0.2 }, { note: 587.33, dur: 0.2 },
  { note: 523.25, dur: 0.2 }, { note: 659.25, dur: 0.2 }, { note: 783.99, dur: 0.25 }, { note: 659.25, dur: 0.2 },
  { note: 587.33, dur: 0.2 }, { note: 493.88, dur: 0.2 }, { note: 523.25, dur: 0.3 }, { note: 659.25, dur: 0.4 },
];

const VICTORY: { note: number; dur: number }[] = [
  { note: 523.25, dur: 0.12 }, { note: 659.25, dur: 0.12 }, { note: 783.99, dur: 0.15 },
  { note: 1046.5, dur: 0.3 }, { note: 783.99, dur: 0.15 }, { note: 1046.5, dur: 0.6 },
];

const SCORE_UP: { note: number; dur: number }[] = [
  { note: 587.33, dur: 0.1 }, { note: 880, dur: 0.22 },
];

export interface BattleMusicOptions {
  initialVolume?: number;
  customAudioUrl?: string | null;
  idbKey?: string | null;
  loop?: boolean;
}

export function useBattleMusic(options: number | BattleMusicOptions = 0.4) {
  const opts: BattleMusicOptions =
    typeof options === "number" ? { initialVolume: options } : options;

  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(opts.initialVolume ?? 0.4);
  const [isLoop, setIsLoop] = useState(opts.loop !== false);
  const [customUrl, setCustomUrl] = useState<string | null>(opts.customAudioUrl || null);

  // WebAudio synth refs
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const stoppedRef = useRef(true);

  // HTMLAudioElement ref for custom imported audio file
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const resolvedUrlRef = useRef<string | null>(null);

  // Cập nhật customUrl khi options thay đổi
  useEffect(() => {
    if (typeof options !== "number") {
      setCustomUrl(options.customAudioUrl || null);
      if (options.loop !== undefined) setIsLoop(options.loop);
      if (options.initialVolume !== undefined) setVolume(options.initialVolume);
    }
  }, [options]);

  // Giải quyết URL nếu cần từ IDB hoặc Data URL
  useEffect(() => {
    let active = true;
    (async () => {
      const idbKey = typeof options !== "number" ? options.idbKey : undefined;
      const targetUrl = customUrl || (typeof options !== "number" ? options.customAudioUrl : null);
      const res = await resolvePlayableAudioUrl(targetUrl || undefined, idbKey || undefined);
      if (active) {
        resolvedUrlRef.current = res;
        if (audioElementRef.current && res) {
          if (audioElementRef.current.src !== res) {
            audioElementRef.current.src = res;
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [customUrl, options]);

  // Khởi tạo WebAudio context
  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      const ctx: AudioContext = new AC();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      gainRef.current = gain;
    }
    return ctxRef.current;
  }, [volume]);

  // Đồng bộ âm lượng
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
    if (audioElementRef.current) audioElementRef.current.volume = volume;
  }, [volume]);

  // Đồng bộ phát lặp
  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.loop = isLoop;
    }
  }, [isLoop]);

  // WebAudio synth player
  const playSequence = useCallback((seq: { note: number; dur: number }[], type: OscillatorType, vol: number) => {
    const ctx = ensureCtx();
    if (!ctx || !gainRef.current) return 0;
    let t = ctx.currentTime + 0.02;
    seq.forEach(({ note, dur }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = note;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(gainRef.current!);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      t += dur;
    });
    return (t - ctx.currentTime) * 1000;
  }, [ensureCtx]);

  const synthLoop = useCallback(() => {
    if (stoppedRef.current) return;
    const ms = playSequence(DEFAULT_LOOP, "triangle", 0.25);
    timerRef.current = window.setTimeout(synthLoop, Math.max(400, ms - 30));
  }, [playSequence]);

  // Dừng mọi âm thanh nền
  const stop = useCallback(() => {
    stoppedRef.current = true;
    setPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
      } catch {}
    }
  }, []);

  // Bắt đầu phát
  const start = useCallback(async () => {
    stoppedRef.current = false;

    // 1. Nếu có file nhạc riêng (custom audio)
    const playUrl = resolvedUrlRef.current || customUrl;
    if (playUrl) {
      try {
        if (!audioElementRef.current) {
          const audio = new Audio();
          audio.preload = "auto";
          audio.onended = () => {
            if (!audio.loop) {
              setPlaying(false);
              stoppedRef.current = true;
            }
          };
          audioElementRef.current = audio;
        }

        const audio = audioElementRef.current;
        if (audio.src !== playUrl) {
          audio.src = playUrl;
        }
        audio.volume = volume;
        audio.loop = isLoop;
        await audio.play();
        setPlaying(true);
        return;
      } catch {
        // Nếu file nhạc bị chặn hoặc lỗi, tự động chuyển về nhạc synth mặc định
      }
    }

    // 2. Nhạc synth mặc định
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    setPlaying(true);
    synthLoop();
  }, [customUrl, volume, isLoop, synthLoop, ensureCtx]);

  const toggle = useCallback(() => {
    if (stoppedRef.current || !playing) {
      start();
    } else {
      stop();
    }
  }, [playing, start, stop]);

  const playVictory = useCallback(() => {
    stop();
    playSequence(VICTORY, "square", 0.4);
  }, [playSequence, stop]);

  const playScoreUp = useCallback(() => {
    playSequence(SCORE_UP, "sine", 0.35);
  }, [playSequence]);

  // Clean up
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (audioElementRef.current) {
        try {
          audioElementRef.current.pause();
          audioElementRef.current.src = "";
        } catch {}
      }
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  return {
    playing,
    volume,
    setVolume,
    isLoop,
    setIsLoop,
    customUrl,
    setCustomUrl,
    start,
    stop,
    toggle,
    playVictory,
    playScoreUp,
  };
}
