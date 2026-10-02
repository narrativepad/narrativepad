"use client";

import { useState } from "react";
import { canonicalJson, fromHex, lockHash, sha256Hex, uuidBytes } from "@/lib/math";
import type { NarrativeDetail } from "@/lib/views";

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
        canonicalJson({ narrativeId: n.id, chain: n.chain, metadata, votesRoot: l.votesRoot, winners: l.winners }),
      );
      const lh = lockHash(uuidBytes(n.id), l.name, l.symbol, l.metadataUri, fromHex(details));
      const ok = servedMatches && details === l.detailsHash && lh === l.lockHash;
      setResult({
        ok,
        detail: ok
          ? "Metadata, winners and vote root hash to the lock hash."
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
          These are frozen. The escrow can only ever launch a coin with exactly this name, ticker and metadata. Copies launched
          elsewhere are not the crowd&apos;s coin.
        </p>
        <dl className="divide-y divide-line">
          {row("Name", <span className="font-medium text-ink">{l.name}</span>)}
          {row("Ticker", <span className="num text-ink">${l.symbol}</span>)}
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
