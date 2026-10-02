"use client";

// Guest identity: every visitor gets a throwaway ed25519 key kept in this browser, so they can
// create, vote and join pools instantly with no wallet. It never holds funds. If a wallet is
// connected, that wallet is used instead.
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";

const KEY = "np_guest_sk_v1";

export interface Guest {
  address: string;
  sign: (message: Uint8Array) => Uint8Array;
}

let cached: Guest | null = null;

export function guest(): Guest {
  if (cached) return cached;
  let sk: Uint8Array | null = null;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) sk = Uint8Array.from(stored.match(/../g)!.map((x) => parseInt(x, 16)));
  } catch {}
  if (!sk) {
    sk = ed25519.utils.randomSecretKey();
    try {
      localStorage.setItem(KEY, Array.from(sk, (b) => b.toString(16).padStart(2, "0")).join(""));
    } catch {}
  }
  const secret = sk;
  cached = {
    address: bs58.encode(ed25519.getPublicKey(secret)),
    sign: (m) => ed25519.sign(m, secret),
  };
  return cached;
}
