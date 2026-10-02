import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { submitAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    rateLimit(`submit:${clientIp(req)}`, 30, 60);
    const v = await verifySigned("submit", await req.json());
    return Response.json(await submitAction(id, v));
  } catch (e) {
    return errorResponse(e);
  }
}
