"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePublicConfig, useToast } from "@/components/Providers";
import { buildMessage, type Action, type Payload } from "@/lib/messages";
import { displayName } from "@/lib/names";
import { guest } from "./identity";

/** Who is acting: a connected wallet if there is one, otherwise this browser's guest identity. */
export function useIdentity() {
  const { publicKey, signMessage } = useWallet();
  const [guestAddress, setGuestAddress] = useState<string | null>(null);
  useEffect(() => setGuestAddress(guest().address), []);
  const walletAddress = publicKey && signMessage ? publicKey.toBase58() : null;
  const address = walletAddress ?? guestAddress;
  return {
    address,
    kind: walletAddress ? ("wallet" as const) : ("guest" as const),
    name: address ? displayName(address) : null,
  };
}

/** Sign an action message (wallet, or silently with the guest key) and POST it. */
export function useSigned() {
  const { publicKey, signMessage } = useWallet();
  const cfg = usePublicConfig();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const identity = useIdentity();

  const run = useCallback(
    async <A extends Action>(key: string, url: string, action: A, payload: Payload<A>, okText?: string) => {
      setBusy(key);
      try {
        const useWalletKey = Boolean(publicKey && signMessage);
        const wallet = useWalletKey ? publicKey!.toBase58() : guest().address;
        const nr = await fetch(`/api/auth/nonce?wallet=${wallet}`);
        const nj = await nr.json();
        if (!nr.ok) throw new Error(nj.error ?? "Please try again");
        const issuedAt = new Date().toISOString();
        const message = new TextEncoder().encode(
          buildMessage({ action, payload, wallet, nonce: nj.nonce, issuedAt, simulation: cfg.simulation }),
        );
        const sig = useWalletKey ? await signMessage!(message) : guest().sign(message);
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet, nonce: nj.nonce, issuedAt, signature: bs58.encode(sig), payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        if (okText) toast("ok", okText);
        router.refresh();
        return data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast("err", /reject|cancel|denied/i.test(msg) ? "Cancelled" : msg);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [publicKey, signMessage, cfg.simulation, toast, router],
  );

  return { run, busy, wallet: identity.address, identity };
}
