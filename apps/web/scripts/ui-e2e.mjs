// Dev check: drives the whole product through the browser as a guest (no wallet), in SIMULATION
// mode, and reports every console error and failed request on the way. Local servers only.
// Start the server with short timings, e.g.
//   VOTE_DURATION_SEC=35 DEPOSIT_WINDOW_SEC=35 LAUNCH_DELAY_SEC=3 LAUNCH_WINDOW_SEC=60 \
//   TRANCHE_COUNT=3 TRANCHE_INTERVAL_SEC=8 npx next start -p 3912
// then: node scripts/ui-e2e.mjs http://localhost:3912 <outDir>
import { chromium } from "playwright";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
if (!/^http:\/\/localhost:\d+$/.test(base ?? "")) throw new Error("ui-e2e is local-only: pass http://localhost:<port>");

const results = [];
const problems = [];
let section = "setup";
const pass = (msg) => results.push({ ok: true, msg: `${section}: ${msg}` });
const failSoft = (msg) => results.push({ ok: false, msg: `${section}: ${msg}` });
async function check(msg, fn) {
  try {
    await fn();
    pass(msg);
  } catch (e) {
    failSoft(`${msg} → ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Cards in the explore grid (the spotlight card above it is excluded).
const GRID_CARDS = '[role="tablist"] + div a.card[href^="/n/"]';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Expected rejections the test triggers on purpose are whitelisted by URL + status.
const expected = [];
// HTTP errors are tracked (and whitelisted) by the response listener; the browser's own
// "Failed to load resource" echo of them is skipped here.
page.on("console", (m) => {
  if (m.type() !== "error" || m.text().startsWith("Failed to load resource")) return;
  problems.push(`[${section}] console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => problems.push(`[${section}] page error: ${e.message.slice(0, 200)}`));
page.on("requestfailed", (r) => {
  const err = r.failure()?.errorText ?? "";
  if (/ERR_ABORTED/.test(err) && /\/api\/stream|_rsc=|\/_next\//.test(r.url())) return; // navigations cancel streams and prefetches
  problems.push(`[${section}] request failed: ${r.method()} ${r.url()} ${err}`);
});
page.on("response", (r) => {
  if (r.status() < 400) return;
  if (expected.some((x) => r.url().includes(x.url) && r.status() === x.status)) return;
  problems.push(`[${section}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
});

const toast = async (re, timeout = 10_000) => {
  await page.locator('[role="status"]', { hasText: re }).first().waitFor({ timeout });
};
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });

const pic = await browser.newPage({ viewport: { width: 96, height: 96 } });
await pic.setContent('<body style="margin:0;background:radial-gradient(circle at 30% 30%,#ffd76a,#b45309)"></body>');
const png = await pic.screenshot({ type: "png" });
await pic.setContent('<body style="margin:0;background:radial-gradient(circle at 30% 30%,#c4b5fd,#4c1d95)"></body>');
const png2 = await pic.screenshot({ type: "png" });
await pic.close();

async function createViaUI({ pitch, name, ticker, source, x, image }) {
  await page.goto(`${base}/create`, { waitUntil: "load" });
  if (image) {
    await page.setInputFiles('input[type="file"]', { name: "pic.png", mimeType: "image/png", buffer: image });
    await page.locator('button:has-text("Change picture")').waitFor({ state: "attached", timeout: 10_000 });
  }
  await page.fill("#pitch", pitch);
  await page.fill("#name", name);
  await page.fill("#ticker", ticker);
  if (source) await page.fill("#source", source);
  if (x) await page.fill("#x", x);
  await page.click('button[type="submit"]:has-text("Start narrative")');
  await page.waitForURL(/\/n\/[A-Za-z0-9]+$/, { timeout: 15_000 });
  return page.url();
}

async function waitText(text, timeout) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}

// ---- home --------------------------------------------------------------------------------------
section = "home (empty)";
await page.goto(base, { waitUntil: "load" });
await check("hero headline renders", async () => {
  const h1 = await page.textContent("h1");
  if (!h1?.includes("The crowd builds")) throw new Error(`h1 was "${h1}"`);
});
await check("preview banner is shown", () => waitText("Pools are simulated", 3000));
await check("empty board state is shown", () => waitText("The board is waiting for its first narrative", 3000));
await check('"Explore coins" jumps to the board', async () => {
  await page.click('a:has-text("Explore coins")');
  await page.waitForFunction(() => location.hash === "#explore", null, { timeout: 3000 });
});
await check("how-it-works tiles render (6 steps + 4 guarantees)", async () => {
  const n = await page.locator("#how li").count();
  if (n !== 10) throw new Error(`found ${n} tiles`);
});

// ---- create A (with picture), then interact during voting --------------------------------------
section = "create";
let urlA;
await check("guest creates a narrative with picture, source and X link", async () => {
  urlA = await createViaUI({
    pitch: "QA coin: a golden retriever that audits smart contracts for treats.",
    name: "Audit Dog",
    ticker: "AUDOG",
    source: "https://x.com/narrativepad/status/42",
    x: "https://x.com/auditdog",
    image: png,
  });
});
if (!urlA) {
  console.log(JSON.stringify({ results, problems }, null, 2));
  process.exit(1);
}

section = "voting";
await check("narrative page shows title, ticker and the voting stage", async () => {
  await page.locator("h1", { hasText: "Audit Dog" }).waitFor({ timeout: 5000 });
  await waitText("$AUDOG", 3000);
  await waitText("Voting is open", 3000);
});
await check("add a name entry", async () => {
  await page.fill('input[aria-label="New Name entry"]', "Audit Pup");
  await page.locator('form:has(input[aria-label="New Name entry"]) button').click();
  await toast(/Entry added/);
  await page.locator('button[aria-label="Vote for Audit Pup"]').waitFor({ timeout: 5000 });
});
expected.push({ url: "/submit", status: 409 });
await check("duplicate entry is rejected with a message", async () => {
  await page.fill('input[aria-label="New Name entry"]', "Audit Pup");
  await page.locator('form:has(input[aria-label="New Name entry"]) button').click();
  await toast(/already|exists|duplicate/i);
});
await check("vote on a name", async () => {
  await page.click('button[aria-label="Vote for Audit Dog"]');
  await toast(/Vote counted/);
  await page.locator('button[aria-label="Vote for Audit Dog"]', { hasText: "Voted" }).waitFor({ timeout: 5000 });
});
await check("vote on a ticker", async () => {
  await page.click('button[aria-label="Vote for AUDOG"]');
  await toast(/Vote counted/);
});
await check("upload an image entry", async () => {
  const before = await page.locator('img[src^="/api/images/"]').count();
  await page.setInputFiles('input[type="file"]', { name: "alt.png", mimeType: "image/png", buffer: png2 });
  await toast(/Entry added/);
  await page.waitForFunction((n) => document.querySelectorAll('img[src^="/api/images/"]').length > n, before, { timeout: 8000 });
});
await check("report a narrative", async () => {
  await page.click('button:has-text("Report")');
  await page.fill('input[placeholder^="NSFW"]', "QA test report, please ignore");
  await page.click('button:has-text("Send")');
  await toast(/Reported/);
});
await check("live activity lists the votes", () => waitText("voted", 5000));
await shot("1-voting");

// ---- create B (for the refund path) -------------------------------------------------------------
section = "create (refund case)";
let urlB;
await check("second narrative created without a picture", async () => {
  urlB = await createViaUI({ pitch: "QA coin that will not reach its pool minimum, to test refunds.", name: "Thin Coin", ticker: "THINQ" });
});

// ---- pool on A -----------------------------------------------------------------------------------
section = "pool";
await page.goto(urlA, { waitUntil: "load" });
await check("voting ends, metadata locks and the pool opens", async () => {
  await page.locator('button:has-text("Join the pool")').waitFor({ timeout: 60_000 });
  await waitText("Locked metadata", 3000);
});
await check("amount below the minimum shows an error", async () => {
  await page.fill('input[aria-label="Amount in SOL"]', "0.01");
  await waitText("Minimum is", 3000);
  if (await page.locator('button:has-text("Join the pool")').isEnabled()) throw new Error("Join enabled for an invalid amount");
});
await check("join the pool with a quick amount (0.5)", async () => {
  await page.click('button:text-is("0.5")');
  await waitText("Your share of the pool", 3000);
  await page.click('button:has-text("Join the pool")');
  await toast(/You're in the pool/);
  await waitText("Your position", 8000);
});
await check("Max fills the remaining per-wallet room (1.5 SOL)", async () => {
  await page.click('button:has-text("Max")');
  const v = await page.inputValue('input[aria-label="Amount in SOL"]');
  if (Number(v) !== 1.5) throw new Error(`Max filled ${v}`);
});
expected.push({ url: "/deposit", status: 409 });
await check("top up to reach the launch minimum", async () => {
  await page.click('button:text-is("0.5")');
  await page.click('button:has-text("Join the pool")');
  await toast(/You're in the pool/);
  await waitText("minimum reached", 8000);
});
await check("deposit list shows both deposits in order", async () => {
  await waitText("Deposits, in order", 3000);
  const rows = await page.locator("ol li", { hasText: "#2" }).count();
  if (rows < 1) throw new Error("second deposit not listed");
});
await check("lock hash verifies in the browser", async () => {
  await page.click('button:has-text("Verify in browser")');
  await waitText("Metadata, winners and vote root hash to the lock hash", 8000);
});
await check("signed votes download as JSON", async () => {
  const href = await page.getAttribute('a:has-text("Download signed votes")', "href");
  const res = await page.request.get(base + href);
  const json = await res.json();
  if (!Array.isArray(json.votes) || json.votes.length < 2) throw new Error(`votes: ${JSON.stringify(json).slice(0, 80)}`);
});
await shot("2-pool");

// ---- pool on B (stays under the minimum) ---------------------------------------------------------
section = "refund case";
await page.goto(urlB, { waitUntil: "load" });
await check("pool opens on the second narrative", () => page.locator('button:has-text("Join the pool")').waitFor({ timeout: 60_000 }));
await check("deposit 0.25 SOL (under the 1 SOL minimum)", async () => {
  await page.click('button:text-is("0.25")');
  await page.click('button:has-text("Join the pool")');
  await toast(/You're in the pool/);
});

// ---- launch + claim on A -------------------------------------------------------------------------
section = "launch";
await page.goto(urlA, { waitUntil: "load" });
await check("coin launches; community pool buy is labelled", async () => {
  await waitText("Community pool buy", 70_000);
  await waitText("Launched by the community pool", 3000);
});
await check("claim the first tranche", async () => {
  const btn = page.locator("button", { hasText: /^Claim/ });
  await btn.waitFor({ timeout: 15_000 });
  await btn.click();
  await toast(/Claimed/);
});
await check("release schedule shows unlocked tranches", () => waitText("everyone unlocks together", 3000));
await shot("3-live");

// ---- refund on B ---------------------------------------------------------------------------------
section = "refund";
await page.goto(urlB, { waitUntil: "load" });
await check("under-minimum pool switches to refunds", () => waitText("Every depositor can take back 100%", 70_000));
await check("refund 100% of the deposit", async () => {
  const btn = page.locator("button", { hasText: /^Refund 0\.25 SOL/ });
  await btn.waitFor({ timeout: 10_000 });
  await btn.click();
  await toast(/Refunded in full/);
  await page.locator("button", { hasText: /^Refunded$/ }).waitFor({ timeout: 8000 });
});
await shot("4-refunded");

// ---- home with data, tabs and search ---------------------------------------------------------------
section = "home (with data)";
await page.goto(base, { waitUntil: "load" });
await check("stats show under the hero", () => waitText("narratives", 3000));
await check("tabs filter the grid and match their counts", async () => {
  for (const label of ["Voting", "Pooling", "Launching", "Live", "Ended", "All"]) {
    const tab = page.locator('[role="tab"]', { hasText: label });
    if ((await tab.count()) === 0) continue;
    await tab.first().click();
    const count = Number((await tab.first().locator("span.num").textContent())?.trim());
    const cards = await page.locator(GRID_CARDS).count();
    if (count !== cards && !(count === 0 && cards === 0)) throw new Error(`${label}: tab says ${count}, grid shows ${cards}`);
  }
});
await check("cards link to their narrative", async () => {
  await page.locator(GRID_CARDS, { hasText: "Audit Dog" }).first().click();
  await page.waitForURL(/\/n\//, { timeout: 8000 });
  await page.goBack();
});
await check("Ctrl+K focuses search and filters results", async () => {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("audog");
  await page.waitForURL(/\?q=audog/, { timeout: 5000 });
  await page.locator("h2", { hasText: "Results for" }).waitFor({ timeout: 5000 });
  const n = await page.locator(GRID_CARDS).count();
  if (n !== 1) throw new Error(`expected 1 result, got ${n}`);
});
await check("clear search returns to the full page", async () => {
  await page.click('a:has-text("Clear search")');
  await page.waitForURL((u) => !u.search.includes("q="), { timeout: 5000 });
  await page.locator("h1").waitFor({ timeout: 5000 });
});
await shot("5-home");

// ---- other pages ---------------------------------------------------------------------------------
section = "pages";
await check("leaderboard lists pools, creators and voters", async () => {
  await page.goto(`${base}/leaderboard`, { waitUntil: "load" });
  await waitText("Biggest pools", 3000);
  await waitText("Audit Dog", 3000);
});
await check("header identity opens the guest's profile with their activity", async () => {
  await page.goto(base, { waitUntil: "load" });
  await page.locator('header a[href^="/profile/"]').click();
  await page.waitForURL(/\/profile\//, { timeout: 8000 });
  await waitText("Narratives started", 3000);
  await waitText("QA coin", 3000);
});
await check("how it works shows the preview explainer", async () => {
  await page.goto(`${base}/how-it-works#preview`, { waitUntil: "load" });
  await waitText("About this preview", 3000);
});
await check("unknown narrative shows the not-found page", async () => {
  expected.push({ url: "/n/doesnotexist", status: 404 });
  const res = await page.goto(`${base}/n/doesnotexist`, { waitUntil: "load" });
  if (res?.status() !== 404) throw new Error(`status ${res?.status()}`);
  await waitText("Not found", 3000);
});
await check("share image (OG card) renders as PNG", async () => {
  const res = await page.request.get(`${urlA}/opengraph-image`);
  if (res.status() !== 200 || !String(res.headers()["content-type"]).includes("image/png")) throw new Error(`${res.status()} ${res.headers()["content-type"]}`);
});
await check("Connect wallet opens the wallet picker", async () => {
  await page.goto(base, { waitUntil: "load" });
  await page.locator(".wallet-adapter-button-trigger").click();
  await page.locator(".wallet-adapter-modal").waitFor({ timeout: 5000 });
  await page.keyboard.press("Escape");
});

// ---- phones ----------------------------------------------------------------------------------------
section = "mobile";
await page.setViewportSize({ width: 390, height: 844 });
for (const path of ["/", "/create", "/leaderboard", "/how-it-works", new URL(urlA).pathname, new URL(urlB).pathname]) {
  await check(`no sideways scrolling on ${path}`, async () => {
    await page.goto(base + path, { waitUntil: "load" });
    await sleep(400);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) throw new Error(`page is ${w}px wide`);
  });
}
await check("mobile nav reaches Leaderboard", async () => {
  await page.goto(base, { waitUntil: "load" });
  await page.locator('header nav a:has-text("Leaderboard")').last().click();
  await page.waitForURL(/\/leaderboard/, { timeout: 5000 });
});
await check("mobile coin page shows the pool before the ballots", async () => {
  await page.goto(urlA, { waitUntil: "load" });
  const pool = await page.getByText("Community pool", { exact: true }).first().boundingBox();
  const ballots = await page.getByText("Final ballots", { exact: true }).first().boundingBox();
  if (!pool || !ballots || pool.y > ballots.y) throw new Error("pool is below the ballots");
});

await browser.close();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.msg}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(problems.length ? `\nConsole errors / failed requests (${problems.length}):\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}` : "\nNo console errors or failed requests.");
process.exit(failed.length || problems.length ? 1 : 0);
