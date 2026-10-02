// Public JSON for a narrative (same data as its page).
import { errorResponse } from "@/lib/auth";
import { narrativeBySlug } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const n = await narrativeBySlug((await ctx.params).slug);
    if (!n || n.hidden) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(n);
  } catch (e) {
    return errorResponse(e);
  }
}
