// The connected wallet's votes and pool position for one narrative (public data, no auth needed).
import { errorResponse, HttpError } from "@/lib/auth";
import { q } from "@/lib/db";
import { walletPosition } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new HttpError(400, "Invalid wallet");
    const [position, votes] = await Promise.all([
      walletPosition(id, wallet),
      q<{ field: string; submission_id: string }>(`SELECT field, submission_id FROM votes WHERE narrative_id = $1 AND voter_wallet = $2`, [id, wallet]),
    ]);
    return Response.json({ position, votes: Object.fromEntries(votes.map((v) => [v.field, v.submission_id])) });
  } catch (e) {
    return errorResponse(e);
  }
}
