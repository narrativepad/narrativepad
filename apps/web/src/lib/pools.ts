// Pool currencies this server can open (D-023): what a narrative's pool holds, given its pair.
// SOL pairs pool SOL; USDC pairs pool USDC. Other pairs aren't offered until depositors can swap
// into them as they join (stage 3, mainnet).
import "server-only";
import { config, type PoolLimits } from "./config";
import { PUMP } from "./math";
import { knownPair, poolReady } from "./pairs";
import { SOL_UNIT, type PoolUnit } from "./units";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** USDC on each cluster. Devnet's is Circle's, the mint in pump's devnet Global whitelist. */
const USDC_MINT = { devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" };
/** pump Global.initial_virtual_quote_reserves on mainnet; the devnet adapter reads its own. */
const USDC_CURVE_RESERVES = 4_292_000_000n;

export interface PoolCurrency {
  unit: PoolUnit;
  /** Whether pump admits the mint through quote-control rather than Global's whitelist. */
  viaQuoteControl: boolean;
  limits: PoolLimits;
}

/** The pool currency for a pair on this server's chain, or null if pools can't hold it yet. */
export function poolCurrency(pair: string): PoolCurrency | null {
  if (!poolReady(pair)) return null;
  if (pair === "SOL") return { unit: SOL_UNIT, viaQuoteControl: false, limits: config.pools.SOL };
  return {
    unit: {
      symbol: "USDC",
      decimals: 6,
      // CHAIN=solana is devnet-only; the simulation records mainnet's mint.
      mint: config.chain === "solana" ? USDC_MINT.devnet : USDC_MINT.mainnet,
      tokenProgram: SPL_TOKEN,
      logo: knownPair("USDC")?.logo ?? null,
      curveReserves: USDC_CURVE_RESERVES.toString(),
    },
    viaQuoteControl: false,
    limits: config.pools.USDC,
  };
}

/** The unit an escrow row holds: its recorded token, or SOL for SOL pools and older escrows. */
export function unitOfEscrow(e: { quote_symbol?: string | null; quote_mint?: string | null; quote_decimals?: number | null; quote_program?: string | null; curve_reserves?: unknown }): PoolUnit {
  const reserves = e.curve_reserves === null || e.curve_reserves === undefined ? null : String(e.curve_reserves);
  if (!e.quote_mint) return reserves ? { ...SOL_UNIT, curveReserves: reserves } : SOL_UNIT;
  return {
    symbol: e.quote_symbol ?? "?",
    decimals: Number(e.quote_decimals ?? 0),
    mint: e.quote_mint,
    tokenProgram: e.quote_program ?? SPL_TOKEN,
    logo: knownPair(e.quote_symbol ?? "")?.logo ?? null,
    curveReserves: reserves ?? (e.quote_symbol === "USDC" ? USDC_CURVE_RESERVES : PUMP.virtualQuoteReserves).toString(),
  };
}
