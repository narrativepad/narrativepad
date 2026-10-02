"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, TeamBadge } from "@/components/bits";
import { Portal } from "@/components/Portal";
import { useToast } from "@/components/Providers";
import { useMine } from "@/lib/client/useMine";
import { useSigned } from "@/lib/client/useSigned";
import { entryLabel, FIELD_LABEL, FIELDS, LINK_FIELDS, REQUIRED_FIELDS, type Field } from "@/lib/messages";
import { displayName } from "@/lib/names";
import type { NarrativeDetail } from "@/lib/views";

const PLACEHOLDER: Record<Field, string> = {
  name: "Suggest a name",
  ticker: "Suggest a ticker",
  image: "",
  pair: "",
  x: "https://x.com/…",
  telegram: "https://t.me/…",
  website: "https://…",
};

type Entry = NarrativeDetail["ballots"][Field]["entries"][number];
const pctOf = (votes: number, total: number) => (total > 0 ? (votes / total) * 100 : 0);

/** All ballots as a responsive grid. Read-only (winners marked) once voting has ended. */
export function Ballots({ n, version }: { n: NarrativeDetail; version: string }) {
  const open = n.stage === "voting" && Date.parse(n.voteEndsAt) > Date.now();
  const { votes: myVotes } = useMine(n.id, version);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {FIELDS.map((f) => (
        <FieldBallot key={f} n={n} field={f} open={open} myVote={myVotes[f]} />
      ))}
    </div>
  );
}

function VoteButton({ open, mine, voted, busy, label, onVote }: { open: boolean; mine: boolean; voted: boolean; busy: boolean; label: string; onVote: () => void }) {
  if (!open) return null;
  return (
    <button
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
        mine ? "border-accent/50 bg-accent/10 text-accent" : "border-white/10 bg-white/[0.05] text-ink hover:border-accent/50 hover:text-accent disabled:opacity-40"
      }`}
      disabled={voted || busy}
      onClick={onVote}
      aria-label={`Vote for ${label}`}
    >
      {mine ? "Voted" : busy ? "…" : "Vote"}
    </button>
  );
}

function FieldBallot({ n, field, open, myVote }: { n: NarrativeDetail; field: (typeof FIELDS)[number]; open: boolean; myVote?: string }) {
  const b = n.ballots[field];
  const { run, busy } = useSigned();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voted = Boolean(myVote);
  const leaderWord = open ? "Leading" : "Won";

  const vote = (submissionId: string) =>
    run(`vote:${submissionId}`, `/api/narratives/${n.id}/vote`, "vote", { narrativeId: n.id, field, submissionId }, "Vote counted");

  async function submit(v: string) {
    const out = await run(`submit:${field}`, `/api/narratives/${n.id}/submit`, "submit", { narrativeId: n.id, field, value: v }, "Entry added");
    if (out) setValue("");
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      await submit(data.path);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const voteButton = (e: Entry, label: string) => (
    <VoteButton open={open} mine={myVote === e.id} voted={voted} busy={busy !== null} label={label} onVote={() => vote(e.id)} />
  );

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="flex items-center gap-1.5">
          {FIELD_LABEL[field]}
          {REQUIRED_FIELDS.includes(field) && <span className="text-danger">*</span>}
        </span>
        <span className="num">
          {b.entries.length} entr{b.entries.length === 1 ? "y" : "ies"} · {b.total} vote{b.total === 1 ? "" : "s"}
        </span>
      </div>

      {b.entries.length === 0 ? (
        <p className="flex-1 px-5 py-5 text-sm text-dim">{open ? "No entries yet. Add the first one." : "No entries."}</p>
      ) : field === "image" ? (
        <ul className="grid flex-1 grid-cols-3 gap-2 p-3 sm:grid-cols-4 md:grid-cols-3">
          {b.entries.map((e, i) => {
            const lead = e.id === b.leaderId;
            const mine = myVote === e.id;
            return (
              <li key={e.id} className={`relative overflow-hidden rounded-xl border ${mine ? "border-accent" : lead ? "border-accent/50" : "border-white/[0.07]"} bg-white/[0.03]`}>
                <button type="button" className="group block w-full" onClick={() => setZoom(i)} aria-label="Enlarge image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={e.value} alt="" className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                </button>
                {(lead || mine) && (
                  <span className={`absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[0.6rem] font-bold ${mine ? "bg-white text-black" : "bg-accent text-accent-ink"}`}>
                    {mine ? "Your vote" : leaderWord}
                  </span>
                )}
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="num text-xs">
                    <b className="font-semibold">{e.votes}</b> <span className="text-dim">{pctOf(e.votes, b.total).toFixed(0)}%</span>
                  </span>
                  {voteButton(e, "this image")}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="scroll-y max-h-[19rem] flex-1 space-y-1 p-2">
          {b.entries.map((e) => {
            const lead = e.id === b.leaderId;
            const mine = myVote === e.id;
            const pct = pctOf(e.votes, b.total);
            const isLink = (LINK_FIELDS as readonly string[]).includes(field);
            return (
              <li key={e.id} className={`relative overflow-hidden rounded-xl px-3 py-2 ${mine ? "ring-1 ring-inset ring-accent/40" : ""}`}>
                <div
                  className={`absolute inset-y-0 left-0 ${lead ? "bg-accent/[0.12]" : "bg-white/[0.04]"} transition-[width] duration-700 ease-out`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    {isLink ? (
                      <a href={e.value} target="_blank" rel="noopener noreferrer nofollow" className="block truncate text-sm text-info hover:underline">
                        {e.value.replace(/^https:\/\//, "")}
                      </a>
                    ) : (
                      <span className={`block truncate text-sm font-medium ${field === "ticker" ? "num" : ""}`}>
                        {entryLabel(field, e.value).title}
                      </span>
                    )}
                    <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] text-dim" title={e.submitter}>
                      <span className="truncate">by {displayName(e.submitter)}</span> {e.isTeam && <TeamBadge />}
                      {lead && <span className="shrink-0 font-semibold text-accent">· {leaderWord}</span>}
                      {mine && <span className="shrink-0 font-semibold text-ink">· Your vote</span>}
                    </span>
                  </div>
                  <span className="num w-16 text-right">
                    <span className="block text-sm font-semibold leading-tight">{e.votes}</span>
                    <span className="block text-[0.68rem] text-dim">{pct.toFixed(0)}%</span>
                  </span>
                  {voteButton(e, entryLabel(field, e.value).title)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="border-t border-white/[0.06] p-2.5">
          {field === "image" ? (
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <button className="btn h-8 py-0 text-xs" disabled={uploading || busy !== null} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload image"}
              </button>
              <span className="text-[0.7rem] leading-tight text-dim">PNG, JPEG, WebP or GIF up to 1 MB.</span>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim()) submit(value.trim());
              }}
            >
              <input
                className={`input h-9 py-0 text-[0.82rem] ${field === "ticker" ? "num uppercase" : ""}`}
                placeholder={PLACEHOLDER[field]}
                maxLength={field === "name" ? 32 : field === "ticker" ? 11 : 300}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={`New ${FIELD_LABEL[field]} entry`}
              />
              <button className="btn h-9 shrink-0 py-0 text-xs" disabled={!value.trim() || busy !== null}>
                {busy === `submit:${field}` ? "…" : "Add"}
              </button>
            </form>
          )}
        </div>
      )}

      {zoom !== null && field === "image" && (
        <Lightbox
          entries={b.entries}
          index={zoom}
          total={b.total}
          leaderId={b.leaderId}
          myVote={myVote}
          onIndex={setZoom}
          onClose={() => setZoom(null)}
          vote={(e) => voteButton(e, "this image")}
        />
      )}
    </section>
  );
}

function Lightbox({
  entries,
  index,
  total,
  leaderId,
  myVote,
  onIndex,
  onClose,
  vote,
}: {
  entries: Entry[];
  index: number;
  total: number;
  leaderId: string | null;
  myVote?: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  vote: (e: Entry) => React.ReactNode;
}) {
  const e = entries[index];
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowRight") onIndex((index + 1) % entries.length);
      if (ev.key === "ArrowLeft") onIndex((index - 1 + entries.length) % entries.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, entries.length, onClose, onIndex]);
  if (!e) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image entry">
        <div className="relative w-full max-w-lg" onClick={(ev) => ev.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.value} alt="" className="aspect-square w-full rounded-3xl object-cover shadow-[0_40px_120px_-20px_rgb(0_0_0/0.95)]" />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="num font-semibold">{e.votes}</span> <span className="text-muted">votes · {pctOf(e.votes, total).toFixed(0)}%</span>
              {e.id === leaderId && <span className="ml-2 font-semibold text-accent">Leading</span>}
              {e.id === myVote && <span className="ml-2 font-semibold text-ink">Your vote</span>}
              <div className="text-xs text-dim">by {displayName(e.submitter)}</div>
            </div>
            <div className="flex items-center gap-2">
              {vote(e)}
              {entries.length > 1 && (
                <>
                  <button className="btn h-9 w-9 px-0" onClick={() => onIndex((index - 1 + entries.length) % entries.length)} aria-label="Previous image">
                    <Icon name="chevron" className="h-4 w-4 rotate-180" />
                  </button>
                  <button className="btn h-9 w-9 px-0" onClick={() => onIndex((index + 1) % entries.length)} aria-label="Next image">
                    <Icon name="chevron" className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
          <button className="btn absolute -right-2 -top-2 h-9 w-9 px-0 sm:-right-12 sm:top-0" onClick={onClose} aria-label="Close">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Portal>
  );
}
