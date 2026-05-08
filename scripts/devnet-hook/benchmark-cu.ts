/**
 * On-chain CU benchmark for zksettle (issue #99, PRD §11).
 *
 * Uses the chunked hook path:
 *   1. Register issuer with fixture roots
 *   2. init_hook_payload → write_hook_proof → finalize_hook_payload
 *   3. Simulate settle_hook to measure gnark verification CU
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json ./node_modules/.bin/ts-node benchmark-cu.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ZKSETTLE_PROGRAM_ID = new PublicKey(
  "2HexcvYg6zvQo6kf1ompmvG78GUKMTW292kp1wDdKzFk"
);
const MPL_BUBBLEGUM_ID = new PublicKey(
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY"
);
const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK"
);
const NOOP_PROGRAM_ID = new PublicKey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"
);

const ISSUER_SEED = Buffer.from("issuer");
const BUBBLEGUM_REGISTRY_SEED = Buffer.from("bubblegum-registry");
const BUBBLEGUM_TREE_CREATOR_SEED = Buffer.from("bubblegum-tree-creator");
const HOOK_PAYLOAD_SEED = Buffer.from("hook-payload");

const MERKLE_ROOT = Buffer.from("0408f1aa9155d9f7405d652b9c5dd4cd69602fff5fba80e1d6bd0a36c3add6d1", "hex");
const NULLIFIER = Buffer.from("1d6ac8cee9f7b2d8f092a9169a9f49d81bb1ef665e21732414dcbe559ea0d560", "hex");
const SANCTIONS_ROOT = Buffer.from("03f5d399d3a5403fafb12fdab7483b3170812ee4e66e812bc8587e6921da2b4a", "hex");
const JURISDICTION_ROOT = Buffer.from("0408f1aa9155d9f7405d652b9c5dd4cd69602fff5fba80e1d6bd0a36c3add6d1", "hex");

function loadWallet(): Keypair {
  const p = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

function loadIdl(): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "sdk", "dist", "idl", "zksettle.json"), "utf-8"));
}

function loadProofAndWitness(): Buffer {
  const base = path.join(__dirname, "..", "..", "circuits", "target");
  const proof = fs.readFileSync(path.join(base, "zksettle_slice.proof"));
  const witness = fs.readFileSync(path.join(base, "zksettle_slice.pw"));
  return Buffer.concat([proof, witness]);
}

function pda(seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, ZKSETTLE_PROGRAM_ID)[0];
}

async function exists(c: Connection, pk: PublicKey): Promise<boolean> {
  return (await c.getAccountInfo(pk)) !== null;
}

async function main() {
  const wallet = loadWallet();
  const connection = new Connection(process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  const program = new Program(loadIdl(), provider);
  const proofAndWitness = loadProofAndWitness();

  console.log("=== ZKSettle CU Benchmark ===\n");
  console.log(`Wallet:  ${wallet.publicKey.toBase58()}`);
  console.log(`Proof+witness: ${proofAndWitness.length} bytes`);
  console.log(`Balance: ${((await connection.getBalance(wallet.publicKey)) / 1e9).toFixed(4)} SOL\n`);

  const issuerPda = pda([ISSUER_SEED, wallet.publicKey.toBuffer()]);
  const hookPayloadPda = pda([HOOK_PAYLOAD_SEED, wallet.publicKey.toBuffer()]);
  const registryPda = pda([BUBBLEGUM_REGISTRY_SEED]);
  const treeCreator = pda([BUBBLEGUM_TREE_CREATOR_SEED]);

  const mintBytes = Buffer.alloc(32);
  for (let i = 16; i < 32; i++) mintBytes[i] = 0x01;
  const mint = new PublicKey(mintBytes);

  const recipientBytes = Buffer.alloc(32);
  for (let i = 16; i < 32; i++) recipientBytes[i] = 0x02;
  const recipient = new PublicKey(recipientBytes);

  // 1. Register/update issuer
  if (await exists(connection, issuerPda)) {
    console.log("Updating issuer roots...");
    await program.methods
      .updateIssuerRoot(Array.from(MERKLE_ROOT), Array.from(SANCTIONS_ROOT), Array.from(JURISDICTION_ROOT))
      .accounts({ authority: wallet.publicKey, issuer: issuerPda })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log("  Done.");
  } else {
    console.log("Registering issuer...");
    await program.methods
      .registerIssuer(Array.from(MERKLE_ROOT), Array.from(SANCTIONS_ROOT), Array.from(JURISDICTION_ROOT))
      .accounts({ authority: wallet.publicKey, issuer: issuerPda, systemProgram: SystemProgram.programId })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log("  Done.");
  }

  // 2. Close existing payload
  if (await exists(connection, hookPayloadPda)) {
    console.log("Closing existing payload...");
    try {
      await program.methods.closeHookPayload()
        .accounts({ authority: wallet.publicKey, issuer: issuerPda, hookPayload: hookPayloadPda })
        .signers([wallet]).rpc({ commitment: "confirmed" });
    } catch {}
  }

  // 3. init_hook_payload
  console.log(`\nInitializing hook payload (${proofAndWitness.length}B)...`);
  await program.methods
    .initHookPayload(proofAndWitness.length)
    .accounts({ authority: wallet.publicKey, issuer: issuerPda, hookPayload: hookPayloadPda, systemProgram: SystemProgram.programId })
    .signers([wallet]).rpc({ commitment: "confirmed" });
  console.log("  Done.");

  // 4. write_hook_proof in chunks
  const CHUNK = 450;
  const n = Math.ceil(proofAndWitness.length / CHUNK);
  console.log(`\nUploading proof (${n} chunks)...`);
  for (let off = 0; off < proofAndWitness.length; off += CHUNK) {
    const chunk = Buffer.from(proofAndWitness.subarray(off, off + CHUNK));
    await program.methods
      .writeHookProof(off, chunk)
      .accounts({ authority: wallet.publicKey, issuer: issuerPda, hookPayload: hookPayloadPda })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log(`  ${Math.floor(off / CHUNK) + 1}/${n}: ${chunk.length}B @ ${off}`);
  }

  // 5. finalize_hook_payload
  console.log("\nFinalizing payload...");
  await program.methods
    .finalizeHookPayload(
      Array.from(NULLIFIER), mint, new BN(0), recipient, new BN(1000),
      { bubblegumTail: 0, proofPresent: false, proofBytes: Array(128).fill(0), addressMtIndex: 0, addressQueueIndex: 0, addressRootIndex: 0, outputStateTreeIndex: 0 }
    )
    .accounts({ authority: wallet.publicKey, issuer: issuerPda, hookPayload: hookPayloadPda })
    .signers([wallet]).rpc({ commitment: "confirmed" });
  console.log("  Done.");

  // 6. Simulate settle_hook
  console.log("\nSimulating settle_hook (gnark verification)...");
  const dummyTree = Keypair.generate().publicKey;
  const [dummyTreeConfig] = PublicKey.findProgramAddressSync([dummyTree.toBuffer()], MPL_BUBBLEGUM_ID);

  const ix = await program.methods
    .settleHook(new BN(1000))
    .accounts({
      authority: wallet.publicKey, mint, destinationToken: recipient,
      hookPayload: hookPayloadPda, leafOwner: recipient, issuer: issuerPda,
      registry: registryPda, merkleTree: dummyTree, treeConfig: dummyTreeConfig,
      treeCreator, bubblegumProgram: MPL_BUBBLEGUM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID, logWrapper: NOOP_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const bh = (await connection.getLatestBlockhash()).blockhash;
  const msg = new TransactionMessage({
    payerKey: wallet.publicKey, recentBlockhash: bh,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix],
  }).compileToV0Message();

  const vtx = new VersionedTransaction(msg);
  vtx.sign([wallet]);

  const sim = await connection.simulateTransaction(vtx, { sigVerify: false });

  console.log(`\n${"=".repeat(50)}`);
  console.log(`COMPUTE UNITS CONSUMED: ${sim.value.unitsConsumed}`);
  console.log(`${"=".repeat(50)}`);

  if (sim.value.err) {
    console.log(`\nError (expected — no bubblegum tree): ${JSON.stringify(sim.value.err)}`);
  }
  if (sim.value.logs) {
    console.log(`\nLogs:`);
    for (const log of sim.value.logs) console.log(`  ${log}`);
  }

  // Cleanup
  console.log("\nCleaning up...");
  try {
    await program.methods.closeHookPayload()
      .accounts({ authority: wallet.publicKey, issuer: issuerPda, hookPayload: hookPayloadPda })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log("  Payload closed.");
  } catch {}
}

main().catch((err) => { console.error(err); process.exit(1); });
