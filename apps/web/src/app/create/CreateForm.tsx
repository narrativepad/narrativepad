"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Coin, Icon, Logo, StageBadge } from "@/components/bits";
import { CoinCard } from "@/components/CoinCard";
import { usePublicConfig, useToast } from "@/components/Providers";
import { useSigned } from "@/lib/client/useSigned";

const TIPS: [string, string][] = [
  ["Be specific", "“A cat that refuses to leave the moon” beats “a space coin”."],
  ["Add the source", "The tweet, clip or article the narrative comes from."],
  ["Suggest, don't decide", "Your name, ticker and picture are the first ballot entries. The crowd votes on them and on the pair."],
  ["Keep it original", "Impersonating real brands or people is blocked."],
];

export function CreateForm() {
  const router = useRouter();
  const cfg = usePublicConfig();
  const toast = useToast();
  const { run, busy } = useSigned();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pitch, setPitch] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  // The preview card counts down from the full voting window, as the real one will.
  const [previewEnds] = useState(() => new Date(Date.now() + cfg.voteDurationSec * 1000).toISOString());

  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const sourceOk = !sourceUrl || /^https:\/\/\S+\.\S+/.test(sourceUrl);
  const valid = pitch.trim().length >= 10 && pitch.length <= 280 && sourceOk && !uploading;
  const title = name.trim() || "Untitled narrative";

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setImage(data.path);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const out = await run("create", "/api/narratives", "create", {
      pitch: pitch.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
      name: name.trim() || undefined,
      ticker: cleanTicker || undefined,
      image: image ?? undefined,
    });
    if (out?.slug) router.push(`/n/${out.slug}`);
  }

  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:items-start">
      <form onSubmit={submit} className="panel flex min-h-0 flex-col">
        <div className="panel-head">
          <span className="flex items-center gap-2">
            <Icon name="spark" className="h-3.5 w-3.5" /> New narrative
          </span>
        </div>
        <div className="scroll-y flex flex-1 flex-col gap-5 p-5">
          <div className="grid gap-5 md:grid-cols-[11rem_minmax(0,1fr)]">
            <div>
              <span className="label">Picture</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(ev) => ev.target.files?.[0] && upload(ev.target.files[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(ev) => {
                  ev.preventDefault();
                  setDrag(false);
                  const f = ev.dataTransfer.files?.[0];
                  if (f) upload(f);
                }}
                className={`group relative mt-1.5 flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed text-center transition-colors ${
                  drag ? "border-accent bg-accent/10" : "border-line-2 bg-bg/60 hover:border-accent/50"
                }`}
              >
                {image ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute inset-x-2 bottom-2 rounded-lg bg-black/60 px-2 py-1 text-[0.7rem] text-ink opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                      Change picture
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] text-accent">
                      <Icon name={uploading ? "clock" : "upload"} className="h-5 w-5" />
                    </span>
                    <span className="px-3 text-[0.75rem] leading-snug text-muted">{uploading ? "Uploading…" : "Drop an image or click to upload"}</span>
                    <span className="text-[0.65rem] text-dim">PNG · JPG · WebP · GIF · 1 MB</span>
                  </>
                )}
              </button>
              {image && (
                <button type="button" className="mt-1.5 text-[0.72rem] text-dim hover:text-danger" onClick={() => setImage(null)}>
                  Remove
                </button>
              )}
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="flex items-baseline justify-between">
                <label htmlFor="pitch" className="label">
                  Pitch
                </label>
                <span className={`num text-xs ${pitch.length > 260 ? "text-warn" : "text-dim"}`}>{pitch.length}/280</span>
              </div>
              <textarea
                id="pitch"
                className="input mt-1.5 h-[11rem] resize-none text-[1rem] leading-relaxed"
                placeholder="What's the narrative? Why does it deserve a coin right now?"
                maxLength={280}
                value={pitch}
                onChange={(ev) => setPitch(ev.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="label">
                Name
              </label>
              <input id="name" className="input mt-1.5" maxLength={32} placeholder="Moon Kitty" value={name} onChange={(ev) => setName(ev.target.value)} />
            </div>
            <div>
              <label htmlFor="ticker" className="label">
                Ticker
              </label>
              <div className="relative mt-1.5">
                <span className="num pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim">$</span>
                <input id="ticker" className="input num pl-7 uppercase" maxLength={11} placeholder="MKITTY" value={ticker} onChange={(ev) => setTicker(ev.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="source" className="label">
                Source link
              </label>
              <input
                id="source"
                className={`input mt-1.5 ${sourceOk ? "" : "border-danger/60"}`}
                placeholder="https://… tweet, clip or article"
                inputMode="url"
                value={sourceUrl}
                onChange={(ev) => setSourceUrl(ev.target.value)}
              />
            </div>
            <div>
              <span className="label">Launch</span>
              <div className="mt-1.5 flex h-[2.85rem] items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3.5 text-[0.82rem] text-muted">
                <span className="font-medium text-ink">pump.fun</span>
                <span className="truncate">· the crowd picks the pair: SOL, a coin or a stock</span>
              </div>
            </div>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {TIPS.map(([t, d]) => (
              <li key={t} className="rounded-xl border border-line bg-white/[0.02] px-3.5 py-3">
                <div className="text-sm font-medium">{t}</div>
                <div className="mt-0.5 text-[0.78rem] leading-snug text-muted">{d}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-xs text-dim">Voting opens right away and runs for {Math.round(cfg.voteDurationSec / 60)} minute{Math.round(cfg.voteDurationSec / 60) === 1 ? "" : "s"}.</p>
          <button type="submit" className="btn-primary px-5 py-2.5" disabled={!valid || busy !== null}>
            {busy ? "Starting…" : "Start narrative"}
          </button>
        </div>
      </form>

      <div className="flex min-h-0 flex-col gap-3">
        <section className="panel">
          <div className="panel-head"><span>On the board</span></div>
          <div className="p-4">
            <CoinCard
              n={{
                id: "preview",
                slug: "preview",
                pitch: pitch || "Your pitch shows up here.",
                stage: "voting",
                title,
                ticker: cleanTicker || null,
                image,
                pair: null,
                createdAt: previewEnds,
                voteEndsAt: previewEnds,
                creator: "",
                votes: 0,
                escrow: null,
                flow: null,
                comments: 0,
                trend: { votes: 0, comments: 0, deposits: 0, lamports: "0", score: 0 },
              }}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><span>Share card</span></div>
          <div className="p-3">
            <div className="relative flex aspect-[1200/630] flex-col justify-between overflow-hidden rounded-xl border border-line bg-bg p-[4.5%]">
              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="pointer-events-none absolute -right-10 -top-10 h-3/4 opacity-25 blur-2xl" />
              )}
              <div className="relative flex items-center gap-2 text-[0.7rem] text-muted">
                <Logo size={18} />
                narrativepad
                <span className="ml-auto">
                  <StageBadge stage="voting" />
                </span>
              </div>
              <div className="relative flex items-center gap-3">
                <Coin image={image} ticker={cleanTicker || null} size={56} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-2xl font-semibold tracking-tight">{title}</span>
                    {cleanTicker && <span className="num text-sm text-muted">${cleanTicker}</span>}
                  </div>
                  <p className="line-clamp-2 break-words text-xs text-muted">{pitch || "Your pitch"}</p>
                </div>
              </div>
              <div className="relative flex justify-between text-[0.7rem] text-muted">
                <span>0 votes</span>
                <span className="text-gradient font-medium">the crowd builds the coin</span>
              </div>
            </div>
          </div>
        </section>

        <section className="panel flex min-h-0 flex-1 flex-col">
          <div className="panel-head"><span>What happens next</span></div>
          <ol className="scroll-y relative min-h-0 flex-1 space-y-4 p-4 pl-5">
            <span className="absolute bottom-6 left-[1.6rem] top-6 w-px bg-line-2" aria-hidden />
            {(
              [
                ["Voting", `${Math.round(cfg.voteDurationSec / 60)} min. Anyone can add entries and vote, one vote per person per field.`, "bg-violet"],
                ["Lock", "The winning name, ticker, picture and pair are frozen and hashed.", "bg-accent"],
                ["Pool", `${Math.round(cfg.depositWindowSec / 60)} min public pool. Same price for everyone who joins, and their SOL votes holder rewards on or off.`, "bg-info"],
                ["Launch", "The coin is created and the whole pool buys in, in one transaction.", "bg-gold"],
                ["Release", `Tokens unlock to everyone in ${cfg.trancheCount} equal tranches.`, "bg-accent"],
              ] as const
            ).map(([t, d, c]) => (
              <li key={t} className="relative flex gap-3">
                <span className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-panel ${c}`} />
                <div>
                  <div className="text-sm font-medium">{t}</div>
                  <div className="text-[0.8rem] leading-snug text-muted">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
