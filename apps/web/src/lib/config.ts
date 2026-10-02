// Server-side configuration. Env vars only; nothing secret is ever sent to the client.
import "server-only";

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const v = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(v)) throw new Error(`Invalid number in env ${key}`);
  return v;
};

/** A whole-unit env value (e.g. "0.5") in base units of a currency with `decimals`. */
const units = (key: string, fallback: number, decimals: number): bigint => BigInt(Math.round(num(key, fallback) * 10 ** decimals));

export interface PoolLimits {
  poolCap: bigint;
  poolMin: bigint;
  perWalletMax: bigint;
  minDeposit: bigint;
}

/** Each pool currency's limits, in its base units (D-023). */
const limits = (sym: string, decimals: number, d: { cap: number; min: number; perWallet: number; minDeposit: number }): PoolLimits => ({
  poolCap: units(`POOL_CAP_${sym}`, d.cap, decimals),
  poolMin: units(`POOL_MIN_${sym}`, d.min, decimals),
  perWalletMax: units(`PER_WALLET_MAX_${sym}`, d.perWallet, decimals),
  minDeposit: units(`MIN_DEPOSIT_${sym}`, d.minDeposit, decimals),
});

export type ChainKind = "mock" | "solana";

function chainKind(): ChainKind {
  const c = (process.env.CHAIN ?? "mock").toLowerCase();
  if (c !== "mock" && c !== "solana") throw new Error(`Unsupported CHAIN=${c}`);
  return c;
}

export const config = {
  chain: chainKind(),
  voteDurationSec: num("VOTE_DURATION_SEC", 180),
  depositWindowSec: num("DEPOSIT_WINDOW_SEC", 600),
  launchDelaySec: num("LAUNCH_DELAY_SEC", 120),
  launchWindowSec: num("LAUNCH_WINDOW_SEC", 1800),
  trancheCount: num("TRANCHE_COUNT", 5),
  trancheIntervalSec: num("TRANCHE_INTERVAL_SEC", 300),
  pools: {
    SOL: limits("SOL", 9, { cap: 20, min: 1, perWallet: 2, minDeposit: 0.05 }),
    // pump's devnet USDC curve starts with 4.292 USDC of virtual reserves (mainnet: 4,292), so the
    // escrow's 90% fill limit stops a devnet pool at about 8.5 USDC. These defaults fit devnet.
    USDC: limits("USDC", 6, { cap: 8, min: 1, perWallet: 4, minDeposit: 0.5 }),
  } satisfies Record<string, PoolLimits>,
  feeBps: num("FEE_BPS", 100),
  teamWallets: new Set(
    (process.env.TEAM_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ),
  publicUrl:
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000"),
  /** CHAIN=solana (D-021). Devnet only: the adapter checks the genesis hash before sending. The
   *  RPC URL may carry an API key, so it never goes to the browser. */
  solana: {
    rpcUrl:
      process.env.SOLANA_RPC_URL ||
      (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : "https://api.devnet.solana.com"),
    /** Address lookup table for `launch` (scripts/devnet-create-alt.ts). */
    launchAlt: process.env.LAUNCH_ALT || null,
    /** Who pays pump's create rent: the vault (default) or the cranker (fallback §4.3b). */
    createPayer: (process.env.LAUNCH_CREATE_PAYER === "cranker" ? "cranker" : "vault") as "vault" | "cranker",
  },
};

/** Values the browser may see. */
export function publicConfig() {
  return {
    chain: config.chain,
    simulation: config.chain === "mock",
    feeBps: config.feeBps,
    trancheCount: config.trancheCount,
    trancheIntervalSec: config.trancheIntervalSec,
    voteDurationSec: config.voteDurationSec,
    depositWindowSec: config.depositWindowSec,
  };
}
export type PublicConfig = ReturnType<typeof publicConfig>;
