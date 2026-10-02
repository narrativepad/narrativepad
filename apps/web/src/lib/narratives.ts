// Narrative lifecycle (ARCHITECTURE.md §6): propose → vote → lock → escrow. Chain-agnostic.
import "server-only";
import bs58 from "bs58";
import { randomBytes, randomUUID } from "node:crypto";
import { HttpError, type Verified } from "./auth";
import { chain, ChainError } from "./chain";
import { config } from "./config";
import { date, q, q1, transaction } from "./db";
import { publish } from "./events";
import { canonicalJson, fromHex, lockHash, merkleRoot, sha256Hex, uuidBytes } from "./math";
import { COMMENT_MAX_LINES, COMMENT_MAX_WORDS, countWords, FIELDS, normaliseComment, REQUIRED_FIELDS, type Field } from "./messages";
import { HIDE_THRESHOLD, moderateText } from "./moderation";
import { knownPair, SOL_PAIR, type PairOption } from "./pairs";
import { poolCurrency } from "./pools";
import { pumpPairs } from "./pumpPairs";

const MAX_SUBMISSIONS_PER_WALLET_PER_FIELD = 3;
export const IMAGE_PATH_RE = /^\/api\/images\/[a-f0-9]{64}$/;

// ---- validation -----------------------------------------------------------------------------

/** `pairs` is pump.fun's current list; required for the pair field. */
export function normaliseEntry(field: Field, raw: string, pairs: PairOption[] = []): string {
  const v = raw.trim();
  const fail = (m: string): never => {
    throw new HttpError(400, m);
  };
  switch (field) {
    case "name":
      if (v.length < 1 || v.length > 32) fail("Name must be 1–32 characters");
      if (/[\u0000-\u001f]/.test(v)) fail("Name contains invalid characters");
      break;
    case "ticker": {
      const t = v.replace(/^\$/, "").toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(t)) fail("Ticker must be 1–10 letters or digits");
      return checkText(t, "ticker");
    }
    case "image":
      if (!IMAGE_PATH_RE.test(v)) fail("Upload an image first");
      return v;
    case "pair": {
      const p = pairs.find((o) => o.symbol.toLowerCase() === v.toLowerCase());
      if (!p) return fail("pump.fun doesn't accept that pair. Pick one from the list");
      return p.symbol;
    }
    case "x":
      if (!/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}(\/.*)?$/.test(v)) fail("Must be an https://x.com/… link");
      break;
    case "telegram":
      if (!/^https:\/\/t\.me\/[A-Za-z0-9_+/-]{3,64}$/.test(v)) fail("Must be an https://t.me/… link");
      break;
    case "website":
      try {
        const u = new URL(v);
        if (u.protocol !== "https:") fail("Website must be https");
      } catch {
        fail("Invalid website URL");
      }
      break;
  }
  return checkText(v, field === "name" ? "name" : "link");
}

function checkText(v: string, kind: "pitch" | "name" | "ticker" | "link") {
  const problem = moderateText(v, kind);
  if (problem) throw new HttpError(400, problem);
  return v;
}

// ---- writes ---------------------------------------------------------------------------------

export async function createNarrative(v: Verified<"create">): Promise<{ id: string; slug: string }> {
  const p = v.payload;
  checkText(p.pitch, "pitch");
  const name = p.name ? normaliseEntry("name", p.name) : null;
  const ticker = p.ticker ? normaliseEntry("ticker", p.ticker) : null;
  const image = p.image ? normaliseEntry("image", p.image) : null;
  // The creator picks the pair (D-024): one pump.fun accepts that a pool can hold today.
  const pair = normaliseEntry("pair", p.pair, await pumpPairs());
  const pool = poolCurrency(pair);
  if (!pool) throw new HttpError(400, `${pair} pools open with the mainnet launch. Pick SOL or USDC for now`);

  const id = randomUUID();
  const slug = bs58.encode(randomBytes(6));
  const voteEndsAt = new Date(Date.now() + config.voteDurationSec * 1000);
  const snapshot = {
    voteDurationSec: config.voteDurationSec,
    depositWindowSec: config.depositWindowSec,
    launchDelaySec: config.launchDelaySec,
    launchWindowSec: config.launchWindowSec,
    trancheCount: config.trancheCount,
    trancheIntervalSec: config.trancheIntervalSec,
    // Limits in the pool currency's base units (D-023).
    pool: pool.unit.symbol,
    poolCap: pool.limits.poolCap.toString(),
    poolMin: pool.limits.poolMin.toString(),
    perWalletMax: pool.limits.perWalletMax.toString(),
    minDeposit: pool.limits.minDeposit.toString(),
    feeBps: config.feeBps,
  };

  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO narratives (id, slug, chain, creator_wallet, pitch, source_url, stage, vote_ends_at, config, create_message, create_signature, pair)
       VALUES ($1,$2,$3,$4,$5,$6,'voting',$7,$8,$9,$10,$11)`,
      [id, slug, config.chain, v.wallet, p.pitch, p.sourceUrl ?? null, voteEndsAt, JSON.stringify(snapshot), v.message, v.signature, pair],
    );
    // The creator's suggestions are the first ballot entries. Link ballots are off for now (D-018).
    const seeds: [Field, string | null][] = [
      ["name", name],
      ["ticker", ticker],
      ["image", image],
    ];
    for (const [field, value] of seeds) {
      if (!value) continue;
      await tx.query(
        `INSERT INTO submissions (id, narrative_id, field, value, submitter_wallet, message, signature) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), id, field, value, v.wallet, v.message, v.signature],
      );
    }
  });
  publish(id, "created", { wallet: v.wallet });
  return { id, slug };
}

async function votingNarrative(narrativeId: string) {
  const n = await q1<any>(`SELECT id, stage, vote_ends_at, hidden FROM narratives WHERE id = $1`, [narrativeId]);
  if (!n || n.hidden) throw new HttpError(404, "Narrative not found");
  if (n.stage !== "voting" || date(n.vote_ends_at).getTime() <= Date.now()) throw new HttpError(409, "Voting has ended");
  return n;
}

export async function addSubmission(v: Verified<"submit">): Promise<{ id: string }> {
  const { narrativeId, field } = v.payload;
  await votingNarrative(narrativeId);
  const value = normaliseEntry(field, v.payload.value);
  const mine = await q1<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM submissions WHERE narrative_id = $1 AND field = $2 AND submitter_wallet = $3`,
    [narrativeId, field, v.wallet],
  );
  if (Number(mine?.c ?? 0) >= MAX_SUBMISSIONS_PER_WALLET_PER_FIELD) {
    throw new HttpError(429, `Max ${MAX_SUBMISSIONS_PER_WALLET_PER_FIELD} entries per field per wallet`);
  }
  const id = randomUUID();
  const inserted = await q1(
    `INSERT INTO submissions (id, narrative_id, field, value, submitter_wallet, message, signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (narrative_id, field, value) DO NOTHING RETURNING id`,
    [id, narrativeId, field, value, v.wallet, v.message, v.signature],
  );
  if (!inserted) throw new HttpError(409, "That entry already exists, vote for it instead");
  publish(narrativeId, "submission");
  return { id };
}

export async function castVote(v: Verified<"vote">) {
  const { narrativeId, field, submissionId } = v.payload;
  await votingNarrative(narrativeId);
  const s = await q1<any>(`SELECT id, field, hidden FROM submissions WHERE id = $1 AND narrative_id = $2`, [submissionId, narrativeId]);
  if (!s || s.field !== field || s.hidden) throw new HttpError(404, "Entry not found");
  const inserted = await q1(
    `INSERT INTO votes (narrative_id, field, voter_wallet, submission_id, message, signature)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING voter_wallet`,
    [narrativeId, field, v.wallet, submissionId, v.message, v.signature],
  );
  if (!inserted) throw new HttpError(409, "You already voted on this field");
  publish(narrativeId, "vote");
}

/** Community chat. Open in every stage; same signature, moderation and report rules as entries. */
export async function addComment(v: Verified<"comment">): Promise<{ id: string }> {
  const { narrativeId } = v.payload;
  const body = v.payload.body.trim();
  const n = await q1<any>(`SELECT id, hidden FROM narratives WHERE id = $1`, [narrativeId]);
  if (!n || n.hidden) throw new HttpError(404, "Narrative not found");
  // Plain text only: line breaks are fine, other control characters are not.
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(body)) throw new HttpError(400, "Messages can only contain text");
  if (body !== normaliseComment(body)) throw new HttpError(400, "Message has extra blank lines or spaces");
  if (countWords(body) > COMMENT_MAX_WORDS) throw new HttpError(400, `Keep it under ${COMMENT_MAX_WORDS} words`);
  if (body.split("\n").length > COMMENT_MAX_LINES) throw new HttpError(400, `Keep it under ${COMMENT_MAX_LINES} lines`);
  checkText(body, "pitch");
  const recent = await q1<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM comments WHERE wallet = $1 AND created_at > now() - interval '1 minute'`,
    [v.wallet],
  );
  if (Number(recent?.c ?? 0) >= 6) throw new HttpError(429, "You're posting too fast, wait a moment");
  const id = randomUUID();
  await q(`INSERT INTO comments (id, narrative_id, wallet, body, message, signature) VALUES ($1,$2,$3,$4,$5,$6)`, [
    id,
    narrativeId,
    v.wallet,
    body,
    v.message,
    v.signature,
  ]);
  publish(narrativeId, "comment", { wallet: v.wallet });
  return { id };
}

const REPORT_TABLE = { narrative: "narratives", submission: "submissions", comment: "comments" } as const;

export async function report(v: Verified<"report">) {
  const { targetType, targetId, reason } = v.payload;
  const table = REPORT_TABLE[targetType];
  const inserted = await q1(
    `INSERT INTO reports (target_type, target_id, reporter_wallet, reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING target_id`,
    [targetType, targetId, v.wallet, reason],
  );
  if (!inserted) throw new HttpError(409, "You already reported this");
  const row = await q1<any>(
    `UPDATE ${table} SET report_count = report_count + 1, hidden = (report_count + 1 >= $2) WHERE id = $1 RETURNING ${
      targetType === "narrative" ? "id" : "narrative_id"
    } AS nid`,
    [targetId, HIDE_THRESHOLD],
  );
  if (row) publish(row.nid, "report");
}

// ---- tally + lock ---------------------------------------------------------------------------

export interface Entry {
  id: string;
  field: Field;
  value: string;
  votes: number;
  submitter: string;
  createdAt: string;
  hidden: boolean;
}

export async function entries(narrativeId: string): Promise<Entry[]> {
  const rows = await q<any>(
    `SELECT s.id, s.field, s.value, s.submitter_wallet, s.created_at, s.hidden, COUNT(v.voter_wallet)::int AS votes
       FROM submissions s LEFT JOIN votes v ON v.submission_id = s.id
      WHERE s.narrative_id = $1
      GROUP BY s.id
      ORDER BY s.field, votes DESC, s.created_at ASC, s.id ASC`,
    [narrativeId],
  );
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    value: r.value,
    votes: Number(r.votes),
    submitter: r.submitter_wallet,
    createdAt: date(r.created_at).toISOString(),
    hidden: Boolean(r.hidden),
  }));
}

/** Highest votes wins; ties → earliest submission (rows are already in that order). */
export function winners(list: Entry[]): Partial<Record<Field, Entry>> {
  const out: Partial<Record<Field, Entry>> = {};
  for (const e of list) if (!e.hidden && !out[e.field]) out[e.field] = e;
  return out;
}

/** Called by the scheduler once voting has ended. Idempotent. */
export async function finalizeVoting(narrativeId: string): Promise<void> {
  const n = await q1<any>(`SELECT * FROM narratives WHERE id = $1`, [narrativeId]);
  if (!n || n.stage !== "voting" || date(n.vote_ends_at).getTime() > Date.now()) return;

  const win = winners(await entries(narrativeId));
  if (n.hidden || REQUIRED_FIELDS.some((f) => !win[f])) {
    await q(`UPDATE narratives SET stage = 'cancelled', updated_at = now() WHERE id = $1 AND stage = 'voting'`, [narrativeId]);
    publish(narrativeId, "stage");
    return;
  }

  let lock = await q1<any>(`SELECT * FROM locks WHERE narrative_id = $1`, [narrativeId]);
  if (!lock) {
    const votes = await q<any>(
      `SELECT field, voter_wallet, submission_id, signature FROM votes WHERE narrative_id = $1`,
      [narrativeId],
    );
    const votesRoot = merkleRoot(votes.map((v) => sha256Hex(`${v.field}|${v.voter_wallet}|${v.submission_id}|${v.signature}`)));
    const name = win.name!.value;
    const symbol = win.ticker!.value;
    const image = win.image ? `${config.publicUrl}${win.image.value}` : null;
    const links = { twitter: win.x?.value ?? null, telegram: win.telegram?.value ?? null, website: win.website?.value ?? null };
    // Field names follow pump.fun's metadata JSON.
    const metadata = {
      name,
      symbol,
      description: n.pitch,
      image,
      showName: true,
      createdOn: `${config.publicUrl}/n/${n.slug}`,
      twitter: links.twitter ?? undefined,
      telegram: links.telegram ?? undefined,
      website: links.website ?? undefined,
    };
    const metadataJson = canonicalJson(metadata);
    // Simulation serves metadata from our API. On-chain mode pins it to IPFS (content-addressed).
    const metadataUri = `${config.publicUrl}/api/metadata/${narrativeId}`;
    const winnerIds = Object.fromEntries(FIELDS.filter((f) => win[f]).map((f) => [f, win[f]!.id]));
    // How the coin launches. Hashed into details, so the on-chain lock hash commits to it too.
    // Creator fees are not here: the pool votes on them with its deposits (D-019). The pair is
    // the creator's (D-024); narratives from before voted on it.
    const pair = n.pair ?? win.pair?.value ?? SOL_PAIR.symbol;
    // The mint the pool holds on this chain (devnet USDC differs from mainnet's).
    const pairMint =
      (pair === SOL_PAIR.symbol ? SOL_PAIR.mint : poolCurrency(pair)?.unit.mint) ??
      (await pumpPairs()).find((o) => o.symbol === pair)?.mint ??
      knownPair(pair)?.mint ??
      null;
    const launch = { venue: "pump.fun", pair, pairMint };
    const detailsHash = sha256Hex(canonicalJson({ narrativeId, chain: config.chain, metadata, votesRoot, winners: winnerIds, launch }));
    const hash = lockHash(uuidBytes(narrativeId), name, symbol, metadataUri, fromHex(detailsHash));
    await q(
      `INSERT INTO locks (narrative_id, name, symbol, image, links, metadata_json, metadata_uri, details_hash, lock_hash, votes_root, winners, launch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (narrative_id) DO NOTHING`,
      [narrativeId, name, symbol, image, JSON.stringify(links), metadataJson, metadataUri, detailsHash, hash, votesRoot, JSON.stringify(winnerIds), JSON.stringify(launch)],
    );
    lock = await q1<any>(`SELECT * FROM locks WHERE narrative_id = $1`, [narrativeId]);
  }

  const c = typeof n.config === "string" ? JSON.parse(n.config) : n.config;
  // The snapshot's limits are in this currency. Older narratives (no `pool`) pool SOL.
  const pool = poolCurrency(c.pool ?? SOL_PAIR.symbol);
  if (!pool) {
    console.error(`createEscrow skipped for ${narrativeId}: no pool currency for ${c.pool}`);
    return;
  }
  const start = new Date();
  const depositEnd = new Date(start.getTime() + c.depositWindowSec * 1000);
  const launchAfter = new Date(depositEnd.getTime() + c.launchDelaySec * 1000);
  const launchDeadline = new Date(launchAfter.getTime() + c.launchWindowSec * 1000);
  try {
    await chain().createEscrow({
      narrativeId,
      name: lock.name,
      symbol: lock.symbol,
      uri: lock.metadata_uri,
      lockHash: lock.lock_hash,
      detailsHash: lock.details_hash,
      proposer: n.creator_wallet,
      poolCap: BigInt(c.poolCap),
      poolMin: BigInt(c.poolMin),
      perWalletMax: BigInt(c.perWalletMax),
      minDeposit: BigInt(c.minDeposit),
      feeBps: c.feeBps,
      depositStart: start,
      depositEnd,
      launchAfter,
      launchDeadline,
      trancheCount: c.trancheCount,
      trancheIntervalSec: c.trancheIntervalSec,
      pool: { unit: pool.unit, viaQuoteControl: pool.viaQuoteControl },
    });
  } catch (e) {
    if (!(e instanceof ChainError)) throw e;
    console.error(`createEscrow failed for ${narrativeId}: ${e.message}`);
    return;
  }
  await q(`UPDATE narratives SET stage = 'pooling', updated_at = now() WHERE id = $1 AND stage = 'voting'`, [narrativeId]);
  publish(narrativeId, "stage");
}
