// Signed per-narrative actions behind /api/narratives/[id]/*.
import "server-only";
import { HttpError, type Verified } from "./auth";
import { chain, ChainError } from "./chain";
import { config } from "./config";
import { publish } from "./events";
import { addComment, addSubmission, castVote } from "./narratives";

function sameNarrative(routeId: string, payloadId: string) {
  if (routeId !== payloadId) throw new HttpError(400, "Narrative mismatch");
}

/** Money actions run through the chain adapter. Only the simulation executes them server-side;
 *  on-chain, the wallet signs and sends the escrow transaction itself. */
function simulationOnly() {
  if (config.chain !== "mock") throw new HttpError(409, "Send this as an on-chain transaction from your wallet");
}

async function viaChain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ChainError) throw new HttpError(409, e.message);
    throw e;
  }
}

const json = (o: object) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

export async function submitAction(id: string, v: Verified<"submit">) {
  sameNarrative(id, v.payload.narrativeId);
  return addSubmission(v);
}

export async function voteAction(id: string, v: Verified<"vote">) {
  sameNarrative(id, v.payload.narrativeId);
  await castVote(v);
  return { ok: true };
}

export async function commentAction(id: string, v: Verified<"comment">) {
  sameNarrative(id, v.payload.narrativeId);
  return addComment(v);
}

export async function depositAction(id: string, v: Verified<"deposit">) {
  sameNarrative(id, v.payload.narrativeId);
  simulationOnly();
  const out = await viaChain(() => chain().deposit(id, v.wallet, BigInt(v.payload.amountLamports), v.payload.holderRewards));
  publish(id, "deposit", { wallet: v.wallet, amount: v.payload.amountLamports });
  return json(out);
}

// On-chain, claims and refunds are pushed by the server: the program lets anyone send them and
// always pays the depositor, so the signed message only says which wallet to push for.
export async function claimAction(id: string, v: Verified<"claim">) {
  sameNarrative(id, v.payload.narrativeId);
  const out = await viaChain(() => chain().claim(id, v.wallet));
  publish(id, "claim");
  return json(out);
}

export async function refundAction(id: string, v: Verified<"refund">) {
  sameNarrative(id, v.payload.narrativeId);
  const out = await viaChain(() => chain().refund(id, v.wallet));
  publish(id, "refund");
  return json(out);
}
