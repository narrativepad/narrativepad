import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/bits";
import { config } from "@/lib/config";
import { formatSol } from "@/lib/math";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorks() {
  const min = (s: number) => Math.round(s / 60);
  const steps: [Parameters<typeof Icon>[0]["name"], string, string][] = [
    ["spark", "Propose", "Anyone starts a narrative with a pitch, a picture and a source: a tweet, an article, a meme."],
    ["vote", "Vote", `For ${min(config.voteDurationSec)} minutes everyone suggests and votes on the name, ticker, image and links. One vote per person per field.`],
    ["lock", "Lock", "The winners are frozen and hashed. Nobody, including us, can change what launches."],
    ["coins", "Pool", `A public pool is open for ${min(config.depositWindowSec)} minutes. Everyone who joins gets the same price; every deposit is listed in order.`],
    ["rocket", "Launch", `${min(config.launchDelaySec)} minutes after the pool closes, the coin is created and the whole pool buys in, in one transaction.`],
    ["check", "Release", `Tokens go back to everyone who joined, pro-rata, in ${config.trancheCount} equal tranches every ${min(config.trancheIntervalSec)} minutes.`],
  ];
  const promises: [string, string, string][] = [
    ["Nobody gets in before the pool", "Creation and the opening buy happen together. Later buyers, even in the same block, pay more.", "text-accent"],
    ["Refunds can't be blocked", "If the pool misses its minimum or the deadline passes, everyone takes back 100%.", "text-accent"],
    ["Copies can still exist", "Anyone can launch a lookalike elsewhere. The official coin is the one built here, with its locked hash on the page.", "text-warn"],
    ["Limits are per person", "Someone with several identities can join more than once, but they still pay the same price as everyone.", "text-warn"],
  ];
  const limits: [string, string][] = [
    ["Pool cap", `${formatSol(config.poolCap)} SOL`],
    ["Pool minimum", `${formatSol(config.poolMin)} SOL`],
    ["Max per person", `${formatSol(config.perWalletMax)} SOL`],
    ["Min deposit", `${formatSol(config.minDeposit)} SOL`],
    ["Platform fee", `${(config.feeBps / 100).toFixed(0)}%, only on launch`],
    ["Refunds", "100%, always"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <section className="panel relative overflow-hidden p-6 lg:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/12 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-80 w-80 rounded-full bg-accent-2/10 blur-3xl" />
        <h1 className="relative max-w-4xl text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] lg:text-[3.2rem]">
          The crowd builds the coin. <span className="display text-gradient pr-2 text-[1.08em]">Then buys it together.</span>
        </h1>
        <p className="relative mt-4 max-w-3xl text-[1.02rem] leading-relaxed text-muted">
          The community decides everything before the coin exists, then buys it together at launch in one public pool. No snipers ahead of
          you, no insiders at a better price.
        </p>
        <Link href="/create" className="btn-primary relative mt-6 px-5 py-2.5">
          <Icon name="plus" className="h-4 w-4" /> Start a narrative
        </Link>
      </section>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {steps.map(([icon, t, d], i) => (
          <li key={t} className="panel relative overflow-hidden p-5">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Icon name={icon} className="h-5 w-5" />
              </span>
              <span className="num text-xs text-dim">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight">{t}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="panel-head"><span>What we can and can&apos;t promise</span></div>
          <div className="grid gap-px bg-line sm:grid-cols-2">
            {promises.map(([t, d, tone]) => (
              <div key={t} className="bg-panel p-5">
                <h3 className={`font-semibold ${tone}`}>{t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><span>Pool rules</span></div>
          <dl className="divide-y divide-line">
            {limits.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-5 py-3 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="num font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {config.chain === "mock" && (
        <section id="preview" className="panel scroll-mt-24 border-warn/20">
          <div className="panel-head">
            <span>About this preview</span>
            <span className="chip border-warn/30 text-warn">no real funds</span>
          </div>
          <div className="grid gap-5 p-5 text-sm leading-relaxed text-muted lg:grid-cols-3 lg:p-6">
            <p>
              <span className="font-semibold text-ink">Pools are simulated.</span> The escrow program is written but not deployed yet, so deposits,
              launches, claims and refunds run on the same math the escrow uses, and no real SOL moves.
            </p>
            <p>
              <span className="font-semibold text-ink">Votes are real.</span> Every vote is a message signed by your wallet, or by a guest key kept in
              your browser if you haven&apos;t connected one. Signing is free and never moves funds.
            </p>
            <p>
              <span className="font-semibold text-ink">What changes at launch.</span> Once the escrow is live on Solana devnet, every pool page shows its
              escrow address, every deposit, and explorer links you can check yourself.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
