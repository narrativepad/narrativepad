// Dev tool: renders the brand images from HTML (D-017).
//   node scripts/brand-assets.mjs
// Writes public/brand/x-banner.png (1500x500), public/brand/x-banner@2x.png (3000x1000) for the
// X profile header, src/app/opengraph-image.png (1200x630), the default link preview, and the
// GitHub README hero and social preview in .github/assets/.
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

/** README hero: logo lockup and tagline on the left, the crowd orbit on the right. */
const readme = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${base(1600, 560)}
  .grid{mask-image:radial-gradient(ellipse 50% 90% at 78% 50%,#000,transparent 75%)}
</style></head><body>
  <div style="position:absolute;inset:0;background:radial-gradient(55% 110% at 80% 50%,rgba(1,107,253,0.24),transparent 60%),radial-gradient(30% 50% at 40% 0%,rgba(255,208,50,0.05),transparent 70%)"></div>
  <div class="grid"></div>
  ${orbit(1250, 280, 1)}
  <div style="position:absolute;left:110px;top:88px">
    <div style="display:flex;align-items:center;gap:18px">
      <img src="${logo}" style="width:76px;height:76px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,0.15),0 20px 50px -10px rgba(1,107,253,0.8)">
      <div style="font-size:44px;font-weight:600;letter-spacing:-1.6px">narrativepad</div>
    </div>
    <div class="silver" style="margin-top:44px;font-size:76px;font-weight:600;letter-spacing:-3px;line-height:1">The crowd builds the coin.</div>
    <div class="gold" style="margin-top:6px;font-size:84px;line-height:1.05">Then buys it together.</div>
    <div style="margin-top:34px;display:flex;gap:12px">
      <div class="chip" style="font-size:19px;padding:8px 16px"><span class="dot"></span>Non-custodial escrow</div>
      <div class="chip" style="font-size:19px;padding:8px 16px">Same price for everyone</div>
      <div class="chip" style="font-size:19px;padding:8px 16px">100% refundable</div>
    </div>
  </div>
  <div class="grain"></div>
</body></html>`;

// ---- README diagrams (rounded cards on a transparent background) -------------------------------

const ICON = {
  spark: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z",
  vote: "M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5V11Z",
  coins: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM18.1 10.4A6 6 0 1 1 10.4 18.1M7 6h1v4M16.7 13.9l.7.7-2.8 2.8",
  rocket: "M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2a2.1 2.1 0 0 0-3-3ZM12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2ZM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5",
  check: "M5 12l5 5 9-10",
  refund: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  plug: "M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5",
};
const svg = (name, color, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON[name]}"/></svg>`;

const card = (w, h, inner) => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
  html,body{margin:0;background:transparent}
  body{font-family:Geist,system-ui,sans-serif;color:#f5f6f7;-webkit-font-smoothing:antialiased}
  .card{position:relative;width:${w}px;height:${h}px;border-radius:28px;overflow:hidden;background:#0b0c0f;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.09)}
  .glow{position:absolute;inset:0;background:radial-gradient(60% 80% at 50% 0%,rgba(1,107,253,0.16),transparent 70%)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(ellipse 70% 80% at 50% 30%,#000,transparent 80%)}
  .t{font-weight:600;letter-spacing:-0.3px}
  .m{color:#a3a8b0}
  .chip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);border-radius:999px;color:#a3a8b0;font-weight:500}
</style></head><body><div class="card"><div class="glow"></div><div class="grid"></div>${inner}</div></body></html>`;

function howItWorks() {
  const steps = [
    ["spark", "#a3a8b0", "Propose", "Pitch and source:<br>a tweet, a clip, a meme", "anytime"],
    ["vote", "#a98bff", "Vote", "Name, ticker, image<br>and links, by the crowd", "10 min"],
    ["lock", "#3d8bff", "Lock", "Winners frozen and<br>hashed, nobody can swap", "instant"],
    ["coins", "#3d8bff", "Pool", "One public escrow,<br>same price for everyone", "10 min"],
    ["rocket", GOLD, "Launch", "Coin created and bought<br>in one transaction", "~2 min"],
    ["check", "#3ddc97", "Release", "Equal unlocks for<br>every depositor", "5 × 5 min"],
  ];
  const x0 = 140, gap = 264, y = 190;
  const nodes = steps
    .map(([icon, color, title, desc, when], i) => {
      const x = x0 + i * gap;
      return `
      <div style="position:absolute;left:${x - 38}px;top:${y - 38}px;width:76px;height:76px;border-radius:24px;background:#111318;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.1),0 0 40px -6px ${color}55;display:flex;align-items:center;justify-content:center">${svg(icon, color, 30)}</div>
      <div style="position:absolute;left:${x - 13}px;top:${y - 66}px;width:26px;height:26px;border-radius:50%;background:#050607;box-shadow:inset 0 0 0 1.5px ${color}88;color:${color};font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center">${i + 1}</div>
      <div style="position:absolute;left:${x - 120}px;top:${y + 58}px;width:240px;text-align:center">
        <div class="t" style="font-size:24px">${title}</div>
        <div class="m" style="margin-top:8px;font-size:16px;line-height:1.45">${desc}</div>
        <div class="chip" style="margin-top:14px;font-size:14px;padding:5px 12px">${when}</div>
      </div>`;
    })
    .join("");
  const line = `<div style="position:absolute;left:${x0}px;top:${y - 1}px;width:${gap * 5}px;height:2px;background:linear-gradient(90deg,rgba(163,168,176,0.35),rgba(169,139,255,0.5),rgba(61,139,255,0.6),${GOLD}99,rgba(61,220,151,0.6))"></div>`;
  // Refund branch from Pool.
  const px = x0 + 3 * gap;
  const refund = `
    <div style="position:absolute;left:${px}px;top:${y + 230}px;width:2px;height:0"></div>
    <div style="position:absolute;left:${px - 1}px;top:${y + 196}px;width:0;height:58px;border-left:2px dashed rgba(255,92,124,0.5)"></div>
    <div class="chip" style="position:absolute;left:${px - 205}px;top:${y + 262}px;font-size:16px;padding:9px 18px;border-color:rgba(255,92,124,0.35);color:#ffb3c1">${svg("refund", "#ff5c7c", 18)}<b style="color:#f5f6f7;font-weight:600">Didn't launch?</b>&nbsp;Everyone takes back 100%, on their own</div>`;
  return card(1600, 540, `${line}${nodes}${refund}`);
}

function architecture() {
  const box = (x, y, w, h, icon, color, title, sub, extra = "") =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:20px;background:#111318;box-shadow:inset 0 0 0 1px rgba(255,255,255,0.1);display:flex;align-items:center;gap:16px;padding:0 22px;box-sizing:border-box;${extra}">
       <div style="width:46px;height:46px;border-radius:14px;flex-shrink:0;background:${color}1f;display:flex;align-items:center;justify-content:center">${svg(icon, color, 24)}</div>
       <div><div class="t" style="font-size:20px">${title}</div><div class="m" style="font-size:14.5px;margin-top:4px;line-height:1.35">${sub}</div></div>
     </div>`;
  const arrow = (x1, y1, x2, y2, label = "", dashed = false, color = "rgba(255,255,255,0.35)") => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    return `<div style="position:absolute;left:${x1}px;top:${y1}px;width:${len}px;height:0;border-top:2px ${dashed ? "dashed" : "solid"} ${color};transform-origin:0 0;transform:rotate(${ang}deg)">
        <div style="position:absolute;right:-2px;top:-7px;width:0;height:0;border-left:10px solid ${color};border-top:6px solid transparent;border-bottom:6px solid transparent"></div>
      </div>${label ? `<div class="chip" style="position:absolute;left:${(x1 + x2) / 2 - 70}px;top:${(y1 + y2) / 2 - 40}px;width:140px;justify-content:center;font-size:13px;padding:4px 10px;background:#0b0c0f">${label}</div>` : ""}`;
  };
  const railway = `<div style="position:absolute;left:400px;top:70px;width:520px;height:430px;border-radius:24px;border:1.5px dashed rgba(255,255,255,0.14)"></div>
    <div class="chip" style="position:absolute;left:424px;top:52px;font-size:13px;padding:4px 12px;background:#0b0c0f">Railway</div>`;
  return card(
    1600,
    580,
    `${railway}
    ${box(60, 230, 270, 110, "user", "#a3a8b0", "Browser", "wallet or guest key,<br>signs every action")}
    ${box(440, 120, 440, 120, "server", "#3d8bff", "apps/web · Next.js", "UI · API · live events (SSE)<br>stage scheduler · launch crank")}
    ${box(440, 340, 440, 110, "db", "#a98bff", "Postgres", "a cache, not the source of truth:<br>if it disagrees, the chain wins")}
    ${box(1000, 120, 250, 100, "plug", "#a3a8b0", "ChainAdapter", "one boundary,<br>chain-agnostic above it")}
    ${box(1000, 300, 250, 110, "check", "#3ddc97", "mock", "today: same math<br>as the escrow")}
    ${box(1300, 120, 260, 110, "lock", GOLD, "Escrow program", "Solana · Anchor<br>non-custodial")}
    ${box(1300, 330, 260, 110, "rocket", GOLD, "pump.fun", "create + buy<br>in one instruction")}
    ${arrow(330, 285, 436, 190)}
    ${arrow(660, 240, 660, 336)}
    ${arrow(880, 175, 996, 172)}
    ${arrow(1125, 220, 1125, 296)}
    ${arrow(1250, 172, 1296, 172, "", true, "rgba(255,208,50,0.6)")}
    ${arrow(1430, 230, 1430, 326, "", false, "rgba(255,208,50,0.6)")}
    <div class="chip" style="position:absolute;left:1268px;top:470px;font-size:13px;padding:5px 12px">dashed = next: CHAIN=solana on devnet</div>`,
  );
}

const browser = await chromium.launch();
async function render(html, w, h, scale, out, transparent = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(root, out), type: "png", omitBackground: transparent });
  await page.close();
  console.log(out);
}
await render(xBanner, 1500, 500, 1, "public/brand/x-banner.png");
await render(xBanner, 1500, 500, 2, "public/brand/x-banner@2x.png");
await render(og, 1200, 630, 1, "src/app/opengraph-image.png");
// GitHub: README hero and the repository's social preview (Settings → Social preview, 1280×640).
await render(readme, 1600, 560, 1, "../../.github/assets/banner.png");
await render(og.replaceAll("1200px", "1280px").replaceAll("630px", "640px"), 1280, 640, 1, "../../.github/assets/social-preview.png");
await render(howItWorks(), 1600, 540, 1, "../../.github/assets/how-it-works.png", true);
await render(architecture(), 1600, 580, 1, "../../.github/assets/architecture.png", true);
await browser.close();
