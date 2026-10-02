// LOCAL DEV ONLY: fills a local PGlite database with narratives in every stage, so the UI can be
// reviewed with realistic content. Uses throwaway keys; never point this at a deployed server.
//   node --experimental-strip-types scripts/demo-seed.ts
// Afterwards: PGLITE_DIR=./.data/demo npx next start -p 3917
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { buildMessage, type Action, type Payload } from "../src/lib/messages.ts";

const PORT = 3917;
const BASE = `http://localhost:${PORT}`;
const DIR = "./.data/demo";
const SOL = 1_000_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!BASE.includes("localhost")) throw new Error("demo-seed is local-only");

class W {
  secret = ed25519.utils.randomSecretKey();
  address = bs58.encode(ed25519.getPublicKey(this.secret));
  async post<A extends Action>(path: string, action: A, payload: Payload<A>) {
    const { nonce } = await (await fetch(`${BASE}/api/auth/nonce?wallet=${this.address}`)).json();
    const issuedAt = new Date().toISOString();
    const message = buildMessage({ action, payload, wallet: this.address, nonce, issuedAt, simulation: true });
    const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), this.secret));
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: this.address, nonce, issuedAt, signature, payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.warn(`  ! ${action} ${res.status} ${data.error ?? ""}`);
    return data;
  }
}
const crowd = Array.from({ length: 24 }, () => new W());
const pick = (k: number, offset = 0) => Array.from({ length: k }, (_, i) => crowd[(i + offset) % crowd.length]);

let server: ChildProcess | null = null;
async function start(env: Record<string, string>) {
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, PGLITE_DIR: DIR, PUBLIC_URL: BASE, NEXT_TELEMETRY_DISABLED: "1", RATE_LIMIT_DISABLED: "1", ...env },
    shell: true,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("server did not start");
}
async function stop() {
  if (!server) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  server = null;
  await sleep(2500);
}

// ---- coin art -------------------------------------------------------------------------------
async function renderCoins(specs: { emoji: string; from: string; to: string }[]) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const out: Buffer[] = [];
  for (const s of specs) {
    await page.setContent(
      `<body style="margin:0"><div style="width:256px;height:256px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 25%,${s.from},${s.to});font-size:150px">${s.emoji}</div></body>`,
    );
    out.push(await page.screenshot({ type: "png" }));
  }
  await browser.close();
  return out;
}
async function upload(png: Buffer) {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "coin.png");
  return (await (await fetch(`${BASE}/api/images`, { method: "POST", body: fd })).json()).path as string;
}

/** `deposits` are whole units of the pair: SOL by default, or USDC (D-023, D-024). */
type Spec = { pitch: string; name: string; ticker: string; alt?: [string, string]; art: number; x?: string; voters: number; deposits?: number[]; pair?: "SOL" | "USDC" };

async function narrative(creator: W, s: Spec, images: string[]) {
  const { id, slug } = await creator.post("/api/narratives", "create", { pitch: s.pitch, name: s.name, ticker: s.ticker, sourceUrl: s.x, pair: s.pair ?? "SOL" });
  const sub = (w: W, field: any, value: string) => w.post(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field, value });
  if (s.alt) {
    await sub(crowd[1], "name", s.alt[0]);
    await sub(crowd[2], "ticker", s.alt[1]);
  }
  await sub(crowd[3], "image", images[s.art]);
  await sub(crowd[4], "image", images[(s.art + 5) % images.length]);
  const d = await (await fetch(`${BASE}/api/n/${slug}`)).json();
  const id0 = (field: string, i = 0) => d.ballots[field].entries[i]?.id;
  const chatter = [
    `${s.name} is the one. The ticker writes itself.`,
    "Source checks out, this has been all over my timeline today.",
    `Voted. ${s.alt ? `${s.alt[0]} is fine too, but ` : ""}the first entry has better meme energy.`,
    "Same price for everyone is the only reason I'm in. No more getting sniped.",
    "Who made the image? Needs to be the official one.",
  ];
  for (const [i, line] of chatter.slice(0, 2 + (s.voters % 3)).entries()) {
    await crowd[(i * 4 + s.art + 1) % crowd.length].post(`/api/narratives/${id}/comments`, "comment", { narrativeId: id, body: line });
  }
  for (const [i, w] of pick(s.voters, s.art).entries()) {
    const v = (field: any, sid: string | undefined) => sid && w.post(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field, submissionId: sid });
    await v("name", id0("name", i % 4 === 0 && d.ballots.name.entries.length > 1 ? 1 : 0));
    await v("ticker", id0("ticker", i % 5 === 0 && d.ballots.ticker.entries.length > 1 ? 1 : 0));
    await v("image", id0("image", i % 3 === 0 ? 1 : 0));
  }
  return { id, slug };
}

async function waitStage(slug: string, stage: string) {
  for (let i = 0; i < 120; i++) {
    const d = await (await fetch(`${BASE}/api/n/${slug}`)).json();
    if (d.stage === stage) return d;
    await sleep(1000);
  }
  throw new Error(`timeout ${slug} → ${stage}`);
}

async function deposits(id: string, amounts: number[], pair: Spec["pair"] = "SOL") {
  const scale = pair === "USDC" ? 1e6 : 1e9;
  for (const [i, a] of amounts.entries()) {
    await crowd[(i * 5 + 3) % crowd.length].post(`/api/narratives/${id}/deposit`, "deposit", {
      narrativeId: id,
      amountLamports: BigInt(Math.round(a * scale)).toString(),
      holderRewards: i % 3 !== 1,
    });
  }
}

const LIVE: Spec[] = [
  { pitch: "A cat landed on the moon and refused to come back. Lunar real estate is now feline-only.", name: "Moon Kitty", ticker: "MKITTY", alt: ["Lunar Cat", "LCAT"], art: 0, x: "https://x.com/moonkitty", voters: 14, deposits: [2, 1.5, 2, 0.8, 1.2, 2, 0.5, 1] },
  { pitch: "Capybaras are the calmest animal on earth. This coin has the same energy: unbothered.", name: "Quantum Capybara", ticker: "QCAPY", art: 1, voters: 11, deposits: [1, 2, 0.6, 1.4, 0.9] },
  { pitch: "Every bear market needs a goose that honks at it. HONK.", name: "Cosmic Goose", ticker: "HONK", alt: ["Goose Patrol", "GOOSE"], art: 2, voters: 9, deposits: [0.5, 1, 1, 0.75, 2, 1.2] },
  { pitch: "The slowest snail in crypto just finished its first lap. Patience is the meta.", name: "Turbo Snail", ticker: "SNAIL", art: 3, voters: 7, deposits: [1.5, 1, 0.4] },
];
const POOLING: Spec[] = [
  { pitch: "A llama with laser eyes that only buys the dip. Community-built, no dev bags.", name: "Laser Llama", ticker: "LLAMA", alt: ["Lazer Llama", "LAZR"], art: 4, x: "https://x.com/laserllama", voters: 12, deposits: [2, 1.2, 0.5, 1, 2, 0.3, 1.8, 0.9, 1.1] },
  { pitch: "Penguins don't panic sell. They just slide. The official coin of sliding.", name: "Pixel Penguin", ticker: "PENG", art: 5, voters: 8, deposits: [2, 1.5, 0.75], pair: "USDC" },
  { pitch: "Toasters have been oppressed for decades. Time for the toaster revolution.", name: "Toaster Revolution", ticker: "TOAST", art: 6, voters: 6, deposits: [1, 0.5, 2, 1.5, 0.7] },
];
const LAUNCHING: Spec[] = [
  { pitch: "A duck that only comes out at night to dance. Disco never died.", name: "Disco Duck", ticker: "DISCO", alt: ["Night Duck", "NDUCK"], art: 7, voters: 10, deposits: [2, 2, 1.5, 1, 0.8, 1.6, 2, 0.4] },
];
const VOTING: Spec[] = [
  { pitch: "Sloths have survived 64 million years by doing nothing. Diamond hands, literally.", name: "Sleepy Sloth", ticker: "SLOTH", alt: ["Slow Sloth", "SLOW"], art: 8, x: "https://x.com/sleepysloth", voters: 13 },
  { pitch: "A hamster running on a wheel powers an entire data center. We are all the hamster.", name: "Cyber Hamster", ticker: "HAMS", alt: ["Hamster Grid", "HGRID"], art: 9, voters: 9 },
  { pitch: "Goats climb anything. Charts included.", name: "Galactic Goat", ticker: "GGOAT", art: 10, voters: 5, pair: "USDC" },
  { pitch: "A dog that dives to the bottom of the ocean to find the actual bottom.", name: "Deep Sea Dog", ticker: "DSDOG", alt: ["Abyss Dog", "ABYSS"], art: 11, voters: 4 },
  { pitch: "Owls see in the dark. This one only trades at 3am.", name: "Night Owl", ticker: "HOOT", art: 0, voters: 2 },
];

async function main() {
  rmSync(DIR, { recursive: true, force: true });
  const pngs = await renderCoins([
    { emoji: "🐱", from: "#6ee7f9", to: "#1e3a8a" }, { emoji: "🐻", from: "#fcd34d", to: "#92400e" },
    { emoji: "🦢", from: "#c4b5fd", to: "#4c1d95" }, { emoji: "🐌", from: "#86efac", to: "#14532d" },
    { emoji: "🦙", from: "#f9a8d4", to: "#831843" }, { emoji: "🐧", from: "#93c5fd", to: "#0c4a6e" },
    { emoji: "🍩", from: "#fdba74", to: "#7c2d12" }, { emoji: "🦆", from: "#fde047", to: "#713f12" },
    { emoji: "🦥", from: "#d9f99d", to: "#3f6212" }, { emoji: "🐹", from: "#fda4af", to: "#7f1d1d" },
    { emoji: "🐐", from: "#e2e8f0", to: "#334155" }, { emoji: "🐶", from: "#67e8f9", to: "#164e63" },
  ]);

  console.log("phase 1: live + refunding");
  await start({ VOTE_DURATION_SEC: "6", DEPOSIT_WINDOW_SEC: "8", LAUNCH_DELAY_SEC: "2", LAUNCH_WINDOW_SEC: "60", TRANCHE_COUNT: "5", TRANCHE_INTERVAL_SEC: "900" });
  const images = [];
  for (const p of pngs) images.push(await upload(p));
  const live = [];
  for (const [i, s] of LIVE.entries()) live.push({ ...(await narrative(crowd[(i * 3) % 24], s, images)), s });
  const thin = await narrative(crowd[7], { pitch: "A pool that never filled. Everyone gets their SOL back.", name: "Almost Coin", ticker: "ALMOST", art: 3, voters: 3 }, images);
  for (const l of live) {
    await waitStage(l.slug, "pooling");
    await deposits(l.id, l.s.deposits!, l.s.pair);
  }
  await waitStage(thin.slug, "pooling");
  await deposits(thin.id, [0.3, 0.2]);
  for (const l of live) await waitStage(l.slug, "live");
  await waitStage(thin.slug, "refunding");
  await stop();

  console.log("phase 2: pooling");
  await start({ VOTE_DURATION_SEC: "6", DEPOSIT_WINDOW_SEC: "5400", LAUNCH_DELAY_SEC: "120", LAUNCH_WINDOW_SEC: "1800" });
  for (const [i, s] of POOLING.entries()) {
    const n = await narrative(crowd[(i * 5 + 2) % 24], s, images);
    await waitStage(n.slug, "pooling");
    await deposits(n.id, s.deposits!, s.pair);
  }
  await stop();

  console.log("phase 3: launching");
  await start({ VOTE_DURATION_SEC: "6", DEPOSIT_WINDOW_SEC: "12", LAUNCH_DELAY_SEC: "5400", LAUNCH_WINDOW_SEC: "1800" });
  for (const s of LAUNCHING) {
    const n = await narrative(crowd[11], s, images);
    await waitStage(n.slug, "pooling");
    await deposits(n.id, s.deposits!, s.pair);
    await waitStage(n.slug, "launching");
  }
  await stop();

  console.log("phase 4: voting");
  await start({ VOTE_DURATION_SEC: "5400" });
  for (const [i, s] of VOTING.entries()) await narrative(crowd[(i * 7 + 1) % 24], s, images);
  await stop();

  // Backdate launches so charts and vesting look like coins that have traded for a while.
  const db = new PGlite(DIR);
  const hours = [26, 9, 4, 2];
  for (const [i, l] of live.entries()) {
    await db.query(`UPDATE escrows SET launched_at = launched_at - make_interval(hours => $2) WHERE narrative_id = $1`, [l.id, hours[i]]);
  }
  await db.close();
  console.log(`done. Start with: PGLITE_DIR=${DIR} npx next start -p ${PORT}`);
}

main().catch(async (e) => {
  console.error(e);
  await stop();
  process.exit(1);
});
