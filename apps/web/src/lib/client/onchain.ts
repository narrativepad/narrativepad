"use client";

// Wallet-signed escrow deposits (CHAIN=solana, D-021). One transaction holds the holder-rewards
// vote (a memo) and the deposit, so the vote is signed by the depositor and stored on-chain with it.
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { useCallback } from "react";
import { uuidBytes } from "@/lib/math";
import { depositIx, escrowPda, holderVoteMemoIx, programErrorName } from "@/lib/solana/escrow";

const FRIENDLY: Record<string, string> = {
  NotPooling: "The deposit window is not open",
  DepositTooSmall: "That's below the minimum deposit",
  WalletCapExceeded: "That would go over the per-wallet maximum",
  PoolCapExceeded: "That would go over the pool cap",
};

/** A readable message for a wallet or program error. */
export function chainErrorMessage(e: unknown): string {
  const text = e instanceof Error ? `${e.message} ${(e as { logs?: string[] }).logs?.join(" ") ?? ""}` : String(e);
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  const name = m ? programErrorName(parseInt(m[1], 16)) : null;
  if (name) return FRIENDLY[name] ?? name;
  if (/reject|cancel|denied|declined/i.test(text)) return "Cancelled";
  if (/insufficient|debit an account/i.test(text)) return "Not enough devnet SOL. Get free test SOL at faucet.solana.com";
  return text.slice(0, 160);
}

export function useOnchainDeposit() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const deposit = useCallback(
    async (narrativeId: string, lamports: bigint, holderRewards: boolean): Promise<string | null> => {
      if (!publicKey) {
        setVisible(true);
        return null;
      }
      // Leave room for the network fee and the receipt account's rent.
      const balance = BigInt(await connection.getBalance(publicKey, "confirmed"));
      if (balance < lamports + 5_000_000n) throw new Error("Not enough devnet SOL. Get free test SOL at faucet.solana.com");
      const escrow = escrowPda(uuidBytes(narrativeId));
      const tx = new Transaction().add(holderVoteMemoIx(holderRewards), depositIx(publicKey, escrow, lamports));
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
