// Server-sent events: pushes "something changed" pings; clients refetch the page data.
import { bus } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const only = new URL(req.url).searchParams.get("n");
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const onChange = (ev: { narrativeId: string; kind: string; at: number }) => {
        if (!only || ev.narrativeId === only) send(`data: ${JSON.stringify(ev)}\n\n`);
      };
      const keepAlive = setInterval(() => send(": keep-alive\n\n"), 20_000);
      bus.on("change", onChange);
      cleanup = () => {
        clearInterval(keepAlive);
        bus.off("change", onChange);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send(`retry: 3000\ndata: {"kind":"hello"}\n\n`);
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
