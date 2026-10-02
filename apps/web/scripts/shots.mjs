// Dev tool: screenshot pages at several viewport sizes.
//   node scripts/shots.mjs <baseUrl> <outDir> /path1 /path2 ...
// Env SIZES="1920x1080,390x844" to override sizes.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [base, out, ...paths] = process.argv.slice(2);
const sizes = (process.env.SIZES ?? "1366x768,1920x1080,2560x1440,390x844").split(",").map((s) => s.split("x").map(Number));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: "dark" });
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(600);
    const name = `${(p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home")}-${w}x${h}.png`;
    await page.screenshot({ path: join(out, name), fullPage: process.env.FULL === "1" });
    console.log(join(out, name));
  }
  await ctx.close();
}
await browser.close();
