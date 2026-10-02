"use client";

import { useEffect, useRef, useState } from "react";

type Format = "int" | "sol" | "tokens" | "pct";

const fmt = (v: number, format: Format) => {
  if (format === "int") return Math.round(v).toLocaleString("en-US");
  if (format === "pct") return `${v.toFixed(1)}%`;
  if (format === "tokens") {
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return Math.floor(v).toLocaleString("en-US");
  }
  // Currency amounts in whole units (SOL, USDC…): up to 3 decimals, no trailing zeros (matches formatAmount).
  const s = (Math.floor(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  const [w, f] = s.split(".");
  return `${Number(w).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
};

/** A number that counts from its previous value to the new one when the data changes. */
export function AnimatedNumber({ value, format = "int", className = "" }: { value: number; format?: Format; className?: string }) {
  const [shown, setShown] = useState(value);
  // What's on screen right now, so an interrupted animation continues from where it is.
  const current = useRef(value);
  useEffect(() => {
    const start = current.current;
    if (start === value) return;
    const set = (v: number) => {
      current.current = v;
      setShown(v);
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return set(value);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      set(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`num ${className}`}>{fmt(shown, format)}</span>;
}
