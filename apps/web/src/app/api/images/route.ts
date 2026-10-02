// Image upload for ballot entries. Content-addressed (id = sha256), so a locked image can't be
// swapped later. Max 1 MB; PNG/JPEG/WebP/GIF only (checked by magic bytes, not by header).
import { createHash } from "node:crypto";
import { clientIp, errorResponse, HttpError, rateLimit } from "@/lib/auth";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
const MAX_BYTES = 1_000_000;

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return "image/webp";
  return null;
}

export async function POST(req: Request) {
  try {
    rateLimit(`img:${clientIp(req)}`, 20, 3600);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file");
    if (file.size > MAX_BYTES) throw new HttpError(413, "Image must be 1 MB or smaller");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime) throw new HttpError(415, "Only PNG, JPEG, WebP or GIF");
    const sha = createHash("sha256").update(bytes).digest("hex");
    await q(`INSERT INTO images (id, mime, data, sha256) VALUES ($1,$2,$3,$1) ON CONFLICT (sha256) DO NOTHING`, [sha, mime, Buffer.from(bytes)]);
    return Response.json({ path: `/api/images/${sha}` });
  } catch (e) {
    return errorResponse(e);
  }
}
