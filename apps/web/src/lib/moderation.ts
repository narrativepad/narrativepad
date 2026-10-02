// Basic, best-effort moderation (ARCHITECTURE.md §10). Blocks obvious slurs/NSFW terms and
// impersonation of well-known brands/people in names and tickers. The report button and the
// hide threshold cover the rest. Extend the lists via env without a redeploy of code.
import "server-only";

const BASE_BLOCKED = [
  "nigger", "nigga", "faggot", "retard", "kike", "chink", "spic", "tranny",
  "porn", "nsfw", "nude", "nudes", "hentai", "onlyfans", "xxx", "cp", "loli", "rape",
];
const BASE_IMPERSONATION = [
  "official", "binance", "coinbase", "robinhood", "pumpfun", "pump.fun", "solana foundation",
  "tesla", "spacex", "apple", "google", "microsoft", "nvidia", "openai", "anthropic", "blackrock",
];

const fromEnv = (key: string) =>
  (process.env[key] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const blocked = [...BASE_BLOCKED, ...fromEnv("MODERATION_BLOCKLIST")];
const impersonation = [...BASE_IMPERSONATION, ...fromEnv("MODERATION_IMPERSONATION")];

const normalise = (s: string) =>
  s.toLowerCase().replace(/[0@]/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4]/g, "a").replace(/\$/g, "s");

const hasTerm = (text: string, terms: string[]) => {
  const t = normalise(text);
  const words = new Set(t.split(/[^a-z0-9.]+/).filter(Boolean));
  return terms.some((term) => (term.includes(" ") || term.includes(".") ? t.includes(term) : words.has(term)));
};

export function moderateText(text: string, kind: "pitch" | "name" | "ticker" | "link"): string | null {
  if (hasTerm(text, blocked)) return "Content not allowed";
  if ((kind === "name" || kind === "ticker") && hasTerm(text, impersonation)) {
    return "Names that impersonate real brands or people aren't allowed";
  }
  return null;
}

/** Reports needed before content is auto-hidden pending review. */
export const HIDE_THRESHOLD = Number(process.env.MODERATION_HIDE_THRESHOLD ?? 3);
