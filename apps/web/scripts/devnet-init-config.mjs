// One-time escrow setup on DEVNET (`init_config`, D-020). Signs with the upgrade-authority key file
// and prints only public addresses and the transaction signature. Refuses anything but devnet.
//
//   node scripts/devnet-init-config.mjs <admin-keypair.json> <operator-address> <treasury-address> [maxPoolCapSol=0.5]
//
// Fee settings match the web app defaults: 1% platform fee on launch, creator fees 30% to the
// proposer and 20% to the platform (the rest to depositors). Devnet pool caps stay tiny because
// pump's devnet curve is ~30x smaller than mainnet's (ARCHITECTURE.md).
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** sha256("global:init_config")[..8], from the published IDL. */
const DISC = Buffer.from([23, 235, 115, 232, 168, 96, 1, 231]);
const FEE_BPS = 100;
const PROPOSER_BPS = 3000;
const PLATFORM_BPS = 2000;

const [keyPath, operatorArg, treasuryArg, capArg = "0.5"] = process.argv.slice(2);
if (!keyPath || !operatorArg || !treasuryArg) {
  console.error("usage: node scripts/devnet-init-config.mjs <admin-keypair.json> <operator> <treasury> [maxPoolCapSol]");
  process.exit(1);
}
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const operator = new PublicKey(operatorArg);
const treasury = new PublicKey(treasuryArg);
const maxPoolCap = BigInt(Math.round(Number(capArg) * 1e9));
if (!(maxPoolCap >= 100_000_000n && maxPoolCap <= 2_000_000_000n)) throw new Error("devnet max pool cap must be 0.1–2 SOL");

const conn = new Connection(RPC, "confirmed");
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER);

console.log(`admin     ${admin.publicKey.toBase58()}`);
console.log(`operator  ${operator.toBase58()}`);
console.log(`treasury  ${treasury.toBase58()}`);
console.log(`config    ${config.toBase58()}`);
if (await conn.getAccountInfo(config)) {
  console.log("Config already exists; nothing to do (use update_config to change it).");
  process.exit(0);
}

const data = Buffer.alloc(8 + 32 + 32 + 2 + 2 + 2 + 8);
let o = 0;
o += DISC.copy(data, o);
o += operator.toBuffer().copy(data, o);
o += treasury.toBuffer().copy(data, o);
o = data.writeUInt16LE(FEE_BPS, o);
o = data.writeUInt16LE(PROPOSER_BPS, o);
o = data.writeUInt16LE(PLATFORM_BPS, o);
data.writeBigUInt64LE(maxPoolCap, o);

const ix = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: config, isSigner: false, isWritable: true },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data,
});
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [admin]);
console.log(`init_config ok: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
