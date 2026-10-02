"use client";

import { useState } from "react";
import { short } from "@/components/bits";
import { PairLogo } from "@/components/Pair";
import { canonicalJson, fromHex, lockHash, sha256Hex, uuidBytes } from "@/lib/math";
import { entryLabel, FEE_MODE } from "@/lib/messages";
import type { NarrativeDetail } from "@/lib/views";

/** The locked pair with its logo, and the exact mint the pool holds on this chain. */
function PairRow({ n, pair, mint }: { n: NarrativeDetail; pair: string; mint?: string | null }) {
  const p = n.pair?.symbol === pair ? n.pair : null;
  return (
    <span className="flex items-center gap-2.5">
      {p ? <PairLogo pair={p} size={28} /> : null}
      <span className="min-w-0">
        <span className="num block font-semibold text-ink">{pair}</span>
        <span className="block text-dim">
          {p && p.name !== pair ? `${p.name}${p.kind === "stock" ? " stock" : ""}` : entryLabel("pair", pair).sub}
          {mint && <span className="mono"> · {short(mint, 4)}</span>}
        </span>
      </span>
    </span>
  );
}

/** Not part of the lock: the pool decides holder rewards with its deposits (D-019). */
function FeeRow({ n }: { n: NarrativeDetail }) {
  const e = n.escrow;
  if (e?.holderRewards != null) {
    const m = FEE_MODE[e.holderRewards ? "on" : "off"];
    // The escrow applies the vote at launch (D-022), unless pump has holder rewards switched off.
    const votedOnButOff = !e.holderRewards && BigInt(e.holderVotesOn) > BigInt(e.holderVotesOff);
    return (
      <span>
        <span className="text-ink">{m.title}</span>
        <span className="block text-dim">
          {votedOnButOff
            ? "The pool voted on, but pump.fun had holder rewards switched off (as on devnet), so the escrow launched with them off."
            : `${m.sub}. Voted by the pool${n.preview ? "" : ", applied on-chain by the escrow"}.`}
        </span>
      </span>
    );
  }
  return (
    <span>
      <span className="text-ink">Voted by the pool</span>
      <span className="block text-dim">Everyone who joins votes holder rewards on or off, weighted by what they put in.</span>
    </span>
  );
}

/** Shows the locked metadata and recomputes both hashes in the browser, no trust in our server needed. */
export function LockPanel({ n }: { n: NarrativeDetail }) {
  const l = n.lock!;
  const [result, setResult] = useState<null | { ok: boolean; detail: string }>(null);

  async function verify() {
    try {
      const res = await fetch(l.metadataUri);
      const text = await res.text();
      const metadata = JSON.parse(text);
      const servedMatches = canonicalJson(metadata) === l.metadataJson;
      const details = sha256Hex(
        canonicalJson({ narrativeId: n.id, chain: n.chain, metadata, votesRoot: l.votesRoot, winners: l.winners, launch: l.launch ?? undefined }),
      );
      const lh = lockHash(uuidBytes(n.id), l.name, l.symbol, l.metadataUri, fromHex(details));
      const ok = servedMatches && details === l.detailsHash && lh === l.lockHash;
      setResult({
        ok,
        detail: ok
          ? "Metadata, launch settings, winners and vote root hash to the lock hash."
          : `Mismatch: served metadata ${servedMatches ? "ok" : "differs"}, details ${details === l.detailsHash ? "ok" : "differs"}, lock ${lh === l.lockHash ? "ok" : "differs"}`,
      });
    } catch (e) {
      setResult({ ok: false, detail: e instanceof Error ? e.message : "Verification failed" });
    }
  }

  const row = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1.5 text-xs">
      <dt className="text-dim">{k}</dt>
      <dd className="min-w-0 break-all">{v}</dd>
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Locked metadata</span>
        <span className="chip border-accent/40 text-accent">official</span>
      </div>
      <div className="p-4">
        <p className="mb-3 text-sm text-muted">
          These are frozen. The escrow can only ever launch a coin with exactly this name, ticker, metadata and launch settings.
          Copies launched elsewhere are not the crowd&apos;s coin.
        </p>
        <dl className="divide-y divide-line">
          {row("Name", <span className="font-medium text-ink">{l.name}</span>)}
          {row("Ticker", <span className="num text-ink">${l.symbol}</span>)}
          {l.launch && row("Launches on", <span className="text-ink">{l.launch.venue}</span>)}
          {l.launch && row("Pair", <PairRow n={n} pair={l.launch.pair} mint={l.launch.pairMint} />)}
          {l.launch && !l.launch.fees && row("Creator fees", <FeeRow n={n} />)}
          {l.links.twitter && row("X", <a className="text-info hover:underline" href={l.links.twitter} target="_blank" rel="noopener noreferrer nofollow">{l.links.twitter}</a>)}
          {l.links.telegram && row("Telegram", <a className="text-info hover:underline" href={l.links.telegram} target="_blank" rel="noopener noreferrer nofollow">{l.links.telegram}</a>)}
          {l.links.website && row("Website", <a className="text-info hover:underline" href={l.links.website} target="_blank" rel="noopener noreferrer nofollow">{l.links.website}</a>)}
          {row("Metadata", <a className="mono text-info hover:underline" href={l.metadataUri} target="_blank" rel="noopener noreferrer">{l.metadataUri}</a>)}
          {row("Lock hash", <span className="mono text-ink">{l.lockHash}</span>)}
          {row("Votes root", <span className="mono text-muted">{l.votesRoot}</span>)}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn" onClick={verify}>
            Verify in browser
          </button>
          <a className="btn" href={`/api/narratives/${n.id}/votes`} target="_blank" rel="noopener noreferrer">
            Download signed votes
          </a>
        </div>
        {result && <p className={`mt-2 text-xs ${result.ok ? "text-accent" : "text-danger"}`}>{result.ok ? "✓ " : "✗ "}{result.detail}</p>}
      </div>
    </section>
  );
}
