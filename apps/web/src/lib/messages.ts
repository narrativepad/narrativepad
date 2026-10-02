// Shared by browser and server: the exact text a wallet signs for each action. The server
// rebuilds the message from the submitted payload and verifies the signature over it, so a
// signature can only ever authorise the action shown to the user. Signing is free (no tx).
import { z } from "zod";

/** Ballots shown, voted on and locked (D-018). The link ballots (x, telegram, website) are
 *  switched off while the launch flow is being tested; their code paths stay for later. */
export const FIELDS = ["name", "ticker", "image", "pair", "fees"] as const;
export const LINK_FIELDS = ["x", "telegram", "website"] as const;
export type Field = (typeof FIELDS)[number] | (typeof LINK_FIELDS)[number];
export const FIELD_LABEL: Record<Field, string> = {
  name: "Name",
  ticker: "Ticker",
  image: "Image",
  pair: "Pair",
  fees: "Creator fees",
  x: "X / Twitter",
  telegram: "Telegram",
  website: "Website",
};
export const REQUIRED_FIELDS: Field[] = ["name", "ticker"];

// The coin always launches on pump.fun (D-018). The crowd votes on what it trades against and
// where pump.fun's creator fees go. Fixed options are seeded when a narrative is created; the
// first listed wins on a tie (earliest entry), so SOL and the escrow split are the defaults.
export const PAIRS = ["SOL", "USDC", "USD1"] as const;
export const FEE_PRESETS = ["split", "holders"] as const;
/** Pairs a real launch can use today; the escrow pools SOL. */
export const LIVE_PAIRS = new Set<string>(["SOL"]);
export const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** How an entry reads on screen (ballots, activity, lock panel). */
export function entryLabel(field: Field, value: string): { title: string; sub?: string } {
  if (field === "ticker") return { title: `$${value}` };
  if (field === "pair") return { title: `${value} pair`, sub: LIVE_PAIRS.has(value) ? "trades against SOL on pump.fun" : "preview only for now; real launches pair with SOL" };
  if (field === "fees") {
    if (value === "split") return { title: "Split the fees", sub: "50% to the pool, 30% to the creator, 20% to the platform" };
    if (value === "holders") return { title: "Holder rewards", sub: "pump.fun shares creator fees with the coin's holders" };
    return { title: `Wallet ${value.slice(0, 4)}…${value.slice(-4)}`, sub: "all creator fees go to this wallet" };
  }
  if (field === "x" || field === "telegram" || field === "website") return { title: value.replace(/^https:\/\//, "") };
  return { title: value };
}

/** Chat limits (D-016): text only, up to 300 words across at most 30 lines. */
export const COMMENT_MAX_WORDS = 300;
export const COMMENT_MAX_CHARS = 2000;
export const COMMENT_MAX_LINES = 30;
export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** The chat text that gets signed: no CRs or trailing spaces, at most one blank line in a row. */
export const normaliseComment = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const solAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "invalid wallet");
const id = z.string().uuid();
const httpsUrl = z.string().url().max(300).refine((u) => u.startsWith("https://"), "must be https");

export const payloadSchemas = {
  create: z.object({
    pitch: z.string().trim().min(10).max(280),
    sourceUrl: httpsUrl.optional(),
    name: z.string().trim().min(1).max(32).optional(),
    ticker: z.string().trim().min(1).max(10).optional(),
    image: z.string().regex(/^\/api\/images\/[a-f0-9]{64}$/).optional(),
  }),
  submit: z.object({ narrativeId: id, field: z.enum(FIELDS), value: z.string().trim().min(1).max(300) }),
  vote: z.object({ narrativeId: id, field: z.enum(FIELDS), submissionId: id }),
  deposit: z.object({ narrativeId: id, amountLamports: z.string().regex(/^\d{1,18}$/) }),
  claim: z.object({ narrativeId: id }),
  refund: z.object({ narrativeId: id }),
  report: z.object({
    targetType: z.enum(["narrative", "submission", "comment"]),
    targetId: id,
    reason: z.string().trim().min(3).max(200),
  }),
  comment: z.object({ narrativeId: id, body: z.string().trim().min(1).max(COMMENT_MAX_CHARS) }),
} as const;

export type Action = keyof typeof payloadSchemas;
export type Payload<A extends Action> = z.infer<(typeof payloadSchemas)[A]>;

const TITLE: Record<Action, string> = {
  create: "Start a narrative",
  submit: "Submit a ballot entry",
  vote: "Cast a vote",
  deposit: "Deposit into the pool",
  claim: "Claim from the pool",
  refund: "Refund from the pool",
  report: "Report content",
  comment: "Post a comment",
};

function lines<A extends Action>(action: A, p: Payload<A>, simulation: boolean): [string, string][] {
  switch (action) {
    case "create": {
      const c = p as Payload<"create">;
      return [
        ["Pitch", c.pitch],
        ["Source", c.sourceUrl ?? "-"],
        ["Suggested name", c.name ?? "-"],
        ["Suggested ticker", c.ticker ?? "-"],
        ["Suggested image", c.image ?? "-"],
      ];
    }
    case "submit": {
      const s = p as Payload<"submit">;
      return [["Narrative", s.narrativeId], ["Field", s.field], ["Value", s.value]];
    }
    case "vote": {
      const v = p as Payload<"vote">;
      return [["Narrative", v.narrativeId], ["Field", v.field], ["Entry", v.submissionId]];
    }
    case "deposit": {
      const d = p as Payload<"deposit">;
      return [
        ["Narrative", d.narrativeId],
        ["Amount (lamports)", d.amountLamports],
        ["Mode", simulation ? "SIMULATION, no funds move" : "on-chain"],
      ];
    }
    case "claim":
    case "refund": {
      const c = p as Payload<"claim">;
      return [["Narrative", c.narrativeId], ["Mode", simulation ? "SIMULATION, no funds move" : "on-chain"]];
    }
    case "report": {
      const r = p as Payload<"report">;
      return [["Target", `${r.targetType} ${r.targetId}`], ["Reason", r.reason]];
    }
    case "comment": {
      const c = p as Payload<"comment">;
      return [["Narrative", c.narrativeId], ["Comment", c.body]];
    }
  }
  return [];
}

export function buildMessage<A extends Action>(args: {
  action: A;
  payload: Payload<A>;
  wallet: string;
  nonce: string;
  issuedAt: string;
  simulation: boolean;
}): string {
  const body = lines(args.action, args.payload, args.simulation).map(([k, v]) => `${k}: ${v}`);
  return [
    `narrativepad: ${TITLE[args.action]}`,
    "",
    ...body,
    "",
    `Wallet: ${args.wallet}`,
    `Nonce: ${args.nonce}`,
    `Issued At: ${args.issuedAt}`,
    "",
    "Signing is free and does not send a transaction.",
  ].join("\n");
}

export const signedRequestSchema = z.object({
  wallet: solAddress,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  issuedAt: z.string().datetime(),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/),
  payload: z.unknown(),
});
