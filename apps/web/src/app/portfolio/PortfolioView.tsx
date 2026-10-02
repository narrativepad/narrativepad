"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Avatar, Coin, Icon, StageBadge } from "@/components/bits";
import { CoinCard } from "@/components/CoinCard";
import { Countdown } from "@/components/Countdown";
import { useToast } from "@/components/Providers";
import { useWatchlist } from "@/lib/client/local";
import { useIdentity, useSigned } from "@/lib/client/useSigned";
import { formatSol, formatTokens } from "@/lib/math";
import type { NarrativeCard, PortfolioItem } from "@/lib/views";

const claimableOf = (p: PortfolioItem) => BigInt(p.claimable) + BigInt(p.leftover);
const canRefund = (p: PortfolioItem) => p.phase === "refundable" && !p.refunded;

function Stat({ label, children, tone = "" }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="bg-[#0c0d10] px-5 py-4">
      <div className="label">{label}</div>
      <div className={`num mt-1.5 text-[1.6rem] font-semibold leading-none tracking-tight ${tone}`}>{children}</div>
    </div>
  );
}

/** The current identity's pools, claims and refunds, plus the starred watchlist. */
export function PortfolioView() {
  const { address, name, kind } = useIdentity();
  const { run, busy } = useSigned();
  const toast = useToast();
  const { ids: watch } = useWatchlist();
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [coins, setCoins] = useState<NarrativeCard[] | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    const [p, c] = await Promise.all([
      fetch(`/api/portfolio?wallet=${address}`).then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("/api/narratives").then((r) => r.json()).catch(() => ({ narratives: [] })),
    ]);
    setItems(p.items ?? []);
    setCoins(c.narratives ?? []);
  }, [address]);

  useEffect(() => {
    load();
    // Refresh when anything changes on the platform (debounced), and as a slow safety net.
    let t: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      if (/"kind":"(hello|comment|vote|submission)"/.test(e.data)) return;
      if (t) clearTimeout(t);
      t = setTimeout(load, 600);
    };
    const slow = setInterval(load, 20_000);
    return () => {
      es.close();
      clearInterval(slow);
      if (t) clearTimeout(t);
    };
  }, [load]);

  const claimable = (items ?? []).filter((p) => claimableOf(p) > 0n);
  const refundable = (items ?? []).filter(canRefund);
  const open = (items ?? []).filter((p) => !p.refunded && (p.stage === "pooling" || p.stage === "launching"));
  const sum = (list: PortfolioItem[], f: (p: PortfolioItem) => bigint) => list.reduce((s, p) => s + f(p), 0n);

  async function all(kindOf: "claim" | "refund") {
    const list = kindOf === "claim" ? claimable : refundable;
    setBulk(kindOf);
    let ok = 0;
    for (const p of list) {
      const out = await run(`${kindOf}:${p.narrativeId}`, `/api/narratives/${p.narrativeId}/${kindOf}`, kindOf, { narrativeId: p.narrativeId });
      if (out) ok += 1;
    }
    setBulk(null);
    if (ok) toast("ok", kindOf === "claim" ? `Claimed from ${ok} coin${ok === 1 ? "" : "s"}` : `Refunded ${ok} pool${ok === 1 ? "" : "s"} in full`);
    load();
  }

  const watched = (coins ?? []).filter((n) => watch.includes(n.id));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2.2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.8rem]">
            <span className="text-silver">Your </span>
            <span className="display text-gradient pr-2 text-[1.06em]">portfolio</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.95rem] text-muted">
            {address ? (
              <>
                <Avatar address={address} size={18} />
                <span className="text-ink">{name}</span>
                <span className="text-dim">
                  ·{" "}
                  {kind === "guest"
                    ? "guest identity in this browser. Connect a wallet to use your own address."
                    : "connected wallet"}
                </span>
              </>
            ) : (
              "Loading your identity…"
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-accent h-11" disabled={claimable.length === 0 || busy !== null} onClick={() => all("claim")}>
            <Icon name="coins" className="h-4 w-4" />
            {bulk === "claim" ? "Claiming…" : `Claim all${claimable.length ? ` (${claimable.length})` : ""}`}
          </button>
          {refundable.length > 0 && (
            <button className="btn-danger h-11" disabled={busy !== null} onClick={() => all("refund")}>
              <Icon name="refund" className="h-4 w-4" />
              {bulk === "refund" ? "Refunding…" : `Refund all (${refundable.length})`}
            </button>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-white/[0.07] lg:grid-cols-4">
        <Stat label="In open pools">
          <AnimatedNumber value={Number(sum(open, (p) => BigInt(p.deposited))) / 1e9} format="sol" /> <span className="text-base font-normal text-dim">SOL</span>
        </Stat>
        <Stat label="Claimable now" tone="text-accent">
          <AnimatedNumber value={Number(sum(claimable, (p) => BigInt(p.claimable)) / 1_000_000n)} format="tokens" />{" "}
          <span className="text-base font-normal text-dim">tokens</span>
        </Stat>
        <Stat label="Refundable" tone={refundable.length ? "text-danger" : ""}>
          <AnimatedNumber value={Number(sum(refundable, (p) => BigInt(p.deposited))) / 1e9} format="sol" /> <span className="text-base font-normal text-dim">SOL</span>
        </Stat>
        <Stat label="Pools joined">
          <AnimatedNumber value={items?.length ?? 0} />
        </Stat>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[1.35rem] font-semibold tracking-[-0.025em]">Positions</h2>
        {items === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="panel flex flex-col items-center px-6 py-14 text-center">
            <span className="glass flex h-12 w-12 items-center justify-center rounded-2xl text-accent">
              <Icon name="briefcase" className="h-5 w-5" />
            </span>
            <p className="mt-4 font-semibold">You haven&apos;t joined a pool yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted">Pools open when a narrative&apos;s vote ends. Everyone who joins gets the same price.</p>
            <Link href="/#pooling" className="btn-primary mt-6 h-11 px-6">
              Find an open pool <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <ul className="panel divide-y divide-white/[0.06] overflow-hidden">
            {items.map((p) => (
              <Position key={p.narrativeId} p={p} busy={busy} run={run} onDone={load} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[1.35rem] font-semibold tracking-[-0.025em]">
            <Icon name="star" className="h-5 w-5 fill-current text-warn" /> Watchlist
          </h2>
          <span className="text-[0.8rem] text-dim">Saved in this browser</span>
        </div>
        {watched.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-sm text-muted">
            Star any coin to keep it here. <Link href="/#explore" className="text-ink underline decoration-white/30 underline-offset-4">Browse coins</Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {watched.map((n) => (
              <CoinCard key={n.id} n={n} href={`/n/${n.slug}`} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Position({
  p,
  busy,
  run,
  onDone,
}: {
  p: PortfolioItem;
  busy: string | null;
  run: ReturnType<typeof useSigned>["run"];
  onDone: () => void;
}) {
  const claim = claimableOf(p);
  const launched = BigInt(p.entitlement) > 0n;
  const progress = launched ? Number((BigInt(p.claimed) * 1000n) / BigInt(p.entitlement)) / 10 : 0;
  const act = async (kind: "claim" | "refund") => {
    const out = await run(`${kind}:${p.narrativeId}`, `/api/narratives/${p.narrativeId}/${kind}`, kind, { narrativeId: p.narrativeId }, kind === "claim" ? "Claimed" : "Refunded in full");
    if (out) onDone();
  };

  let action: React.ReactNode;
  if (claim > 0n) {
    action = (
      <button className="btn-accent h-10" disabled={busy !== null} onClick={() => act("claim")}>
        {busy === `claim:${p.narrativeId}` ? "Claiming…" : BigInt(p.claimable) > 0n ? `Claim ${formatTokens(BigInt(p.claimable))}` : `Claim ${formatSol(BigInt(p.leftover), 4)} SOL`}
      </button>
    );
  } else if (canRefund(p)) {
    action = (
      <button className="btn-danger h-10" disabled={busy !== null} onClick={() => act("refund")}>
        {busy === `refund:${p.narrativeId}` ? "Refunding…" : `Refund ${formatSol(BigInt(p.deposited))} SOL`}
      </button>
    );
  } else if (p.refunded) {
    action = <span className="text-sm text-dim">Refunded in full</span>;
  } else if (p.stage === "pooling") {
    action = (
      <span className="text-sm text-info">
        <Countdown to={p.depositEnd} prefix="closes in" done="closing…" />
      </span>
    );
  } else if (p.stage === "launching") {
    action = (
      <span className="text-sm text-warn">
        <Countdown to={p.launchAfter} prefix="launches in" done="launching…" />
      </span>
    );
  } else if (launched && p.unlocked < p.trancheCount) {
    action = <span className="text-sm text-dim">Next unlock soon</span>;
  } else {
    action = <span className="text-sm text-dim">{launched ? "Fully claimed" : "-"}</span>;
  }

  return (
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center">
      <Link href={`/n/${p.slug}`} className="flex min-w-0 flex-1 items-center gap-3.5">
        <Coin image={p.image} ticker={p.ticker} size={48} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{p.title}</span>
            {p.ticker && <span className="num text-xs text-dim">${p.ticker}</span>}
            <StageBadge stage={p.stage} />
          </span>
          <span className="num mt-0.5 block text-[0.8rem] text-muted">
            {formatSol(BigInt(p.deposited))} SOL in · {p.sharePct.toFixed(2)}% of the pool
          </span>
        </span>
      </Link>
      {launched && (
        <div className="w-full sm:w-56">
          <div className="flex justify-between text-[0.72rem] text-dim">
            <span>
              claimed {formatTokens(BigInt(p.claimed))} / {formatTokens(BigInt(p.entitlement))}
            </span>
            <span>
              {p.unlocked}/{p.trancheCount} unlocked
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <div className="flex shrink-0 justify-end sm:w-48">{action}</div>
    </li>
  );
}
