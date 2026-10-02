// Live list of pump.fun quote assets (D-019), read from mainnet with plain JSON-RPC. Read-only and
// keyless; cached for an hour. If the read fails or the layout looks wrong, the snapshot in
// `pairs.ts` is used, so the pair ballot never depends on an RPC being up.
import "server-only";
import bs58 from "bs58";
import { BY_MINT, PUMP_PAIRS_SNAPSHOT, SOL_PAIR, type PairOption } from "./pairs";

const RPC = process.env.PUMP_RPC_URL || "https://api.mainnet-beta.solana.com";
/** pump.fun PDAs: seeds ["global"] and ["quote-control"] under 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P. */
const GLOBAL = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const QUOTE_CONTROL = "6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP";
/** Byte offset of `whitelisted_quote_mints[0]` in Global, per idls/pump.json (account is 1087 bytes). */
const WHITELIST_OFFSET = 1013;
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

const TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
let cached: { list: PairOption[]; at: number; live: boolean } = { list: PUMP_PAIRS_SNAPSHOT, at: 0, live: false };
let inflight: Promise<void> | null = null;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `RPC ${res.status}`);
  return body.result as T;
}

const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;

async function readLive(): Promise<PairOption[]> {
  const { value } = await rpc<{ value: ({ data: [string, string] } | null)[] }>("getMultipleAccounts", [[GLOBAL, QUOTE_CONTROL], { encoding: "base64" }]);
  const [g, qc] = value.map((a) => (a ? Buffer.from(a.data[0], "base64") : null));
  if (!g || g.length < WHITELIST_OFFSET + 32) throw new Error("unexpected Global layout");
  const mints = [bs58.encode(g.subarray(WHITELIST_OFFSET, WHITELIST_OFFSET + 32))].filter((m) => m !== DEFAULT_PUBKEY);
  if (qc) {
    let o = 8 + 32 + 64;
    const n = qc.readUInt32LE(o);
    o += 4;
    if (qc.length < o + n * 40) throw new Error("unexpected quote-control layout");
    for (let i = 0; i < n; i++, o += 40) mints.push(bs58.encode(qc.subarray(o, o + 32)));
  }

  // Name mints the snapshot doesn't know from their Token-2022 metadata, if they carry it.
  const unknown = mints.filter((m) => !BY_MINT.has(m));
  const named = new Map<string, PairOption>();
  if (unknown.length) {
    const parsed = await rpc<{ value: any[] }>("getMultipleAccounts", [unknown, { encoding: "jsonParsed" }]);
    unknown.forEach((m, i) => {
      const ext = parsed.value[i]?.data?.parsed?.info?.extensions?.find((e: any) => e.extension === "tokenMetadata")?.state;
      const name: string = ext?.name ?? `Token ${short(m)}`;
      named.set(m, {
        symbol: ext?.symbol || short(m),
        name: name.replace(/\s*(xStock|- Backpack Securities)\s*$/i, ""),
        mint: m,
        kind: /xStock|Securities|ETF/i.test(name) ? "stock" : "crypto",
      });
    });
  }
  return [SOL_PAIR, ...mints.map((m) => BY_MINT.get(m) ?? named.get(m)!)];
}

/** pump.fun's current pairs, SOL first. Never throws. Pages pass `wait: false` and get the cached
 *  list while it refreshes in the background; validation waits for the refresh. */
export async function pumpPairs({ wait = true } = {}): Promise<PairOption[]> {
  const age = Date.now() - cached.at;
  if (age > (cached.live ? TTL_MS : RETRY_MS)) {
    inflight ??= readLive()
      .then((list) => void (cached = { list, at: Date.now(), live: true }))
      .catch((e) => {
        console.warn(`[pairs] using snapshot: ${e instanceof Error ? e.message : e}`);
        cached = { ...cached, at: Date.now() };
      })
      .finally(() => (inflight = null));
    if (wait) await inflight;
  }
  return cached.list;
}
