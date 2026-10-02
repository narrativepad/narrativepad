"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./bits";
import { useToast } from "./Providers";

/** Share to X with a ready-made post, or copy the link. */
export function ShareMenu({ path, text }: { path: string; text: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const url = () => `${window.location.origin}${path}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      toast("ok", "Link copied");
    } catch {
      toast("err", "Couldn't copy. Long-press the address bar instead.");
    }
    setOpen(false);
  }
  function post() {
    const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url())}`;
    window.open(intent, "_blank", "noopener,noreferrer");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn h-9 px-3.5 text-[0.82rem]" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Icon name="share" className="h-4 w-4" /> Share
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-11 z-30 w-56 animate-rise overflow-hidden rounded-2xl border border-white/10 bg-[#0f1114]/95 p-1.5 shadow-[0_24px_60px_-16px_rgb(0_0_0/0.95)] backdrop-blur-xl">
          <button role="menuitem" onClick={post} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/[0.06]">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.2h1.7L7.4 4.7H5.58l11.09 14.5Z" />
            </svg>
            Post on X
          </button>
          <button role="menuitem" onClick={copy} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/[0.06]">
            <Icon name="link" className="h-4 w-4" /> Copy link
          </button>
        </div>
      )}
    </div>
  );
}
