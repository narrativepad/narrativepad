import { TeamBadge, Who } from "@/components/bits";
import { formatSol, formatTokens } from "@/lib/math";
import type { NarrativeDetail } from "@/lib/views";

/** Who is in the pool, and how concentrated it is. One row per wallet. */
export function Holders({ n }: { n: NarrativeDetail }) {
  const e = n.escrow;
  const live = n.holders.filter((h) => !h.refunded);
  if (!e || n.holders.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center">
        <p className="font-medium">No holders yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-dim">
          {e ? "When people join the pool they show up here, with their share of the opening buy." : "The pool opens when voting ends. Everyone who joins shows up here."}
        </p>
      </div>
    );
  }
  const top = (k: number) => live.slice(0, k).reduce((s, h) => s + h.sharePct, 0);
  const stats: [string, string][] = [
    [e.launched ? "Holders" : "In the pool", String(live.length)],
    ["Largest holder", `${(live[0]?.sharePct ?? 0).toFixed(1)}%`],
    ["Top 5 together", `${top(5).toFixed(1)}%`],
    ["Cap per wallet", `${formatSol(BigInt(e.perWalletMax))} SOL`],
  ];
  const max = Math.max(...n.holders.map((h) => h.sharePct), 1);

  return (
    <section className="panel overflow-hidden">
      <div className="grid grid-cols-2 gap-px border-b border-white/[0.06] bg-white/[0.06] sm:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-[#0c0d10] px-5 py-4">
            <div className="label">{k}</div>
            <div className="num mt-1.5 text-[1.25rem] font-semibold leading-none">{v}</div>
          </div>
        ))}
      </div>
      <ol className="max-h-[32rem] divide-y divide-white/[0.05] overflow-y-auto">
        {n.holders.map((h, i) => (
          <li key={h.wallet} className={`relative flex items-center gap-3 px-5 py-3 text-sm ${h.refunded ? "opacity-50" : ""}`}>
            <span
              className="absolute inset-y-1.5 left-1.5 rounded-lg bg-gradient-to-r from-accent/[0.1] to-transparent"
              style={{ width: `calc(${(h.sharePct / max) * 100}% - 12px)` }}
              aria-hidden
            />
            <span className="num relative w-6 text-xs text-dim">{i + 1}</span>
            <span className="relative flex min-w-0 flex-1 items-center gap-2">
              <Who address={h.wallet} size={22} className="text-ink/90" />
              {h.isTeam && <TeamBadge />}
              {h.refunded && <span className="text-[0.7rem] text-dim">refunded</span>}
            </span>
            {h.tokens && <span className="num relative hidden text-xs text-muted sm:inline">{formatTokens(BigInt(h.tokens))} tokens</span>}
            <span className="num relative w-20 text-right text-muted">{formatSol(BigInt(h.amount))} SOL</span>
            <span className="num relative w-14 text-right font-semibold">{h.sharePct.toFixed(1)}%</span>
          </li>
        ))}
      </ol>
      <p className="border-t border-white/[0.06] px-5 py-3 text-[0.75rem] text-dim">
        {e.launched
          ? "Every holder bought at the same price in one transaction and unlocks on the same schedule."
          : "Shares are pro-rata to deposits. Everyone gets the same price at launch."}
      </p>
    </section>
  );
}
