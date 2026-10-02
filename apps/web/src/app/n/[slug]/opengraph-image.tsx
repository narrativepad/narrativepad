import { ImageResponse } from "next/og";
import { formatSol } from "@/lib/math";
import { narrativeBySlug } from "@/lib/views";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STAGE_COLOR: Record<string, string> = {
  voting: "#a98bff",
  pooling: "#5cb8ff",
  launching: "#ffb547",
  live: "#3ef0a1",
  refunding: "#ff5a7a",
  cancelled: "#5a6577",
};

/** Shareable card for X / Telegram previews of a narrative. */
export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const n = await narrativeBySlug((await params).slug);
  const title = n?.title ?? "narrativepad";
  const color = STAGE_COLOR[n?.stage ?? "voting"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#06080c",
          color: "#e7edf4",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#8d98aa" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#3ef0a1",
              color: "#03150c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
            }}
          >
            N
          </div>
          narrativepad
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              padding: "6px 16px",
              borderRadius: 10,
              border: `2px solid ${color}`,
              color,
              fontSize: 24,
              textTransform: "uppercase",
              letterSpacing: 2,
            }}
          >
            {n?.stage ?? ""}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
            <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1 }}>{title.slice(0, 28)}</div>
            {n?.ticker ? <div style={{ fontSize: 48, color: "#8d98aa" }}>{`$${n.ticker}`}</div> : null}
          </div>
          <div style={{ fontSize: 30, color: "#8d98aa", lineHeight: 1.35 }}>{(n?.pitch ?? "").slice(0, 160)}</div>
        </div>
        <div style={{ display: "flex", gap: 48, fontSize: 28, color: "#8d98aa" }}>
          <div style={{ display: "flex" }}>{n ? `${n.totalVotes} votes` : ""}</div>
          {n?.escrow ? <div style={{ display: "flex" }}>{`${formatSol(BigInt(n.escrow.totalDeposited))} SOL pooled`}</div> : null}
          <div style={{ display: "flex", marginLeft: "auto", color: "#3ef0a1" }}>the crowd builds the coin</div>
        </div>
      </div>
    ),
    size,
  );
}
