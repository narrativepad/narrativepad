// Logos for pairs pump.fun added after the bundled snapshot (D-024). The server fetches each
// token's metadata image once, checks that it is an image, shrinks it to the same 96×96 WebP as
// the bundled logos and serves it from /api/pair-logo/<mint>. Browsers never load images from
// third-party hosts, and a broken or missing image simply gives no logo (the UI draws a monogram).
import "server-only";
import sharp from "sharp";

const SIZE = 96;
const MAX_BYTES = 5 * 1024 * 1024;
const RETRY_MS = 6 * 60 * 60 * 1000;

// On globalThis: Next bundles pages and route handlers separately, and they must share one cache.
declare global {
  // eslint-disable-next-line no-var
  var __narrativepadPairLogos: { logos: Map<string, Buffer>; failedAt: Map<string, number> } | undefined;
}
globalThis.__narrativepadPairLogos ??= { logos: new Map(), failedAt: new Map() };
const { logos, failedAt } = globalThis.__narrativepadPairLogos;

export const pairLogo = (mint: string): Buffer | undefined => logos.get(mint);

/** IPFS links through a gateway that serves them; everything else must be public https. */
function publicUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^ipfs:\/\//, "https://gateway.pinata.cloud/ipfs/").replace(/^https:\/\/ipfs\.io\/ipfs\//, "https://gateway.pinata.cloud/ipfs/");
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // Metadata comes from pump.fun's admin-curated quote list, but never let it point the server
  // at itself or a private network.
  const h = u.hostname;
  if (u.protocol !== "https:" || /^(localhost|.*\.internal|.*\.local)$/i.test(h) || /^[\d.]+$|:/.test(h)) return null;
  return u;
}

async function fetchCapped(u: URL, timeoutMs: number): Promise<{ type: string; body: Buffer } | null> {
  const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok || !res.body) return null;
  const chunks: Uint8Array[] = [];
  let n = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    n += c.length;
    if (n > MAX_BYTES) return null;
    chunks.push(c);
  }
  return { type: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
}

/** Fetches, checks and shrinks one token's logo. True if the mint now has a logo. Never throws. */
export async function resolvePairLogo(mint: string, metadataUri: string | undefined): Promise<boolean> {
  if (logos.has(mint)) return true;
  if (Date.now() - (failedAt.get(mint) ?? 0) < RETRY_MS) return false;
  try {
    const metaUrl = publicUrl(metadataUri);
    if (!metaUrl) throw new Error("no metadata uri");
    const meta = await fetchCapped(metaUrl, 4000);
    const imageUrl = meta && publicUrl(JSON.parse(meta.body.toString("utf8"))?.image);
    if (!imageUrl) throw new Error("no image in metadata");
    const img = await fetchCapped(imageUrl, 6000);
    // Gateways often send images as octet-stream; sharp decides whether it really is one.
    if (!img || /^(text\/html|application\/json)/i.test(img.type)) throw new Error("not an image");
    const webp = await sharp(img.body, { limitInputPixels: 40_000_000, animated: false, density: 192 })
      .resize(SIZE, SIZE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    logos.set(mint, webp);
    failedAt.delete(mint);
    return true;
  } catch {
    failedAt.set(mint, Date.now());
    return false;
  }
}

/** Resolves many logos, a few at a time. */
export async function resolvePairLogos(items: { mint: string; uri?: string }[], concurrency = 8): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await resolvePairLogo(it.mint, it.uri);
    }),
  );
}
