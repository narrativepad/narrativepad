import Link from "next/link";

/** Always-on notice while CHAIN=mock (D-009): nothing here moves real money yet. */
export function PreviewBanner() {
  return (
    <div className="relative z-50 border-b border-warn/15 bg-warn/[0.06] px-3 py-1.5 text-center text-[0.78rem] leading-snug text-warn/90">
      <span className="font-semibold text-warn">Preview build.</span> Pools are simulated, so no real SOL moves. Votes are real signed
      messages.{" "}
      <Link href="/how-it-works#preview" className="whitespace-nowrap font-medium text-warn underline decoration-warn/40 underline-offset-2 hover:decoration-warn">
        What this means
      </Link>
    </div>
  );
}
