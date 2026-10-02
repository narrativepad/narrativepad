import Link from "next/link";
import { formatTokens } from "@/lib/math";
import { displayName } from "@/lib/names";
import { SOL_UNIT, withUnit } from "@/lib/units";
import type { GlobalActivityItem } from "@/lib/views";
import { Avatar } from "./bits";

const VERB: Record<GlobalActivityItem["kind"], { verb: string; tone: string }> = {
  vote: { verb: "voted on", tone: "text-violet" },
  submit: { verb: "suggested for", tone: "text-accent-2" },
  deposit: { verb: "joined the pool of", tone: "text-accent" },
  claim: { verb: "claimed from", tone: "text-gold" },
  refund: { verb: "refunded from", tone: "text-danger" },
};

function Item({ a }: { a: GlobalActivityItem }) {
  const v = VERB[a.kind];
  const amount =
    a.kind === "deposit" || a.kind === "refund"
      ? withUnit(a.amount ?? "0", a.unit ?? SOL_UNIT)
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

/** Below this many distinct events the loop would just repeat itself, so the tape stays hidden. */
const MIN_EVENTS = 6;

/** Scrolling tape of the latest activity across all narratives. */
export function Ticker({ items }: { items: GlobalActivityItem[] }) {
  const distinct = new Set(items.map((a) => `${a.kind}:${a.wallet}:${a.slug}:${a.field ?? ""}:${a.value ?? ""}:${a.amount ?? ""}`));
  if (distinct.size < MIN_EVENTS) return null;
  const duration = `${Math.max(40, items.length * 6)}s`;
  return (
    <div className="flex items-center gap-3 border-y border-white/[0.06] py-3" aria-label="Recent activity">
      <span className="flex shrink-0 items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1 text-[0.75rem] font-semibold text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" /> Live
      </span>
      <div
        className="group relative min-w-0 flex-1 overflow-hidden"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)" }}
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
