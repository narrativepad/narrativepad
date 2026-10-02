import Link from "next/link";
import { formatSol, formatTokens } from "@/lib/math";
import { displayName } from "@/lib/names";
import type { GlobalActivityItem } from "@/lib/views";
import { Avatar } from "./bits";

const VERB: Record<GlobalActivityItem["kind"], { verb: string; tone: string }> = {
  vote: { verb: "voted on", tone: "text-violet" },
  submit: { verb: "suggested for", tone: "text-info" },
  deposit: { verb: "joined the pool of", tone: "text-accent" },
  claim: { verb: "claimed from", tone: "text-warn" },
  refund: { verb: "refunded from", tone: "text-danger" },
};

function Item({ a }: { a: GlobalActivityItem }) {
  const v = VERB[a.kind];
  const amount =
    a.kind === "deposit" || a.kind === "refund"
      ? `${formatSol(BigInt(a.amount ?? "0"))} SOL`
      : a.kind === "claim"
        ? `${formatTokens(BigInt(a.amount ?? "0"))}`
        : null;
  return (
    <Link href={`/n/${a.slug}`} className="flex shrink-0 items-center gap-2 px-6 text-[0.8rem] text-dim transition-colors hover:text-ink">
      <Avatar address={a.wallet} size={16} />
      <span className="text-muted">{displayName(a.wallet)}</span>
      {amount && <span className={`num font-medium ${v.tone}`}>{amount}</span>}
      <span>{v.verb}</span>
      <span className="font-medium text-ink">{a.title}</span>
    </Link>
  );
}

/** Scrolling tape of the latest activity across all narratives. */
export function Ticker({ items }: { items: GlobalActivityItem[] }) {
  if (items.length === 0) return null;
  const duration = `${Math.max(40, items.length * 6)}s`;
  return (
    <div className="flex items-center gap-4 border-y border-white/[0.06] py-3" aria-label="Recent activity">
      <span className="flex shrink-0 items-center gap-2 text-[0.75rem] font-semibold text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" /> Live
      </span>
      <div
        className="group relative min-w-0 flex-1 overflow-hidden"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 5%, black 95%, transparent)" }}
      >
        <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]" style={{ ["--marquee-duration" as string]: duration }}>
          {[0, 1].map((copy) => (
            <div key={copy} className="flex" aria-hidden={copy === 1}>
              {items.map((a, i) => (
                <Item key={`${copy}-${i}`} a={a} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
