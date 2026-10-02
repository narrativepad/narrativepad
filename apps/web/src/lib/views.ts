// Read models for pages. Everything returned here is plain JSON (lamports/tokens as strings) so
// it can cross the server→client boundary. Only data the system actually has is shown: no
// invented market prices, and no placeholder addresses in preview mode.
import "server-only";
import { chain } from "./chain";
import { config } from "./config";
import { big, date, q, q1 } from "./db";
import { proRata, unlockedTranches, vested } from "./math";
import { FIELDS, type Field } from "./messages";
import type { PairOption } from "./pairs";
import { pumpPairs } from "./pumpPairs";
import { entries, winners, type Entry } from "./narratives";
import { phaseOf, stageFromPhase, type Phase, type Stage } from "./phase";

const preview = () => config.chain === "mock";

export interface EscrowView {
  /** On-chain addresses; null in preview mode (nothing is on-chain yet). */
  address: string | null;
  addressUrl: string | null;
  mint: string | null;
  mintUrl: string | null;
  launchTxUrl: string | null;
  phase: Phase;
  poolCap: string;
  poolMin: string;
  perWalletMax: string;
  minDeposit: string;
  feeBps: number;
  totalDeposited: string;
  totalRefunded: string;
  depositorCount: number;
  depositStart: string;
  depositEnd: string;
  launchAfter: string;
  launchDeadline: string;
  trancheCount: number;
  trancheIntervalSec: number;
  launched: boolean;
  launchedAt: string | null;
  platformFee: string;
  tokensBought: string;
  tokensClaimed: string;
  baseLeftover: string;
  unlocked: number;
  /** Lamports behind each side of the holder-rewards vote (D-019). */
  holderVotesOn: string;
  holderVotesOff: string;
  /** Settled at launch; null before. */
  holderRewards: boolean | null;
}

export interface DepositView {
  orderIndex: number;
  wallet: string;
  amount: string;
  at: string;
  isTeam: boolean;
  /** This deposit's holder-rewards vote; null for deposits made before D-019. */
  holderRewards: boolean | null;
}

export interface NarrativeCard {
  id: string;
  slug: string;
  pitch: string;
  stage: Stage;
  title: string;
  ticker: string | null;
  image: string | null;
  createdAt: string;
  voteEndsAt: string;
  creator: string;
  votes: number;
  escrow: Pick<
    EscrowView,
    | "phase"
    | "totalDeposited"
    | "poolCap"
    | "poolMin"
    | "depositEnd"
    | "launchAfter"
    | "launchedAt"
    | "depositorCount"
    | "feeBps"
    | "tokensBought"
    | "tokensClaimed"
    | "trancheCount"
    | "unlocked"
  > | null;
  /** Normalised 0..1 cumulative pool size over time (sparkline). */
  flow: number[] | null;
  comments: number;
  /** Activity in the last TREND_MINUTES, for the Trending tab. */
  trend: { votes: number; comments: number; deposits: number; lamports: string; score: number };
}

export const TREND_MINUTES = 15;

/** Momentum: deposits weigh most, then votes, then chat. */
const trendScore = (votes: number, comments: number, deposits: number, lamports: bigint) =>
  votes + comments * 0.5 + deposits * 3 + Number(lamports) / 5e8;

export interface ActivityItem {
  kind: "vote" | "submit" | "deposit" | "claim" | "refund";
  wallet: string;
  field: string | null;
  value: string | null;
  amount: string | null;
  at: string;
}

export interface GlobalActivityItem extends ActivityItem {
  slug: string;
  title: string;
}

function escrowView(e: any): EscrowView {
  const c = chain();
  const now = Date.now();
  const phase = phaseOf(
    {
      launched: Boolean(e.launched),
      depositStart: date(e.deposit_start).getTime(),
      depositEnd: date(e.deposit_end).getTime(),
      launchAfter: date(e.launch_after).getTime(),
      launchDeadline: date(e.launch_deadline).getTime(),
      totalDeposited: big(e.total_deposited),
      poolMin: big(e.pool_min),
    },
    now,
  );
  const onchain = !preview();
  return {
    address: onchain ? e.address : null,
    addressUrl: onchain ? c.explorer.address(e.address) : null,
    mint: onchain ? (e.mint ?? null) : null,
    mintUrl: onchain && e.mint ? c.explorer.token(e.mint) : null,
    launchTxUrl: onchain && e.launch_tx ? c.explorer.tx(e.launch_tx) : null,
    phase,
    poolCap: big(e.pool_cap).toString(),
    poolMin: big(e.pool_min).toString(),
    perWalletMax: big(e.per_wallet_max).toString(),
    minDeposit: big(e.min_deposit).toString(),
    feeBps: Number(e.fee_bps),
    totalDeposited: big(e.total_deposited).toString(),
    totalRefunded: big(e.total_refunded).toString(),
    depositorCount: Number(e.depositor_count),
    depositStart: date(e.deposit_start).toISOString(),
    depositEnd: date(e.deposit_end).toISOString(),
    launchAfter: date(e.launch_after).toISOString(),
    launchDeadline: date(e.launch_deadline).toISOString(),
    trancheCount: Number(e.tranche_count),
    trancheIntervalSec: Number(e.tranche_interval),
    launched: Boolean(e.launched),
    launchedAt: e.launched_at ? date(e.launched_at).toISOString() : null,
    platformFee: big(e.platform_fee).toString(),
    tokensBought: big(e.tokens_bought).toString(),
    tokensClaimed: big(e.tokens_claimed).toString(),
    baseLeftover: big(e.base_leftover).toString(),
    unlocked: e.launched
      ? unlockedTranches(now / 1000, date(e.launched_at).getTime() / 1000, Number(e.tranche_interval), Number(e.tranche_count))
      : 0,
    holderVotesOn: big(e.holder_votes_on).toString(),
    holderVotesOff: big(e.holder_votes_off).toString(),
    holderRewards: e.holder_rewards ?? null,
  };
}

/** Cumulative pool size, normalised to 0..1, sampled to at most `points` values. */
function flowSpark(amounts: bigint[], points = 24): number[] | null {
  if (amounts.length === 0) return null;
  let sum = 0n;
  const cum = [0, ...amounts.map((a) => Number((sum += a)))];
  const max = cum[cum.length - 1] || 1;
  const step = Math.max(1, Math.ceil(cum.length / points));
  const out = cum.filter((_, i) => i % step === 0).map((v) => v / max);
  if (out[out.length - 1] !== 1) out.push(1);
  return out;
}

// ---- feed -----------------------------------------------------------------------------------

export async function feed(limit = 120): Promise<NarrativeCard[]> {
  const rows = await q<any>(
    `SELECT n.*, l.name AS l_name, l.symbol AS l_symbol, l.image AS l_image,
            (SELECT COUNT(*)::int FROM votes v WHERE v.narrative_id = n.id) AS vote_count,
            (SELECT COUNT(*)::int FROM comments c WHERE c.narrative_id = n.id AND NOT c.hidden) AS comment_count,
            (SELECT COUNT(*)::int FROM votes v WHERE v.narrative_id = n.id AND v.created_at > now() - make_interval(mins => ${TREND_MINUTES})) AS t_votes,
            (SELECT COUNT(*)::int FROM comments c WHERE c.narrative_id = n.id AND NOT c.hidden AND c.created_at > now() - make_interval(mins => ${TREND_MINUTES})) AS t_comments,
            (SELECT COUNT(*)::int FROM deposits d WHERE d.narrative_id = n.id AND d.created_at > now() - make_interval(mins => ${TREND_MINUTES})) AS t_deposits,
            (SELECT COALESCE(SUM(d.amount), 0)::text FROM deposits d WHERE d.narrative_id = n.id AND d.created_at > now() - make_interval(mins => ${TREND_MINUTES})) AS t_lamports,
            e.narrative_id AS e_id, e.*
       FROM narratives n
       LEFT JOIN locks l ON l.narrative_id = n.id
       LEFT JOIN escrows e ON e.narrative_id = n.id
      WHERE NOT n.hidden
      ORDER BY n.created_at DESC
      LIMIT $1`,
    [limit],
  );
  const ids = rows.map((r) => r.id);
  const [leaders, deps] = ids.length
    ? await Promise.all([
        q<any>(
          `SELECT DISTINCT ON (s.narrative_id, s.field) s.narrative_id, s.field, s.value
             FROM submissions s LEFT JOIN votes v ON v.submission_id = s.id
            WHERE s.narrative_id = ANY($1) AND NOT s.hidden AND s.field IN ('name','ticker','image')
            GROUP BY s.id
            ORDER BY s.narrative_id, s.field, COUNT(v.voter_wallet) DESC, s.created_at ASC, s.id ASC`,
          [ids],
        ),
        q<any>(`SELECT narrative_id, amount FROM deposits WHERE narrative_id = ANY($1) ORDER BY narrative_id, order_index`, [ids]),
      ])
    : [[], []];
  const lead = new Map<string, Record<string, string>>();
  for (const l of leaders) {
    const m = lead.get(l.narrative_id) ?? {};
    m[l.field] = l.value;
    lead.set(l.narrative_id, m);
  }
  const amounts = new Map<string, bigint[]>();
  for (const d of deps) {
    const list = amounts.get(d.narrative_id) ?? [];
    list.push(big(d.amount));
    amounts.set(d.narrative_id, list);
  }

  return rows.map((r) => {
    const e = r.e_id ? escrowView(r) : null;
    const l = lead.get(r.id) ?? {};
    const stage: Stage = e ? stageFromPhase(e.phase) : (r.stage as Stage);
    return {
      id: r.id,
      slug: r.slug,
      pitch: r.pitch,
      stage,
      title: r.l_name ?? l.name ?? "Untitled narrative",
      ticker: r.l_symbol ?? l.ticker ?? null,
      image: r.l_image ?? l.image ?? null,
      createdAt: date(r.created_at).toISOString(),
      voteEndsAt: date(r.vote_ends_at).toISOString(),
      creator: r.creator_wallet,
      votes: Number(r.vote_count),
      escrow: e && {
        phase: e.phase,
        totalDeposited: e.totalDeposited,
        poolCap: e.poolCap,
        poolMin: e.poolMin,
        depositEnd: e.depositEnd,
        launchAfter: e.launchAfter,
        launchedAt: e.launchedAt,
        depositorCount: e.depositorCount,
        feeBps: e.feeBps,
        tokensBought: e.tokensBought,
        tokensClaimed: e.tokensClaimed,
        trancheCount: e.trancheCount,
        unlocked: e.unlocked,
      },
      flow: flowSpark(amounts.get(r.id) ?? []),
      comments: Number(r.comment_count),
      trend: {
        votes: Number(r.t_votes),
        comments: Number(r.t_comments),
        deposits: Number(r.t_deposits),
        lamports: big(r.t_lamports).toString(),
        score: trendScore(Number(r.t_votes), Number(r.t_comments), Number(r.t_deposits), big(r.t_lamports)),
      },
    };
  });
}

// ---- activity -------------------------------------------------------------------------------

/** The seeded SOL pair is not anyone's submission; `fees` rows are from the D-018 fee ballot. */
const NOT_PRESET = `NOT (field = 'pair' AND value = 'SOL') AND field <> 'fees'`;

const ACTIVITY_SQL = (where: string) => `
  (SELECT 'vote' AS kind, v.narrative_id, v.voter_wallet AS wallet, v.field, s.value, NULL::text AS amount, v.created_at AS at
     FROM votes v JOIN submissions s ON s.id = v.submission_id ${where.replace(/narrative_id/g, "v.narrative_id")})
  UNION ALL
  (SELECT 'submit', narrative_id, submitter_wallet, field, value, NULL, created_at FROM submissions ${where} ${where ? "AND" : "WHERE"} NOT hidden AND ${NOT_PRESET})
  UNION ALL
  (SELECT 'deposit', narrative_id, wallet, NULL, NULL, amount::text, created_at FROM deposits ${where})
  UNION ALL
  (SELECT 'claim', narrative_id, wallet, NULL, NULL, tokens::text, created_at FROM claims ${where})
  UNION ALL
  (SELECT 'refund', narrative_id, wallet, NULL, NULL, amount::text, created_at FROM refunds ${where})`;

const toActivity = (r: any): ActivityItem => ({
  kind: r.kind,
  wallet: r.wallet,
  field: r.field ?? null,
  value: r.value ?? null,
  amount: r.amount ?? null,
  at: date(r.at).toISOString(),
});

async function activity(narrativeId: string, limit = 60): Promise<ActivityItem[]> {
  const rows = await q<any>(`${ACTIVITY_SQL("WHERE narrative_id = $1")} ORDER BY at DESC LIMIT $2`, [narrativeId, limit]);
  return rows.map(toActivity);
}

/** Latest events across all narratives (the board's ticker tape). */
export async function globalActivity(limit = 30): Promise<GlobalActivityItem[]> {
  const rows = await q<any>(
    `SELECT a.*, n.slug,
            COALESCE(
              l.name,
              (SELECT s.value FROM submissions s WHERE s.narrative_id = n.id AND s.field = 'name' AND NOT s.hidden ORDER BY s.created_at LIMIT 1),
              'Untitled narrative'
            ) AS title
       FROM (${ACTIVITY_SQL("")} ORDER BY at DESC LIMIT $1) a
       JOIN narratives n ON n.id = a.narrative_id
       LEFT JOIN locks l ON l.narrative_id = a.narrative_id
      WHERE NOT n.hidden
      ORDER BY a.at DESC`,
    [limit],
  );
  return rows.map((r) => ({ ...toActivity(r), slug: r.slug, title: String(r.title).slice(0, 40) }));
}

// ---- narrative page -------------------------------------------------------------------------

export interface NarrativeDetail {
  id: string;
  slug: string;
  pitch: string;
  sourceUrl: string | null;
  creator: string;
  creatorIsTeam: boolean;
  createdAt: string;
  voteEndsAt: string;
  stage: Stage;
  hidden: boolean;
  title: string;
  ticker: string | null;
  image: string | null;
  ballots: Record<Field, { entries: (Entry & { isTeam: boolean })[]; leaderId: string | null; total: number }>;
  totalVotes: number;
  voters: number;
  entryCount: number;
  lock: {
    name: string;
    symbol: string;
    image: string | null;
    links: { twitter: string | null; telegram: string | null; website: string | null };
    /** Venue and pair (D-018/D-019). Null on locks made before it existed; `fees` only on
     *  D-018 locks, before the fee vote moved into the pool. */
    launch: { venue: string; pair: string; pairMint?: string | null; fees?: string } | null;
    metadataUri: string;
    metadataJson: string;
    detailsHash: string;
    lockHash: string;
    votesRoot: string;
    winners: Record<string, string>;
    lockedAt: string;
  } | null;
  chain: string;
  escrow: EscrowView | null;
  deposits: DepositView[];
  /** Cumulative pool size after each deposit (for the pool-flow chart). */
  flow: { t: number; total: string }[];
  activity: ActivityItem[];
  comments: CommentView[];
  /** One row per depositing wallet, biggest first. Tokens only once launched. */
  holders: { wallet: string; amount: string; sharePct: number; tokens: string | null; refunded: boolean; isTeam: boolean }[];
  preview: boolean;
  /** pump.fun's current pairs, for the pair ballot. Empty once voting is over. */
  pairOptions: PairOption[];
}

export interface CommentView {
  id: string;
  wallet: string;
  body: string;
  at: string;
  isCreator: boolean;
  isTeam: boolean;
  /** Has SOL in this narrative's pool (not refunded). */
  inPool: boolean;
}

export async function narrativeBySlug(slug: string): Promise<NarrativeDetail | null> {
  const n = await q1<any>(`SELECT * FROM narratives WHERE slug = $1`, [slug]);
  if (!n) return null;
  const [list, lock, e, deps, voteCount, voterCount, feedItems, comments, receiptRows] = await Promise.all([
    entries(n.id),
    q1<any>(`SELECT * FROM locks WHERE narrative_id = $1`, [n.id]),
    q1<any>(`SELECT * FROM escrows WHERE narrative_id = $1`, [n.id]),
    q<any>(`SELECT * FROM deposits WHERE narrative_id = $1 ORDER BY order_index ASC`, [n.id]),
    q1<any>(`SELECT COUNT(*)::int AS c FROM votes WHERE narrative_id = $1`, [n.id]),
    q1<any>(`SELECT COUNT(DISTINCT voter_wallet)::int AS c FROM votes WHERE narrative_id = $1`, [n.id]),
    activity(n.id),
    commentsFor(n.id, n.creator_wallet),
    q<any>(`SELECT wallet, amount, refunded FROM receipts WHERE narrative_id = $1 ORDER BY amount DESC, first_order_index ASC`, [n.id]),
  ]);
  const poolTotal = receiptRows.reduce((s, r) => s + big(r.amount), 0n);
  const team = config.teamWallets;
  const lead = winners(list);
  const ballots = Object.fromEntries(
    FIELDS.map((f) => {
      const fe = list.filter((x) => x.field === f && !x.hidden).map((x) => ({ ...x, isTeam: team.has(x.submitter) }));
      return [f, { entries: fe, leaderId: lead[f]?.id ?? null, total: fe.reduce((s, x) => s + x.votes, 0) }];
    }),
  ) as NarrativeDetail["ballots"];
  const escrow = e ? escrowView(e) : null;
  const stage: Stage = escrow ? stageFromPhase(escrow.phase) : (n.stage as Stage);
  const links = lock ? (typeof lock.links === "string" ? JSON.parse(lock.links) : lock.links) : null;
  let running = 0n;

  return {
    id: n.id,
    slug: n.slug,
    pitch: n.pitch,
    sourceUrl: n.source_url,
    creator: n.creator_wallet,
    creatorIsTeam: team.has(n.creator_wallet),
    createdAt: date(n.created_at).toISOString(),
    voteEndsAt: date(n.vote_ends_at).toISOString(),
    stage,
    hidden: Boolean(n.hidden),
    title: lock?.name ?? lead.name?.value ?? "Untitled narrative",
    ticker: lock?.symbol ?? lead.ticker?.value ?? null,
    image: lock?.image ?? lead.image?.value ?? null,
    ballots,
    totalVotes: Number(voteCount?.c ?? 0),
    voters: Number(voterCount?.c ?? 0),
    entryCount: list.filter((x) => !x.hidden).length,
    lock: lock && {
      name: lock.name,
      symbol: lock.symbol,
      image: lock.image,
      links,
      launch: typeof lock.launch === "string" ? JSON.parse(lock.launch) : (lock.launch ?? null),
      metadataUri: lock.metadata_uri,
      metadataJson: lock.metadata_json,
      detailsHash: lock.details_hash,
      lockHash: lock.lock_hash,
      votesRoot: lock.votes_root,
      winners: typeof lock.winners === "string" ? JSON.parse(lock.winners) : lock.winners,
      lockedAt: date(lock.locked_at).toISOString(),
    },
    chain: n.chain,
    escrow,
    deposits: deps.map((d) => ({
      orderIndex: Number(d.order_index),
      wallet: d.wallet,
      amount: big(d.amount).toString(),
      at: date(d.created_at).toISOString(),
      isTeam: team.has(d.wallet),
      holderRewards: d.holder_rewards ?? null,
    })),
    flow: deps.map((d) => ({ t: date(d.created_at).getTime(), total: (running += big(d.amount)).toString() })),
    activity: feedItems,
    comments,
    holders: receiptRows.map((r) => ({
      wallet: r.wallet,
      amount: big(r.amount).toString(),
      sharePct: poolTotal > 0n ? Number((big(r.amount) * 1_000_000n) / poolTotal) / 10_000 : 0,
      tokens: escrow?.launched ? proRata(BigInt(escrow.tokensBought), big(r.amount), BigInt(escrow.totalDeposited)).toString() : null,
      refunded: Boolean(r.refunded),
      isTeam: team.has(r.wallet),
    })),
    preview: preview(),
    pairOptions: stage === "voting" ? await pumpPairs({ wait: false }) : [],
  };
}

/** A coin's chat, oldest first: the latest 200, or only those after `after` (live updates). */
export async function commentsFor(narrativeId: string, creatorWallet: string, after?: Date): Promise<CommentView[]> {
  const [rows, holders] = await Promise.all([
    after
      ? q<any>(
          `SELECT id, wallet, body, created_at FROM comments WHERE narrative_id = $1 AND NOT hidden AND created_at > $2 ORDER BY created_at ASC LIMIT 200`,
          [narrativeId, after],
        )
      : q<any>(`SELECT id, wallet, body, created_at FROM comments WHERE narrative_id = $1 AND NOT hidden ORDER BY created_at DESC LIMIT 200`, [narrativeId]).then(
          (r) => r.reverse(),
        ),
    q<{ wallet: string }>(`SELECT wallet FROM receipts WHERE narrative_id = $1 AND NOT refunded AND amount > 0`, [narrativeId]),
  ]);
  const inPool = new Set(holders.map((h) => h.wallet));
  return rows.map((c) => ({
    id: c.id,
    wallet: c.wallet,
    body: c.body,
    at: date(c.created_at).toISOString(),
    isCreator: c.wallet === creatorWallet,
    isTeam: config.teamWallets.has(c.wallet),
    inPool: inPool.has(c.wallet),
  }));
}

/** What a wallet can do right now in an escrow (for the claim/refund buttons). */
export async function walletPosition(narrativeId: string, wallet: string) {
  const [e, r] = await Promise.all([
    q1<any>(`SELECT * FROM escrows WHERE narrative_id = $1`, [narrativeId]),
    q1<any>(`SELECT * FROM receipts WHERE narrative_id = $1 AND wallet = $2`, [narrativeId, wallet]),
  ]);
  if (!e || !r) return null;
  return positionFrom(e, r);
}

/** Position maths for one receipt in one escrow row (shared by the coin page and the portfolio). */
function positionFrom(e: any, r: any) {
  const total = big(e.total_deposited);
  const amount = big(r.amount);
  const count = Number(e.tranche_count);
  let entitlement = 0n;
  let claimable = 0n;
  let unlocked = 0;
  let leftover = 0n;
  if (e.launched) {
    entitlement = proRata(big(e.tokens_bought), amount, total);
    unlocked = unlockedTranches(Date.now() / 1000, date(e.launched_at).getTime() / 1000, Number(e.tranche_interval), count);
    claimable = vested(entitlement, unlocked, count) - big(r.tokens_claimed);
    leftover = r.leftover_paid ? 0n : proRata(big(e.base_leftover), amount, total);
  }
  return {
    deposited: amount.toString(),
    sharePct: total > 0n ? Number((amount * 1_000_000n) / total) / 10_000 : 0,
    entitlement: entitlement.toString(),
    claimed: big(r.tokens_claimed).toString(),
    claimable: claimable.toString(),
    leftover: leftover.toString(),
    unlocked,
    trancheCount: count,
    refunded: Boolean(r.refunded),
  };
}

export interface PortfolioItem extends ReturnType<typeof positionFrom> {
  narrativeId: string;
  slug: string;
  title: string;
  ticker: string | null;
  image: string | null;
  stage: Stage;
  phase: Phase;
  depositEnd: string;
  launchAfter: string;
}

/** Every pool a wallet has joined, with what it can claim or refund right now. */
export async function portfolio(wallet: string): Promise<PortfolioItem[]> {
  const receipts = await q<any>(`SELECT * FROM receipts WHERE wallet = $1`, [wallet]);
  if (receipts.length === 0) return [];
  const ids = receipts.map((r) => r.narrative_id);
  const [escrows, meta] = await Promise.all([
    q<any>(`SELECT * FROM escrows WHERE narrative_id = ANY($1)`, [ids]),
    q<any>(
      `SELECT n.id, n.slug, n.created_at, n.hidden, l.name, l.symbol, l.image
         FROM narratives n LEFT JOIN locks l ON l.narrative_id = n.id WHERE n.id = ANY($1)`,
      [ids],
    ),
  ]);
  const escrowBy = new Map(escrows.map((e) => [e.narrative_id, e]));
  const metaBy = new Map(meta.map((m) => [m.id, m]));
  const items: (PortfolioItem & { created: number })[] = [];
  for (const r of receipts) {
    const e = escrowBy.get(r.narrative_id);
    const m = metaBy.get(r.narrative_id);
    if (!e || !m) continue;
    const view = escrowView(e);
    items.push({
      narrativeId: r.narrative_id,
      slug: m.slug,
      title: m.name ?? "Untitled narrative",
      ticker: m.symbol ?? null,
      image: m.image ?? null,
      stage: stageFromPhase(view.phase),
      phase: view.phase,
      depositEnd: view.depositEnd,
      launchAfter: view.launchAfter,
      created: date(m.created_at).getTime(),
      ...positionFrom(e, r),
    });
  }
  return items.sort((a, b) => b.created - a.created).map(({ created: _created, ...rest }) => rest);
}

// ---- profile & leaderboard ------------------------------------------------------------------

export async function profile(wallet: string) {
  const [created, votes, receipts, claims, refunds] = await Promise.all([
    q<any>(`SELECT slug, pitch, stage, created_at FROM narratives WHERE creator_wallet = $1 AND NOT hidden ORDER BY created_at DESC`, [wallet]),
    q<any>(
      `SELECT v.field, v.created_at, s.value, n.slug, n.pitch FROM votes v
         JOIN submissions s ON s.id = v.submission_id JOIN narratives n ON n.id = v.narrative_id
        WHERE v.voter_wallet = $1 ORDER BY v.created_at DESC LIMIT 200`,
      [wallet],
    ),
    q<any>(
      `SELECT r.*, n.slug, l.name, l.symbol FROM receipts r JOIN narratives n ON n.id = r.narrative_id
         LEFT JOIN locks l ON l.narrative_id = r.narrative_id WHERE r.wallet = $1 ORDER BY n.created_at DESC`,
      [wallet],
    ),
    q<any>(`SELECT c.*, n.slug FROM claims c JOIN narratives n ON n.id = c.narrative_id WHERE c.wallet = $1 ORDER BY c.created_at DESC`, [wallet]),
    q<any>(`SELECT f.*, n.slug FROM refunds f JOIN narratives n ON n.id = f.narrative_id WHERE f.wallet = $1 ORDER BY f.created_at DESC`, [wallet]),
  ]);
  const board = await leaderboard();
  return {
    wallet,
    isTeam: config.teamWallets.has(wallet),
    created: created.map((c) => ({ slug: c.slug, pitch: c.pitch, stage: c.stage, createdAt: date(c.created_at).toISOString() })),
    votes: votes.map((v) => ({ field: v.field, value: v.value, slug: v.slug, pitch: v.pitch, at: date(v.created_at).toISOString() })),
    positions: receipts.map((r) => ({
      slug: r.slug,
      name: r.name,
      symbol: r.symbol,
      amount: big(r.amount).toString(),
      tokensClaimed: big(r.tokens_claimed).toString(),
      refunded: Boolean(r.refunded),
    })),
    claims: claims.map((c) => ({ slug: c.slug, tokens: big(c.tokens).toString(), lamports: big(c.lamports).toString(), at: date(c.created_at).toISOString() })),
    refunds: refunds.map((f) => ({ slug: f.slug, amount: big(f.amount).toString(), at: date(f.created_at).toISOString() })),
    rank: {
      creator: board.creators.findIndex((c) => c.wallet === wallet) + 1 || null,
      voter: board.voters.findIndex((v) => v.wallet === wallet) + 1 || null,
      raised: board.creators.find((c) => c.wallet === wallet)?.raised ?? "0",
      picks: board.voters.find((v) => v.wallet === wallet)?.picks ?? 0,
    },
  };
}

/**
 * Reputation from real activity: creators rank by SOL their narratives pooled (launches break
 * ties); voters rank by how often they picked the entry that won.
 */
export async function leaderboard() {
  const [creators, voters, pools] = await Promise.all([
    q<any>(
      `SELECT n.creator_wallet AS wallet,
              COUNT(*)::int AS narratives,
              COUNT(e.narrative_id) FILTER (WHERE e.launched)::int AS launches,
              COALESCE(SUM(e.total_deposited - e.total_refunded), 0)::text AS raised
         FROM narratives n LEFT JOIN escrows e ON e.narrative_id = n.id
        WHERE NOT n.hidden
        GROUP BY n.creator_wallet
        ORDER BY COALESCE(SUM(e.total_deposited - e.total_refunded), 0) DESC, launches DESC, narratives DESC
        LIMIT 50`,
    ),
    q<any>(
      `SELECT v.voter_wallet AS wallet,
              COUNT(*)::int AS votes,
              COUNT(*) FILTER (WHERE l.winners ->> v.field = v.submission_id)::int AS picks
         FROM votes v LEFT JOIN locks l ON l.narrative_id = v.narrative_id
        GROUP BY v.voter_wallet
        ORDER BY picks DESC, votes DESC
        LIMIT 50`,
    ),
    feed(500),
  ]);
  const topPools = pools
    .filter((n) => n.escrow && n.stage !== "refunding")
    .sort((a, b) => Number(BigInt(b.escrow!.totalDeposited) - BigInt(a.escrow!.totalDeposited)))
    .slice(0, 50);
  return {
    creators: creators.map((c) => ({ wallet: c.wallet, narratives: Number(c.narratives), launches: Number(c.launches), raised: String(c.raised) })),
    voters: voters.map((v) => ({ wallet: v.wallet, votes: Number(v.votes), picks: Number(v.picks) })),
    pools: topPools,
  };
}

export async function stats() {
  const r = await q1<any>(
    `SELECT (SELECT COUNT(*)::int FROM narratives WHERE NOT hidden) AS narratives,
            (SELECT COALESCE(SUM(total_deposited - total_refunded), 0)::text FROM escrows) AS pooled,
            (SELECT COUNT(*)::int FROM escrows WHERE launched) AS launched,
            (SELECT COUNT(DISTINCT voter_wallet)::int FROM votes) AS voters,
            (SELECT COUNT(*)::int FROM votes) AS votes`,
  );
  return {
    narratives: Number(r?.narratives ?? 0),
    pooled: String(r?.pooled ?? "0"),
    launched: Number(r?.launched ?? 0),
    voters: Number(r?.voters ?? 0),
    votes: Number(r?.votes ?? 0),
  };
}
