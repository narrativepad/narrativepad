// Read-only smoke test, safe against the deployed site: loads every page on desktop and phone,
// and reports bad status codes, console errors, failed requests and sideways scrolling.
// Never signs, posts or creates anything.  Usage: node scripts/smoke.mjs <baseUrl>
import { chromium } from "playwright";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) throw new Error("usage: node scripts/smoke.mjs <baseUrl>");

const problems = [];
const lines = [];
const browser = await chromium.launch();

async function visit(path, viewport, expectStatus = 200) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const tag = `${path} @${viewport.width}`;
  page.on("console", (m) => m.type() === "error" && !(expectStatus === 404 && m.text().includes("404")) && problems.push(`${tag} console: ${m.text().slice(0, 160)}`));
  page.on("pageerror", (e) => problems.push(`${tag} page error: ${e.message.slice(0, 160)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !(expectStatus === 404 && r.url() === base + path)) problems.push(`${tag} HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (/\/api\/stream|_rsc=/.test(r.url()) && /ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return;
    problems.push(`${tag} failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  const t0 = Date.now();
  const res = await page.goto(base + path, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(1500);
  const ms = Date.now() - t0;
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const status = res?.status();
  if (status !== expectStatus) problems.push(`${tag} status ${status}, expected ${expectStatus}`);
  if (width > viewport.width) problems.push(`${tag} sideways scroll: page is ${width}px wide`);
  lines.push(`  ${status === expectStatus ? "✓" : "✗"} ${tag.padEnd(28)} ${status}  ${ms}ms`);
  await ctx.close();
}

for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  for (const p of ["/", "/create", "/leaderboard", "/how-it-works"]) await visit(p, vp);
  await visit("/n/doesnotexist", vp, 404);
}

const ctx = await browser.newContext();
for (const [path, want] of [["/api/health", 200], ["/api/narratives", 200]]) {
  const r = await ctx.request.get(base + path);
  lines.push(`  ${r.status() === want ? "✓" : "✗"} GET ${path.padEnd(24)} ${r.status()}`);
  if (r.status() !== want) problems.push(`GET ${path} → ${r.status()}`);
}
// Live updates: the event stream should open and say hello.
try {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  const res = await fetch(`${base}/api/stream`, { signal: ac.signal });
  const first = new TextDecoder().decode((await res.body.getReader().read()).value);
  clearTimeout(timer);
  ac.abort();
  const ok = res.status === 200 && first.includes("hello");
  lines.push(`  ${ok ? "✓" : "✗"} GET /api/stream (live updates) ${res.status} ${ok ? "hello received" : first.slice(0, 40)}`);
  if (!ok) problems.push("event stream did not say hello");
} catch (e) {
  problems.push(`event stream: ${String(e).slice(0, 80)}`);
}
await browser.close();

console.log(lines.join("\n"));
console.log(problems.length ? `\nProblems (${problems.length}):\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}` : "\nNo console errors, failed requests or layout overflow.");
process.exit(problems.length ? 1 : 0);
