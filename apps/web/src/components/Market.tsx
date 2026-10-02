"use client";

import Link from "next/link";
import { useState } from "react";
import type { Stage } from "@/lib/phase";
import type { NarrativeCard } from "@/lib/views";
import { Icon, STAGE } from "./bits";
import { CoinCard } from "./CoinCard";

type Tab = { key: string; label: string; stages: Stage[] };

const TABS: Tab[] = [
  { key: "all", label: "All", stages: ["launching", "pooling", "voting", "live", "refunding", "cancelled"] },
  { key: "voting", label: "Voting", stages: ["voting"] },
  { key: "pooling", label: "Pooling", stages: ["pooling"] },
  { key: "launching", label: "Launching", stages: ["launching"] },
  { key: "live", label: "Live", stages: ["live"] },
  { key: "ended", label: "Ended", stages: ["refunding", "cancelled"] },
];

const ORDER: Record<Stage, number> = { launching: 0, pooling: 1, voting: 2, live: 3, refunding: 4, cancelled: 5 };

/** Within a stage: the most urgent or most backed first. */
function rank(n: NarrativeCard): number {
  if (n.stage === "voting") return -n.votes;
  if (n.stage === "pooling") return Date.parse(n.escrow?.depositEnd ?? "") || 0;
  if (n.stage === "launching") return Date.parse(n.escrow?.launchAfter ?? "") || 0;
  if (n.stage === "live") return -(Date.parse(n.escrow?.launchedAt ?? "") || 0);
  return -Date.parse(n.createdAt);
}

export function Market({ items, searching }: { items: NarrativeCard[]; searching: boolean }) {
  const [tab, setTab] = useState("all");
  const counts = Object.fromEntries(TABS.map((t) => [t.key, items.filter((n) => t.stages.includes(n.stage)).length]));
  const active = TABS.find((t) => t.key === tab)!;
  const shown = items
    .filter((n) => active.stages.includes(n.stage))
    .sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || rank(a) - rank(b));

  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter by stage">
        {TABS.filter((t) => t.key !== "ended" || counts.ended > 0).map((t) => {
          const on = t.key === tab;
          const hex = t.key === "all" || t.key === "ended" ? null : STAGE[t.stages[0]].hex;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[0.85rem] font-medium transition-all ${
                on ? "bg-white text-black shadow-[0_8px_24px_-12px_rgb(255_255_255/0.5)]" : "text-muted hover:bg-white/[0.06] hover:text-ink"
              }`}
            >
              {hex && <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />}
              {t.label}
              <span className={`num text-[0.75rem] ${on ? "text-black/50" : "text-dim"}`}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {shown.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {shown.map((n) => (
            <CoinCard key={n.id} n={n} href={`/n/${n.slug}`} />
          ))}
        </div>
      ) : (
        <div className="panel relative flex flex-col items-center overflow-hidden px-6 py-16 text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
          <span className="glass relative flex h-14 w-14 items-center justify-center rounded-2xl text-accent">
            <Icon name={searching ? "search" : "spark"} className="h-6 w-6" />
          </span>
          <h3 className="relative mt-5 text-[1.25rem] font-semibold tracking-tight">
            {searching ? "No coins match that search" : items.length === 0 ? "The board is waiting for its first narrative" : `Nothing in ${active.label.toLowerCase()} right now`}
          </h3>
          <p className="relative mt-2 max-w-md text-[0.92rem] leading-relaxed text-muted">
            {searching
              ? "Try a name, a ticker or a word from the pitch."
              : items.length === 0
                ? "Post a pitch and a source. The crowd takes it from there: name, ticker, image, then one shared pool."
                : "Coins move through this stage quickly. Check another tab, or start something new."}
          </p>
          {!searching && (
            <Link href="/create" className="btn-primary relative mt-7 h-11 px-6">
              Start a narrative <Icon name="arrow" className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
