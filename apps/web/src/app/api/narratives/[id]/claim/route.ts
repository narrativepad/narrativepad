import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { claimAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`claim:${clientIp(req)}`, 30, 60);
    const v = await verifySigned("claim", await req.json());
    return Response.json(await claimAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
