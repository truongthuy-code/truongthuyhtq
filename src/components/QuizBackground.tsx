export default function QuizBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none select-none overflow-hidden z-0"
    >
      {/* Soft gradient aura behind */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute top-1/3 -right-32 w-96 h-96 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 rounded-full bg-amber-400/10 blur-3xl" />

      {/* Floating subtle math and educational symbols */}
      <svg
        className="absolute inset-0 w-full h-full opacity-25 dark:opacity-10"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="quiz-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <circle cx="40" cy="40" r="1.5" fill="currentColor" className="text-primary/40" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#quiz-grid)" />
      </svg>

      {/* Playful subtle icons scattered lightly */}
      <div className="absolute top-12 left-10 text-primary/30 font-black text-2xl select-none hidden md:block">
        ✦
      </div>
      <div className="absolute top-28 right-16 text-sky-500/30 font-bold text-3xl select-none hidden md:block rotate-12">
        π
      </div>
      <div className="absolute top-1/2 left-8 text-amber-500/25 font-black text-4xl select-none hidden lg:block -rotate-12">
        ∑
      </div>
      <div className="absolute bottom-24 left-14 text-emerald-500/30 font-black text-2xl select-none hidden md:block rotate-45">
        ★
      </div>
      <div className="absolute top-2/3 right-12 text-rose-500/25 font-black text-3xl select-none hidden md:block -rotate-6">
        %
      </div>
      <div className="absolute bottom-16 right-24 text-primary/30 font-bold text-2xl select-none hidden lg:block">
        √
      </div>
    </div>
  );
}
