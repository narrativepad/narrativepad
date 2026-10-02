// Stage transitions + permissionless cranks. Launch/refund/claim never DEPEND on this process:
// in on-chain mode anyone can call them (scripts/crank in the README); here we just do it first.
import "server-only";
import { chain, ChainError } from "./chain";
import { phaseFor } from "./chain/mock";
import { q } from "./db";
import { publish } from "./events";
import { finalizeVoting } from "./narratives";
import { stageFromPhase } from "./phase";

const TICK_MS = 2_000;

async function tick() {
  // 1. Voting ended → tally, lock, create escrow (or cancel).
  const due = await q<{ id: string }>(`SELECT id FROM narratives WHERE stage = 'voting' AND vote_ends_at <= now() LIMIT 20`);
  for (const n of due) {
    try {
      await finalizeVoting(n.id);
    } catch (e) {
      console.error(`finalizeVoting ${n.id}`, e);
    }
  }

  // 2. Escrow phases → narrative stage; crank launches.
  const open = await q<any>(
    `SELECT n.id, n.stage, e.* FROM narratives n JOIN escrows e ON e.narrative_id = n.id
      WHERE n.stage IN ('pooling','launching') OR (n.stage = 'live' AND NOT e.launched)`,
  );
  for (const row of open) {
    let phase = phaseFor(row);
    if (phase === "launchable") {
      try {
        await chain().launch(row.id);
        phase = "released";
        publish(row.id, "launched");
      } catch (e) {
        // A failed launch changes nothing; we retry next tick until the deadline, then refunds open.
        if (!(e instanceof ChainError)) console.error(`launch ${row.id}`, e);
      }
    }
    const stage = stageFromPhase(phase);
    if (stage !== row.stage) {
      await q(`UPDATE narratives SET stage = $2, updated_at = now() WHERE id = $1`, [row.id, stage]);
      publish(row.id, "stage");
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
  console.log(`[narrativepad] scheduler started (every ${TICK_MS}ms)`);
}
