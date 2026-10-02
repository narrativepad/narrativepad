import { clientIp, errorResponse, HttpError, issueNonce, rateLimit } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new HttpError(400, "Invalid wallet");
    rateLimit(`nonce:${clientIp(req)}`, 60, 60);
    return Response.json({ nonce: await issueNonce(wallet) });
  } catch (e) {
    return errorResponse(e);
  }
}
