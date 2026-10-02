import type { Metadata } from "next";
import Link from "next/link";
import { Coin } from "@/components/bits";
import { Countdown } from "@/components/Countdown";
import { config } from "@/lib/config";
import { feed } from "@/lib/views";
import { CreateForm } from "./CreateForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Start a narrative" };

export default async function CreatePage() {
  const open = (await feed()).filter((n) => n.stage === "voting").sort((a, b) => b.votes - a.votes).slice(0, 12);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[2.2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.8rem]"><span className="text-silver">Start a </span><span className="display text-gradient pr-2 text-[1.06em]">narrative</span></h1>
          <p className="text-sm text-muted">A short pitch and a source. The crowd decides the name, ticker, image, pair and fees.</p>
        </div>
        <div className="flex gap-2 text-xs text-dim">
          <span className="chip">voting {Math.round(config.voteDurationSec / 60)} min</span>
          <span className="chip">pool {Math.round(config.depositWindowSec / 60)} min</span>
          <span className="chip">fee {(config.feeBps / 100).toFixed(0)}% on launch only</span>
        </div>
      </div>
      <div className="grid gap-3 lg:min-h-0 lg:flex-1 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <CreateForm />
        <aside className="panel hidden min-h-0 flex-col 2xl:flex">
          <div className="panel-head">
            <span>Open ballots right now</span>
            <span className="num normal-case tracking-normal text-dim">{open.length}</span>
          </div>
          {open.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-dim">No open ballots. Yours would be the only one on the board.</p>
          ) : (
            <ul className="scroll-y min-h-0 flex-1 divide-y divide-line">
              {open.map((n) => (
                <li key={n.id}>
                  <Link href={`/n/${n.slug}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel-2">
                    <Coin image={n.image} ticker={n.ticker} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      <span className="num block text-[0.7rem] text-dim">{n.votes} votes</span>
                    </span>
                    <Countdown to={n.voteEndsAt} className="text-xs text-violet" done="tallying" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
