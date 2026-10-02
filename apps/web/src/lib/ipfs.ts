// Coin metadata on IPFS (D-026). A coin's image and metadata JSON are pinned through Pinata and
// referenced by public-gateway URLs, so nothing in the coin's metadata on pump.fun points at this
// site. Content-addressed, so the URI committed in the lock hash can never change either.
// PINATA_JWT is a secret: env only, never logged or sent to the browser.
import "server-only";

export const ipfsEnabled = () => Boolean(process.env.PINATA_JWT);

/** The public-gateway URL pump.fun's own coins use. */
export const ipfsUrl = (cid: string) => `https://ipfs.io/ipfs/${cid}`;

/** Pins `bytes` and returns their CID. Same bytes, same CID, so retries are harmless. */
export async function pinBytes(bytes: Uint8Array, mime: string): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is not set");
  const form = new FormData();
  // A neutral file name: Pinata lists it in the account, never in the coin.
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), mime === "application/json" ? "metadata.json" : "image");
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { IpfsHash?: string; error?: unknown };
  if (!res.ok || !body.IpfsHash) throw new Error(`Pinata ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 160)}`);
  return body.IpfsHash;
}
