// Dev tool: renders the brand images from HTML (D-017).
//   node scripts/brand-assets.mjs
// Writes public/brand/x-banner.png (1500x500), public/brand/x-banner@2x.png (3000x1000) for the
// X profile header, and src/app/opengraph-image.png (1200x630), the default link preview.
// X covers the banner's bottom-left with the profile picture, so that corner stays empty.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const logo = `data:image/png;base64,${readFileSync(join(root, "public/brand/logo.png")).toString("base64")}`;

const BLUE = "#016bfd";
const GOLD = "#ffd032";
const fonts =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600&family=Instrument+Serif:ital@1&display=block" rel="stylesheet">';

/** Rings, crowd dots and gold coins flowing to a glowing core, centred at (cx, cy). */
function orbit(cx, cy, scale) {
  const ring = (r, dashed = false, a = 0.08) =>
    `<div style="position:absolute;left:${cx - r * scale}px;top:${cy - r * scale}px;width:${2 * r * scale}px;height:${2 * r * scale}px;border-radius:50%;border:1px ${dashed ? "dashed" : "solid"} rgba(255,255,255,${a})"></div>`;
  const at = (r, deg) => [cx + Math.cos((deg * Math.PI) / 180) * r * scale, cy + Math.sin((deg * Math.PI) / 180) * r * scale];
  const hues = [[265, 300], [24, 50], [200, 240], [330, 10], [180, 220], [285, 325], [5, 35], [240, 275]];
  const dot = (r, deg, i, size = 22) => {
    const [x, y] = at(r, deg);
    const [a, b] = hues[i % hues.length];
    const s = size * scale;
    return `<div style="position:absolute;left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:conic-gradient(from 210deg,hsl(${a} 80% 62%),hsl(${b} 85% 55%),hsl(${a} 80% 62%));box-shadow:0 0 0 ${4 * scale}px #050607"></div>`;
  };
  const coin = (r, deg, size, blur = 0, trail = true) => {
    const [x, y] = at(r, deg);
    const s = size * scale;
    const len = 70 * scale;
    // Trail points back along the radius, away from the core.
    const t = trail
      ? `<div style="position:absolute;left:${x}px;top:${y - 1}px;width:${len}px;height:2px;transform-origin:0 50%;transform:rotate(${deg}deg);background:linear-gradient(90deg,rgba(255,208,50,0.55),transparent);filter:blur(${0.5 + blur}px)"></div>`
      : "";
    return `${t}<div style="position:absolute;left:${x - s / 2}px;top:${y - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;filter:blur(${blur}px);background:radial-gradient(circle at 34% 30%,#fff3b8,${GOLD} 45%,#c98a06 100%);box-shadow:inset 0 0 0 ${Math.max(1.5, s * 0.09)}px rgba(150,95,0,0.55),0 0 ${s * 0.9}px rgba(255,208,50,0.45)"></div>`;
  };
  const core = 64 * scale;
  return `
    <div style="position:absolute;left:${cx - 260 * scale}px;top:${cy - 260 * scale}px;width:${520 * scale}px;height:${520 * scale}px;border-radius:50%;background:radial-gradient(circle,rgba(1,107,253,0.55),rgba(1,107,253,0.12) 45%,transparent 70%);filter:blur(${20 * scale}px)"></div>
    ${ring(110, false, 0.1)}${ring(190, true, 0.12)}${ring(285, false, 0.06)}
    ${[ [285, 200, 0], [285, 250, 1], [285, 305, 2], [285, 140, 3], [190, 20, 4], [190, 165, 5], [190, 230, 6], [190, 300, 7] ].map(([r, d, i]) => dot(r, d, i)).join("")}
    ${coin(150, 120, 30)}${coin(235, 330, 22)}${coin(132, 260, 18, 0.5)}${coin(250, 75, 38, 1.5)}${coin(160, 15, 14)}${coin(320, 215, 26, 2.5)}
    <div style="position:absolute;left:${cx - core / 2}px;top:${cy - core / 2}px;width:${core}px;height:${core}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffff,#8ec1ff 25%,${BLUE} 60%,#00307a 100%);box-shadow:0 0 ${60 * scale}px ${10 * scale}px rgba(1,107,253,0.65),inset 0 0 0 1px rgba(255,255,255,0.4)"></div>`;
}

const base = (w, h) => `
  html,body{margin:0;width:${w}px;height:${h}px;background:#050607;overflow:hidden}
  body{position:relative;font-family:Geist,system-ui,sans-serif;color:#f5f6f7;-webkit-font-smoothing:antialiased}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.035) 1px,transparent 1px);background-size:56px 56px}
  .grain{position:absolute;inset:0;opacity:.07;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
  .silver{background:linear-gradient(180deg,#fff 30%,#9aa0a8 125%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .gold{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;background:linear-gradient(110deg,#fff1b8 0%,${GOLD} 38%,#f2a516 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:12px}
  .chip{display:inline-flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);border-radius:999px;color:#a3a8b0;font-weight:500}
  .dot{width:8px;height:8px;border-radius:50%;background:${BLUE};box-shadow:0 0 12px ${BLUE}}`;

const xBanner = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base(1500, 500)}
  .grid{mask-image:radial-gradient(ellipse 55% 90% at 78% 50%,#000,transparent 75%)}
</style></head><body>
  <div style="position:absolute;inset:0;background:radial-gradient(60% 120% at 80% 50%,rgba(1,107,253,0.22),transparent 60%),radial-gradient(30% 50% at 45% 0%,rgba(255,208,50,0.06),transparent 70%)"></div>
  <div class="grid"></div>
  ${orbit(1170, 250, 1)}
  <div style="position:absolute;left:120px;top:96px">
    <div class="chip" style="font-size:20px;padding:9px 18px"><span class="dot"></span>Community memecoin launchpad · Solana</div>
    <div class="silver" style="margin-top:30px;font-size:78px;font-weight:600;letter-spacing:-3.2px;line-height:1">The crowd builds the coin.</div>
    <div class="gold" style="margin-top:6px;font-size:86px;line-height:1.05;letter-spacing:-1px">Then buys it together.</div>
  </div>
  <div class="grain"></div>
</body></html>`;

const og = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base(1200, 630)}
  .grid{mask-image:radial-gradient(ellipse 60% 80% at 80% 50%,#000,transparent 75%)}
</style></head><body>
  <div style="position:absolute;inset:0;background:radial-gradient(60% 100% at 85% 50%,rgba(1,107,253,0.25),transparent 60%)"></div>
  <div class="grid"></div>
  ${orbit(930, 315, 0.95)}
  <div style="position:absolute;left:80px;top:80px;display:flex;align-items:center;gap:18px">
    <img src="${logo}" style="width:84px;height:84px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,0.15),0 20px 50px -10px rgba(1,107,253,0.8)">
    <div style="font-size:42px;font-weight:600;letter-spacing:-1.5px">narrativepad</div>
  </div>
  <div style="position:absolute;left:80px;top:250px">
    <div class="silver" style="font-size:70px;font-weight:600;letter-spacing:-3px;line-height:1">The crowd builds</div>
    <div class="silver" style="font-size:70px;font-weight:600;letter-spacing:-3px;line-height:1.05">the coin.</div>
    <div class="gold" style="margin-top:4px;font-size:76px;line-height:1.05">Then buys it together.</div>
  </div>
  <div style="position:absolute;left:80px;bottom:58px;display:flex;gap:12px">
    <div class="chip" style="font-size:20px;padding:8px 16px"><span class="dot"></span>Same price for everyone</div>
    <div class="chip" style="font-size:20px;padding:8px 16px">100% refundable if it doesn't launch</div>
  </div>
  <div class="grain"></div>
</body></html>`;

const browser = await chromium.launch();
async function render(html, w, h, scale, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, out), type: "png" });
  await page.close();
  console.log(out);
}
await render(xBanner, 1500, 500, 1, "public/brand/x-banner.png");
await render(xBanner, 1500, 500, 2, "public/brand/x-banner@2x.png");
await render(og, 1200, 630, 1, "src/app/opengraph-image.png");
await browser.close();
