import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  await q1("SELECT 1");
  return Response.json({ ok: true });
}
