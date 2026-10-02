"use client";

import { useWatchlist } from "@/lib/client/local";
import { Icon } from "./bits";

/** Watchlist toggle. Safe inside a link: it never navigates. */
export function StarButton({ id, variant = "icon" }: { id: string; variant?: "icon" | "pill" }) {
  const { has, toggle } = useWatchlist();
  const on = has(id);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(id);
  };
  if (variant === "pill") {
    return (
      <button type="button" onClick={onClick} aria-pressed={on} className={`btn h-9 px-3.5 text-[0.82rem] ${on ? "border-gold/40 bg-gold/10 text-gold hover:bg-gold/15" : ""}`}>
        <Icon name="star" className={`h-4 w-4 ${on ? "fill-current" : ""}`} />
        {on ? "Watching" : "Watch"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      className={`flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition-colors ${
        on ? "border-gold/40 bg-gold/15 text-gold" : "border-white/10 bg-black/40 text-white/70 hover:text-white"
      }`}
    >
      <Icon name="star" className={`h-4 w-4 ${on ? "fill-current" : ""}`} />
    </button>
  );
}
