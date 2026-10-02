// Tiny SQL layer that works on Postgres (Railway, DATABASE_URL) and on embedded PGlite
// (local dev without a Postgres install). The DB is a cache + coordination layer; in
// CHAIN=mock mode the escrow tables ARE the simulated chain.
import "server-only";

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  chain TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  pitch TEXT NOT NULL,
  source_url TEXT,
  stage TEXT NOT NULL,
  vote_ends_at TIMESTAMPTZ NOT NULL,
  config JSONB NOT NULL,
  create_message TEXT NOT NULL,
  create_signature TEXT NOT NULL,
  report_count INT NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS narratives_stage_idx ON narratives(stage);
CREATE INDEX IF NOT EXISTS narratives_creator_idx ON narratives(creator_wallet);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  submitter_wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  report_count INT NOT NULL DEFAULT 0,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (narrative_id, field, value)
);

CREATE TABLE IF NOT EXISTS votes (
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  field TEXT NOT NULL,
  voter_wallet TEXT NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (narrative_id, field, voter_wallet)
);
CREATE INDEX IF NOT EXISTS votes_voter_idx ON votes(voter_wallet);

CREATE TABLE IF NOT EXISTS locks (
  narrative_id TEXT PRIMARY KEY REFERENCES narratives(id),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  image TEXT,
  links JSONB NOT NULL,
  metadata_json TEXT NOT NULL,
  metadata_uri TEXT NOT NULL,
  details_hash TEXT NOT NULL,
  lock_hash TEXT NOT NULL,
  votes_root TEXT NOT NULL,
  winners JSONB NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrows (
  narrative_id TEXT PRIMARY KEY REFERENCES narratives(id),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  vault TEXT NOT NULL,
  create_tx TEXT,
  pool_cap BIGINT NOT NULL,
  pool_min BIGINT NOT NULL,
  per_wallet_max BIGINT NOT NULL,
  min_deposit BIGINT NOT NULL,
  fee_bps INT NOT NULL,
  deposit_start TIMESTAMPTZ NOT NULL,
  deposit_end TIMESTAMPTZ NOT NULL,
  launch_after TIMESTAMPTZ NOT NULL,
  launch_deadline TIMESTAMPTZ NOT NULL,
  tranche_count INT NOT NULL,
  tranche_interval INT NOT NULL,
  total_deposited BIGINT NOT NULL DEFAULT 0,
  total_refunded BIGINT NOT NULL DEFAULT 0,
  depositor_count INT NOT NULL DEFAULT 0,
  next_order_index INT NOT NULL DEFAULT 0,
  launched BOOLEAN NOT NULL DEFAULT FALSE,
  launched_at TIMESTAMPTZ,
  mint TEXT,
  launch_tx TEXT,
  platform_fee BIGINT,
  tokens_bought BIGINT,
  tokens_claimed BIGINT NOT NULL DEFAULT 0,
  base_leftover BIGINT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  wallet TEXT NOT NULL,
  amount BIGINT NOT NULL,
  first_order_index INT NOT NULL,
  deposit_count INT NOT NULL,
  tokens_claimed BIGINT NOT NULL DEFAULT 0,
  leftover_paid BOOLEAN NOT NULL DEFAULT FALSE,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (narrative_id, wallet)
);
CREATE INDEX IF NOT EXISTS receipts_wallet_idx ON receipts(wallet);

CREATE TABLE IF NOT EXISTS deposits (
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  order_index INT NOT NULL,
  wallet TEXT NOT NULL,
  amount BIGINT NOT NULL,
  tx TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (narrative_id, order_index)
);

CREATE TABLE IF NOT EXISTS claims (
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  wallet TEXT NOT NULL,
  tokens BIGINT NOT NULL,
  lamports BIGINT NOT NULL,
  unlocked_tranches INT NOT NULL,
  tx TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claims_wallet_idx ON claims(wallet);

CREATE TABLE IF NOT EXISTS refunds (
  narrative_id TEXT NOT NULL REFERENCES narratives(id),
  wallet TEXT NOT NULL,
  amount BIGINT NOT NULL,
  tx TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (narrative_id, wallet)
);

CREATE TABLE IF NOT EXISTS reports (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reporter_wallet TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id, reporter_wallet)
);

CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function open(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    await pool.query(SCHEMA);
    return {
      query: (text, params) => pool.query(text, params as any[]),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn({ query: (t, p) => client.query(t, p as any[]) });
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR ?? "./.data/pglite");
  await pg.exec(SCHEMA);
  return {
    query: (text, params) => pg.query(text, params as any[]),
    transaction: (fn) => pg.transaction((tx) => fn({ query: (t, p) => tx.query(t, p as any[]) })),
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __narrativepadDb: Promise<Database> | undefined;
}

export function database(): Promise<Database> {
  globalThis.__narrativepadDb ??= open();
  return globalThis.__narrativepadDb;
}

export async function q<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
  const db = await database();
  return (await db.query(text, params)).rows as T[];
}

export async function q1<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const db = await database();
  return db.transaction(fn);
}

/** pg returns BIGINT as string, PGlite may return bigint or number: normalise. */
export const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));
export const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
