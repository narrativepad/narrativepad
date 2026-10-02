// Locked coin metadata JSON (the `uri` committed in the lock hash). Simulation serves it from
// here; on-chain mode pins the identical JSON to IPFS.
import { q1 } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const lock = await q1<{ metadata_json: string }>(`SELECT metadata_json FROM locks WHERE narrative_id = $1`, [id]);
  if (!lock) return Response.json({ error: "Not locked" }, { status: 404 });
  return new Response(lock.metadata_json, {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
