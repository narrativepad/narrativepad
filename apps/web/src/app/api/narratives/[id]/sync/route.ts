// Re-read one escrow from the chain into the cache (CHAIN=solana). The browser calls it right after
// its deposit lands, so the pool updates without waiting for the scheduler. No auth: it only reads
// public chain data, and it is throttled per narrative.
import { errorResponse, HttpError } from "@/lib/auth";
import { chain } from "@/lib/chain";
import { publish } from "@/lib/events";

export const dynamic = "force-dynamic";

const last = new Map<string, number>();

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Invalid narrative");
    const sync = chain().sync;
    if (!sync) return Response.json({ ok: true, synced: false });
    if (Date.now() - (last.get(id) ?? 0) < 1500) return Response.json({ ok: true, synced: false });
    last.set(id, Date.now());
    await sync(id);
    publish(id, "deposit");
    return Response.json({ ok: true, synced: true });
  } catch (e) {
    return errorResponse(e);
  }
}
