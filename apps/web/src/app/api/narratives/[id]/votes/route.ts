// Audit export: every signed vote, so anyone can re-verify signatures and recount (§6.2).
import { errorResponse } from "@/lib/auth";
import { date, q, q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [votes, lock] = await Promise.all([
      q<any>(`SELECT field, voter_wallet, submission_id, message, signature, created_at FROM votes WHERE narrative_id = $1 ORDER BY created_at`, [id]),
      q1<any>(`SELECT votes_root, lock_hash FROM locks WHERE narrative_id = $1`, [id]),
    ]);
    return Response.json({
      narrativeId: id,
      votesRoot: lock?.votes_root ?? null,
      lockHash: lock?.lock_hash ?? null,
      leafFormula: "sha256(`${field}|${voter_wallet}|${submission_id}|${signature}`), sorted, pairwise sha256",
      votes: votes.map((v) => ({ ...v, created_at: date(v.created_at).toISOString() })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
