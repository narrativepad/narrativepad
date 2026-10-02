import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { refundAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`refund:${clientIp(req)}`, 30, 60);
    const v = await verifySigned("refund", await req.json());
    return Response.json(await refundAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
