"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setAlertsMuted, useAlertsMuted, useWatchlist } from "@/lib/client/local";
import { useIdentity } from "@/lib/client/useSigned";
import type { NarrativeCard } from "@/lib/views";
import { Coin, Icon, StageBadge } from "./bits";
import { Portal } from "./Portal";

type IconName = Parameters<typeof Icon>[0]["name"];
type Item =
  | { kind: "coin"; key: string; n: NarrativeCard; go: string }
  | { kind: "action"; key: string; label: string; hint?: string; icon: IconName; run: () => void };

export const openPalette = () => window.dispatchEvent(new Event("np-open-palette"));

/** Ctrl/Cmd+K (or "/"): jump to any coin or action from the keyboard. */
export function CommandPalette() {
  const router = useRouter();
  const muted = useAlertsMuted();
  const { ids: watch } = useWatchlist();
  const { address } = useIdentity();
  const [open, setOpenState] = useState(false);
  // Mirrors `open` synchronously, so a shortcut pressed right after closing (e.g. just after
  // navigating from the palette) never sees a stale value.
  const isOpen = useRef(false);
  const setOpen = useCallback((v: boolean) => {
    isOpen.current = v;
    setOpenState(v);
  }, []);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [coins, setCoins] = useState<NarrativeCard[] | null>(null);
  const fetchedAt = useRef(0);
  const list = useRef<HTMLUListElement>(null);

  const show = useCallback(() => {
    setOpen(true);
    setQ("");
    setActive(0);
    if (Date.now() - fetchedAt.current > 20_000) {
      fetchedAt.current = Date.now();
      fetch("/api/narratives")
        .then((r) => r.json())
        .then((d) => setCoins(d.narratives))
        .catch(() => setCoins([]));
    }
  }, [setOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen.current) setOpen(false);
        else show();
      } else if (e.key === "/" && !typing && !isOpen.current) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("np-open-palette", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("np-open-palette", show);
    };
  }, [show, setOpen]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router, setOpen],
  );

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^\$/, "");
    const matches = (coins ?? [])
      .filter((n) => !term || `${n.title} ${n.ticker ?? ""} ${n.pitch}`.toLowerCase().includes(term))
      .sort((a, b) => {
        // Ticker/title prefix matches first, then the most active.
        const pa = term && (a.ticker?.toLowerCase().startsWith(term) || a.title.toLowerCase().startsWith(term)) ? 0 : 1;
        const pb = term && (b.ticker?.toLowerCase().startsWith(term) || b.title.toLowerCase().startsWith(term)) ? 0 : 1;
        return pa - pb || b.trend.score - a.trend.score;
      })
      .slice(0, term ? 8 : 5)
      .map((n): Item => ({ kind: "coin", key: n.id, n, go: `/n/${n.slug}` }));
    const actions: Item[] = [
      { kind: "action", key: "create", label: "Start a narrative", icon: "plus", run: () => go("/create") },
      { kind: "action", key: "portfolio", label: "Your portfolio", hint: "pools, claims, refunds", icon: "briefcase", run: () => go("/portfolio") },
      { kind: "action", key: "trending", label: "Trending coins", icon: "trend", run: () => go("/#trending") },
      { kind: "action", key: "watch", label: "Watchlist", hint: `${watch.length} starred`, icon: "star", run: () => go("/#watchlist") },
      { kind: "action", key: "board", label: "Leaderboard", icon: "trophy", run: () => go("/leaderboard") },
      { kind: "action", key: "how", label: "How it works", icon: "shield", run: () => go("/how-it-works") },
      ...(address ? [{ kind: "action" as const, key: "profile", label: "Your public profile", icon: "users" as IconName, run: () => go(`/profile/${address}`) }] : []),
      {
        kind: "action",
        key: "alerts",
        label: muted ? "Turn live alerts on" : "Mute live alerts",
        icon: "bell",
        run: () => {
          setAlertsMuted(!muted);
          setOpen(false);
        },
      },
    ];
    const filteredActions = term ? actions.filter((a) => a.kind === "action" && a.label.toLowerCase().includes(term)) : actions;
    const all: Item[] = [...matches, ...filteredActions];
    if (term) all.push({ kind: "action", key: "search", label: `Search all coins for "${q.trim()}"`, icon: "search", run: () => go(`/?q=${encodeURIComponent(q.trim())}`) });
    return all;
  }, [coins, q, watch.length, muted, address, go, setOpen]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (it: Item) => (it.kind === "coin" ? go(it.go) : it.run());
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const firstAction = items.findIndex((i) => i.kind === "action");
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 pt-[12vh] backdrop-blur-sm animate-fade" onMouseDown={() => setOpen(false)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search and commands"
          className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0e1013]/95 shadow-[0_40px_120px_-20px_rgb(0_0_0/0.95)] backdrop-blur-xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
            <Icon name="search" className="h-[1.1rem] w-[1.1rem] text-dim" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search coins or type a command…"
              className="h-14 flex-1 bg-transparent text-[0.98rem] text-ink outline-none placeholder:text-dim"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
            />
            <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[0.65rem] text-dim">Esc</kbd>
          </div>
          <ul ref={list} id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
            {coins === null && <li className="px-3 py-6 text-center text-sm text-dim">Loading coins…</li>}
            {items.map((it, i) => (
              <li key={it.key} data-index={i}>
                {i === 0 && it.kind === "coin" && <div className="px-3 pb-1 pt-1.5 text-[0.7rem] font-medium text-dim">{q.trim() ? "Coins" : "Most active"}</div>}
                {i === firstAction && <div className="px-3 pb-1 pt-3 text-[0.7rem] font-medium text-dim">Go to</div>}
                <button
                  id={`palette-${it.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(it)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${i === active ? "bg-white/[0.07]" : ""}`}
                >
                  {it.kind === "coin" ? (
                    <>
                      <Coin image={it.n.image} ticker={it.n.ticker} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-semibold">{it.n.title}</span>
                          {it.n.ticker && <span className="num text-xs text-dim">${it.n.ticker}</span>}
                        </span>
                        <span className="block truncate text-[0.76rem] text-muted">{it.n.pitch}</span>
                      </span>
                      <StageBadge stage={it.n.stage} />
                    </>
                  ) : (
                    <>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] text-muted">
                        <Icon name={it.icon} className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm">{it.label}</span>
                      {it.hint && <span className="text-xs text-dim">{it.hint}</span>}
                    </>
                  )}
                  {i === active && <Icon name="chevron" className="h-4 w-4 text-dim" />}
                </button>
              </li>
            ))}
            {coins !== null && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-dim">Nothing matches.</li>}
          </ul>
          <div className="flex items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 text-[0.7rem] text-dim">
            <span>
              <kbd className="font-mono">↑↓</kbd> move
            </span>
            <span>
              <kbd className="font-mono">Enter</kbd> open
            </span>
            <span className="ml-auto">
              <kbd className="font-mono">Ctrl K</kbd> or <kbd className="font-mono">/</kbd> anywhere
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
