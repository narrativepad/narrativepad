"use client";

// Wallet-signed escrow deposits (CHAIN=solana, D-021). The holder-rewards vote is an argument of
// the deposit itself, tallied on-chain by the escrow and applied at launch (D-022). Token pools
// (D-023) take the pool's token from the depositor's token account instead of SOL.
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { useCallback } from "react";
import { uuidBytes } from "@/lib/math";
import { ata, depositIx, depositTokenIx, escrowPda, programErrorName } from "@/lib/solana/escrow";
import { withUnit, type PoolUnit } from "@/lib/units";

const FRIENDLY: Record<string, string> = {
  NotPooling: "The deposit window is not open",
  DepositTooSmall: "That's below the minimum deposit",
  WalletCapExceeded: "That would go over the per-wallet maximum",
  PoolCapExceeded: "That would go over the pool cap",
  TransferAmountMismatch: "The pool received a different amount than you sent, so the deposit was undone",
};

/** Where to get free test funds on devnet. */
export const FAUCET = {
  SOL: { name: "faucet.solana.com", url: "https://faucet.solana.com" },
} as const;
const noFunds = (symbol: string) =>
  symbol in FAUCET ? `Not enough devnet ${symbol}. Get free test ${symbol} at ${FAUCET[symbol as keyof typeof FAUCET].name}` : `Not enough ${symbol}`;

/** A readable message for a wallet or program error. */
export function chainErrorMessage(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${(e as { logs?: string[] }).logs?.join(" ") ?? ""}` : String(e);
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  const name = m ? programErrorName(parseInt(m[1], 16)) : null;
  if (name) return FRIENDLY[name] ?? name;
  if (/reject|cancel|denied|declined/i.test(text)) return "Cancelled";
  if (/insufficient|debit an account/i.test(text)) return noFunds("SOL");
  return text.slice(0, 160);
}

/** Network fee plus the receipt account's rent, in lamports. */
const SOL_HEADROOM = 5_000_000n;

async function tokenBalance(connection: Connection, owner: PublicKey, unit: PoolUnit): Promise<bigint> {
  const account = ata(owner, new PublicKey(unit.mint!), new PublicKey(unit.tokenProgram!));
  try {
    return BigInt((await connection.getTokenAccountBalance(account, "confirmed")).value.amount);
  } catch {
    return 0n; // no token account yet
  }
}

export function useOnchainDeposit() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  /** `amount` is in `unit`'s base units. */
  const deposit = useCallback(
    async (narrativeId: string, amount: bigint, holderRewards: boolean, unit: PoolUnit): Promise<string | null> => {
      if (!publicKey) {
        setVisible(true);
        return null;
      }
      const escrow = escrowPda(uuidBytes(narrativeId));
      const sol = BigInt(await connection.getBalance(publicKey, "confirmed"));
      let ix;
      if (unit.mint) {
        const have = await tokenBalance(connection, publicKey, unit);
        if (have < amount) throw new Error(`${noFunds(unit.symbol)} (you have ${withUnit(have, unit)})`);
        if (sol < SOL_HEADROOM) throw new Error(`${noFunds("SOL")} for the network fee`);
        ix = depositTokenIx(publicKey, escrow, { mint: new PublicKey(unit.mint), tokenProgram: new PublicKey(unit.tokenProgram!) }, amount, holderRewards);
      } else {
        if (sol < amount + SOL_HEADROOM) throw new Error(noFunds("SOL"));
        ix = depositIx(publicKey, escrow, amount, holderRewards);
      }
      const tx = new Transaction().add(ix);
      const {
        context: { slot: minContextSlot },
        value: { blockhash, lastValidBlockHeight },
      } = await connection.getLatestBlockhashAndContext("confirmed");
      const signature = await sendTransaction(tx, connection, { minContextSlot });
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error(`Deposit failed: ${JSON.stringify(res.value.err)}`);
      await fetch(`/api/narratives/${narrativeId}/sync`, { method: "POST" }).catch(() => {});
      return signature;
    },
    [connection, publicKey, sendTransaction, setVisible],
  );

  return { deposit, connected: Boolean(publicKey), connect: () => setVisible(true) };
}
