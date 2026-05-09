/**
 * On-chain CU benchmark for zksettle (issue #99, PRD §11).
 *
 * Uses devnet-state.json (from setup.ts) for account addresses, then:
 *   1. Update issuer roots to match fixture
 *   2. Upload proof via chunked flow (init → write → finalize)
 *   3. Simulate settle_hook to measure gnark verification CU
 *   4. Compute SOL cost per verification
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node benchmark-cu.ts [--runs N] [--live]
 */

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

import {
  ZKSETTLE_PROGRAM_ID,
  HOOK_PAYLOAD_SEED,
  MERKLE_ROOT,
  SANCTIONS_ROOT,
  JURISDICTION_ROOT,
  PRIORITY_FEE_MICRO_LAMPORTS,
  LAMPORTS_PER_SOL,
  pda,
  solCostFromCu,
  percentile,
  exists,
  loadWallet,
  loadProofAndWitness,
  uploadProof,
  simulateSettle,
  liveSettle,
} from "../lib/benchmark-utils";

const idlJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "sdk", "src", "idl", "zksettle.json"), "utf-8")
);

const STATE_FILE = path.join(__dirname, "devnet-state.json");

interface DevnetState {
  mint: string;
  issuerPda: string;
  registryPda: string;
  hookPayloadPda: string;
  recipient: string;
  merkleTree: string;
}

function parseArgs(): { runs: number; live: boolean } {
  const args = process.argv.slice(2);
  let runs = 5;
  let live = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--live") { live = true; continue; }
    if (args[i] === "--runs" && args[i + 1]) { runs = parseInt(args[++i], 10); }
  }
  return { runs, live };
}

function loadState(): DevnetState {
  if (!fs.existsSync(STATE_FILE)) {
    console.error("No devnet-state.json. Run setup.ts first.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

async function main() {
  const { runs, live } = parseArgs();
  const wallet = loadWallet();
  const state = loadState();
  const circuitsBase = path.join(__dirname, "..", "..", "circuits", "target");
  const proofAndWitness = loadProofAndWitness(circuitsBase);

  const connection = new Connection(
    process.env.RPC_URL || "https://api.devnet.solana.com", "confirmed"
  );
  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  const program = new Program(idlJson as any, provider);

  const issuerPda = new PublicKey(state.issuerPda);
  const hookPayloadPda = pda([HOOK_PAYLOAD_SEED, wallet.publicKey.toBuffer()]);
  const registryPda = new PublicKey(state.registryPda);
  const mintPk = new PublicKey(state.mint);
  const recipientPk = new PublicKey(state.recipient);
  const merkleTree = new PublicKey(state.merkleTree);

  console.log("=== ZKSettle CU Benchmark (devnet-hook) ===\n");
  console.log(`Wallet:        ${wallet.publicKey.toBase58()}`);
  console.log(`Program:       ${ZKSETTLE_PROGRAM_ID.toBase58()}`);
  console.log(`Mint:          ${mintPk.toBase58()}`);
  console.log(`Proof+witness: ${proofAndWitness.length} bytes`);
  console.log(`Mode:          ${live ? "LIVE" : "SIMULATE"}`);
  console.log(`Runs:          ${runs}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance:       ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.error("Need ≥ 0.5 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  console.log("Updating issuer roots...");
  await program.methods
    .updateIssuerRoot(Array.from(MERKLE_ROOT), Array.from(SANCTIONS_ROOT), Array.from(JURISDICTION_ROOT))
    .accounts({ authority: wallet.publicKey, issuer: issuerPda })
    .signers([wallet]).rpc({ commitment: "confirmed" });

  interface RunResult { run: number; cu: number; solCost: number; error?: string }
  const results: RunResult[] = [];

  for (let i = 0; i < runs; i++) {
    console.log(`\n--- Run ${i + 1}/${runs} ---`);

    console.log("Uploading proof...");
    await uploadProof(
      program, wallet, connection, proofAndWitness,
      issuerPda, hookPayloadPda, mintPk, recipientPk,
    );
    console.log("Proof finalized.");

    console.log(`${live ? "Executing" : "Simulating"} settle_hook...`);

    try {
      const { cu, logs } = live
        ? await liveSettle(program, wallet, connection, hookPayloadPda, issuerPda, mintPk, recipientPk, registryPda, merkleTree)
        : await simulateSettle(program, wallet, connection, hookPayloadPda, issuerPda, mintPk, recipientPk, registryPda, merkleTree);

      const cost = solCostFromCu(cu);
      results.push({ run: i + 1, cu, solCost: cost });
      console.log(`  CU: ${cu.toLocaleString()}  |  SOL: ${cost.toFixed(6)}`);

      const probes = logs.filter(l => l.includes("cu-probe"));
      for (const p of probes) console.log(`  ${p}`);

      if (logs.some(l => l.includes("failed:"))) {
        const errLog = logs.find(l => l.includes("failed:"));
        console.log(`  Note: ${errLog?.trim()}`);
      }
    } catch (err: any) {
      console.error(`  Failed: ${err.message?.slice(0, 200)}`);
      results.push({ run: i + 1, cu: 0, solCost: 0, error: err.message?.slice(0, 200) });
    }

    if (await exists(connection, hookPayloadPda)) {
      try {
        await program.methods.closeHookPayload()
          .accounts({ authority: wallet.publicKey, hookPayload: hookPayloadPda })
          .signers([wallet]).rpc({ commitment: "confirmed" });
      } catch (err: any) {
        console.warn(`closeHookPayload (cleanup) failed: ${err.message?.slice(0, 120)}`);
      }
    }
  }

  const ok = results.filter(r => r.cu > 0);
  if (ok.length === 0) {
    console.log("\nAll runs failed.");
    process.exit(1);
  }

  const cuVals = ok.map(r => r.cu).sort((a, b) => a - b);
  const costVals = ok.map(r => r.solCost).sort((a, b) => a - b);

  console.log("\n" + "=".repeat(55));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(55));
  console.log(`Successful: ${ok.length}/${runs}`);
  console.log(`\nCompute Units:`);
  console.log(`  Min:    ${cuVals[0].toLocaleString()}`);
  console.log(`  Median: ${percentile(cuVals, 50).toLocaleString()}`);
  console.log(`  Max:    ${cuVals[cuVals.length - 1].toLocaleString()}`);
  console.log(`  Target: < 250,000`);
  console.log(`  Status: ${percentile(cuVals, 50) < 250_000 ? "PASS" : "FAIL"}`);

  console.log(`\nSOL Cost (@ ${PRIORITY_FEE_MICRO_LAMPORTS} µlam/CU):`);
  console.log(`  Min:    ${costVals[0].toFixed(6)} SOL`);
  console.log(`  Median: ${percentile(costVals, 50).toFixed(6)} SOL`);
  console.log(`  Max:    ${costVals[costVals.length - 1].toFixed(6)} SOL`);
  console.log(`  Target: < 0.001 SOL`);
  console.log(`  Status: ${percentile(costVals, 50) < 0.001 ? "PASS" : "FAIL"}`);

  const report = {
    timestamp: new Date().toISOString(),
    config: { runs, live, priorityFeeMicroLamports: PRIORITY_FEE_MICRO_LAMPORTS },
    results: results.map(({ run, cu, solCost, error }) => ({ run, cu, solCost, error })),
    summary: {
      cu: { min: cuVals[0], median: percentile(cuVals, 50), max: cuVals[cuVals.length - 1] },
      solCost: { min: costVals[0], median: percentile(costVals, 50), max: costVals[costVals.length - 1] },
      cuPass: percentile(cuVals, 50) < 250_000,
      solPass: percentile(costVals, 50) < 0.001,
    },
  };

  const outPath = path.join(__dirname, "..", "..", "docs", "benchmark-cu-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nResults → ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
