// Server-sent events: pushes "something changed" pings; clients refetch the page data.
// `?n=<id>` limits the stream to one narrative; adding `&presence=1` also counts this
// connection as someone in that narrative's chat and streams the live headcount.
import { bus, presenceChange } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const only = params.get("n");
  const counted = Boolean(only && params.get("presence") === "1" && /^[0-9a-f-]{36}$/.test(only));
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onChange = (ev: { narrativeId: string; kind: string; at: number; wallet?: string; amount?: string }) => {
        if (!only || ev.narrativeId === only) send(`data: ${JSON.stringify(ev)}\n\n`);
      };
      const onPresence = (ev: { narrativeId: string; count: number }) => {
        if (ev.narrativeId === only) send(`data: ${JSON.stringify({ kind: "presence", count: ev.count })}\n\n`);
      };
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 20_000);
      bus.on("change", onChange);
      if (counted) bus.on("presence", onPresence);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        bus.off("change", onChange);
        if (counted) {
          bus.off("presence", onPresence);
          presenceChange(only!, -1);
        }
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send(`retry: 3000\ndata: {"kind":"hello"}\n\n`);
      // Emitting the new headcount also reaches this connection through onPresence.
      if (counted) presenceChange(only!, 1);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
