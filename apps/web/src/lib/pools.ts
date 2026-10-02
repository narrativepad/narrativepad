// Pool currencies this server can open (D-023): what a narrative's pool holds, given its pair.
// SOL pairs pool SOL. Other pairs (tokenized stocks, other coins) will pool their own token once
// depositors can swap into it as they join (stage 3, mainnet); until then they can't be picked.
// No USD pairs (D-025).
import "server-only";
import { config, type PoolLimits } from "./config";
import { PUMP } from "./math";
import { knownPair, poolReady } from "./pairs";
import { SOL_UNIT, type PoolUnit } from "./units";

const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export interface PoolCurrency {
  unit: PoolUnit;
  /** Whether pump admits the mint through quote-control rather than Global's whitelist. */
  viaQuoteControl: boolean;
  limits: PoolLimits;
}

/** The pool currency for a pair on this server's chain, or null if pools can't hold it yet. */
export function poolCurrency(pair: string): PoolCurrency | null {
  if (!poolReady(pair)) return null;
  return pair === "SOL" ? { unit: SOL_UNIT, viaQuoteControl: false, limits: config.pools.SOL } : null;
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
    curveReserves: reserves ?? PUMP.virtualQuoteReserves.toString(),
  };
}
