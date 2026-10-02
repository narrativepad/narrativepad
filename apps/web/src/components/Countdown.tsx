"use client";

import { useEffect, useState } from "react";

export function format(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Live countdown to an ISO timestamp. Renders nothing server-side to avoid hydration drift. */
export function Countdown({ to, prefix, done = "now", className = "" }: { to: string; prefix?: string; done?: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className={`num ${className}`}>&nbsp;</span>;
  const left = Date.parse(to) - now;
  return (
    <span className={`num ${className}`} suppressHydrationWarning>
      {left > 0 ? `${prefix ? prefix + " " : ""}${format(left)}` : done}
    </span>
  );
}
