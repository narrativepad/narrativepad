"use client";

// Small per-browser stores (watchlist, reminders, alert mute). They live in localStorage, so
// they're private to this browser and can be empty (private window, cleared data, blocked
// storage). Every read and write is guarded, and components re-render through one event.
import { useSyncExternalStore } from "react";

const EVENT = "np-local";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const cache = new Map<string, { raw: string | null; value: unknown }>();

/** Parsed JSON at `key`, stable between renders until it changes. */
export function useLocal<T>(key: string, fallback: T): T {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => {
      const raw = read(key);
      const hit = cache.get(key);
      if (hit && hit.raw === raw) return hit.value as T;
      let value: unknown = fallback;
      try {
        if (raw) value = JSON.parse(raw);
      } catch {}
      cache.set(key, { raw, value });
      return value as T;
    },
    () => fallback,
  );
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = read(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---- watchlist --------------------------------------------------------------------------------

const WATCH = "np_watchlist_v1";
const EMPTY: string[] = [];

export function useWatchlist() {
  const ids = useLocal<string[]>(WATCH, EMPTY);
  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string) => {
      const now = readLocal<string[]>(WATCH, []);
      writeLocal(WATCH, now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
    },
  };
}

// ---- live alerts mute -------------------------------------------------------------------------

const MUTE = "np_alerts_muted_v1";
export const useAlertsMuted = () => useLocal<boolean>(MUTE, false);
export const setAlertsMuted = (muted: boolean) => writeLocal(MUTE, muted);

// ---- reminders --------------------------------------------------------------------------------

export interface Reminder {
  /** narrative id + deadline kind, so one coin can't stack duplicates. */
  id: string;
  slug: string;
  title: string;
  /** When to fire (ms epoch). */
  at: number;
  /** "Pool closes in 1 minute" etc. */
  label: string;
}

const REMIND = "np_reminders_v1";
const NO_REMINDERS: Reminder[] = [];
export const useReminders = () => useLocal<Reminder[]>(REMIND, NO_REMINDERS);
export const readReminders = () => readLocal<Reminder[]>(REMIND, []);
export const saveReminders = (list: Reminder[]) => writeLocal(REMIND, list);
