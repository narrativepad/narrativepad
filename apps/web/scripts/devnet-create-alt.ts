// Creates the address lookup table that `launch` needs on DEVNET (D-021): ~40 accounts don't fit a
// plain transaction. Signs with the operator key file and prints only the table's address, which
// goes into LAUNCH_ALT. Re-run it if pump changes its fee recipients.
//
//   node --experimental-strip-types scripts/devnet-create-alt.ts <operator-keypair.json> <treasury-address>
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { launchStaticAccounts, PUMP_PROGRAM_ID, pumpFeesFromGlobal } from "../src/lib/solana/escrow.ts";

const [keyPath, treasuryArg] = process.argv.slice(2);
if (!keyPath || !treasuryArg) {
  console.error("usage: node --experimental-strip-types scripts/devnet-create-alt.ts <operator-keypair.json> <treasury>");
  process.exit(1);
}
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
if ((await conn.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("not devnet");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));

const global = await conn.getAccountInfo(PublicKey.findProgramAddressSync([new TextEncoder().encode("global")], PUMP_PROGRAM_ID)[0]);
if (!global) throw new Error("pump Global not found on devnet");
const fees = pumpFeesFromGlobal(global.data);
console.log(`pump fee recipient     ${fees.feeRecipient.toBase58()}`);
console.log(`pump buyback recipient ${fees.buybackRecipient.toBase58()}`);
const addresses = launchStaticAccounts(fees, new PublicKey(treasuryArg));

async function send(ixs: TransactionInstruction[]) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([payer]);
  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

// The table's address derives from a recent slot that the validator must still have in its slot
// hashes. Public RPC is load-balanced, so take the slot a node just served and retry if needed.
for (let attempt = 1; ; attempt++) {
  const slot = (await conn.getLatestBlockhashAndContext("finalized")).context.slot;
  const [createIx, table] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const extendIx = AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: table, addresses });
  try {
    await send([createIx, extendIx]);
    console.log(`LAUNCH_ALT=${table.toBase58()}  (${addresses.length} addresses)`);
    break;
  } catch (e) {
    if (attempt >= 5 || !/not a recent slot/.test(String((e as { logs?: string[] }).logs ?? e))) throw e;
    await new Promise((r) => setTimeout(r, 1500));
  }
}
