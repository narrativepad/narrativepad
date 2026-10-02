// End-to-end check of the full flow against a running server in SIMULATION mode, using throwaway
// ed25519 keys (no real wallets, nothing on-chain). Run the server with short timings, e.g.
//   VOTE_DURATION_SEC=15 DEPOSIT_WINDOW_SEC=15 LAUNCH_DELAY_SEC=4 LAUNCH_WINDOW_SEC=60 \
//   TRANCHE_COUNT=3 TRANCHE_INTERVAL_SEC=6 npx next start -p 3100
// then: node --experimental-strip-types scripts/sim-e2e.ts http://localhost:3100
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import assert from "node:assert/strict";
import { canonicalJson, fromHex, lockHash, merkleRoot, sha256Hex, uuidBytes } from "../src/lib/math.ts";
import { buildMessage, type Action, type Payload } from "../src/lib/messages.ts";

const BASE = process.argv[2] ?? "http://localhost:3100";
const SOL = 1_000_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Wallet {
  secret = ed25519.utils.randomSecretKey();
  address = bs58.encode(ed25519.getPublicKey(this.secret));
  label: string;
  constructor(label: string) {
    this.label = label;
  }

  async signed<A extends Action>(path: string, action: A, payload: Payload<A>, tamper?: (p: any) => any) {
    const { nonce } = await (await fetch(`${BASE}/api/auth/nonce?wallet=${this.address}`)).json();
    const issuedAt = new Date().toISOString();
    const message = buildMessage({ action, payload, wallet: this.address, nonce, issuedAt, simulation: true });
    const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), this.secret));
    const body = { wallet: this.address, nonce, issuedAt, signature, payload: tamper ? tamper(structuredClone(payload)) : payload };
    const send = () => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await send();
    return { status: res.status, data: await res.json().catch(() => ({})), replay: send };
  }
}

async function detail(slug: string) {
  return (await fetch(`${BASE}/api/n/${slug}`)).json();
}

async function waitFor(slug: string, pred: (n: any) => boolean, label: string, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const n = await detail(slug);
    if (pred(n)) return n;
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${msg}`);

// Smallest valid PNG (1x1).
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function main() {
  console.log(`E2E against ${BASE}`);
  const [alice, bob, carol, dave] = ["alice", "bob", "carol", "dave"].map((l) => new Wallet(l));

  // ---- propose -------------------------------------------------------------------------------
  const created = await alice.signed("/api/narratives", "create", {
    pitch: "A cat that went to the moon and refused to come back. Community-built.",
    sourceUrl: "https://x.com/narrativepad/status/1",
    name: "Moon Cat",
    ticker: "mcat",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const { id, slug } = created.data;
  ok(`created narrative ${slug}`);

  // ---- ballots & votes -----------------------------------------------------------------------
  const kitty = await bob.signed(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field: "name", value: "Moon Kitty" });
  assert.equal(kitty.status, 200);
  const dup = await carol.signed(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field: "name", value: "Moon Kitty" });
  assert.equal(dup.status, 409);
  const badTicker = await carol.signed(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field: "ticker", value: "BINANCE" });
  assert.equal(badTicker.status, 400, "impersonation filter");
  ok("submissions: duplicate rejected, impersonation filtered");

  // ---- pair (D-019) --------------------------------------------------------------------------
  const submit = (w: Wallet, field: any, value: string) => w.signed(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field, value });
  assert.equal((await submit(carol, "x", "https://x.com/mooncat")).status, 400, "link ballots are off");
  assert.equal((await submit(carol, "fees", "holders")).status, 400, "fees are voted in the pool, not on a ballot");
  assert.equal((await submit(carol, "pair", "NOTAPAIR")).status, 400, "only pairs pump.fun accepts");
  assert.equal((await submit(carol, "pair", "sol")).status, 409, "SOL is already on the ballot");
  const nvda = await submit(carol, "pair", "nvdax");
  assert.equal(nvda.status, 200, JSON.stringify(nvda.data));
  let n = await detail(slug);
  assert.deepEqual(n.ballots.pair.entries.map((e: any) => e.value), ["SOL", "NVDAx"], "case fixed to pump.fun's symbol");
  assert.equal(n.ballots.x, undefined);
  assert.equal(n.ballots.fees, undefined);
  assert.ok(n.pairOptions.some((o: any) => o.symbol === "TSLAx" && o.kind === "stock"), "stocks offered");
  assert.ok(n.pairOptions.some((o: any) => o.symbol === "USDC"), "USDC offered");
  assert.ok(!n.pairOptions.some((o: any) => o.symbol === "USD1"), "USD1 is not a pump.fun pair");
  ok(`pair ballot takes only pump.fun's ${n.pairOptions.length} pairs (NVDAx added, a made-up one refused); no link or fee ballots`);

  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "cat.png");
  const up = await (await fetch(`${BASE}/api/images`, { method: "POST", body: fd })).json();
  assert.match(up.path, /^\/api\/images\/[a-f0-9]{64}$/);
  const img = await dave.signed(`/api/narratives/${id}/submit`, "submit", { narrativeId: id, field: "image", value: up.path });
  assert.equal(img.status, 200);
  ok("image uploaded (content-addressed) and submitted");

  const withPic = await bob.signed("/api/narratives", "create", {
    pitch: "A narrative started with its own picture.",
    name: "Picture Coin",
    ticker: "PIC",
    image: up.path,
  });
  assert.equal(withPic.status, 200, JSON.stringify(withPic.data));
  const pic = await detail(withPic.data.slug);
  assert.equal(pic.ballots.image.entries[0].value, up.path);
  assert.deepEqual(pic.ballots.pair.entries.map((e: any) => e.value), ["SOL"]);
  ok("narrative created with a picture → first image entry; SOL seeded as the default pair");

  n = await detail(slug);
  const entry = (field: string, value: string) => n.ballots[field].entries.find((e: any) => e.value === value).id;
  const vote = (w: Wallet, field: any, value: string) =>
    w.signed(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field, submissionId: entry(field, value) });

  for (const w of [bob, carol, dave]) assert.equal((await vote(w, "name", "Moon Kitty")).status, 200);
  assert.equal((await vote(alice, "name", "Moon Cat")).status, 200);
  for (const w of [alice, bob, carol]) assert.equal((await vote(w, "ticker", "MCAT")).status, 200);
  assert.equal((await vote(dave, "image", up.path)).status, 200);
  // NVDAx gets one vote, SOL two.
  assert.equal((await vote(carol, "pair", "NVDAx")).status, 200);
  for (const w of [alice, dave]) assert.equal((await vote(w, "pair", "SOL")).status, 200);
  ok("11 signed votes accepted across name, ticker, image and pair");

  assert.equal((await vote(bob, "name", "Moon Cat")).status, 409);
  ok("second vote on the same field rejected");

  const tampered = await dave.signed(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field: "ticker", submissionId: entry("ticker", "MCAT") }, (p) => ({
    ...p,
    field: "name",
    submissionId: entry("name", "Moon Cat"),
  }));
  assert.equal(tampered.status, 401);
  ok("payload tampered after signing → 401");

  const once = await dave.signed(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field: "ticker", submissionId: entry("ticker", "MCAT") });
  assert.equal(once.status, 200);
  assert.equal((await once.replay()).status, 401);
  ok("nonce replay → 401");

  // ---- chat ----------------------------------------------------------------------------------
  const say = (w: Wallet, body: string) => w.signed(`/api/narratives/${id}/comments`, "comment", { narrativeId: id, body });
  const hello = await say(bob, "Moon Kitty all the way.");
  assert.equal(hello.status, 200, JSON.stringify(hello.data));
  const plan = await say(carol, "Plan for the pool:\n1. back Moon Kitty\n2. join early, it's the same price anyway");
  assert.equal(plan.status, 200, "multi-line messages are allowed");
  assert.equal((await say(carol, Array.from({ length: 300 }, () => "word").join(" "))).status, 200, "300 words is fine");
  assert.equal((await say(carol, Array.from({ length: 301 }, () => "word").join(" "))).status, 400, "301 words is not");
  assert.equal((await say(carol, "x".repeat(2001))).status, 400);
  assert.equal((await say(carol, "   ")).status, 400);
  assert.equal((await say(carol, "this is nsfw content")).status, 400, "blocklist applies to chat");
  assert.equal((await say(carol, "tab\tcharacter")).status, 400, "text only");
  assert.equal((await say(carol, "too\n\n\n\nmany blank lines")).status, 400, "must be normalised before signing");
  const since = await (await fetch(`${BASE}/api/narratives/${id}/comments?after=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`)).json();
  assert.equal(since.comments.length, 3, "catch-up endpoint returns new messages");
  const tamperedChat = await dave.signed(`/api/narratives/${id}/comments`, "comment", { narrativeId: id, body: "nice" }, (p) => ({ ...p, body: "rug" }));
  assert.equal(tamperedChat.status, 401);
  for (const w of [alice, carol, dave]) {
    const r = await w.signed("/api/report", "report", { targetType: "comment", targetId: hello.data.id, reason: "spam test" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  n = await detail(slug);
  assert.equal(n.comments.length, 2, "reported message hidden after 3 reports");
  assert.ok(!n.comments.some((c: any) => c.id === hello.data.id));
  assert.equal((await say(alice, "Second message, still here.")).status, 200);
  n = await detail(slug);
  assert.equal(n.comments.length, 3);
  assert.equal(n.comments[2].isCreator, true);
  ok("chat: signed text, up to 300 words and multi-line; length, blocklist, control-char and tamper checks; 3 reports hide a message");

  // ---- lock ----------------------------------------------------------------------------------
  n = await waitFor(slug, (x) => x.lock && x.escrow, "lock + escrow");
  assert.equal(n.lock.name, "Moon Kitty");
  assert.equal(n.lock.symbol, "MCAT");
  assert.equal(n.stage, "pooling");
  const metadata = await (await fetch(n.lock.metadataUri.replace(/^https?:\/\/[^/]+/, BASE))).json();
  assert.deepEqual(n.lock.launch, { venue: "pump.fun", pair: "SOL", pairMint: "So11111111111111111111111111111111111111112" });
  assert.equal(metadata.twitter, undefined, "no links in the coin metadata");
  const details = sha256Hex(canonicalJson({ narrativeId: id, chain: n.chain, metadata, votesRoot: n.lock.votesRoot, winners: n.lock.winners, launch: n.lock.launch }));
  assert.equal(details, n.lock.detailsHash);
  assert.equal(lockHash(uuidBytes(id), n.lock.name, n.lock.symbol, n.lock.metadataUri, fromHex(details)), n.lock.lockHash);
  ok(`locked "Moon Kitty" $MCAT on pump.fun with the SOL pair; lock hash recomputed: ${n.lock.lockHash.slice(0, 16)}…`);

  const audit = await (await fetch(`${BASE}/api/narratives/${id}/votes`)).json();
  for (const v of audit.votes) {
    assert.ok(ed25519.verify(bs58.decode(v.signature), new TextEncoder().encode(v.message), bs58.decode(v.voter_wallet)));
  }
  const root = merkleRoot(audit.votes.map((v: any) => sha256Hex(`${v.field}|${v.voter_wallet}|${v.submission_id}|${v.signature}`)));
  assert.equal(root, n.lock.votesRoot);
  ok(`${audit.votes.length} vote signatures re-verified; votes root matches`);

  assert.equal((await vote(carol, "image", up.path)).status, 409);
  ok("voting closed after lock");

  // ---- pool ----------------------------------------------------------------------------------
  const deposit = (w: Wallet, lamports: bigint, holderRewards: boolean) =>
    w.signed(`/api/narratives/${id}/deposit`, "deposit", { narrativeId: id, amountLamports: lamports.toString(), holderRewards });
  const noVote = await alice.signed(`/api/narratives/${id}/deposit`, "deposit", { narrativeId: id, amountLamports: SOL.toString() } as any);
  assert.equal(noVote.status, 400, "a deposit must carry a holder-rewards vote");
  // More wallets say off (bob), but more SOL says on: 2.5 SOL on vs 2 SOL off.
  assert.equal((await deposit(alice, SOL, true)).status, 200);
  assert.equal((await deposit(bob, 2n * SOL, false)).status, 200);
  assert.equal((await deposit(carol, SOL / 2n, true)).status, 200);
  assert.equal((await deposit(carol, SOL, true)).status, 200);
  const overCap = await deposit(carol, SOL, true);
  assert.equal(overCap.status, 409, JSON.stringify(overCap.data));
  const tooSmall = await deposit(dave, SOL / 100n, false);
  assert.equal(tooSmall.status, 409);
  n = await detail(slug);
  assert.equal(n.escrow.totalDeposited, (4n * SOL + SOL / 2n).toString());
  assert.equal(n.escrow.holderVotesOn, (2n * SOL + SOL / 2n).toString());
  assert.equal(n.escrow.holderVotesOff, (2n * SOL).toString());
  assert.equal(n.escrow.holderRewards, null, "not settled before launch");
  assert.deepEqual(n.deposits.map((d: any) => d.holderRewards), [true, false, true, true]);
  assert.deepEqual(n.deposits.map((d: any) => [d.orderIndex, d.wallet]), [
    [0, alice.address],
    [1, bob.address],
    [2, carol.address],
    [3, carol.address],
  ]);
  ok("deposits: 4.5 SOL in order; per-wallet cap and minimum enforced; holder-rewards vote 2.5 SOL on / 2 off");

  const earlyRefund = await alice.signed(`/api/narratives/${id}/refund`, "refund", { narrativeId: id });
  assert.equal(earlyRefund.status, 409);
  ok("refund refused while pooling");

  // ---- launch --------------------------------------------------------------------------------
  n = await waitFor(slug, (x) => x.escrow?.launched, "launch");
  assert.equal(n.stage, "live");
  assert.equal(n.escrow.platformFee, (45_000_000n).toString(), "1% of 4.5 SOL");
  assert.equal(n.escrow.holderRewards, true, "the SOL-weighted vote decides, not the wallet count");
  ok(`auto-launched: bought ${(Number(n.escrow.tokensBought) / 1e12).toFixed(2)}M tokens, fee 0.045 SOL, holder rewards on`);

  const pos = async (w: Wallet) => (await (await fetch(`${BASE}/api/narratives/${id}/position?wallet=${w.address}`)).json()).position;
  const claim = (w: Wallet) => w.signed(`/api/narratives/${id}/claim`, "claim", { narrativeId: id });
  const p0 = await pos(alice);
  assert.equal(p0.unlocked, 1);
  const c1 = await claim(alice);
  assert.equal(c1.status, 200);
  assert.equal(BigInt(c1.data.tokens), BigInt(p0.entitlement) / 3n);
  assert.equal((await claim(alice)).status, 409);
  ok("tranche 1/3 claimed; immediate second claim rejected");

  await sleep(6500);
  const c2 = await claim(alice);
  assert.equal(c2.status, 200);
  await sleep(6500);
  const c3 = await claim(alice);
  assert.equal(c3.status, 200);
  const p3 = await pos(alice);
  assert.equal(p3.claimed, p0.entitlement);
  assert.equal((await claim(alice)).status, 409);
  ok("all 3 tranches claimed, exactly the entitlement, never more");

  const folio = await (await fetch(`${BASE}/api/portfolio?wallet=${bob.address}`)).json();
  const mine = folio.items.find((x: any) => x.narrativeId === id);
  assert.ok(mine, "portfolio lists the pool");
  assert.equal(mine.stage, "live");
  assert.equal(mine.deposited, (2n * SOL).toString());
  assert.ok(BigInt(mine.claimable) > 0n, "bob has unclaimed tokens");
  assert.equal((await (await fetch(`${BASE}/api/portfolio?wallet=nope`)).json()).error, "Invalid wallet");
  ok("portfolio: position, stage and claimable amount match");

  // ---- refund path ---------------------------------------------------------------------------
  const c2Res = await bob.signed("/api/narratives", "create", { pitch: "A narrative nobody funds enough, to test refunds.", name: "Thin Pool", ticker: "THIN" });
  assert.equal(c2Res.status, 200);
  const { id: id2, slug: slug2 } = c2Res.data;
  await waitFor(slug2, (x) => x.escrow, "second escrow");
  const d2 = await carol.signed(`/api/narratives/${id2}/deposit`, "deposit", { narrativeId: id2, amountLamports: (SOL / 2n).toString(), holderRewards: false });
  assert.equal(d2.status, 200);
  const n2 = await waitFor(slug2, (x) => x.stage === "refunding", "refunding");
  assert.equal(n2.escrow.launched, false);
  const r1 = await carol.signed(`/api/narratives/${id2}/refund`, "refund", { narrativeId: id2 });
  assert.equal(r1.status, 200);
  assert.equal(r1.data.amount, (SOL / 2n).toString());
  assert.equal((await carol.signed(`/api/narratives/${id2}/refund`, "refund", { narrativeId: id2 })).status, 409);
  ok("under-minimum pool → refunding; 100% refunded once, double refund rejected");

  console.log(`\nAll ${step} checks passed.`);
}

main().catch((e) => {
  console.error("\nE2E FAILED:", e);
  process.exit(1);
});
