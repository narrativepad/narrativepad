// In-process pub/sub for SSE. One Railway instance, so no broker is needed yet.
import "server-only";
import { EventEmitter } from "node:events";

declare global {
  // eslint-disable-next-line no-var
  var __narrativepadBus: EventEmitter | undefined;
}

export const bus = (globalThis.__narrativepadBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(10_000);
  return e;
})());

/** Public details some events carry for live alerts (wallet, lamports). Never secrets. */
export type EventDetail = { wallet?: string; amount?: string };

/** Something about a narrative changed (votes, deposits, stage...). */
export function publish(narrativeId: string, kind: string, detail?: EventDetail) {
  bus.emit("change", { narrativeId, kind, at: Date.now(), ...detail });
}

// ---- presence: how many open chat connections each narrative has ------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __narrativepadHere: Map<string, number> | undefined;
}
const here = (globalThis.__narrativepadHere ??= new Map<string, number>());

export const presence = (narrativeId: string) => here.get(narrativeId) ?? 0;

/** Count a chat viewer in (+1) or out (-1) and tell everyone on that page. */
export function presenceChange(narrativeId: string, delta: 1 | -1) {
  const count = Math.max(0, presence(narrativeId) + delta);
  if (count === 0) here.delete(narrativeId);
  else here.set(narrativeId, count);
  bus.emit("presence", { narrativeId, count });
}
