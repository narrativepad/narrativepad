"use client";

import { useState } from "react";
import { useSigned } from "@/lib/client/useSigned";

export function ReportButton({ targetType, targetId }: { targetType: "narrative" | "submission"; targetId: string }) {
  const { run, busy } = useSigned();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button className="text-xs text-dim hover:text-danger" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await run("report", "/api/report", "report", { targetType, targetId, reason: reason.trim() }, "Reported. Thanks.");
        if (out) setOpen(false);
      }}
    >
      <input className="input h-8 w-48 py-1 text-xs" placeholder="NSFW, impersonation, scam…" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <button className="btn h-8 py-0 text-xs" disabled={reason.trim().length < 3 || busy !== null}>
        Send
      </button>
      <button type="button" className="text-xs text-dim" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
