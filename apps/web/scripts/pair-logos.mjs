// Dev tool: downloads a logo for every pair in the snapshot (src/lib/pairs.ts) into
// public/pairs/<mint>.webp, 96×96, so the pair picker never hotlinks a third-party host.
//   node scripts/pair-logos.mjs            (skips logos that already exist)
//   node scripts/pair-logos.mjs --force
// Sources: each token's own metadata image (xStocks, Backpack and Hex Trust publish these for
// wallets and exchanges), and the Solana token list for SOL, USDC, WBTC and WETH, whose
// metadata has no image.
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "public/pairs");
const force = process.argv.includes("--force");
mkdirSync(out, { recursive: true });

// The snapshot is TypeScript; read the mints straight from its source.
const src = readFileSync(join(root, "src/lib/pairs.ts"), "utf8");
const pairs = [...src.matchAll(/\b[cs]\("([^"]+)", "[^"]+", "([1-9A-HJ-NP-Za-km-z]{32,44})"\)/g)].map((m) => ({ symbol: m[1], mint: m[2] }));
pairs.unshift({ symbol: "SOL", mint: "So11111111111111111111111111111111111111112" });

const TOKEN_LIST = (mint) => `https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/${mint}/logo.png`;
const FIXED = {
  SOL: TOKEN_LIST("So11111111111111111111111111111111111111112"),
  USDC: TOKEN_LIST("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  WBTC: TOKEN_LIST("3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"),
  WETH: TOKEN_LIST("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
  // Backpack's generic "securities" image for AMC; its stock-logo endpoint has the real mark.
  AMC: "https://backpack.exchange/api/stock-logo/AMC",
};

const RPC = "https://api.mainnet-beta.solana.com";
async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await res.json()).result;
}
const ipfs = (u) => u.replace(/^https:\/\/ipfs\.io\/ipfs\//, "https://gateway.pinata.cloud/ipfs/");

/** The image URL in a mint's Token-2022 or Metaplex metadata JSON. */
async function metadataImage(mint) {
  const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  let uri = acc?.value?.data?.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state?.uri;
  if (!uri) {
    const { PublicKey } = await import("@solana/web3.js");
    const META = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), META.toBuffer(), new PublicKey(mint).toBuffer()], META);
    const m = await rpc("getAccountInfo", [pda.toBase58(), { encoding: "base64" }]);
    if (m?.value) {
      const d = Buffer.from(m.value.data[0], "base64");
      let o = 65;
      const str = () => {
        const n = d.readUInt32LE(o);
        const v = d.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, "").trim();
        o += 4 + n;
        return v;
      };
      str();
      str();
      uri = str();
    }
  }
  if (!uri) return null;
  const json = await (await fetch(ipfs(uri), { signal: AbortSignal.timeout(10_000) })).json();
  return json.image ? ipfs(json.image) : null;
}

let failed = 0;
for (const p of pairs) {
  const file = join(out, `${p.mint}.webp`);
  if (!force && existsSync(file)) continue;
  try {
    const url = FIXED[p.symbol] ?? (await metadataImage(p.mint));
    if (!url) throw new Error("no image in metadata");
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    let img = Buffer.from(await res.arrayBuffer());
    // Illustrator exports carry relative namespace URIs (xmlns:x="ns_extend;") that librsvg rejects.
    if (/svg/.test(res.headers.get("content-type") ?? "")) {
      img = Buffer.from(img.toString("utf8").replace(/\s+xmlns(:\w+)?="ns_\w+;"/g, "").replace(/<metadata>[\s\S]*?<\/metadata>/, ""));
    }
    await sharp(img, { density: 384 }).resize(96, 96, { fit: "cover" }).webp({ quality: 88 }).toFile(file);
    console.log(`${p.symbol.padEnd(8)} ${url}`);
  } catch (e) {
    failed++;
    console.error(`${p.symbol.padEnd(8)} FAILED: ${e instanceof Error ? e.message : e}`);
  }
}
if (failed) process.exitCode = 1;
