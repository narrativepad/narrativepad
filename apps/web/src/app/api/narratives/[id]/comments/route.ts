import { clientIp, errorResponse, HttpError, rateLimit, verifySigned } from "@/lib/auth";
import { commentAction } from "@/lib/actions";
import { q1 } from "@/lib/db";
import { commentsFor } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Live chat catch-up: messages after `?after=<ISO time>` (or the latest 200). Public. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const n = await q1<{ creator_wallet: string; hidden: boolean }>(`SELECT creator_wallet, hidden FROM narratives WHERE id = $1`, [id]);
    if (!n || n.hidden) throw new HttpError(404, "Narrative not found");
    const raw = new URL(req.url).searchParams.get("after");
    const after = raw ? new Date(raw) : undefined;
    if (after && Number.isNaN(after.getTime())) throw new HttpError(400, "Invalid time");
    return Response.json({ comments: await commentsFor(id, n.creator_wallet, after) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`comment:${clientIp(req)}`, 20, 60);
    const v = await verifySigned("comment", await req.json());
    return Response.json(await commentAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
