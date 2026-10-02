"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon, TeamBadge, Who } from "@/components/bits";
import { Portal } from "@/components/Portal";
import { useIdentity, useSigned } from "@/lib/client/useSigned";
import { COMMENT_MAX_CHARS, COMMENT_MAX_WORDS, countWords, normaliseComment } from "@/lib/messages";
import type { CommentView } from "@/lib/views";
import { ReportButton } from "./ReportButton";

// Live chat for one coin (D-016). One provider per page holds the messages, listens on the
// narrative's event stream (which also counts who is here) and fetches only new messages, so
// the tab and the floating dock always show the same thing without reloading the page.

interface ChatState {
  narrativeId: string;
  title: string;
  comments: CommentView[];
  here: number | null;
  unread: number;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  send: (raw: string) => Promise<boolean>;
  sending: boolean;
  /** Rooms report whether they are on screen; unread only counts while none is. */
  setViewing: (key: string, visible: boolean) => void;
}

const ChatContext = createContext<ChatState | null>(null);
const useChat = () => {
  const c = useContext(ChatContext);
  if (!c) throw new Error("ChatProvider missing");
  return c;
};

const byTime = (a: CommentView, b: CommentView) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

export function ChatProvider({ narrativeId, title, initial, children }: { narrativeId: string; title: string; initial: CommentView[]; children: React.ReactNode }) {
  const { run, busy } = useSigned();
  const { address } = useIdentity();
  const me = useRef(address);
  me.current = address;
  const [comments, setComments] = useState(initial);
  const list = useRef(initial);
  const latest = useRef(initial.at(-1)?.at ?? "");
  const [here, setHere] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [dockOpen, setDockOpenState] = useState(false);
  const viewing = useRef(new Set<string>());

  const commit = useCallback((next: CommentView[]) => {
    list.current = next;
    if (next.length) latest.current = next[next.length - 1].at;
    setComments(next);
  }, []);

  const merge = useCallback(
    (incoming: CommentView[]) => {
      const known = new Set(list.current.map((c) => c.id));
      const fresh = incoming.filter((c) => !known.has(c.id));
      if (fresh.length === 0) return;
      commit([...list.current, ...fresh].sort(byTime).slice(-300));
      const fromOthers = fresh.filter((c) => c.wallet !== me.current).length;
      if (fromOthers && viewing.current.size === 0) setUnread((u) => u + fromOthers);
    },
    [commit],
  );

  // A server re-render is the source of truth (reported messages drop out); keep anything newer.
  useEffect(() => {
    const last = initial.at(-1)?.at ?? "";
    const ids = new Set(initial.map((c) => c.id));
    commit([...initial, ...list.current.filter((c) => c.at > last && !ids.has(c.id))]);
  }, [initial, commit]);

  const pulling = useRef(false);
  const again = useRef(false);
  const pull = useCallback(async () => {
    if (pulling.current) {
      again.current = true;
      return;
    }
    pulling.current = true;
    try {
      const after = latest.current ? `?after=${encodeURIComponent(latest.current)}` : "";
      const res = await fetch(`/api/narratives/${narrativeId}/comments${after}`);
      if (res.ok) merge((await res.json()).comments ?? []);
    } catch {
      // Offline for a moment; the next event or reconnect catches up.
    } finally {
      pulling.current = false;
      if (again.current) {
        again.current = false;
        pull();
      }
    }
  }, [narrativeId, merge]);

  useEffect(() => {
    const es = new EventSource(`/api/stream?n=${narrativeId}&presence=1`);
    es.onmessage = (e) => {
      let ev: { kind?: string; count?: number };
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.kind === "presence") setHere(ev.count ?? null);
      else if (ev.kind === "comment" || ev.kind === "hello") pull(); // hello = (re)connected: catch up
    };
    return () => es.close();
  }, [narrativeId, pull]);

  const setViewing = useCallback((key: string, visible: boolean) => {
    if (visible) {
      viewing.current.add(key);
      setUnread(0);
    } else viewing.current.delete(key);
  }, []);

  // Opening the dock reads everything at once (don't wait for the visibility observer).
  const setDockOpen = useCallback((open: boolean) => {
    setDockOpenState(open);
    if (open) setUnread(0);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const body = normaliseComment(raw);
      if (!body) return false;
      const out = await run("comment", `/api/narratives/${narrativeId}/comments`, "comment", { narrativeId, body });
      if (!out) return false;
      pull();
      return true;
    },
    [run, narrativeId, pull],
  );

  return (
    <ChatContext.Provider value={{ narrativeId, title, comments, here, unread, dockOpen, setDockOpen, send, sending: busy === "comment", setViewing }}>
      {children}
    </ChatContext.Provider>
  );
}

/** Message count for the tab label. */
export function ChatCount() {
  return <>{useChat().comments.length}</>;
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`rounded-full px-1.5 py-px text-[0.62rem] font-semibold ${tone}`}>{children}</span>;
}

function Here({ count }: { count: number | null }) {
  if (count === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-dim">
      <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />
      <span className="num">{count}</span> here now
    </span>
  );
}

/** Message list + composer. `tab` sits in the page; `dock` fills the floating panel. */
export function ChatRoom({ variant }: { variant: "tab" | "dock" }) {
  const { comments, here, send, sending, setViewing } = useChat();
  const { address } = useIdentity();
  const [text, setText] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Unread counting pauses while this room is actually on screen.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const key = `${variant}-${Math.random()}`;
    const io = new IntersectionObserver(([e]) => setViewing(key, e.isIntersecting && document.visibilityState === "visible"));
    io.observe(el);
    return () => {
      io.disconnect();
      setViewing(key, false);
    };
  }, [variant, setViewing]);

  // Follow new messages when the reader is at the bottom (or wrote them); otherwise offer a jump.
  useEffect(() => {
    const el = box.current;
    if (!el || comments.length === seen.current) return;
    const first = seen.current === 0;
    seen.current = comments.length;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    const mine = comments[comments.length - 1]?.wallet === address;
    if (first || nearBottom || mine) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(false);
    } else setNewBelow(true);
  }, [comments, address]);

  const words = countWords(text);
  const over = words > COMMENT_MAX_WORDS;
  const lines = Math.min(6, Math.max(variant === "tab" ? 2 : 1, text.split("\n").length));

  async function submit() {
    if (!text.trim() || over || sending) return;
    if (await send(text)) setText("");
  }

  return (
    <div className={`flex min-h-0 flex-col ${variant === "tab" ? "panel overflow-hidden" : "h-full"}`}>
      {variant === "tab" && (
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <span className="flex items-center gap-2 text-[0.9rem] font-semibold">
            <Icon name="chat" className="h-4 w-4 text-accent" /> Live chat
          </span>
          <Here count={here} />
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) setNewBelow(false);
          }}
          className={`flex flex-col overflow-y-auto overscroll-contain px-2 py-3 ${variant === "tab" ? "h-[30rem]" : "h-full"}`}
          role="log"
          aria-live="polite"
          aria-label="Chat messages"
        >
          {comments.length === 0 && (
            <div className="m-auto flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="glass flex h-11 w-11 items-center justify-center rounded-xl text-accent">
                <Icon name="chat" className="h-5 w-5" />
              </span>
              <p className="font-medium">Start the conversation</p>
              <p className="max-w-xs text-sm text-dim">Coordinate here: which entry to back, when to join the pool, why this narrative deserves a coin.</p>
            </div>
          )}
          {comments.map((c, i) => {
            const prev = comments[i - 1];
            const grouped = prev && prev.wallet === c.wallet && Date.parse(c.at) - Date.parse(prev.at) < 3 * 60_000;
            const mine = c.wallet === address;
            return (
              <div key={c.id} className={`group rounded-xl px-3 transition-colors hover:bg-white/[0.025] ${grouped ? "pb-1" : "mt-1.5 pb-1 pt-2"}`}>
                {!grouped && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8rem]">
                    <Who address={c.wallet} size={20} className="font-medium text-ink/90" />
                    {c.isCreator && <Badge tone="bg-violet/15 text-violet">creator</Badge>}
                    {c.inPool && <Badge tone="bg-accent/15 text-accent">in pool</Badge>}
                    {c.isTeam && <TeamBadge />}
                    {mine && <Badge tone="bg-white/10 text-muted">you</Badge>}
                    <span className="num text-[0.72rem] text-dim" title={new Date(c.at).toLocaleString()}>
                      {now ? ago(c.at, now) : ""}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words pl-[1.65rem] pt-0.5 text-[0.9rem] leading-relaxed text-ink/90">{c.body}</p>
                  {!mine && (
                    <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <ReportButton targetType="comment" targetId={c.id} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {newBelow && (
          <button
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black shadow-[0_8px_24px_-8px_rgb(0_0_0/0.8)]"
            onClick={() => {
              const el = box.current;
              if (el) el.scrollTop = el.scrollHeight;
              setNewBelow(false);
            }}
          >
            New messages ↓
          </button>
        )}
      </div>
      <form
        className="border-t border-white/[0.06] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            className="input min-h-11 flex-1 resize-none py-2.5 leading-relaxed"
            rows={lines}
            placeholder="Message the crowd…"
            value={text}
            maxLength={COMMENT_MAX_CHARS}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            aria-label="Message"
          />
          <button className="btn-primary h-11 w-11 shrink-0 px-0" disabled={!text.trim() || over || sending} aria-label="Send message">
            <Icon name="send" className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[0.7rem] text-dim">
          <span>Text only · Enter to send, Shift+Enter for a new line</span>
          <span className={`num ${over ? "font-semibold text-danger" : words > COMMENT_MAX_WORDS - 30 ? "text-warn" : ""}`}>
            {words}/{COMMENT_MAX_WORDS} words
          </span>
        </div>
      </form>
    </div>
  );
}

/** Floating live chat on every coin page: a launcher with unread + headcount, and a panel. */
export function ChatDock() {
  const { title, here, unread, dockOpen, setDockOpen } = useChat();
  useEffect(() => {
    if (!dockOpen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDockOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [dockOpen, setDockOpen]);

  return (
    <Portal>
      {dockOpen ? (
        <section
          aria-label="Live chat"
          className="fixed inset-0 z-50 flex animate-fade flex-col bg-[#0c0d10] sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(38rem,calc(100dvh-7rem))] sm:w-[25rem] sm:overflow-hidden sm:rounded-[1.25rem] sm:border sm:border-white/10 sm:bg-[#0c0d10]/95 sm:shadow-[0_40px_100px_-20px_rgb(0_0_0/0.95)] sm:backdrop-blur-xl"
        >
          <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon name="chat" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.9rem] font-semibold">Live chat · {title}</div>
              <Here count={here} />
            </div>
            <button className="btn h-9 w-9 px-0" onClick={() => setDockOpen(false)} aria-label="Close chat">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </header>
          <div className="min-h-0 flex-1">
            <ChatRoom variant="dock" />
          </div>
        </section>
      ) : (
        <button
          onClick={() => setDockOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0f1114]/90 py-2 pl-3 pr-4 text-sm font-semibold shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl transition-colors hover:bg-[#15181c] sm:bottom-5 sm:right-5"
          aria-label={`Open live chat${unread ? `, ${unread} new` : ""}`}
        >
          <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Icon name="chat" className="h-4 w-4" />
            {unread > 0 && (
              <span className="num absolute -right-1.5 -top-1.5 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-danger px-1 text-[0.62rem] font-bold text-white ring-2 ring-[#0f1114]">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
          Live chat
          {here !== null && (
            <span className="flex items-center gap-1 text-xs font-medium text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />
              <span className="num">{here}</span>
            </span>
          )}
        </button>
      )}
    </Portal>
  );
}
