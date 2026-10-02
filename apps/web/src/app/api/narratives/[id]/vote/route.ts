import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { voteAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`vote:${clientIp(req)}`, 30, 60);
    const v = await verifySigned("vote", await req.json());
    return Response.json(await voteAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
