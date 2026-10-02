import { clientIp, errorResponse, rateLimit, verifySigned } from "@/lib/auth";
import { report } from "@/lib/narratives";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    rateLimit(`report:${clientIp(req)}`, 10, 600);
    await report(await verifySigned("report", await req.json()));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
