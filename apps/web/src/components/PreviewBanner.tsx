import Link from "next/link";

/** Always-on notice while CHAIN=mock (D-009): nothing here moves real money yet. */
export function PreviewBanner() {
  return (
    <div className="relative z-50 flex items-center justify-center gap-2 border-b border-white/[0.06] bg-black px-3 py-2 text-center text-[0.76rem] leading-snug text-muted">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      <span>
        <span className="font-medium text-ink">Preview build.</span> Pools are simulated, so no real SOL moves. Votes are real signed messages.{" "}
        <Link href="/how-it-works#preview" className="whitespace-nowrap font-medium text-ink underline decoration-white/25 underline-offset-[3px] hover:decoration-white">
          What this means
        </Link>
      </span>
    </div>
  );
}
