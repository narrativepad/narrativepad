"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { setAlertsMuted, useAlertsMuted } from "@/lib/client/local";
import { useIdentity } from "@/lib/client/useSigned";
import { displayName } from "@/lib/names";
import { SOL_UNIT, withUnit, type Unit } from "@/lib/units";
import type { NarrativeCard } from "@/lib/views";
import { Avatar, Coin } from "./bits";

type Meta = Pick<NarrativeCard, "slug" | "title" | "ticker" | "image"> & { unit: Unit };
type Alert = { id: number; meta: Meta; wallet?: string; text: React.ReactNode };

const KINDS = new Set(["deposit", "created", "launched"]);

/** Pop-ups for what other people are doing right now: new coins, deposits, launches. */
export function LiveAlerts() {
  const muted = useAlertsMuted();
  const { address } = useIdentity();
  const me = useRef<string | null>(null);
  me.current = address;
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (muted) return;
    const known = new Map<string, Meta>();
    let loading: Promise<void> | null = null;
    const load = () =>
      (loading ??= fetch("/api/narratives")
        .then((r) => r.json())
        .then((d: { narratives: NarrativeCard[] }) => {
          for (const n of d.narratives) known.set(n.id, { slug: n.slug, title: n.title, ticker: n.ticker, image: n.image, unit: n.escrow?.unit ?? SOL_UNIT });
        })
        .catch(() => {})
        .finally(() => {
          loading = null;
        }));

    const es = new EventSource("/api/stream");
    es.onmessage = async (e) => {
      let ev: { narrativeId: string; kind: string; wallet?: string; amount?: string };
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!KINDS.has(ev.kind) || (ev.wallet && ev.wallet === me.current)) return;
      if (!known.has(ev.narrativeId) || ev.kind === "created") await load();
      const meta = known.get(ev.narrativeId);
      if (!meta) return;
      const coin = meta.ticker ? `$${meta.ticker}` : meta.title;
      const text =
        ev.kind === "deposit" ? (
          <>
            joined <b className="font-semibold text-ink">{coin}</b>
            {/* On-chain deposits arrive through sync without an amount. */}
            {ev.amount && (
              <>
                {" "}
                with <b className="num font-semibold text-accent">{withUnit(ev.amount, meta.unit)}</b>
              </>
            )}
          </>
        ) : ev.kind === "created" ? (
          <>
            started a new narrative: <b className="font-semibold text-ink">{meta.title}</b>
          </>
        ) : (
          <>
            <b className="font-semibold text-ink">{coin}</b> just launched. The whole pool bought in together.
          </>
        );
      const id = Date.now() + Math.random();
      setAlerts((a) => [...a.slice(-2), { id, meta, wallet: ev.wallet, text }]);
      setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== id)), 6500);
    };
    return () => es.close();
  }, [muted]);

  if (muted || alerts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-4 z-50 hidden w-[22rem] flex-col gap-2 sm:flex" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.id} className="pointer-events-auto animate-rise rounded-2xl border border-white/10 bg-[#0f1114]/95 p-3 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl">
          <Link href={`/n/${a.meta.slug}`} className="flex items-center gap-3">
            <Coin image={a.meta.image} ticker={a.meta.ticker} size={36} />
            <p className="min-w-0 flex-1 text-[0.8rem] leading-snug text-muted">
              {a.wallet && (
                <span className="mr-1 inline-flex items-center gap-1 align-[-3px]">
                  <Avatar address={a.wallet} size={14} />
                  <span className="text-ink/90">{displayName(a.wallet)}</span>
                </span>
              )}
              {a.text}
            </p>
          </Link>
          <button className="mt-1.5 text-[0.7rem] text-dim hover:text-ink" onClick={() => setAlertsMuted(true)}>
            Mute live alerts
          </button>
        </div>
      ))}
    </div>
  );
}
