import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { createNarrative } from "@/lib/narratives";
import { feed } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ narratives: await feed() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    rateLimit(`create:${clientIp(req)}`, 5, 600);
    const v = await verifySigned("create", await req.json());
    rateLimit(`create:${v.wallet}`, 3, 600);
    return Response.json(await createNarrative(v));
  } catch (e) {
    return errorResponse(e);
  }
}
