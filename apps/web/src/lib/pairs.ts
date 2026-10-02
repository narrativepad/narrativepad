// What a coin can trade against on pump.fun (D-019). Shared by browser and server.
// pump.fun accepts SOL, the mint in `Global.whitelisted_quote_mints` (USDC) and every mint in its
// `quote-control` account. The server re-reads that list from mainnet (`pumpPairs.ts`); this
// snapshot names the mints and is the fallback when the read fails.

export interface PairOption {
  symbol: string;
  name: string;
  mint: string;
  kind: "crypto" | "stock";
  /** A bundled logo (public/pairs, scripts/pair-logos.mjs), the token metadata's image for pairs
   *  pump.fun added after the snapshot, or null (the UI draws a monogram). */
  logo: string | null;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const logo = (mint: string) => `/pairs/${mint}.webp`;
export const SOL_PAIR: PairOption = { symbol: "SOL", name: "Solana", mint: SOL_MINT, kind: "crypto", logo: logo(SOL_MINT) };

/** Pairs a pool can be opened in today: SOL. The rest need each depositor's wallet to swap into
 *  the pair as it joins (D-023 stage 3, mainnet only: tokenized stocks and wrapped coins don't
 *  exist on devnet). */
export const POOL_PAIRS = new Set<string>(["SOL"]);
export const poolReady = (symbol: string) => POOL_PAIRS.has(symbol);

/** pump.fun pairs narrativepad doesn't offer at all: no USD pairs (owner, D-025). */
export const HIDDEN_PAIRS = new Set<string>(["USDC"]);
export const offered = (p: Pick<PairOption, "symbol">) => !HIDDEN_PAIRS.has(p.symbol);

const c = (symbol: string, name: string, mint: string): PairOption => ({ symbol, name, mint, kind: "crypto", logo: logo(mint) });
const s = (symbol: string, name: string, mint: string): PairOption => ({ symbol, name, mint, kind: "stock", logo: logo(mint) });

/** Read from mainnet on 2026-10-02: SOL, the Global whitelist, then quote-control in its order. */
export const PUMP_PAIRS_SNAPSHOT: PairOption[] = [
  SOL_PAIR,
  c("USDC", "USD Coin", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  c("WBTC", "Wrapped Bitcoin", "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh"),
  c("WETH", "Wrapped Ether", "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"),
  s("MU", "Micron", "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1"),
  s("SPYx", "S&P 500", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
  s("CRCLx", "Circle", "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1"),
  s("SKHY", "SK Hynix", "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3"),
  s("TSLAx", "Tesla", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"),
  s("QQQx", "Nasdaq 100", "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ"),
  s("NVDAx", "NVIDIA", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
  s("SPCX", "SpaceX", "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb"),
  s("MSTRx", "MicroStrategy", "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ"),
  s("COINx", "Coinbase", "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu"),
  s("GLDx", "Gold", "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re"),
  s("HOODx", "Robinhood", "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg"),
  s("VIDAx", "Vida Global", "XsfCC9VL4DamVGNgdJpfLXB3sBVa158Gbx8sh7NzmTk"),
  s("AAPLx", "Apple", "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"),
  s("MCDx", "McDonald's", "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2"),
  s("NKE", "Nike", "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg"),
  s("DRAM", "Roundhill Memory ETF", "DRAMjSWR7HRfJKjRkvQWYL2bcaejaVhuxEcjf4pAY4Cw"),
  s("PLTRx", "Palantir", "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4"),
  s("MSFTx", "Microsoft", "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX"),
  s("BOT", "RoboStrategy", "BoTx8y9ynfdxf5ZjWtCoBVkff52qKA82ysaLU8ZM6d8T"),
  s("GOOGLx", "Alphabet", "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN"),
  s("TTWO", "Take-Two", "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo"),
  s("GPRO", "GoPro", "GPRR2u6NS5yBQHWGauoJ9HXgjrTH8dDsrBfTV5zAYvDH"),
  s("METAx", "Meta", "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu"),
  s("AMZNx", "Amazon", "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg"),
  s("KOx", "Coca-Cola", "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ"),
  s("GMEx", "GameStop", "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc"),
  s("BRK.Bx", "Berkshire Hathaway", "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x"),
  s("SNDK", "Sandisk", "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH"),
  s("AMC", "AMC Entertainment", "AMC1qwR9KhiyrQBRPrxnfo4JfMeMZqEBvt5tgTytNNoc"),
  s("MRNA", "Moderna", "MRNAzXzhNcaEXJPibHEn8cd4vyekCDiivTyEwswLUCT"),
  s("AVGOx", "Broadcom", "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo"),
  s("LLY", "Eli Lilly", "LLYuwZ33keFihgwoxXsBawy31AiRFLFSva32TYq5TvD"),
  s("INTC", "Intel", "iNTCy1qTsUEZQe3DSocLz1ZXXai34Gdw8THQh5rxFaF"),
  c("HYPE", "Hyperliquid", "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g"),
  c("wXRP", "Wrapped XRP", "6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2"),
  c("ONDO", "Ondo", "ondohH8Vssxiqcy5u6Efi4AYN17KZrzQtv2a91dnrgW"),
];

const BY_SYMBOL = new Map(PUMP_PAIRS_SNAPSHOT.map((p) => [p.symbol.toLowerCase(), p]));
export const BY_MINT = new Map(PUMP_PAIRS_SNAPSHOT.map((p) => [p.mint, p]));

export const knownPair = (symbol: string): PairOption | undefined => BY_SYMBOL.get(symbol.toLowerCase());
