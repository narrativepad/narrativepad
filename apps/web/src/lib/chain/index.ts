import "server-only";
import { config } from "../config";
import { mockAdapter } from "./mock";
import { solanaAdapter } from "./solana";
import type { ChainAdapter } from "./types";

export function chain(): ChainAdapter {
  switch (config.chain) {
    case "mock":
      return mockAdapter;
    case "solana":
      return solanaAdapter;
  }
}

export * from "./types";
