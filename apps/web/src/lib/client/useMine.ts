"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "./useSigned";

export interface Position {
  deposited: string;
  sharePct: number;
  entitlement: string;
  claimed: string;
  claimable: string;
  leftover: string;
  unlocked: number;
  trancheCount: number;
  refunded: boolean;
}

/** The current identity's votes + pool position. `version` changes whenever page data refreshes. */
export function useMine(narrativeId: string, version: string) {
  const { address } = useIdentity();
  const [state, setState] = useState<{ position: Position | null; votes: Record<string, string> }>({ position: null, votes: {} });
  useEffect(() => {
    if (!address) return;
    let live = true;
    fetch(`/api/narratives/${narrativeId}/position?wallet=${address}`)
      .then((r) => r.json())
      .then((d) => live && setState({ position: d.position ?? null, votes: d.votes ?? {} }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [narrativeId, address, version]);
  return { wallet: address, ...state };
}
