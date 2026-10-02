// Wallet-signed requests: nonce issue/consume + ed25519 signature verification.
import "server-only";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { config } from "./config";
import { q, q1 } from "./db";
import { buildMessage, payloadSchemas, signedRequestSchema, type Action, type Payload } from "./messages";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const NONCE_TTL_SEC = 300;

export async function issueNonce(wallet: string): Promise<string> {
  const nonce = randomBytes(18).toString("base64url");
  await q(`INSERT INTO nonces (nonce, wallet, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`, [
    nonce,
    wallet,
    NONCE_TTL_SEC,
  ]);
  return nonce;
}

export interface Verified<A extends Action> {
  wallet: string;
  payload: Payload<A>;
  message: string;
  signature: string;
}

/** Validates body, rebuilds the message, verifies the signature, burns the nonce. */
export async function verifySigned<A extends Action>(action: A, body: unknown): Promise<Verified<A>> {
  const parsed = signedRequestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Malformed signed request");
  const { wallet, nonce, issuedAt, signature } = parsed.data;

  const payloadParsed = payloadSchemas[action].safeParse(parsed.data.payload);
  if (!payloadParsed.success) {
    throw new HttpError(400, payloadParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const payload = payloadParsed.data as Payload<A>;

  const age = Date.now() - Date.parse(issuedAt);
  if (age < -60_000 || age > NONCE_TTL_SEC * 1000) throw new HttpError(401, "Signature expired, try again");

  const message = buildMessage({ action, payload, wallet, nonce, issuedAt, simulation: config.chain === "mock" });
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(signature), new TextEncoder().encode(message), bs58.decode(wallet));
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(401, "Invalid signature");

  const used = await q1(
    `UPDATE nonces SET used_at = now() WHERE nonce = $1 AND wallet = $2 AND used_at IS NULL AND expires_at > now() RETURNING nonce`,
    [nonce, wallet],
  );
  if (!used) throw new HttpError(401, "Nonce already used or expired, try again");
  return { wallet, payload, message, signature };
}

// ---- tiny in-memory rate limiter (single instance) ------------------------------------------

const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowSec: number) {
  // Local demo seeding only; never set in deployed environments.
  if (process.env.RATE_LIMIT_DISABLED === "1") return;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowSec * 1000 });
    return;
  }
  b.count += 1;
  if (b.count > max) throw new HttpError(429, "Too many requests, slow down");
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
