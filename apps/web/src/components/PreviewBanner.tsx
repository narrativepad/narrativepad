import Link from "next/link";

/** Always-on notice: nothing here moves real money yet. CHAIN=mock simulates pools (D-009);
 *  CHAIN=solana runs them on devnet with free test SOL (D-021). */
export function PreviewBanner({ devnet }: { devnet: boolean }) {
  return (
    <div className="relative z-50 flex items-center justify-center gap-2 border-b border-white/[0.06] bg-black px-3 py-2 text-center text-[0.76rem] leading-snug text-muted">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      <span>
        {devnet ? (
          <>
            <span className="font-medium text-ink">Devnet:</span> pools run on Solana devnet with free test SOL and USDC, not real money. Set your wallet to
            devnet.{" "}
          </>
        ) : (
          <>
            <span className="font-medium text-ink">Preview:</span> pools are simulated and no real SOL moves yet. Votes are real wallet signatures.{" "}
          </>
        )}
        <Link href="/how-it-works#preview" className="whitespace-nowrap font-medium text-ink underline decoration-white/25 underline-offset-[3px] hover:decoration-white">
          Learn more
        </Link>
      </span>
    </div>
  );
}
