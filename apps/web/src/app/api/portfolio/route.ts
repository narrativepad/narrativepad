// Every pool one wallet joined, with claimable/refundable amounts (public data, no auth needed).
import { errorResponse, HttpError } from "@/lib/auth";
import { portfolio } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const wallet = new URL(req.url).searchParams.get("wallet") ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new HttpError(400, "Invalid wallet");
    return Response.json({ items: await portfolio(wallet) });
  } catch (e) {
    return errorResponse(e);
  }
}
