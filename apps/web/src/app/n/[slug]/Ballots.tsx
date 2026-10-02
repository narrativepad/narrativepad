"use client";

import { useRef, useState } from "react";
import { TeamBadge } from "@/components/bits";
import { displayName } from "@/lib/names";
import { useToast } from "@/components/Providers";
import { useMine } from "@/lib/client/useMine";
import { useSigned } from "@/lib/client/useSigned";
import { FIELD_LABEL, FIELDS, REQUIRED_FIELDS, type Field } from "@/lib/messages";
import type { NarrativeDetail } from "@/lib/views";

const PLACEHOLDER: Record<Field, string> = {
  name: "Suggest a name",
  ticker: "Suggest a ticker",
  image: "",
  x: "https://x.com/…",
  telegram: "https://t.me/…",
  website: "https://…",
};

/** All six ballots as a responsive grid. Read-only (winners marked) once voting has ended. */
export function Ballots({ n, version }: { n: NarrativeDetail; version: string }) {
  const open = n.stage === "voting" && Date.parse(n.voteEndsAt) > Date.now();
  const { votes: myVotes } = useMine(n.id, version);
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {FIELDS.map((f) => (
        <FieldBallot key={f} n={n} field={f} open={open} myVote={myVotes[f]} />
      ))}
    </div>
  );
}

function FieldBallot({ n, field, open, myVote }: { n: NarrativeDetail; field: Field; open: boolean; myVote?: string }) {
  const b = n.ballots[field];
  const { run, busy } = useSigned();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const max = Math.max(1, ...b.entries.map((e) => e.votes));
  const voted = Boolean(myVote);
  const leaderWord = open ? "LEADING" : "WON";

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

  const voteButton = (id: string, label: string) =>
    open && (
      <button
        className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
          myVote === id
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-line-2 bg-panel-3 text-ink hover:border-accent/50 hover:text-accent disabled:opacity-40"
        }`}
        disabled={voted || busy !== null}
        onClick={() => vote(id)}
        aria-label={`Vote for ${label}`}
      >
        {myVote === id ? "Voted" : busy === `vote:${id}` ? "…" : "Vote"}
      </button>
    );

  return (
    <section className="panel flex flex-col">
      <div className="panel-head">
        <span className="flex items-center gap-1.5">
          {FIELD_LABEL[field]}
          {REQUIRED_FIELDS.includes(field) && <span className="text-danger">*</span>}
        </span>
        <span className="num normal-case tracking-normal">
          {b.entries.length} entr{b.entries.length === 1 ? "y" : "ies"} · {b.total} vote{b.total === 1 ? "" : "s"}
        </span>
      </div>

      {b.entries.length === 0 ? (
        <p className="flex-1 px-4 py-5 text-sm text-dim">{open ? "No entries yet. Add the first one." : "No entries."}</p>
      ) : field === "image" ? (
        <ul className="grid flex-1 grid-cols-3 gap-2 p-3 sm:grid-cols-4 md:grid-cols-3">
          {b.entries.map((e) => {
            const lead = e.id === b.leaderId;
            return (
              <li key={e.id} className={`relative overflow-hidden rounded-lg border ${lead ? "border-accent/60" : "border-line"} bg-panel-2`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.value} alt="" className="aspect-square w-full object-cover" />
                {lead && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[0.6rem] font-bold text-accent-ink">{leaderWord}</span>
                )}
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="num text-xs font-semibold">{e.votes}</span>
                  {voteButton(e.id, "this image")}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="scroll-y max-h-[19rem] flex-1 divide-y divide-line">
          {b.entries.map((e) => {
            const lead = e.id === b.leaderId;
            const isLink = field === "x" || field === "telegram" || field === "website";
            return (
              <li key={e.id} className="relative px-3 py-2">
                <div
                  className={`absolute inset-y-1 left-1 rounded-md ${lead ? "bg-accent/10" : "bg-panel-3/70"} transition-[width] duration-500`}
                  style={{ width: `calc(${(e.votes / max) * 100}% - 8px)` }}
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
                        {field === "ticker" ? `$${e.value}` : e.value}
                      </span>
                    )}
                    <span className="flex min-w-0 items-center gap-1.5 text-[0.7rem] text-dim" title={e.submitter}>
                      <span className="truncate">by {displayName(e.submitter)}</span> {e.isTeam && <TeamBadge />}
                      {lead && <span className="shrink-0 font-semibold text-accent">· {leaderWord}</span>}
                    </span>
                  </div>
                  <span className="num w-7 text-right text-sm font-semibold">{e.votes}</span>
                  {voteButton(e.id, e.value)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="border-t border-line p-2.5">
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
                {uploading ? "Uploading…" : "Upload image"}
              </button>
              <span className="text-[0.7rem] leading-tight text-dim">PNG, JPEG, WebP or GIF up to 1 MB. Content-addressed.</span>
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
                className={`input h-8 py-0 text-[0.82rem] ${field === "ticker" ? "num uppercase" : ""}`}
                placeholder={PLACEHOLDER[field]}
                maxLength={field === "name" ? 32 : field === "ticker" ? 11 : 300}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={`New ${FIELD_LABEL[field]} entry`}
              />
              <button className="btn h-8 shrink-0 py-0 text-xs" disabled={!value.trim() || busy !== null}>
                {busy === `submit:${field}` ? "…" : "Add"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
