"use client";

import { useEffect, useState } from "react";
import { formatSol, formatTokens } from "@/lib/math";
import { FIELD_LABEL, type Field } from "@/lib/messages";
import type { ActivityItem } from "@/lib/views";
import { Who } from "./bits";

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STYLE: Record<ActivityItem["kind"], { tone: string; verb: string }> = {
  vote: { tone: "bg-violet", verb: "voted" },
  submit: { tone: "bg-info", verb: "suggested" },
  deposit: { tone: "bg-accent", verb: "joined with" },
  claim: { tone: "bg-warn", verb: "claimed" },
  refund: { tone: "bg-danger", verb: "refunded" },
};

/** Live feed of everything that happened on a narrative. */
export function Activity({ items, className = "" }: { items: ActivityItem[]; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      <div className="panel-head">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" /> Live activity
        </span>
        <span className="num normal-case tracking-normal text-dim">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-dim">Nothing yet. Be the first.</p>
      ) : (
        <ol className="scroll-y min-h-0 flex-1 divide-y divide-line/70">
          {items.map((a, i) => {
            const st = STYLE[a.kind];
            let what: React.ReactNode;
            if (a.kind === "vote" || a.kind === "submit") {
              const label = (FIELD_LABEL[a.field as Field] ?? a.field ?? "").toLowerCase();
              what =
                a.field === "image" ? (
                  <span className="text-dim">an image</span>
                ) : (
                  <>
                    <span className="font-medium text-ink">{a.field === "ticker" ? `$${a.value}` : a.value?.replace(/^https:\/\//, "")}</span>
                    <span className="text-dim"> · {label}</span>
                  </>
                );
            } else if (a.kind === "claim") {
              what = <span className="num font-medium text-ink">{formatTokens(BigInt(a.amount ?? "0"))} tokens</span>;
            } else {
              what = <span className="num font-medium text-ink">{formatSol(BigInt(a.amount ?? "0"))} SOL</span>;
            }
            return (
              <li key={`${a.at}-${i}`} className="flex items-start gap-2.5 px-4 py-2.5 text-[0.8rem]">
                <span className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${st.tone}`} />
                <div className="min-w-0 flex-1 leading-snug">
                  <Who address={a.wallet} size={16} className="max-w-full text-ink/85" />
                  <p className="mt-0.5 break-words text-muted">
                    {st.verb} {what}
                  </p>
                </div>
                <span className="num shrink-0 text-[0.7rem] text-dim">{now ? ago(a.at, now) : ""}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
