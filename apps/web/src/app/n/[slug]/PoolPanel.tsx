"use client";

import { useMemo, useState } from "react";
import { Icon, ProgressBar, TeamBadge, Who } from "@/components/bits";
import { Countdown } from "@/components/Countdown";
import { useMine } from "@/lib/client/useMine";
import { useSigned } from "@/lib/client/useSigned";
import { formatSol, formatTokens, launchBreakdown, parseSol } from "@/lib/math";
import type { NarrativeDetail } from "@/lib/views";

const QUICK = ["0.1", "0.25", "0.5", "1"];

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[0.8rem]">
      <span className="text-muted">{k}</span>
      <span className="num text-right text-ink">{v}</span>
    </div>
  );
}

export function PoolPanel({ n, version }: { n: NarrativeDetail; version: string }) {
  const e = n.escrow!;
  const { run, busy } = useSigned();
  const { position } = useMine(n.id, version);
  const [amount, setAmount] = useState("");

  const total = BigInt(e.totalDeposited);
  const cap = BigInt(e.poolCap);
  const min = BigInt(e.poolMin);
  const perWallet = BigInt(e.perWalletMax);
  const mine = position ? BigInt(position.deposited) : 0n;
  const room = (() => {
    const w = perWallet - mine;
    const p = cap - total;
    const r = w < p ? w : p;
    return r > 0n ? r : 0n;
  })();
  const parsed = parseSol(amount);
  const pooling = e.phase === "pooling";
  const projected = launchBreakdown(total + (parsed ?? 0n), e.feeBps);
  const myShare = parsed && total + parsed > 0n ? Number(((mine + parsed) * 10_000n) / (total + parsed)) / 100 : null;
  const myTokens = parsed && total + parsed > 0n ? (projected.tokens * (mine + parsed)) / (total + parsed) : 0n;

  const amountError = useMemo(() => {
    if (!amount) return null;
    if (parsed === null) return "Enter an amount like 0.5";
    if (parsed < BigInt(e.minDeposit)) return `Minimum is ${formatSol(BigInt(e.minDeposit))} SOL`;
    if (parsed > room) return `You can add up to ${formatSol(room)} SOL`;
    return null;
  }, [amount, parsed, room, e.minDeposit]);

  async function deposit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!parsed || amountError) return;
    const out = await run("deposit", `/api/narratives/${n.id}/deposit`, "deposit", { narrativeId: n.id, amountLamports: parsed.toString() }, "You're in the pool");
    if (out) setAmount("");
  }

  const claimable = position ? BigInt(position.claimable) + BigInt(position.leftover) : 0n;
  const fillPct = cap > 0n ? Number((total * 1000n) / cap) / 10 : 0;

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <span className="flex items-center gap-2">
          <Icon name="coins" className="h-3.5 w-3.5" /> Community pool
        </span>
        <span className="normal-case tracking-normal">
          {e.phase === "pooling" && <Countdown to={e.depositEnd} prefix="closes in" done="closing…" className="text-info" />}
          {(e.phase === "closing" || e.phase === "launchable") && <Countdown to={e.launchAfter} prefix="launch in" done="launching…" className="text-warn" />}
          {e.phase === "refundable" && <span className="text-danger">Refunds open</span>}
          {e.phase === "released" && <span className="text-accent">Launched</span>}
        </span>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="num text-[1.9rem] font-semibold leading-none tracking-tight">
              {formatSol(total)} <span className="text-base font-normal text-dim">SOL</span>
            </span>
            <span className="num text-sm text-muted">{fillPct}% of {formatSol(cap)}</span>
          </div>
          <div className="mt-3">
            <ProgressBar value={total} max={cap} marker={min} />
          </div>
          <div className="mt-2 flex justify-between text-[0.75rem] text-dim">
            <span className="flex items-center gap-1">
              <Icon name="users" className="h-3.5 w-3.5" /> {e.depositorCount === 0 ? "nobody yet" : `${e.depositorCount} joined`}
            </span>
            <span>{total >= min ? "minimum reached" : `${formatSol(min)} SOL needed to launch`}</span>
          </div>
        </div>

        {pooling && (
          <form onSubmit={deposit} className="rounded-2xl border border-line-2 bg-bg/60 p-3">
            <div className="flex items-center justify-between text-[0.72rem] text-dim">
              <span>You put in</span>
              <button type="button" className="hover:text-accent" onClick={() => setAmount(formatSol(room, 9).replace(/,/g, ""))}>
                Max {formatSol(room)} SOL
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="num w-full bg-transparent text-[1.75rem] font-semibold tracking-tight outline-none placeholder:text-line-2"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(x) => setAmount(x.target.value.replace(",", "."))}
                aria-label="Amount in SOL"
              />
              <span className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line-2 bg-panel-2 px-2.5 py-1.5 text-sm font-semibold">
                <span className="h-4 w-4 rounded-full bg-gradient-to-br from-[#9945ff] to-[#14f195]" /> SOL
              </span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {QUICK.map((qv) => (
                <button
                  key={qv}
                  type="button"
                  onClick={() => setAmount(qv)}
                  className={`num flex-1 rounded-lg border px-2 py-1 text-xs transition-colors ${
                    amount === qv ? "border-accent/50 bg-accent/10 text-accent" : "border-line-2 text-muted hover:text-ink"
                  }`}
                >
                  {qv}
                </button>
              ))}
            </div>
            <div className="mt-3 border-t border-line pt-2">
              {amountError ? (
                <p className="py-1 text-xs text-danger">{amountError}</p>
              ) : parsed ? (
                <>
                  <Row k="Your share of the pool" v={`${myShare?.toFixed(2)}%`} />
                  <Row k="Est. tokens at launch" v={formatTokens(myTokens)} />
                  <Row k="Opening buy" v={`${projected.pctOfSupply.toFixed(1)}% of supply`} />
                </>
              ) : (
                <Row k="Max per wallet" v={`${formatSol(perWallet)} SOL`} />
              )}
              <Row k="Platform fee" v={`${(e.feeBps / 100).toFixed(0)}% · only if it launches`} />
            </div>
            <ul className="mt-3 space-y-1.5 rounded-xl bg-accent/[0.05] px-3 py-2.5 text-[0.76rem] leading-snug text-muted">
              <li className="flex gap-2">
                <Icon name="shield" className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
                Goes into the escrow, never to a wallet anyone controls.
              </li>
              <li className="flex gap-2">
                <Icon name="refund" className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
                100% back if the pool misses {formatSol(min)} SOL or the launch fails.
              </li>
            </ul>
            <button className="btn-primary mt-3 w-full py-2.5" disabled={!parsed || !!amountError || busy !== null}>
              {busy === "deposit" ? "Joining…" : "Join the pool"}
            </button>
            {n.preview && <p className="mt-2 text-center text-[0.72rem] text-warn/80">Preview build: this deposit is simulated. No SOL leaves your wallet.</p>}
          </form>
        )}

        {position && (
          <div className="rounded-2xl border border-line-2 bg-bg/60 p-3">
            <div className="mb-1.5 text-sm font-semibold">Your position</div>
            <Row k="In the pool" v={`${formatSol(BigInt(position.deposited))} SOL`} />
            <Row k="Your share" v={`${position.sharePct.toFixed(2)}%`} />
            {e.launched && (
              <>
                <Row k="Allocation" v={formatTokens(BigInt(position.entitlement))} />
                <Row k="Claimed" v={formatTokens(BigInt(position.claimed))} />
              </>
            )}
            {e.launched && (
              <button
                className="btn-primary mt-3 w-full py-2.5"
                disabled={claimable <= 0n || busy !== null}
                onClick={() => run("claim", `/api/narratives/${n.id}/claim`, "claim", { narrativeId: n.id }, "Claimed")}
              >
                {busy === "claim"
                  ? "Claiming…"
                  : BigInt(position.claimable) > 0n
                    ? `Claim ${formatTokens(BigInt(position.claimable))} tokens`
                    : BigInt(position.leftover) > 0n
                      ? `Claim ${formatSol(BigInt(position.leftover), 4)} SOL unspent`
                      : "Next tranche unlocks soon"}
              </button>
            )}
            {e.phase === "refundable" && (
              <button
                className="btn-danger mt-3 w-full"
                disabled={position.refunded || busy !== null}
                onClick={() => run("refund", `/api/narratives/${n.id}/refund`, "refund", { narrativeId: n.id }, "Refunded in full")}
              >
                {position.refunded ? "Refunded" : busy === "refund" ? "Refunding…" : `Refund ${formatSol(BigInt(position.deposited))} SOL`}
              </button>
            )}
          </div>
        )}

        {e.launched && <ReleaseSchedule n={n} />}
        <Depositors n={n} />
      </div>
    </section>
  );
}

function ReleaseSchedule({ n }: { n: NarrativeDetail }) {
  const e = n.escrow!;
  const start = Date.parse(e.launchedAt!);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Release · everyone unlocks together</span>
        <span className="num text-xs text-muted">
          {e.unlocked}/{e.trancheCount}
        </span>
      </div>
      <ol className="flex gap-1">
        {Array.from({ length: e.trancheCount }, (_, i) => {
          const at = new Date(start + i * e.trancheIntervalSec * 1000).toISOString();
          const open = i < e.unlocked;
          return (
            <li key={i} className="min-w-0 flex-1">
              <div className={`h-1.5 rounded-full ${open ? "bg-gradient-to-r from-accent to-accent-2" : "bg-white/[0.07]"}`} />
              <div className={`num mt-1.5 text-center text-[0.65rem] ${open ? "text-accent" : "text-dim"}`}>
                {open ? `${Math.round(((i + 1) / e.trancheCount) * 100)}%` : <Countdown to={at} done="open" />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Depositors({ n }: { n: NarrativeDetail }) {
  const [all, setAll] = useState(false);
  const e = n.escrow!;
  const list = all ? n.deposits : n.deposits.slice(-10);
  if (!n.deposits.length) return <p className="py-2 text-center text-sm text-dim">Be the first one in.</p>;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{e.launched ? "Community pool buy · every depositor" : "Deposits, in order"}</span>
        <span className="num text-xs text-dim">{n.deposits.length}</span>
      </div>
      <ol className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {[...list].reverse().map((d) => (
          <li key={d.orderIndex} className="flex items-center gap-2.5 px-3 py-2 text-[0.8rem]">
            <span className="num w-5 text-[0.7rem] text-dim">#{d.orderIndex + 1}</span>
            <span className="min-w-0 flex-1 truncate text-muted">
              <Who address={d.wallet} size={16} /> {d.isTeam && <TeamBadge />}
            </span>
            <span className="num text-ink">{formatSol(BigInt(d.amount))}</span>
          </li>
        ))}
      </ol>
      {n.deposits.length > 10 && (
        <button className="mt-2 text-xs text-accent hover:underline" onClick={() => setAll(!all)}>
          {all ? "Show latest" : `Show all ${n.deposits.length}`}
        </button>
      )}
    </div>
  );
}
