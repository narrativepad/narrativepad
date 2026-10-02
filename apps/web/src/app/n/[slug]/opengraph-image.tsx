import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { formatSol } from "@/lib/math";
import { narrativeBySlug } from "@/lib/views";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STAGE_COLOR: Record<string, string> = {
  voting: "#a98bff",
  pooling: "#3d8bff",
  launching: "#ffd032",
  live: "#3ddc97",
  refunding: "#ff5c7c",
  cancelled: "#6c717a",
};

/** Shareable card for X / Telegram previews of a narrative. */
export default async function OG({ params }: { params: Promise<{ slug: string }> }) {
  const [n, logo] = await Promise.all([
    narrativeBySlug((await params).slug),
    readFile(join(process.cwd(), "public/brand/logo-128.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`),
  ]);
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
          background: "radial-gradient(circle at 85% 0%, rgba(1,107,253,0.35), rgba(5,6,7,1) 60%)",
          backgroundColor: "#050607",
          color: "#f5f6f7",
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, color: "#a3a8b0" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={52} height={52} style={{ borderRadius: 999 }} alt="" />
          narrativepad
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              padding: "6px 18px",
              borderRadius: 999,
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
            <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1, letterSpacing: -2 }}>{title.slice(0, 28)}</div>
            {n?.ticker ? <div style={{ fontSize: 48, color: "#a3a8b0" }}>{`$${n.ticker}`}</div> : null}
          </div>
          <div style={{ fontSize: 30, color: "#a3a8b0", lineHeight: 1.35 }}>{(n?.pitch ?? "").slice(0, 160)}</div>
        </div>
        <div style={{ display: "flex", gap: 48, fontSize: 28, color: "#a3a8b0" }}>
          <div style={{ display: "flex" }}>{n ? `${n.totalVotes} votes` : ""}</div>
          {n?.escrow ? <div style={{ display: "flex" }}>{`${formatSol(BigInt(n.escrow.totalDeposited))} SOL pooled`}</div> : null}
          <div style={{ display: "flex", marginLeft: "auto", color: "#ffd032" }}>the crowd builds the coin</div>
        </div>
      </div>
    ),
    size,
  );
}
