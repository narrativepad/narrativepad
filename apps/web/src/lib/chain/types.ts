// The only boundary between the app and a chain (brief §4). Everything above it is chain-agnostic.
// Implementations: `mock` (simulation, this build) and `solana` (escrow program, pending).

export interface EscrowParams {
  narrativeId: string;
  name: string;
  symbol: string;
  uri: string;
  lockHash: string;
  detailsHash: string;
  proposer: string;
  poolCap: bigint;
  poolMin: bigint;
  perWalletMax: bigint;
  minDeposit: bigint;
  feeBps: number;
  depositStart: Date;
  depositEnd: Date;
  launchAfter: Date;
  launchDeadline: Date;
  trancheCount: number;
  trancheIntervalSec: number;
}

export interface TxRef {
  tx: string;
}

export interface LaunchStatus {
  launched: boolean;
  /** Pool's deposit-weighted vote, settled at launch; null before. */
  holderRewards: boolean | null;
  mint: string | null;
  tx: string | null;
  tokensBought: bigint;
  platformFee: bigint;
  baseLeftover: bigint;
  launchedAt: Date | null;
}

export interface ChainAdapter {
  readonly kind: "mock" | "solana";
  readonly simulated: boolean;
  readonly currency: "SOL";

  createEscrow(p: EscrowParams): Promise<TxRef & { address: string; vault: string }>;
  /** mock: executes after the server verified the wallet's signed message.
   *  solana: not called server-side; the wallet signs and sends the transaction itself. */
  /** `holderRewards` is the depositor's vote; it counts with the deposit's amount (D-019). */
  deposit(narrativeId: string, wallet: string, amount: bigint, holderRewards: boolean): Promise<TxRef & { orderIndex: number }>;
  /** Permissionless crank. Holder rewards go on if the "on" votes hold more SOL; a tie is off. */
  launch(narrativeId: string): Promise<TxRef & { mint: string; tokensBought: bigint; holderRewards: boolean }>;
  claim(narrativeId: string, wallet: string): Promise<TxRef & { tokens: bigint; lamports: bigint }>;
  refund(narrativeId: string, wallet: string): Promise<TxRef & { amount: bigint }>;
  getLaunchStatus(narrativeId: string): Promise<LaunchStatus>;
  /** solana: refresh the database cache from the chain (accounts + new transactions). The
   *  chain is the source of truth; mock has nothing to sync. */
  sync?(narrativeId: string): Promise<void>;

  explorer: {
    address(a: string): string | null;
    tx(sig: string): string | null;
    token(mint: string): string | null;
  };
}

export class ChainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
