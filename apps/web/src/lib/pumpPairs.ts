// Live list of pump.fun quote assets (D-019), read from mainnet with plain JSON-RPC. Read-only and
// keyless; cached for an hour. If the read fails or the layout looks wrong, the snapshot in
// `pairs.ts` is used, so the pair ballot never depends on an RPC being up.
import "server-only";
import { PublicKey } from "@solana/web3.js";
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

  // Name the mints the snapshot doesn't know: Token-2022 metadata first, then Metaplex metadata.
  // RPC takes at most 100 accounts per call.
  const unknown = mints.filter((m) => !BY_MINT.has(m));
  const meta = new Map<string, { name: string; symbol: string }>();
  for (const batch of chunks(unknown, 100)) {
    const parsed = await rpc<{ value: any[] }>("getMultipleAccounts", [batch, { encoding: "jsonParsed" }]);
    batch.forEach((m, i) => {
      const ext = parsed.value[i]?.data?.parsed?.info?.extensions?.find((e: any) => e.extension === "tokenMetadata")?.state;
      if (ext?.symbol) meta.set(m, { name: ext.name ?? ext.symbol, symbol: ext.symbol });
    });
  }
  const noMeta = unknown.filter((m) => !meta.has(m));
  for (const batch of chunks(noMeta, 100)) {
    const pdas = batch.map((m) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), new PublicKey(m).toBuffer()], METAPLEX)[0].toBase58());
    const { value } = await rpc<{ value: ({ data: [string, string] } | null)[] }>("getMultipleAccounts", [pdas, { encoding: "base64" }]);
    batch.forEach((m, i) => {
      const v = value[i];
      if (!v) return;
      const d = Buffer.from(v.data[0], "base64");
      const str = (o: number) => {
        const n = d.readUInt32LE(o);
        return { s: d.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, "").trim(), next: o + 4 + n };
      };
      const name = str(1 + 32 + 32);
      const symbol = str(name.next);
      if (symbol.s) meta.set(m, { name: name.s || symbol.s, symbol: symbol.s });
    });
  }
  const named = (m: string): PairOption => {
    const x = meta.get(m);
    const name = x?.name ?? `Token ${short(m)}`;
    return {
      symbol: x?.symbol ?? short(m),
      name: name.replace(/\s*(xStock|- Backpack Securities)\s*$/i, ""),
      mint: m,
      kind: /xStock|Securities|ETF/i.test(name) ? "stock" : "crypto",
    };
  };
  return [SOL_PAIR, ...mints.map((m) => BY_MINT.get(m) ?? named(m))];
}

const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const chunks = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

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
