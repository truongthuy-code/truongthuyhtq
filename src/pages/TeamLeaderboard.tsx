import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Music,
  Music2,
  Trophy,
  Maximize2,
  Minimize2,
  Home,
  Sparkles,
  Volume2,
  VolumeX,
  Radio,
  Award,
  Crown,
  Star,
  CheckCircle2,
} from "lucide-react";
import { useBattleMusic } from "@/hooks/useBattleMusic";
import { normalizeTeamConfig } from "@/components/TeamModeSettings";
import { useAuth } from "@/hooks/useAuth";

export type LbTeam = {
  id: string;
  name: string;
  score: number;
  max_score: number;
  correct_count: number;
  answered_count: number;
  finished_at: string | null;
};

/** Hàm sắp xếp thứ hạng: Điểm cao xếp trên, nếu bằng điểm xét thời gian nộp nhanh hơn */
export function rankTeams(teams: LbTeam[]): LbTeam[] {
  return [...teams].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const af = a.finished_at ? new Date(a.finished_at).getTime() : Infinity;
    const bf = b.finished_at ? new Date(b.finished_at).getTime() : Infinity;
    if (af !== bf) return af - bf;
    return b.answered_count - a.answered_count;
  });
}

/**
 * Bảng xếp hạng thu nhỏ gọn dùng trong màn hình học sinh (TeamTake)
 */
export function LeaderboardBoard({
  teams,
  totalQuestions,
  ended,
}: {
  teams: LbTeam[];
  totalQuestions: number;
  ended?: boolean;
}) {
  const ranked = rankTeams(teams);
  if (!ranked.length) {
    return (
      <div className="text-center text-muted-foreground py-8 font-medium">
        Chưa có nhóm nào tham gia…
      </div>
    );
  }

  const ROW_H = 68;
  return (
    <div className="relative w-full" style={{ height: ranked.length * ROW_H }}>
      {ranked.map((t, i) => {
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
        const pct = totalQuestions ? Math.min(100, Math.round((t.answered_count / totalQuestions) * 100)) : 0;
        const isTop = i === 0;

        return (
          <div
            key={t.id}
            className="absolute left-0 right-0 transition-all duration-700 ease-out"
            style={{ transform: `translateY(${i * ROW_H}px)` }}
          >
            <div
              className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 mb-2 shadow-sm transition-transform ${
                isTop
                  ? "border-amber-400 bg-gradient-to-r from-pink-500/15 via-rose-500/10 to-amber-500/15 shadow-md"
                  : "border-border bg-card"
              }`}
            >
              <div className="w-10 text-center text-xl font-black shrink-0">{medal}</div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-sm sm:text-base uppercase truncate flex items-center gap-1.5">
                  {t.name}
                  {isTop && <span className="text-amber-500">👑</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-semibold shrink-0">
                    {t.answered_count}/{totalQuestions || "?"} CÂU
                  </span>
                </div>
              </div>
              <div className="text-center shrink-0 w-16">
                <div className="text-[10px] text-muted-foreground font-semibold">CÂU ĐÚNG</div>
                <div className="font-black text-sm text-foreground">{t.correct_count}</div>
              </div>
              <div className="text-right shrink-0 w-24">
                <div className="text-[10px] text-muted-foreground font-semibold">ĐIỂM</div>
                <div className="text-base font-black text-amber-500 flex items-center justify-end gap-0.5">
                  <Star className="size-3.5 fill-amber-400 text-amber-400 inline" />
                  {Number(t.score).toFixed(t.score % 1 === 0 ? 0 : 2)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hiệu ứng pháo giấy confetti rơi */
function Confetti({ run }: { run: boolean }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 65 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.8,
        dur: 3.2 + Math.random() * 2.5,
        size: 9 + Math.random() * 12,
        color: ["#FACC15", "#EC4899", "#F43F5E", "#38BDF8", "#A855F7", "#4ADE80"][i % 6],
        rot: Math.random() * 360,
      })),
    []
  );

  if (!run) return null;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-40" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-[-5%] rounded-[2px] confetti-fall shadow-sm"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.55,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * MÀN HÌNH TRÌNH CHIẾU BẢNG XẾP HẠNG CHO GIÁO VIÊN / MÁY CHIẾU LỚP HỌC
 */
export default function TeamLeaderboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const music = useBattleMusic(0.4);
  const victoryPlayed = useRef(false);
  const prevScores = useRef<Record<string, number>>({});
  const [bumped, setBumped] = useState<Record<string, boolean>>({});

  // Tải dữ liệu bảng xếp hạng
  const load = useCallback(async () => {
    const { data: lb, error } = await supabase.rpc("get_team_leaderboard", { p_exam_id: id! } as any);
    if (error) return;
    setData(lb);
  }, [id]);

  useEffect(() => {
    load();
    supabase.rpc("get_exam_for_student", { p_exam_id: id! }).then(({ data: e }) => {
      const q = (e as any)?.questions;
      if (q) {
        setTotal((q.partI?.length || 0) + (q.partII?.length || 0) + (q.partIII?.length || 0));
      }
    });
  }, [id, load]);

  // Đăng ký realtime Supabase + polling 4s
  useEffect(() => {
    const ch = supabase
      .channel(`lb-stage-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_teams", filter: `exam_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members", filter: `exam_id=eq.${id}` }, () => load())
      .subscribe();

    const t = setInterval(load, 4000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [id, load]);

  // Quản lý chế độ toàn màn hình
  const enterFs = useCallback(() => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    } catch {
      // Bỏ qua lỗi trình duyệt
    }
  }, []);

  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      enterFs();
    }
  }, [enterFs]);

  useEffect(() => {
    // Tự động kích hoạt toàn màn hình khi mở trang
    enterFs();
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [enterFs]);

  // Dữ liệu xếp hạng
  const teams: LbTeam[] = useMemo(() => (data?.teams || []) as LbTeam[], [data?.teams]);
  const ended = !!data?.exam?.ended;
  const cfg = useMemo(() => normalizeTeamConfig(data?.exam?.team_config), [data?.exam?.team_config]);
  const ranked = useMemo(() => rankTeams(teams), [teams]);
  const champion = ranked[0];

  // Phát hiện tăng điểm để tạo hiệu ứng nhấp nháy + âm thanh
  useEffect(() => {
    const next: Record<string, boolean> = {};
    let scoreIncreased = false;

    teams.forEach((t) => {
      const prev = prevScores.current[t.id];
      const cur = Number(t.score);
      if (prev !== undefined && cur > prev) {
        next[t.id] = true;
        scoreIncreased = true;
      }
      prevScores.current[t.id] = cur;
    });

    if (scoreIncreased) {
      setBumped(next);
      if (cfg.music.enabled && music.playing) {
        music.playScoreUp();
      }
      const to = setTimeout(() => setBumped({}), 1500);
      return () => clearTimeout(to);
    }
  }, [teams, cfg.music.enabled, music]);

  // Khi bài thi kết thúc: tự động phát nhạc chiến thắng và hiện vinh danh
  useEffect(() => {
    if (ended && !victoryPlayed.current && ranked.length) {
      victoryPlayed.current = true;
      setShowWinnerModal(true);
      music.playVictory();
    }
  }, [ended, ranked.length, music]);

  // Tương tác ban đầu để bật âm thanh & fullscreen nếu trình duyệt chặn tự động
  const handleUserStart = () => {
    setHasInteracted(true);
    enterFs();
    if (cfg.music.enabled && !music.playing) {
      music.start();
    }
  };

  // Tính toán kích thước co giãn thông minh cho máy chiếu dựa trên số lượng nhóm
  const n = Math.max(ranked.length, 1);
  const scale = useMemo(() => {
    if (n <= 3) return 1.15;
    if (n <= 5) return 1.0;
    if (n <= 7) return 0.85;
    if (n <= 9) return 0.72;
    return 0.62;
  }, [n]);

  // Chiều cao mỗi thẻ nhóm
  const rowHeight = Math.round(112 * scale);
  const gap = Math.round(16 * scale);

  return (
    <div
      onClick={() => {
        if (!hasInteracted) handleUserStart();
      }}
      className="min-h-screen w-full bg-[#0a1538] text-white overflow-x-hidden select-none relative font-sans flex flex-col justify-between"
      style={{
        backgroundImage: `
          radial-gradient(circle at 50% 15%, #1e3a8a 0%, #0a1538 65%, #050b1e 100%),
          radial-gradient(circle at 10% 85%, rgba(244,63,94,0.18) 0%, transparent 40%),
          radial-gradient(circle at 90% 85%, rgba(250,204,21,0.15) 0%, transparent 40%)
        `,
      }}
    >
      {/* Hiệu ứng pháo hoa / pháo giấy */}
      <Confetti run={ended || showWinnerModal || (!!champion && Number(champion.score) > 0)} />

      {/* THANH CÔNG CỤ ĐIỀU KHIỂN (GÓC PHẢI TRÊN) */}
      <header className="w-full px-6 py-3.5 flex items-center justify-between z-50 bg-[#070e28]/70 backdrop-blur-md border-b-2 border-indigo-950/60 shadow-lg">
        {/* Nhãn trạng thái phát trực tiếp */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-950/90 border-2 border-indigo-700/60 shadow-inner">
            <span className="relative flex size-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${ended ? "bg-amber-400" : "bg-emerald-400"} opacity-75`} />
              <span className={`relative inline-flex rounded-full size-3 ${ended ? "bg-amber-500" : "bg-emerald-500"}`} />
            </span>
            <span className="text-xs sm:text-sm font-extrabold tracking-wider uppercase text-indigo-100">
              {ended ? "ĐÃ KẾT THÚC" : "ĐANG THI ĐẤU TRỰC TIẾP"}
            </span>
          </div>

          {total > 0 && (
            <div className="hidden md:flex items-center gap-1 text-xs font-bold text-indigo-200 bg-white/10 px-3 py-1.5 rounded-full">
              <span>TỔNG SỐ:</span>
              <span className="text-amber-300 font-extrabold">{total} CÂU HỎI</span>
            </div>
          )}
        </div>

        {/* Các nút bấm thao tác của giáo viên */}
        <div className="flex items-center gap-2.5">
          {/* Nút bật/tắt nhạc nền */}
          {cfg.music.enabled && (
            <div className="flex items-center gap-2 bg-indigo-950/80 border-2 border-indigo-700/60 rounded-full px-3 py-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  music.toggle();
                }}
                className="h-8 px-2 text-indigo-100 hover:text-white hover:bg-white/15 rounded-full font-bold text-xs"
              >
                {music.playing ? (
                  <>
                    <Music2 className="size-4 text-pink-400 mr-1.5 animate-pulse" /> Tắt nhạc
                  </>
                ) : (
                  <>
                    <Music className="size-4 text-indigo-300 mr-1.5" /> Bật nhạc
                  </>
                )}
              </Button>
              <div className="w-20 sm:w-24 hidden sm:block">
                <Slider
                  value={[Math.round(music.volume * 100)]}
                  max={100}
                  step={5}
                  onValueChange={(v) => music.setVolume(v[0] / 100)}
                  className="cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Nút công bố trao giải */}
          {champion && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowWinnerModal(true);
                music.playVictory();
              }}
              className="bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-indigo-950 font-black text-xs sm:text-sm shadow-[0_4px_0_#78350f] border-2 border-amber-300 rounded-full px-3.5 h-9 active:translate-y-0.5"
            >
              <Trophy className="size-4 mr-1 text-indigo-950" />
              {showWinnerModal ? "Xem cúp" : "Vinh danh"}
            </Button>
          )}

          {/* Nút Toàn màn hình */}
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              toggleFs();
            }}
            className="bg-white/10 hover:bg-white/20 text-white border-2 border-white/20 rounded-full font-bold text-xs sm:text-sm h-9 px-3.5"
          >
            {isFs ? <Minimize2 className="size-4 mr-1" /> : <Maximize2 className="size-4 mr-1" />}
            {isFs ? "Thu nhỏ" : "Toàn màn hình"}
          </Button>

          {/* Nút Về trang chủ giáo viên */}
          {user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate("/");
              }}
              className="text-white/70 hover:text-white hover:bg-white/10 rounded-full text-xs h-9 px-2.5 hidden lg:flex"
            >
              <Home className="size-4 mr-1" /> Trang chủ
            </Button>
          )}
        </div>
      </header>

      {/* KHU VỰC NỘI DUNG CHÍNH (TRUNG TÂM MÀN HÌNH MÁY CHIẾU) */}
      <main className="flex-1 w-full max-w-[1550px] mx-auto px-4 sm:px-8 py-4 sm:py-6 flex flex-col items-center justify-start">
        {/* BANNER TIÊU ĐỀ "BẢNG XẾP HẠNG" CHUẨN PHONG CÁCH GAMESHOW */}
        <div className="relative mb-3 flex flex-col items-center">
          {/* Hộp tiêu đề nền hồng, viền xanh đậm, chữ xanh tím đậm */}
          <div
            className="rounded-[2.2rem] border-[6px] border-[#0f172a] bg-gradient-to-r from-[#f43f5e] via-[#fb7185] to-[#f43f5e] px-8 sm:px-14 py-3 sm:py-4 shadow-[0_12px_0_#090d16] flex items-center justify-center gap-3 relative transition-transform"
            style={{
              transform: `scale(${Math.min(1.15, Math.max(0.85, scale * 1.05))})`,
            }}
          >
            {/* Chi tiết trang trí góc */}
            <span className="text-3xl sm:text-5xl animate-bounce">🏆</span>
            <h1 className="font-black tracking-widest text-center text-[#0f172a] uppercase drop-shadow-[0_2px_0_rgba(255,255,255,0.4)] text-3xl sm:text-5xl lg:text-6xl">
              BẢNG XẾP HẠNG
            </h1>
            <span className="text-3xl sm:text-5xl animate-bounce">🏆</span>
          </div>

          {/* Tên bài kiểm tra / kỳ thi */}
          <div className="mt-3 flex items-center gap-2 text-center">
            <span className="text-amber-400 font-black text-lg sm:text-2xl tracking-wide drop-shadow-[0_2px_8px_rgba(250,204,21,0.4)]">
              {data?.exam?.title || "Đang tải dữ liệu phòng thi…"}
            </span>
          </div>
        </div>

        {/* DANH SÁCH CÁC NHÓM / ĐỘI THI ĐẤU */}
        <div className="w-full mt-2 sm:mt-4 flex-1 flex flex-col justify-start">
          {!ranked.length ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="p-6 rounded-full bg-white/10 border-4 border-dashed border-white/20 mb-4 animate-pulse">
                <Radio className="size-16 text-pink-400" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-white/90">
                CHƯA CÓ NHÓM NÀO THAM GIA PHÒNG THI
              </h3>
              <p className="text-indigo-200 mt-2 text-base font-semibold max-w-md">
                Học sinh quét mã QR hoặc truy cập đường dẫn bài thi theo đội để bắt đầu thi đấu.
              </p>
            </div>
          ) : (
            <div
              className="relative w-full mx-auto"
              style={{
                height: n * (rowHeight + gap),
                maxWidth: "1480px",
              }}
            >
              {ranked.map((team, index) => {
                const isChampion = index === 0;
                const isTop2 = index === 1;
                const isTop3 = index === 2;
                const isTop3Group = index < 3;
                const pct = total ? Math.min(100, Math.round((team.answered_count / total) * 100)) : 0;
                const isBump = bumped[team.id];

                // Biểu tượng thứ hạng
                const rankBadge =
                  index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}`;

                return (
                  <div
                    key={team.id}
                    className="absolute left-0 right-0 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                    style={{
                      transform: `translateY(${index * (rowHeight + gap)}px)`,
                      height: rowHeight,
                    }}
                  >
                    {/* Hộp nhóm: Tông hồng/tím hồng, viền xanh đậm, chi tiết vàng nổi bật */}
                    <div
                      className={`h-full w-full rounded-[2rem] border-[5px] sm:border-[6px] border-[#0f172a] shadow-[0_10px_0_#090d16] px-4 sm:px-7 flex items-center justify-between gap-3 sm:gap-6 relative overflow-hidden transition-all duration-300 ${
                        isChampion
                          ? "bg-gradient-to-r from-[#f43f5e] via-[#e11d48] to-[#be185d] border-[#facc15] shadow-[0_12px_0_#090d16,0_0_35px_rgba(250,204,21,0.45)]"
                          : isTop2
                          ? "bg-gradient-to-r from-[#e11d48] to-[#db2777]"
                          : isTop3
                          ? "bg-gradient-to-r from-[#db2777] to-[#c026d3]"
                          : "bg-gradient-to-r from-[#be185d] to-[#9d174d]"
                      } ${isBump ? "animate-[scoreBump_0.75s_ease-out]" : ""} ${
                        ended && isChampion ? "animate-[champGlow_1.5s_ease-in-out_infinite]" : ""
                      }`}
                    >
                      {/* Hiệu ứng tia sáng phản chiếu nhẹ kiểu game */}
                      <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-black/20 pointer-events-none" />

                      {/* 1. CỘT THỨ HẠNG (BÊN TRÁI) */}
                      <div className="flex items-center gap-3 sm:gap-4 shrink-0 z-10">
                        <div
                          className={`grid place-items-center rounded-2xl border-4 border-[#0f172a] shadow-[0_4px_0_#090d16] font-black ${
                            isChampion
                              ? "bg-amber-400 text-indigo-950 scale-105"
                              : isTop2
                              ? "bg-slate-200 text-slate-900"
                              : isTop3
                              ? "bg-amber-600 text-white"
                              : "bg-white/25 text-white"
                          }`}
                          style={{
                            width: Math.max(52, Math.round(rowHeight * 0.7)),
                            height: Math.max(52, Math.round(rowHeight * 0.7)),
                            fontSize: Math.max(22, Math.round(rowHeight * 0.38)),
                          }}
                        >
                          <span className="leading-none drop-shadow-sm">{rankBadge}</span>
                        </div>
                      </div>

                      {/* 2. CỘT TÊN NHÓM & TIẾN ĐỘ (Ở GIỮA) */}
                      <div className="flex-1 min-w-0 z-10 flex flex-col justify-center">
                        {/* Tên nhóm viết CHỮ HOA, kích thước rất lớn */}
                        <div className="flex items-center gap-2">
                          <span
                            className="font-black uppercase tracking-wider text-white truncate drop-shadow-[0_3px_0_#0f172a]"
                            style={{
                              fontSize: Math.max(20, Math.round(rowHeight * 0.35)),
                            }}
                          >
                            {team.name}
                          </span>
                          {isChampion && (
                            <span className="text-2xl sm:text-3xl animate-trophy drop-shadow-md shrink-0">
                              🏆
                            </span>
                          )}
                          {team.finished_at && (
                            <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-500 text-white border border-emerald-300 shrink-0">
                              <CheckCircle2 className="size-3" /> ĐÃ HOÀN THÀNH
                            </span>
                          )}
                        </div>

                        {/* Thanh tiến độ làm bài màu vàng */}
                        <div className="mt-1.5 flex items-center gap-3 w-full max-w-[560px]">
                          <div className="flex-1 h-3 sm:h-3.5 rounded-full bg-[#0f172a]/50 p-[2px] border-2 border-[#0f172a] overflow-hidden shadow-inner">
                            <div
                              className="h-full bg-gradient-to-r from-amber-300 to-yellow-400 rounded-full transition-all duration-700 shadow-sm"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span
                            className="font-black text-amber-200 tracking-wider shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                            style={{
                              fontSize: Math.max(12, Math.round(rowHeight * 0.16)),
                            }}
                          >
                            TIẾN ĐỘ: {team.answered_count}/{total || "?"} CÂU ({pct}%)
                          </span>
                        </div>
                      </div>

                      {/* 3. CỘT CÂU ĐÚNG */}
                      <div
                        className="text-center shrink-0 z-10 hidden sm:flex flex-col items-center justify-center px-3 py-1.5 rounded-2xl bg-[#0f172a]/40 border-2 border-[#0f172a]/70"
                        style={{ width: Math.max(90, Math.round(rowHeight * 1.35)) }}
                      >
                        <div
                          className="font-extrabold uppercase text-white/80 tracking-wider"
                          style={{ fontSize: Math.max(11, Math.round(rowHeight * 0.13)) }}
                        >
                          CÂU ĐÚNG
                        </div>
                        <div
                          className="font-black text-white leading-tight drop-shadow-[0_2px_0_#0f172a]"
                          style={{ fontSize: Math.max(22, Math.round(rowHeight * 0.32)) }}
                        >
                          {team.correct_count}
                          {total > 0 && (
                            <span className="text-white/60 text-sm font-bold">/{total}</span>
                          )}
                        </div>
                      </div>

                      {/* 4. CỘT ĐIỂM SỐ NỔI BẬT NHẤT (BÊN PHẢI) */}
                      <div
                        className="text-right shrink-0 z-10 flex flex-col items-end justify-center pl-2"
                        style={{ minWidth: Math.max(120, Math.round(rowHeight * 1.85)) }}
                      >
                        <div
                          className="font-black uppercase text-amber-200 tracking-wider flex items-center gap-1 drop-shadow-sm"
                          style={{ fontSize: Math.max(12, Math.round(rowHeight * 0.14)) }}
                        >
                          <Star className="size-3.5 fill-amber-300 text-amber-300 inline" />
                          ĐIỂM SỐ
                        </div>
                        <div
                          className="font-black text-amber-300 tracking-tight leading-none drop-shadow-[0_4px_0_#0f172a] flex items-baseline gap-1"
                          style={{
                            fontSize: Math.max(28, Math.round(rowHeight * 0.44)),
                          }}
                        >
                          <span>{Number(team.score).toFixed(team.score % 1 === 0 ? 0 : 2)}</span>
                          <span
                            className="font-bold text-amber-200/90"
                            style={{ fontSize: Math.max(12, Math.round(rowHeight * 0.2)) }}
                          >
                            ĐIỂM
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* FOOTER BẢNG ĐIỀU HƯỚNG MÁY CHIẾU */}
      <footer className="w-full py-2.5 px-6 text-center text-xs font-semibold text-indigo-300/80 bg-[#060c22]/90 border-t border-indigo-950 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>🎮 CHẾ ĐỘ THI ĐẤU ĐỘI/NHÓM TRỰC TIẾP</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Tự động cập nhật thời gian thực</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Nhấn phím F11 hoặc nút góc trên để bật Toàn màn hình</span>
        </div>
      </footer>

      {/* POPUP VINH DANH CHIẾN THẮNG KHI KẾT THÚC BÀI THI */}
      {showWinnerModal && champion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-2xl rounded-[2.5rem] border-[8px] border-[#0f172a] bg-gradient-to-b from-[#f43f5e] via-[#e11d48] to-[#be185d] p-8 sm:p-12 text-center text-white shadow-[0_20px_0_#090d16,0_0_60px_rgba(250,204,21,0.6)] relative overflow-hidden animate-slide-up">
            {/* Chi tiết trang trí ánh hào quang */}
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-72 rounded-full bg-amber-400/30 blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center">
              {/* Cúp chiến thắng cỡ đại */}
              <div className="text-7xl sm:text-9xl mb-3 animate-trophy drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)]">
                🏆
              </div>

              <div className="inline-block px-6 py-2 rounded-full bg-amber-400 text-indigo-950 font-black tracking-widest text-sm sm:text-base uppercase mb-4 border-2 border-amber-200 shadow-md">
                CHÚC MỪNG NHÓM CHIẾN THẮNG!
              </div>

              {/* Tên nhóm Quán quân */}
              <h2 className="font-black text-4xl sm:text-6xl uppercase tracking-wider text-white drop-shadow-[0_4px_0_#0f172a] mb-2">
                🥇 {champion.name}
              </h2>

              <p className="text-amber-200 text-lg sm:text-xl font-bold mb-6 drop-shadow-sm">
                ĐÃ XUẤT SẮC ĐẠT THỨ HẠNG CAO NHẤT!
              </p>

              {/* Bảng tổng kết số điểm và câu đúng của Quán quân */}
              <div className="grid grid-cols-2 gap-4 w-full max-w-md bg-[#0f172a]/70 rounded-3xl p-5 border-4 border-[#0f172a] mb-8 shadow-inner">
                <div className="text-center border-r-2 border-white/20 pr-2">
                  <div className="text-xs sm:text-sm font-extrabold text-amber-300 uppercase">
                    ⭐ ĐIỂM SỐ
                  </div>
                  <div className="text-3xl sm:text-5xl font-black text-amber-400 drop-shadow-[0_2px_0_#000]">
                    {Number(champion.score).toFixed(champion.score % 1 === 0 ? 0 : 2)}
                  </div>
                </div>
                <div className="text-center pl-2">
                  <div className="text-xs sm:text-sm font-extrabold text-indigo-200 uppercase">
                    ✅ CÂU ĐÚNG
                  </div>
                  <div className="text-3xl sm:text-5xl font-black text-white drop-shadow-[0_2px_0_#000]">
                    {champion.correct_count}
                    {total > 0 && <span className="text-xl text-white/70">/{total}</span>}
                  </div>
                </div>
              </div>

              {/* Các nút bấm đóng hoặc xem chi tiết */}
              <div className="flex flex-wrap items-center justify-center gap-4 w-full">
                <Button
                  size="lg"
                  onClick={() => setShowWinnerModal(false)}
                  className="rounded-full bg-amber-400 hover:bg-amber-500 text-indigo-950 font-black text-base px-8 h-12 shadow-[0_6px_0_#78350f] border-2 border-amber-200 active:translate-y-1"
                >
                  XEM CHI TIẾT BẢNG XẾP HẠNG
                </Button>
                {cfg.music.enabled && (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => music.playVictory()}
                    className="rounded-full bg-white/15 hover:bg-white/25 text-white border-2 border-white/30 font-bold text-sm h-12 px-6"
                  >
                    🎉 Phát lại âm thanh chiến thắng
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
