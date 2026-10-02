"use client";

import { useEffect, useState } from "react";

export type TabSpec = { key: string; label: string; count?: React.ReactNode; meta?: React.ReactNode; content: React.ReactNode };

/** Panel with a segmented switch in its header (the charts). */
export function SwitchPanel({ tabs, initial }: { tabs: TabSpec[]; initial: string }) {
  const [tab, setTab] = useState(initial);
  const active = tabs.find((t) => t.key === tab) ?? tabs[0];
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2.5 sm:px-4">
        <div className="flex gap-1 rounded-full bg-white/[0.04] p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={t.key === active.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-[0.8rem] font-medium transition-colors ${t.key === active.key ? "bg-white text-black" : "text-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-[0.78rem] text-dim">{active.meta}</div>
      </div>
      {active.content}
    </section>
  );
}

/** Section tabs (Ballots, Chat, Holders, Activity). Deep-linkable with #key; inactive tabs stay mounted. */
export function SectionTabs({ tabs, initial }: { tabs: TabSpec[]; initial: string }) {
  const [tab, setTab] = useState(initial);
  useEffect(() => {
    const key = window.location.hash.slice(1);
    if (tabs.some((t) => t.key === key)) setTab(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (key: string) => {
    setTab(key);
    history.replaceState(null, "", `#${key}`);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-white/[0.06] px-1" role="tablist" aria-label="Coin sections">
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              aria-controls={`tab-${t.key}`}
              onClick={() => choose(t.key)}
              className={`relative flex shrink-0 items-center gap-2 px-4 pb-3 pt-1 text-[0.95rem] font-medium transition-colors ${on ? "text-ink" : "text-dim hover:text-muted"}`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={`num rounded-full px-1.5 py-px text-[0.72rem] ${on ? "bg-white/10 text-ink" : "bg-white/[0.04] text-dim"}`}>{t.count}</span>
              )}
              {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.key} id={`tab-${t.key}`} role="tabpanel" hidden={t.key !== tab} className="animate-fade">
          {t.content}
        </div>
      ))}
    </div>
  );
}
