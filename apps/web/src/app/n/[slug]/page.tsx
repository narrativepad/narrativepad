import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity } from "@/components/Activity";
import { Coin, Icon, StageBadge, STAGE, TeamBadge, Who } from "@/components/bits";
import { Countdown } from "@/components/Countdown";
import { LiveRefresh } from "@/components/LiveRefresh";
import { formatSol, formatTokens, launchBreakdown, PUMP } from "@/lib/math";
import type { Stage } from "@/lib/phase";
import { narrativeBySlug, type NarrativeDetail } from "@/lib/views";
import { Ballots } from "./Ballots";
import { LockPanel } from "./LockPanel";
import { PoolChart } from "./PoolChart";
import { PoolPanel } from "./PoolPanel";
import { ReportButton } from "./ReportButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const n = await narrativeBySlug((await params).slug);
  if (!n) return { title: "Not found" };
  const title = n.ticker ? `${n.title} ($${n.ticker})` : n.title;
  return { title, description: n.pitch, openGraph: { title, description: n.pitch }, twitter: { card: "summary_large_image", title, description: n.pitch } };
}

const STEPS = ["Vote", "Lock", "Pool", "Launch", "Release"] as const;
const STEP_INDEX: Record<Stage, number> = { voting: 0, pooling: 2, launching: 3, live: 4, refunding: 2, cancelled: 0 };

function Stepper({ stage }: { stage: Stage }) {
  const at = STEP_INDEX[stage];
  const failed = stage === "refunding" || stage === "cancelled";
  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-[0.75rem] font-medium" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < at || (stage === "live" && i === at);
        const current = i === at && stage !== "live";
        return (
          <li key={s} className="flex shrink-0 items-center gap-2">
            {i > 0 && <span className={`h-px w-6 sm:w-12 ${done || current ? "bg-gradient-to-r from-accent/60 to-accent-2/60" : "bg-line-2"}`} />}
            <span className={`flex items-center gap-2 ${current ? (failed ? "text-danger" : "text-ink") : done ? "text-accent" : "text-dim"}`}>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.62rem] ${
                  done
                    ? "bg-gradient-to-br from-accent to-accent-2 text-accent-ink"
                    : current
                      ? failed
                        ? "border border-danger"
                        : "border border-accent text-accent shadow-[0_0_14px_-2px_var(--color-accent)]"
                      : "border border-line-2"
                }`}
              >
                {done ? <Icon name="check" className="h-3 w-3" /> : i + 1}
              </span>
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ label, children, tone, sub, icon }: { label: string; children: React.ReactNode; tone?: string; sub?: React.ReactNode; icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-dim">
        <Icon name={icon} className="h-3.5 w-3.5" />
        <span className="label">{label}</span>
      </div>
      <div className={`num mt-1.5 truncate text-xl font-semibold leading-none ${tone ?? ""}`}>{children}</div>
      {sub && <div className="num mt-1 truncate text-[0.7rem] text-dim">{sub}</div>}
    </div>
  );
}

function HeroStats({ n }: { n: NarrativeDetail }) {
  const e = n.escrow;
  if (n.stage === "voting" || n.stage === "cancelled" || !e) {
    return (
      <>
        <Stat icon="vote" label="Votes">{n.totalVotes}</Stat>
        <Stat icon="users" label="Voters">{n.voters}</Stat>
        <Stat icon="spark" label="Entries">{n.entryCount}</Stat>
        <Stat icon="clock" label={n.stage === "voting" ? "Voting ends" : "Status"} tone={n.stage === "voting" ? "text-violet" : "text-dim"}>
          {n.stage === "voting" ? <Countdown to={n.voteEndsAt} done="tallying…" /> : "Cancelled"}
        </Stat>
      </>
    );
  }
  const total = BigInt(e.totalDeposited);
  if (n.stage === "live") {
    const bought = BigInt(e.tokensBought);
    return (
      <>
        <Stat icon="coins" label="Pool bought" sub={`${Number((bought * 1000n) / PUMP.totalSupply) / 10}% of supply`}>
          {formatTokens(bought)}
        </Stat>
        <Stat icon="spark" label="Pool" sub={`fee ${formatSol(BigInt(e.platformFee), 3)} SOL`}>
          {formatSol(total)} SOL
        </Stat>
        <Stat icon="users" label="Holders">{e.depositorCount}</Stat>
        <Stat icon="lock" label="Unlocked" tone="text-accent" sub={`${formatTokens(BigInt(e.tokensClaimed))} claimed`}>
          {e.unlocked}/{e.trancheCount}
        </Stat>
      </>
    );
  }
  const projected = launchBreakdown(total, e.feeBps);
  return (
    <>
      <Stat icon="coins" label="Pooled" tone="text-accent" sub={`of ${formatSol(BigInt(e.poolCap))} SOL cap`}>
        {formatSol(total)} SOL
      </Stat>
      <Stat icon="users" label="In the pool">{e.depositorCount}</Stat>
      <Stat icon="rocket" label="Opening buy" sub="of total supply">
        {projected.pctOfSupply.toFixed(1)}%
      </Stat>
      <Stat icon="clock" label={n.stage === "pooling" ? "Pool closes" : n.stage === "launching" ? "Launch in" : "Refunded"} tone={n.stage === "refunding" ? "text-danger" : "text-warn"}>
        {n.stage === "pooling" ? (
          <Countdown to={e.depositEnd} done="closing…" />
        ) : n.stage === "launching" ? (
          <Countdown to={e.launchAfter} done="launching…" />
        ) : (
          `${formatSol(BigInt(e.totalRefunded))} SOL`
        )}
      </Stat>
    </>
  );
}

const STAGE_LINE: Record<Stage, string> = {
  voting: "Voting is open. Pick the name, ticker, image and links.",
  pooling: "Locked. The pool is open and everyone gets the same price.",
  launching: "Pool closed. The coin is created and the whole pool buys in, in one transaction.",
  live: "Launched by the community pool.",
  refunding: "The pool didn't launch. Every depositor can take back 100%.",
  cancelled: "Voting ended without a name and ticker.",
};

export default async function NarrativePage({ params }: { params: Promise<{ slug: string }> }) {
  const n = await narrativeBySlug((await params).slug);
  if (!n || n.hidden) notFound();
  const version = `${n.stage}:${n.totalVotes}:${n.entryCount}:${n.escrow?.totalDeposited ?? 0}:${n.escrow?.tokensClaimed ?? 0}:${n.escrow?.totalRefunded ?? 0}:${n.deposits.length}`;
  const e = n.escrow;
  const s = STAGE[n.stage];

  return (
    <div className="flex flex-col gap-3">
      <LiveRefresh narrativeId={n.id} />
      <Link href="/#board" className="flex w-fit items-center gap-1.5 px-1 text-[0.82rem] text-muted transition-colors hover:text-ink">
        <Icon name="arrow" className="h-3.5 w-3.5 rotate-180" /> Back to the board
      </Link>

      <section className="panel relative overflow-hidden">
        {n.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.image} alt="" aria-hidden className="pointer-events-none absolute -left-1/4 -top-1/2 h-[200%] w-[80%] scale-110 object-cover opacity-[0.22] blur-[90px] saturate-150" />
        ) : (
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: `${s.hex}22` }} />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-panel/40 to-panel" />
        <div className="relative grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,46rem)] lg:items-center 2xl:p-6">
          <div className="flex min-w-0 gap-5">
            <Coin image={n.image} ticker={n.ticker} size={104} stage={n.stage} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h1 className="text-[1.9rem] font-semibold leading-none tracking-tight sm:text-[2.3rem]">{n.title}</h1>
                {n.ticker && <span className="num text-lg text-muted">${n.ticker}</span>}
                <StageBadge stage={n.stage} />
              </div>
              <p className={`text-sm ${s.text}`}>{STAGE_LINE[n.stage]}</p>
              <p className="line-clamp-3 max-w-3xl break-words text-[0.98rem] leading-relaxed text-ink/90">{n.pitch}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dim">
                <span className="flex items-center gap-1.5">
                  started by <Who address={n.creator} size={16} className="text-muted" /> {n.creatorIsTeam && <TeamBadge />}
                </span>
                {n.sourceUrl && (
                  <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex max-w-[22rem] items-center gap-1 truncate text-accent hover:underline">
                    <Icon name="link" className="h-3.5 w-3.5 shrink-0" />
                    {n.sourceUrl.replace(/^https:\/\//, "")}
                  </a>
                )}
                <ReportButton targetType="narrative" targetId={n.id} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HeroStats n={n} />
          </div>
        </div>
        <div className="relative border-t border-white/[0.05] bg-black/20 px-5 py-3 2xl:px-6">
          <Stepper stage={n.stage} />
        </div>
      </section>

      {e?.launched && (
        <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-accent/25 bg-gradient-to-r from-accent/[0.08] to-transparent px-4 py-3 text-sm">
          <span className="flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-[0.7rem] font-semibold text-accent">
            <Icon name="shield" className="h-3.5 w-3.5" /> Community pool buy
          </span>
          <span className="text-muted">
            The opening buy was made for <span className="num font-medium text-ink">{e.depositorCount}</span> people at one price, together. Not an
            insider bundle.
          </span>
        </section>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start 3xl:grid-cols-[minmax(0,1fr)_30rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {e && n.flow.length > 0 && <PoolChart n={n} />}
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-base font-semibold tracking-tight">{n.stage === "voting" ? "Ballots" : "Final ballots"}</h2>
            <span className="text-xs text-dim">
              {n.stage === "voting" ? "One vote per person per field · highest wins · ties go to the earliest entry" : "Locked and hashed when voting ended"}
            </span>
          </div>
          <Ballots n={n} version={version} />
          <Activity items={n.activity} className="max-h-[30rem]" />
        </div>

        {/* On phones the pool (the thing you act on) comes straight after the hero. */}
        <div className={`flex min-w-0 flex-col gap-3 ${e ? "max-lg:order-first" : ""}`}>
          {e ? (
            <PoolPanel n={n} version={version} />
          ) : (
            <section className="panel">
              <div className="panel-head">
                <span>What happens next</span>
              </div>
              <ol className="space-y-4 p-4 text-sm text-muted">
                {[
                  ["lock", "Lock", "The winning name, ticker, image and links are frozen and hashed."],
                  ["coins", "Pool", "A public pool opens. Everyone who joins gets the same price."],
                  ["rocket", "Launch", "The coin is created and the whole pool buys in, in one transaction."],
                  ["spark", "Release", "Tokens unlock to everyone in equal tranches. Pool too small? Everyone gets 100% back."],
                ].map(([icon, t, d]) => (
                  <li key={t} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-accent">
                      <Icon name={icon as "lock"} className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="font-semibold text-ink">{t}</span>
                      <br />
                      {d}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {n.lock && <LockPanel n={n} />}
        </div>
      </div>
    </div>
  );
}
