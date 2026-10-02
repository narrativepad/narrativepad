// Mirror of Escrow::phase in programs/narrative_escrow/src/state.rs. Pure; used by server and UI.

export type Phase = "scheduled" | "pooling" | "closing" | "launchable" | "released" | "refundable";

export interface PhaseInput {
  launched: boolean;
  depositStart: number; // ms
  depositEnd: number;
  launchAfter: number;
  launchDeadline: number;
  totalDeposited: bigint;
  poolMin: bigint;
}

export function phaseOf(e: PhaseInput, now: number): Phase {
  if (e.launched) return "released";
  if (now < e.depositStart) return "scheduled";
  if (now < e.depositEnd) return "pooling";
  // Refundable is permanent once reached (no deposits after the window).
  if (now >= e.launchDeadline || e.totalDeposited < e.poolMin) return "refundable";
  if (now < e.launchAfter) return "closing";
  return "launchable";
}

/** Narrative stage shown in feeds. */
export type Stage = "voting" | "pooling" | "launching" | "live" | "refunding" | "cancelled";

export function stageFromPhase(p: Phase): Stage {
  switch (p) {
    case "scheduled":
    case "pooling":
      return "pooling";
    case "closing":
    case "launchable":
      return "launching";
    case "released":
      return "live";
    case "refundable":
      return "refunding";
  }
}
