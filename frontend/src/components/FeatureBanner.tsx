'use client';

interface FeatureBannerProps {
    onCtaClick?: () => void;
}

export default function FeatureBanner({ onCtaClick }: FeatureBannerProps) {
    return (
        <div className="mx-auto inline-flex max-w-full items-center gap-3 rounded-full border border-cyan-400/25 bg-white/6 px-3 py-2 text-left backdrop-blur-xl shadow-[0_0_40px_rgba(34,211,238,0.12)]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10 text-cyan-200">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 7h16M7 4v6m10-6v6M5 12h14a1 1 0 011 1v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5a1 1 0 011-1z" />
                </svg>
            </div>

            <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-300/90">
                    New Feature
                </p>
                <p className="text-sm font-semibold text-white sm:text-[15px]">
                    PDF Word Search is live. Jump between matches with <span className="text-cyan-300">Cmd/Ctrl+F</span>.
                </p>
            </div>

            <button
                type="button"
                onClick={onCtaClick}
                className="shrink-0 rounded-full border border-white/12 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-black transition-all hover:scale-[1.02] hover:bg-cyan-100 active:scale-95"
            >
                Try Demo
            </button>
        </div>
    );
}
