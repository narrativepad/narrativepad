"use client";

import Link from "next/link";
import { useState } from "react";
import { formatSol, formatTokens, launchBreakdown, PUMP } from "@/lib/math";
import type { Stage } from "@/lib/phase";
import type { NarrativeCard } from "@/lib/views";
import { Coin, Icon, ProgressBar, Sparkline, STAGE, Who } from "./bits";
import { Countdown } from "./Countdown";

type Col = {
  key: string;
  stages: Stage[];
  step: number;
  title: string;
  hint: string;
  empty: { title: string; text: string; cta?: boolean; icon: "vote" | "coins" | "rocket" | "flame" };
};

const COLUMNS: Col[] = [
  {
    key: "voting",
    stages: ["voting"],
    step: 1,
    title: "Voting",
    hint: "The crowd picks name, ticker and image",
    empty: { title: "No open ballots", text: "Start one and the crowd picks its name, ticker and image.", cta: true, icon: "vote" },
  },
  {
    key: "pooling",
    stages: ["pooling"],
    step: 2,
    title: "Pooling",
    hint: "Join the public pool, same price for all",
    empty: { title: "No open pools", text: "When a vote ends, the winning coin is locked and its pool opens here.", icon: "coins" },
  },
  {
    key: "launching",
    stages: ["launching"],
    step: 3,
    title: "Launching",
    hint: "Created and bought in one transaction",
    empty: { title: "Nothing launching", text: "Shortly after a pool closes, the coin is created and the pool buys in.", icon: "rocket" },
  },
  {
    key: "live",
    stages: ["live", "refunding", "cancelled"],
    step: 4,
    title: "Live",
    hint: "Launched coins and their unlocks",
    empty: { title: "No coins live yet", text: "Launched coins show up here with their release progress.", icon: "flame" },
  },
];

const colStage = (c: Col) => c.stages[0];

export function BoardCard({ n }: { n: NarrativeCard }) {
  const e = n.escrow;
  const total = BigInt(e?.totalDeposited ?? "0");
  const s = STAGE[n.stage];
  return (
    <Link href={`/n/${n.slug}`} className="card group">
      <div className="flex items-start gap-3">
        <Coin image={n.image} ticker={n.ticker} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[0.98rem] font-semibold leading-tight tracking-tight transition-colors group-hover:text-accent">{n.title}</h3>
            {n.ticker && <span className="num shrink-0 text-[0.75rem] font-medium text-dim">${n.ticker}</span>}
          </div>
          <p className="mt-1 line-clamp-2 text-[0.82rem] leading-snug text-muted">{n.pitch}</p>
        </div>
      </div>

      {n.stage === "voting" && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[0.78rem]">
          <span className="flex items-center gap-1.5 text-muted">
            <Icon name="vote" className="h-3.5 w-3.5" />
            <span className="num font-medium text-ink">{n.votes}</span> vote{n.votes === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1.5 text-violet">
            <Icon name="clock" className="h-3.5 w-3.5" />
            <Countdown to={n.voteEndsAt} done="tallying…" />
          </span>
        </div>
      )}

      {(n.stage === "pooling" || n.stage === "launching") && e && (
        <div className="mt-3 space-y-2 border-t border-line pt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="num text-[0.98rem] font-semibold">
              {formatSol(total)} <span className="text-[0.75rem] font-normal text-dim">/ {formatSol(BigInt(e.poolCap))} SOL</span>
            </span>
            <span className={`flex items-center gap-1 text-[0.78rem] ${n.stage === "pooling" ? "text-info" : "text-warn"}`}>
              <Icon name="clock" className="h-3.5 w-3.5" />
              <Countdown to={n.stage === "pooling" ? e.depositEnd : e.launchAfter} done={n.stage === "pooling" ? "closing…" : "launching…"} />
            </span>
          </div>
          <ProgressBar value={total} max={BigInt(e.poolCap)} marker={BigInt(e.poolMin)} tone={n.stage === "pooling" ? "accent" : "warn"} />
          <div className="flex items-center justify-between text-[0.75rem] text-dim">
            <span className="flex items-center gap-1">
              <Icon name="users" className="h-3.5 w-3.5" />
              {e.depositorCount === 0 ? "nobody yet" : `${e.depositorCount} joined`}
            </span>
            {total > 0n && <span>buys ≈ {launchBreakdown(total, e.feeBps).pctOfSupply.toFixed(1)}% of supply</span>}
          </div>
        </div>
      )}

      {n.stage === "live" && e && (
        <div className="mt-3 flex items-end gap-3 border-t border-line pt-2.5">
          {n.flow && <Sparkline values={n.flow} className="h-8 min-w-0 flex-1" />}
          <div className="shrink-0 text-right">
            <div className="num text-sm font-semibold">{formatTokens(BigInt(e.tokensBought))}</div>
            <div className="num text-[0.72rem] text-dim">
              {Number((BigInt(e.tokensBought) * 1000n) / PUMP.totalSupply) / 10}% of supply · {e.unlocked}/{e.trancheCount} unlocked
            </div>
          </div>
        </div>
      )}

      {(n.stage === "refunding" || n.stage === "cancelled") && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[0.75rem] text-dim">
          <span className={`font-medium ${s.text}`}>{n.stage === "refunding" ? "Didn't launch · refunds open" : "Ended without a winner"}</span>
          <span className="max-w-[50%] truncate">
            <Who address={n.creator} size={14} />
          </span>
        </div>
      )}
    </Link>
  );
}

function EmptyColumn({ e, hex }: { e: Col["empty"]; hex: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-line-2 px-5 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${hex}14`, color: hex }}>
        <Icon name={e.icon} className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-medium">{e.title}</p>
        <p className="mx-auto mt-1 max-w-[16rem] text-[0.8rem] leading-relaxed text-dim">{e.text}</p>
      </div>
      {e.cta && (
        <Link href="/create" className="btn-primary mt-1">
          <Icon name="plus" className="h-4 w-4" /> Start a narrative
        </Link>
      )}
    </div>
  );
}

function Column({ col, items }: { col: Col; items: NarrativeCard[] }) {
  const s = STAGE[colStage(col)];
  return (
    <section className="panel relative flex flex-col overflow-hidden lg:max-h-[max(34rem,calc(100dvh-8rem))]" aria-label={col.title}>
      <div className="absolute inset-x-0 top-0 h-px opacity-70" style={{ background: `linear-gradient(90deg, transparent, ${s.hex}, transparent)` }} aria-hidden />
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span
          className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold"
          style={{ color: s.hex, background: `${s.hex}14`, boxShadow: `inset 0 0 0 1px ${s.hex}40` }}
        >
          {col.step}
        </span>
        <div className="min-w-0">
          <h3 className="text-[0.92rem] font-semibold">{col.title}</h3>
          <p className="truncate text-[0.75rem] text-dim">{col.hint}</p>
        </div>
        <span className="num ml-auto rounded-full bg-white/[0.05] px-2 py-0.5 text-[0.75rem] text-muted">{items.length}</span>
      </header>
      <div className="scroll-y min-h-0 flex-1 space-y-2.5 p-3">
        {items.length === 0 ? <EmptyColumn e={col.empty} hex={s.hex} /> : items.map((n) => <BoardCard key={n.id} n={n} />)}
      </div>
    </section>
  );
}

/** Four stage columns on desktop (each scrolls on its own); tabs on mobile. */
export function Board({ items }: { items: NarrativeCard[] }) {
  const rank = (n: NarrativeCard): number => {
    if (n.stage === "voting") return -n.votes;
    if (n.stage === "pooling") return -Number(BigInt(n.escrow?.totalDeposited ?? "0") / 1_000_000n);
    if (n.stage === "launching") return Date.parse(n.escrow?.launchAfter ?? "") || 0;
    if (n.stage === "live") return -(Date.parse(n.escrow?.launchedAt ?? "") || 0) / 1e3;
    return 1e15;
  };
  const byCol = COLUMNS.map((c) => ({ col: c, items: items.filter((n) => c.stages.includes(n.stage)).sort((a, z) => rank(a) - rank(z)) }));
  // Mobile opens on the first stage that has something in it.
  const [tab, setTab] = useState(() => byCol.find((c) => c.items.length > 0)?.col.key ?? "voting");
  return (
    <>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1 md:hidden" role="tablist">
        {byCol.map(({ col, items }) => {
          const s = STAGE[colStage(col)];
          return (
            <button
              key={col.key}
              role="tab"
              aria-selected={tab === col.key}
              onClick={() => setTab(col.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[0.8rem] font-semibold transition-colors ${
                tab === col.key ? `bg-white/[0.07] ${s.text}` : "text-muted"
              }`}
            >
              {col.title}
              <span className="num text-dim">{items.length}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 md:grid-cols-2 md:items-start lg:grid-cols-4">
        {byCol.map(({ col, items }) => (
          <div key={col.key} className={`${tab === col.key ? "block" : "hidden"} min-w-0 md:block`}>
            <Column col={col} items={items} />
          </div>
        ))}
      </div>
    </>
  );
}
