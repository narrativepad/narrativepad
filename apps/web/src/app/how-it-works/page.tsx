import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/bits";
import { HowItWorks } from "@/components/HowItWorks";
import { config, type PoolLimits } from "@/lib/config";
import { SOL_UNIT, withUnit } from "@/lib/units";

export const metadata: Metadata = { title: "How it works" };

type IconName = Parameters<typeof Icon>[0]["name"];

export default function HowItWorksPage() {
  const min = (s: number) => Math.round(s / 60);
  const limits: { icon: IconName; tone: string; t: string; d: string }[] = [
    {
      icon: "check",
      tone: "text-success",
      t: "Nobody gets in before the pool",
      d: "The coin is created and the pool's buy happens in the same transaction. Anyone buying after that, even in the same block, pays a higher price.",
    },
    {
      icon: "check",
      tone: "text-success",
      t: "Refunds can't be blocked",
      d: "If the pool misses its minimum or the launch deadline passes, every depositor takes back 100% on their own. No one has to approve it.",
    },
    {
      icon: "flag",
      tone: "text-gold",
      t: "Lookalike coins can still exist",
      d: "Anyone can launch a copy somewhere else. The official coin is the one built here, and its page shows the locked hash that proves it.",
    },
    {
      icon: "flag",
      tone: "text-gold",
      t: "Limits are per wallet",
      d: "Someone with several wallets can join more than once, but they still pay exactly the same price as everyone else.",
    },
  ];
  // Each limit in both pool currencies (D-023): "20 SOL · 8 USDC".
  const both = (pick: (l: PoolLimits) => bigint) =>
    `${withUnit(pick(config.pools.SOL), SOL_UNIT)} · ${withUnit(pick(config.pools.USDC), { symbol: "USDC", decimals: 6 })}`;
  const rules: [string, string][] = [
    ["Pool cap", both((l) => l.poolCap)],
    ["Pool minimum to launch", both((l) => l.poolMin)],
    ["Max per wallet", both((l) => l.perWalletMax)],
    ["Smallest deposit", both((l) => l.minDeposit)],
    ["Voting window", `${min(config.voteDurationSec)} min`],
    ["Pool window", `${min(config.depositWindowSec)} min`],
    ["Platform fee", `${(config.feeBps / 100).toFixed(0)}%, only if it launches`],
    ["Refunds", "100%, always"],
  ];
  const faq: [string, string][] = [
    ["Do I need a wallet to vote?", "No. You get a guest identity in your browser that signs your votes for free. Connect a wallet when you want to use your own address."],
    ["Who holds the money in a pool?", "The escrow program on Solana, not a person or a company wallet. There is no admin withdraw: funds can only leave as a refund to the depositor, the launch buy, or a claim."],
    ["How is this different from buying on launch day?", "On a normal launch, bots and insiders buy in the first block and everyone else pays more. Here, everyone in the pool buys together in the transaction that creates the coin."],
    ["When do I get my tokens?", `Right after launch, in ${config.trancheCount} equal unlocks every ${min(config.trancheIntervalSec)} minutes. Everyone unlocks on the same schedule, so nobody can dump on the rest of the pool.`],
    ["What if the pool doesn't fill?", "If it misses the minimum or the launch fails, everyone takes back 100% of what they put in. The fee is only charged on a successful launch."],
    ["What can a coin be paired with?", "Whoever starts the narrative picks the pair from pump.fun's own list: SOL, USDC, wrapped BTC and ETH, a few other coins, and tokenized stocks like NVIDIA, Tesla or SpaceX. The pool collects the pair itself, so a USDC coin's pool holds USDC. SOL and USDC pools are open now; the others open with the mainnet launch, where your wallet will swap into the pair as you join."],
    ["Is a USDC pool different from a SOL pool?", "Same rules, same escrow, different currency. One difference: USDC's issuer can freeze tokens. If it ever froze the pool's or a depositor's USDC, deposits and refunds would wait until it was unfrozen. SOL pools have no issuer, so nothing can hold up a SOL refund."],
    ["What are holder rewards?", "A pump.fun setting chosen once, when the coin is created. On: the creator fee from every trade goes to the coin's holders, for good. Off: the fees are split 50% to the pool, 30% to the creator and 20% to the platform. Everyone who joins the pool votes, and each vote counts with the amount behind it. It replaced pump.fun's old cashback option."],
  ];

  return (
    <div className="flex flex-col gap-16 pb-6">
      <section className="relative pt-6 sm:pt-10">
        <p className="eyebrow">How it works</p>
        <h1 className="mt-4 max-w-4xl text-[2.6rem] font-semibold leading-[1] tracking-[-0.045em] sm:text-[3.6rem] xl:text-[4.2rem]">
          <span className="text-silver">The crowd builds the coin.</span>
          <br />
          <span className="display text-gradient pr-3 text-[1.06em]">Then buys it together.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-[1.06rem] leading-relaxed text-muted">
          The community decides everything before the coin exists, then buys it at launch through one public pool. No snipers ahead of you,
          and no insiders at a better price.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/create" className="btn-primary h-12 px-6 text-[0.95rem]">
            Start a narrative <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <Link href="/#explore" className="btn h-12 px-6 text-[0.95rem]">
            Explore coins
          </Link>
        </div>
      </section>

      <HowItWorks heading={false} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-head">
            <span>What&apos;s guaranteed, and what isn&apos;t</span>
          </div>
          <ul className="grid gap-px bg-white/[0.06] sm:grid-cols-2">
            {limits.map((l) => (
              <li key={l.t} className="flex gap-3.5 bg-[#0c0d10] p-5">
                <Icon name={l.icon} className={`mt-0.5 h-[1.1rem] w-[1.1rem] shrink-0 ${l.tone}`} />
                <div>
                  <h3 className="font-semibold">{l.t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{l.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <span>Pool rules</span>
          </div>
          <dl className="divide-y divide-white/[0.05]">
            {rules.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <dt className="text-muted">{k}</dt>
                <dd className="num text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.035em]">
            <span className="text-silver">Good to </span>
            <span className="display text-gradient pr-2 text-[1.06em]">know</span>
          </h2>
          <p className="mt-3 max-w-sm text-[0.95rem] leading-relaxed text-muted">
            Still unsure? Ask on <a href="https://x.com/narrativepad" className="text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white">X</a>.
          </p>
        </div>
        <div className="panel divide-y divide-white/[0.06]">
          {faq.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <Icon name="plus" className="h-4 w-4 shrink-0 text-dim transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-2.5 max-w-2xl text-[0.92rem] leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {config.chain === "mock" && (
        <section id="preview" className="panel scroll-mt-24">
          <div className="panel-head">
            <span>About this preview</span>
            <span className="chip border-warn/30 text-warn">no real funds yet</span>
          </div>
          <div className="grid gap-5 p-5 text-sm leading-relaxed text-muted lg:grid-cols-3 lg:p-6">
            <p>
              <span className="font-semibold text-ink">Pools are simulated.</span> The escrow program is written and being tested, but it isn&apos;t
              deployed yet. Deposits, launches, claims and refunds run on the same math the escrow uses, and no real SOL moves.
            </p>
            <p>
              <span className="font-semibold text-ink">Votes are real.</span> Every vote is a message signed by your wallet, or by a guest key kept in
              your browser. Signing is free and never moves funds.
            </p>
            <p>
              <span className="font-semibold text-ink">What changes next.</span> Once the escrow is live on Solana devnet, every pool page shows its
              escrow address, every deposit, and explorer links you can check yourself.
            </p>
          </div>
        </section>
      )}

      {config.chain === "solana" && (
        <section id="preview" className="panel scroll-mt-24">
          <div className="panel-head">
            <span>About devnet</span>
            <span className="chip border-warn/30 text-warn">test funds only</span>
          </div>
          <div className="grid gap-5 p-5 text-sm leading-relaxed text-muted lg:grid-cols-3 lg:p-6">
            <p>
              <span className="font-semibold text-ink">The escrow is live on devnet.</span> Pools, launches on pump.fun&apos;s devnet, claims and refunds
              are real transactions on Solana&apos;s test network. Devnet SOL and USDC are free and worth nothing.
            </p>
            <p>
              <span className="font-semibold text-ink">To join a pool:</span> switch your wallet (Phantom, Solflare, Backpack) to devnet, get free SOL
              at{" "}
              <a className="text-ink underline" href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">
                faucet.solana.com
              </a>{" "}
              (and devnet USDC at{" "}
              <a className="text-ink underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
                faucet.circle.com
              </a>{" "}
              for USDC pools), then join. Your wallet signs the deposit and your holder-rewards vote in one transaction.
            </p>
            <p>
              <span className="font-semibold text-ink">Check everything yourself.</span> Every pool shows its escrow address, and every deposit, launch,
              claim and refund links to the Solana explorer. Mainnet comes only after an external audit.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
