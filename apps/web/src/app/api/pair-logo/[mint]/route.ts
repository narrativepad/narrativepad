import { pairLogo } from "@/lib/pairLogos";

/** A cached pair logo (pairLogos.ts). 404 until the server has fetched it; pages only link here
 *  once it has. */
export async function GET(_req: Request, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const img = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? pairLogo(mint) : undefined;
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
