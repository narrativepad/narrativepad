import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Icon, short, StageBadge, TeamBadge } from "@/components/bits";
import { formatSol, formatTokens } from "@/lib/math";
import { FIELD_LABEL, type Field } from "@/lib/messages";
import { displayName } from "@/lib/names";
import type { Stage } from "@/lib/phase";
import { profile } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ wallet: string }> }): Promise<Metadata> {
  return { title: displayName((await params).wallet) };
}

function Section({ title, icon, count, children, empty }: { title: string; icon: Parameters<typeof Icon>[0]["name"]; count: number; children: React.ReactNode; empty: string }) {
  return (
    <section className="panel flex min-h-0 flex-col lg:max-h-[max(26rem,calc(100dvh-16rem))]">
      <div className="panel-head">
        <span className="flex items-center gap-2">
          <Icon name={icon} className="h-3.5 w-3.5" /> {title}
        </span>
        <span className="num normal-case tracking-normal text-dim">{count}</span>
      </div>
      {count === 0 ? <p className="flex flex-1 items-center justify-center px-6 py-12 text-center text-sm text-dim">{empty}</p> : children}
    </section>
  );
}

export default async function ProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) notFound();
  const p = await profile(wallet);
  const deposited = p.positions.reduce((s, x) => s + BigInt(x.amount), 0n);
  const claimed = p.claims.reduce((s, c) => s + BigInt(c.tokens), 0n);
  const name = displayName(wallet);

  return (
    <div className="flex flex-col gap-3">
      <section className="panel relative flex flex-col gap-5 overflow-hidden p-5 xl:flex-row xl:items-center">
        <div className="pointer-events-none absolute -left-10 -top-16 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex min-w-0 items-center gap-4">
          <Avatar address={wallet} size={64} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[1.6rem] font-semibold tracking-tight">{name}</h1>
              {p.isTeam && <TeamBadge />}
            </div>
            <p className="num truncate text-xs text-dim" title={wallet}>
              {short(wallet, 8)}
            </p>
          </div>
        </div>
        <dl className="relative grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {(
            [
              ["Narratives", p.created.length],
              ["Votes", p.votes.length],
              ["In pools", `${formatSol(deposited)} SOL`],
              ["Claimed", formatTokens(claimed)],
              ["Creator rank", p.rank.creator ? `#${p.rank.creator}` : "-"],
              ["Winning picks", p.rank.picks],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3">
              <dt className="label">{k}</dt>
              <dd className="num mt-1.5 truncate text-xl font-semibold leading-none">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start 2xl:grid-cols-4">
        <Section title="Narratives started" icon="spark" count={p.created.length} empty="No narratives yet.">
          <ul className="scroll-y min-h-0 flex-1 divide-y divide-line">
            {p.created.map((c) => (
              <li key={c.slug}>
                <Link href={`/n/${c.slug}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1 truncate text-sm">{c.pitch}</span>
                  <StageBadge stage={c.stage as Stage} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Pools joined" icon="coins" count={p.positions.length} empty="Hasn't joined a pool yet.">
          <ul className="scroll-y min-h-0 flex-1 divide-y divide-line">
            {p.positions.map((x) => (
              <li key={x.slug}>
                <Link href={`/n/${x.slug}`} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1 truncate font-medium">{x.name ?? "Unnamed"}</span>
                  <span className="num">{formatSol(BigInt(x.amount))} SOL</span>
                  <span className="num w-24 text-right text-xs text-dim">
                    {x.refunded ? "refunded" : `${formatTokens(BigInt(x.tokensClaimed))} claimed`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Votes" icon="vote" count={p.votes.length} empty="No votes yet.">
          <ul className="scroll-y min-h-0 flex-1 divide-y divide-line">
            {p.votes.map((v, i) => (
              <li key={i}>
                <Link href={`/n/${v.slug}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.03]">
                  <span className="label w-20 shrink-0">{FIELD_LABEL[v.field as Field]}</span>
                  <span className="min-w-0 flex-1 truncate">{v.field === "image" ? "an image" : v.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Claims & refunds" icon="check" count={p.claims.length + p.refunds.length} empty="Nothing claimed yet.">
          <ul className="scroll-y min-h-0 flex-1 divide-y divide-line">
            {p.claims.map((c, i) => (
              <li key={`c${i}`}>
                <Link href={`/n/${c.slug}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.03]">
                  <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[0.68rem] font-semibold text-warn">Claim</span>
                  <span className="num flex-1 text-right">{formatTokens(BigInt(c.tokens))} tokens</span>
                </Link>
              </li>
            ))}
            {p.refunds.map((r, i) => (
              <li key={`r${i}`}>
                <Link href={`/n/${r.slug}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.03]">
                  <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[0.68rem] font-semibold text-danger">Refund</span>
                  <span className="num flex-1 text-right">{formatSol(BigInt(r.amount))} SOL</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
