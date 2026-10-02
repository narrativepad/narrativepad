// Server-side configuration. Env vars only; nothing secret is ever sent to the client.
import "server-only";

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const v = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(v)) throw new Error(`Invalid number in env ${key}`);
  return v;
};

const lamports = (key: string, fallbackSol: number): bigint =>
  BigInt(Math.round(num(key, fallbackSol) * 1e9));

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
  poolCap: lamports("POOL_CAP_SOL", 20),
  poolMin: lamports("POOL_MIN_SOL", 1),
  perWalletMax: lamports("PER_WALLET_MAX_SOL", 2),
  minDeposit: lamports("MIN_DEPOSIT_SOL", 0.05),
  feeBps: num("FEE_BPS", 100),
  teamWallets: new Set(
    (process.env.TEAM_WALLETS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ),
  publicUrl:
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000"),
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
