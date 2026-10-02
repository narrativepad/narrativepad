"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/client/local";
import type { Stage } from "@/lib/phase";
import type { NarrativeCard } from "@/lib/views";
import { Icon, STAGE } from "./bits";
import { CoinCard } from "./CoinCard";

type Tab = { key: string; label: string; stages?: Stage[]; icon?: "trend" | "star" };

const TABS: Tab[] = [
  { key: "all", label: "All" },
  { key: "trending", label: "Trending", icon: "trend" },
  { key: "watchlist", label: "Watchlist", icon: "star" },
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

const isTrending = (n: NarrativeCard) => n.trend.score > 0 && n.stage !== "cancelled" && n.stage !== "refunding";

export function Market({ items, searching }: { items: NarrativeCard[]; searching: boolean }) {
  const [tab, setTab] = useState("all");
  const { ids: watch } = useWatchlist();

  // Deep links: /#trending, /#watchlist, /#pooling…
  useEffect(() => {
    const pick = () => {
      const key = window.location.hash.slice(1);
      if (TABS.some((t) => t.key === key)) {
        setTab(key);
        document.getElementById("explore")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, []);
  const choose = (key: string) => {
    setTab(key);
    history.replaceState(null, "", key === "all" ? window.location.pathname + window.location.search : `#${key}`);
  };

  const filter = (t: Tab) => (n: NarrativeCard) =>
    t.key === "trending" ? isTrending(n) : t.key === "watchlist" ? watch.includes(n.id) : !t.stages || t.stages.includes(n.stage);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, items.filter(filter(t)).length]));
  const active = TABS.find((t) => t.key === tab)!;
  const shown = items
    .filter(filter(active))
    .sort((a, b) => (tab === "trending" ? b.trend.score - a.trend.score : ORDER[a.stage] - ORDER[b.stage] || rank(a) - rank(b)));
  const hot = new Set(
    items
      .filter(isTrending)
      .sort((a, b) => b.trend.score - a.trend.score)
      .slice(0, 3)
      .map((n) => n.id),
  );
  const visibleTabs = TABS.filter((t) => (t.key === "ended" || t.key === "watchlist" ? counts[t.key] > 0 || tab === t.key : true));

  return (
    <div className="flex flex-col gap-5">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter coins">
        {visibleTabs.map((t) => {
          const on = t.key === tab;
          const hex = t.stages && t.key !== "ended" ? STAGE[t.stages[0]].hex : null;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => choose(t.key)}
              className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[0.85rem] font-medium transition-all ${
                on ? "bg-white text-black shadow-[0_8px_24px_-12px_rgb(255_255_255/0.5)]" : "text-muted hover:bg-white/[0.06] hover:text-ink"
              }`}
            >
              {hex && <span className="h-1.5 w-1.5 rounded-full" style={{ background: hex }} />}
              {t.icon && <Icon name={t.icon} className={`h-3.5 w-3.5 ${on ? "" : t.icon === "star" ? "text-warn" : "text-accent"}`} />}
              {t.label}
              <span className={`num text-[0.75rem] ${on ? "text-black/50" : "text-dim"}`}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {shown.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {shown.map((n) => (
            <CoinCard key={n.id} n={n} href={`/n/${n.slug}`} hot={hot.has(n.id)} showTrend={tab === "trending"} />
          ))}
        </div>
      ) : (
        <Empty tab={active} searching={searching} anything={items.length > 0} />
      )}
    </div>
  );
}

function Empty({ tab, searching, anything }: { tab: Tab; searching: boolean; anything: boolean }) {
  const [title, text] = searching
    ? ["No coins match that search", "Try a name, a ticker or a word from the pitch."]
    : !anything
      ? ["The board is waiting for its first narrative", "Post a pitch and a source. The crowd takes it from there: name, ticker, image, then one shared pool."]
      : tab.key === "trending"
        ? ["Nothing is moving right now", "Coins show up here when people vote, chat or join a pool in the last 15 minutes."]
        : tab.key === "watchlist"
          ? ["Your watchlist is empty", "Tap the star on any coin to keep an eye on it here."]
          : [`Nothing in ${tab.label.toLowerCase()} right now`, "Coins move through this stage quickly. Check another tab, or start something new."];
  return (
    <div className="panel relative flex flex-col items-center overflow-hidden px-6 py-16 text-center">
      <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl" />
      <span className="glass relative flex h-14 w-14 items-center justify-center rounded-2xl text-accent">
        <Icon name={searching ? "search" : tab.icon ?? "spark"} className="h-6 w-6" />
      </span>
      <h3 className="relative mt-5 text-[1.25rem] font-semibold tracking-tight">{title}</h3>
      <p className="relative mt-2 max-w-md text-[0.92rem] leading-relaxed text-muted">{text}</p>
      {!searching && (
        <Link href="/create" className="btn-primary relative mt-7 h-11 px-6">
          Start a narrative <Icon name="arrow" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
