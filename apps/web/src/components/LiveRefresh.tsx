"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Subscribes to server-sent events and re-renders the page's server data when something changes. */
export function LiveRefresh({ narrativeId }: { narrativeId?: string }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(narrativeId ? `/api/stream?n=${narrativeId}` : "/api/stream");
    es.onmessage = (e) => {
      try {
        if (JSON.parse(e.data).kind === "hello") return;
      } catch {}
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 350);
    };
    // Countdowns crossing zero are pushed by the scheduler; this is a safety net.
    const slow = setInterval(() => router.refresh(), 20_000);
    return () => {
      es.close();
      clearInterval(slow);
      if (timer) clearTimeout(timer);
    };
  }, [narrativeId, router]);
  return null;
}
