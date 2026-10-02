import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { depositAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`deposit:${clientIp(req)}`, 30, 60);
    const v = await verifySigned("deposit", await req.json());
    return Response.json(await depositAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
