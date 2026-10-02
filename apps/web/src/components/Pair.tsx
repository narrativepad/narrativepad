"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PairOption } from "@/lib/pairs";
import { coinTint, Icon } from "./bits";
import { Portal } from "./Portal";

/** A pair's logo: the bundled image, or a tinted monogram when there is none (or it fails). */
export function PairLogo({ pair, size = 20, className = "" }: { pair: Pick<PairOption, "symbol" | "logo">; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (pair.logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={pair.logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full bg-white/[0.04] object-cover ring-1 ring-white/10 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white/90 ring-1 ring-white/10 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size / 2.8), background: coinTint(pair.symbol) }}
    >
      {pair.symbol.replace(/x$/, "").slice(0, 2)}
    </span>
  );
}

/** Logo and symbol, for cards and summaries. */
export function PairChip({ pair, className = "" }: { pair: Pick<PairOption, "symbol" | "logo" | "name">; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pl-0.5 pr-2 text-[0.7rem] font-semibold text-ink ${className}`}
      title={`Paired with ${pair.name}`}
    >
      <PairLogo pair={pair} size={16} />
      <span className="num">{pair.symbol}</span>
    </span>
  );
}

export type PickerPair = PairOption & { ready: boolean };

const TABS = [
  ["all", "All"],
  ["crypto", "Crypto"],
  ["stock", "Stocks"],
] as const;

/** The pair field on the create form: shows the pick, opens the picker. */
export function PairField({ pairs, value, onChange }: { pairs: PickerPair[]; value: string; onChange: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const picked = pairs.find((p) => p.symbol === value) ?? pairs[0];
  return (
    <>
      <button
        type="button"
        id="pair"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="input group mt-1.5 flex h-[2.85rem] items-center gap-2.5 text-left hover:border-white/20"
      >
        {picked && <PairLogo pair={picked} size={24} />}
        <span className="num font-semibold">{picked?.symbol ?? "Pick a pair"}</span>
        <span className="min-w-0 flex-1 truncate text-[0.82rem] text-muted">{picked?.name}</span>
        <Icon name="chevron" className="h-4 w-4 rotate-90 text-dim transition-colors group-hover:text-ink" />
      </button>
      {open && (
        <PairPicker
          pairs={pairs}
          value={picked?.symbol ?? ""}
          onClose={() => setOpen(false)}
          onPick={(s) => {
            onChange(s);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** Search-and-pick dialog over pump.fun's pairs. Pairs a pool can't hold yet are shown, locked. */
function PairPicker({ pairs, value, onPick, onClose }: { pairs: PickerPair[]; value: string; onPick: (symbol: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (p: PickerPair) =>
      (tab === "all" || p.kind === tab) && (!needle || p.symbol.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle));
    // Ready pairs first; within each group pump.fun's own order.
    return [...pairs.filter((p) => p.ready && hit(p)), ...pairs.filter((p) => !p.ready && hit(p))];
  }, [pairs, q, tab]);
  const firstLocked = shown.findIndex((p) => !p.ready);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => setActive(0), [q, tab]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = shown[active];
      if (p?.ready) onPick(p.symbol);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-md animate-fade sm:items-center sm:p-4"
        onMouseDown={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a pair"
      >
        <div
          className="relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[1.75rem] border border-white/10 bg-[#0d0f12]/95 shadow-[0_40px_140px_-20px_rgb(0_0_0/0.95)] backdrop-blur-xl sm:max-h-[min(44rem,86vh)] sm:max-w-[30rem] sm:rounded-[1.75rem]"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {/* Soft brand glow behind the header. */}
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-80 -translate-x-1/2 rounded-full bg-brand/25 blur-3xl" />

          <div className="relative flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div>
              <h2 className="text-[1.15rem] font-semibold tracking-tight">Pick a pair</h2>
              <p className="mt-0.5 text-[0.78rem] leading-snug text-muted">What your coin trades against on pump.fun. The pool collects it, then buys the coin with it.</p>
            </div>
            <button type="button" className="btn h-9 w-9 shrink-0 rounded-full px-0" onClick={onClose} aria-label="Close">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>

          <div className="relative px-5">
            <label className="flex h-12 items-center gap-2.5 rounded-2xl border border-white/10 bg-black/40 px-3.5 transition-colors focus-within:border-accent/60 focus-within:bg-black/60">
              <Icon name="search" className="h-4 w-4 text-dim" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search SOL, NVIDIA, Tesla…"
                aria-label="Search pairs"
                aria-controls="pair-list"
                aria-activedescendant={shown[active] ? `pair-${shown[active].mint}` : undefined}
                className="h-full flex-1 bg-transparent text-[0.95rem] text-ink outline-none placeholder:text-dim"
              />
              {q && (
                <button type="button" className="text-xs text-dim hover:text-ink" onClick={() => setQ("")}>
                  Clear
                </button>
              )}
            </label>
            <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Pair type">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    tab === k ? "bg-white text-black" : "bg-white/[0.05] text-muted hover:bg-white/[0.09] hover:text-ink"
                  }`}
                >
                  {label}
                  <span className={`num ml-1.5 ${tab === k ? "text-black/50" : "text-dim"}`}>
                    {k === "all" ? pairs.length : pairs.filter((p) => p.kind === k).length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <ul ref={list} id="pair-list" role="listbox" aria-label="Pairs" className="relative mt-3 min-h-0 flex-1 overflow-y-auto border-t border-white/[0.06] px-2.5 pb-3">
            {shown.length === 0 && <li className="px-3 py-10 text-center text-sm text-dim">No pair matches “{q}”.</li>}
            {shown.map((p, i) => {
              const selected = p.symbol === value;
              return (
                <li key={p.mint} role="presentation">
                  {(i === 0 || i === firstLocked) && (
                    <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-4 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-dim">
                      {p.ready ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_8px] shadow-success/70" /> Open now
                        </>
                      ) : (
                        <>
                          <Icon name="lock" className="h-3 w-3" /> With the mainnet launch
                        </>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    id={`pair-${p.mint}`}
                    data-i={i}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={!p.ready}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => p.ready && onPick(p.symbol)}
                    className={`group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors ${
                      i === active ? "bg-white/[0.06]" : ""
                    } ${p.ready ? "" : "cursor-not-allowed"} ${selected ? "bg-accent/[0.1] ring-1 ring-inset ring-accent/40" : ""}`}
                  >
                    <PairLogo pair={p} size={38} className={p.ready ? "" : "opacity-60 grayscale-[35%]"} />
                    <span className="min-w-0 flex-1">
                      <span className={`num block truncate text-[0.95rem] font-semibold ${p.ready ? "text-ink" : "text-ink/70"}`}>{p.symbol}</span>
                      <span className="block truncate text-[0.76rem] text-muted">
                        {p.name}
                        {p.kind === "stock" && <span className="text-dim"> · stock</span>}
                      </span>
                    </span>
                    {selected ? (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white">
                        <Icon name="check" className="h-3.5 w-3.5" />
                      </span>
                    ) : p.ready ? (
                      <span className="rounded-full border border-success/30 bg-success/[0.08] px-2 py-0.5 text-[0.62rem] font-semibold text-success opacity-0 transition-opacity group-hover:opacity-100">
                        Pick
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[0.62rem] font-semibold text-dim">Mainnet</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="relative flex items-center justify-between gap-3 border-t border-white/[0.06] bg-black/30 px-5 py-3 text-[0.7rem] text-dim">
            <span>pump.fun&apos;s live list · {pairs.length} pairs</span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono">↑↓</kbd>
              <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono">Enter</kbd>
              <kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono">Esc</kbd>
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
