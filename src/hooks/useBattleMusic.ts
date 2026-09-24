import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Nhạc nền thi đấu sinh bằng WebAudio (không cần file ngoài, không ảnh hưởng
 * âm thanh hệ thống khác vì chỉ dùng AudioContext riêng của trang).
 */
const LOOP: { note: number; dur: number }[] = [
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

export function useBattleMusic(initialVolume = 0.4) {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(initialVolume);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const stoppedRef = useRef(true);

  const ensureCtx = () => {
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
  };

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

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
  }, []);

  const loop = useCallback(() => {
    if (stoppedRef.current) return;
    const ms = playSequence(LOOP, "triangle", 0.25);
    timerRef.current = window.setTimeout(loop, Math.max(400, ms - 30));
  }, [playSequence]);

  const start = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!stoppedRef.current) return;
    stoppedRef.current = false;
    setPlaying(true);
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setPlaying(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const toggle = useCallback(() => { stoppedRef.current ? start() : stop(); }, [start, stop]);

  const playVictory = useCallback(() => {
    stop();
    playSequence(VICTORY, "square", 0.4);
  }, [playSequence, stop]);

  const playScoreUp = useCallback(() => {
    playSequence(SCORE_UP, "sine", 0.35);
  }, [playSequence]);

  useEffect(() => () => {
    stoppedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    ctxRef.current?.close().catch(() => {});
  }, []);

  return { playing, volume, setVolume, start, stop, toggle, playVictory, playScoreUp };
}
