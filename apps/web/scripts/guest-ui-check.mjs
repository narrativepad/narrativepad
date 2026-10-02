// Dev check: a brand-new visitor (no wallet) can start a narrative with a picture and vote,
// entirely through the UI. Usage: node scripts/guest-ui-check.mjs http://localhost:3917 <outDir>
import { chromium } from "playwright";
import { join } from "node:path";

const [base, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};

// A 64x64 PNG rendered on the fly as the picture to upload.
const pic = await browser.newPage({ viewport: { width: 64, height: 64 } });
await pic.setContent('<body style="margin:0;background:linear-gradient(135deg,#3df2a3,#3cc8f5)"></body>');
const png = await pic.screenshot({ type: "png" });
await pic.close();

await page.goto(`${base}/create`, { waitUntil: "networkidle" });
await page.setInputFiles('input[type="file"]', { name: "pic.png", mimeType: "image/png", buffer: png });
await page.waitForSelector('button:has-text("Change picture")', { state: "attached", timeout: 10000 }).catch(() => fail("picture did not upload"));
await page.fill("#pitch", "Guest-created narrative: no wallet, just vibes and a picture.");
await page.fill("#name", "Guest Coin");
await page.fill("#ticker", "GUEST");
await page.screenshot({ path: join(out, "guest-create-filled.png") });
await page.click('button:has-text("Start narrative")');
await page.waitForURL(/\/n\//, { timeout: 15000 }).catch(() => fail("did not navigate to the narrative"));
await page.waitForLoadState("networkidle");
console.log("created:", page.url());

const title = await page.textContent("h1");
if (!title?.includes("Guest Coin")) fail(`unexpected title ${title}`);
const imgs = await page.locator('img[src^="/api/images/"]').count();
if (imgs < 1) fail("picture not shown on the narrative page");

// Vote on the name entry as the same guest.
const voteBtn = page.locator('button[aria-label="Vote for Guest Coin"]');
await voteBtn.click();
await page.waitForSelector('button:has-text("Voted")', { timeout: 10000 }).catch(() => fail("vote did not register"));
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, "guest-narrative.png") });
console.log("OK: guest created a narrative with a picture and voted, no wallet involved");
await browser.close();
