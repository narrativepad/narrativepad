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

/** Something about a narrative changed (votes, deposits, stage...). */
export function publish(narrativeId: string, kind: string) {
  bus.emit("change", { narrativeId, kind, at: Date.now() });
}
