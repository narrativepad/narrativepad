// Stage transitions + permissionless cranks. Launch/refund/claim never DEPEND on this process:
// in on-chain mode anyone can call them (scripts/crank in the README); here we just do it first.
import "server-only";
import { chain, ChainError } from "./chain";
import { phaseFor } from "./chain/mock";
import { config } from "./config";
import { q } from "./db";
import { publish } from "./events";
import { finalizeVoting } from "./narratives";
import { stageFromPhase } from "./phase";

const TICK_MS = 2_000;
/** On-chain: re-read an open escrow at most this often, and retry a launch at most this often. */
const SYNC_MS = 8_000;
const LAUNCH_RETRY_MS = 20_000;
const lastSync = new Map<string, number>();
const lastLaunch = new Map<string, number>();

async function tick() {
  // 1. Voting ended → tally, lock, create escrow (or cancel).
  const due = await q<{ id: string }>(`SELECT id FROM narratives WHERE stage = 'voting' AND vote_ends_at <= now() AND chain = $1 LIMIT 20`, [config.chain]);
  for (const n of due) {
    try {
      await finalizeVoting(n.id);
    } catch (e) {
      console.error(`finalizeVoting ${n.id}`, e instanceof Error ? e.message : e);
    }
  }

  // 2. Escrow phases → narrative stage; crank launches. On-chain, refresh the cache first and
  //    push refunds once a pool can't launch (anyone may; it always pays the depositor).
  const sync = chain().sync;
  const openSql = `SELECT n.id, n.stage, e.* FROM narratives n JOIN escrows e ON e.narrative_id = n.id
     WHERE e.chain = $1 AND (n.stage IN ('pooling','launching') OR (n.stage = 'live' AND NOT e.launched)
       OR (n.stage = 'refunding' AND EXISTS (SELECT 1 FROM receipts r WHERE r.narrative_id = n.id AND NOT r.refunded)))`;
  let open = await q<any>(openSql, [config.chain]);
  if (sync) {
    let synced = false;
    for (const row of open) {
      if (Date.now() - (lastSync.get(row.id) ?? 0) < SYNC_MS) continue;
      lastSync.set(row.id, Date.now());
      try {
        await sync(row.id);
        synced = true;
      } catch (e) {
        console.error(`sync ${row.id}`, e instanceof Error ? e.message : e);
      }
    }
    if (synced) open = await q<any>(openSql, [config.chain]);
  }

  for (const row of open) {
    let phase = phaseFor(row);
    if (phase === "launchable" && Date.now() - (lastLaunch.get(row.id) ?? 0) >= (sync ? LAUNCH_RETRY_MS : 0)) {
      lastLaunch.set(row.id, Date.now());
      try {
        await chain().launch(row.id);
        phase = "released";
        publish(row.id, "launched");
      } catch (e) {
        // A failed launch changes nothing; we retry until the deadline, then refunds open.
        if (!(e instanceof ChainError)) console.error(`launch ${row.id}`, e instanceof Error ? e.message : e);
        else if (sync) console.warn(`launch ${row.id}: ${e.code}`);
      }
    }
    if (phase === "refundable" && sync) await pushRefunds(row.id);
    const stage = stageFromPhase(phase);
    if (stage !== row.stage) {
      await q(`UPDATE narratives SET stage = $2, updated_at = now() WHERE id = $1`, [row.id, stage]);
      publish(row.id, "stage");
    }
  }
}

/** Refund up to a few depositors per tick; each refund pays the depositor in full. */
async function pushRefunds(narrativeId: string) {
  const pending = await q<{ wallet: string }>(`SELECT wallet FROM receipts WHERE narrative_id = $1 AND NOT refunded LIMIT 3`, [narrativeId]);
  for (const { wallet } of pending) {
    try {
      await chain().refund(narrativeId, wallet);
      publish(narrativeId, "refund");
    } catch (e) {
      console.warn(`refund ${narrativeId} ${wallet.slice(0, 6)}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __narrativepadScheduler: NodeJS.Timeout | undefined;
}

export function startScheduler() {
  if (globalThis.__narrativepadScheduler) return;
  let running = false;
  globalThis.__narrativepadScheduler = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (e) {
      console.error("scheduler tick failed", e);
    } finally {
      running = false;
    }
  }, TICK_MS);
  console.log(`[narrativepad] scheduler started (every ${TICK_MS}ms, chain=${config.chain})`);
}
