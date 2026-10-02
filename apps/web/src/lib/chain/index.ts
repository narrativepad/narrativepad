import "server-only";
import { config } from "../config";
import { mockAdapter } from "./mock";
import type { ChainAdapter } from "./types";

export function chain(): ChainAdapter {
  switch (config.chain) {
    case "mock":
      return mockAdapter;
    case "solana":
      // The Solana adapter ships once programs/narrative_escrow is compiled, tested and on devnet.
      throw new Error("CHAIN=solana is not available yet: the escrow program has not been deployed");
  }
}

export * from "./types";
