/**
 * On-chain CU benchmark for zksettle settle_hook (issue #99, PRD §11).
 *
 * Uses the chunked payload flow:
 *   1. Register/update issuer with fixture roots
 *   2. init_hook_payload → write_hook_proof → finalize_hook_payload
 *   3. Simulate settle_hook to measure gnark verification CU
 *   4. Compute SOL cost per verification from CU
 *
 * Prerequisites:
 *   - Funded wallet (≥ 0.5 SOL)
 *   - Circuit artifacts: circuits/target/zksettle_slice.{proof,pw}
 *   - SDK IDL built: sdk/src/idl/zksettle.json
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/benchmark-cu.ts
 *
 * Options:
 *   --runs <n>       Number of benchmark runs (default: 5)
 *   --rpc <url>      RPC endpoint (default: devnet)
 *   --live           Execute settle_hook on-chain instead of simulating
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

import {
  ZKSETTLE_PROGRAM_ID,
  ISSUER_SEED,
  HOOK_PAYLOAD_SEED,
  BUBBLEGUM_REGISTRY_SEED,
  MERKLE_ROOT,
  SANCTIONS_ROOT,
  JURISDICTION_ROOT,
  FIXTURE_MINT,
  FIXTURE_RECIPIENT,
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
} from "./lib/benchmark-utils";

const idlJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "sdk", "src", "idl", "zksettle.json"), "utf-8")
);

interface BenchmarkResult {
  run: number;
  cuConsumed: number;
  solCost: number;
  logs: string[];
  error?: string;
}

function parseArgs(): { runs: number; rpc: string; live: boolean } {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  let live = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--live") { live = true; continue; }
    const key = args[i]?.replace(/^--/, "");
    const val = args[i + 1];
    if (key && val && !val.startsWith("--")) { opts[key] = val; i++; }
  }
  return {
    runs: parseInt(opts.runs || "5", 10),
    rpc: opts.rpc || "https://api.devnet.solana.com",
    live,
  };
}

async function ensureIssuer(
  program: Program, wallet: Keypair, connection: Connection
): Promise<PublicKey> {
  const issuerPda = pda([ISSUER_SEED, wallet.publicKey.toBuffer()]);

  if (await exists(connection, issuerPda)) {
    await program.methods
      .updateIssuerRoot(
        Array.from(MERKLE_ROOT), Array.from(SANCTIONS_ROOT), Array.from(JURISDICTION_ROOT)
      )
      .accounts({ authority: wallet.publicKey, issuer: issuerPda })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log(`Issuer roots updated: ${issuerPda.toBase58()}`);
  } else {
    await program.methods
      .registerIssuer(
        Array.from(MERKLE_ROOT), Array.from(SANCTIONS_ROOT), Array.from(JURISDICTION_ROOT)
      )
      .accounts({
        authority: wallet.publicKey, issuer: issuerPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet]).rpc({ commitment: "confirmed" });
    console.log(`Issuer registered: ${issuerPda.toBase58()}`);
  }
  return issuerPda;
}

async function resolveRegistryTree(
  program: Program, connection: Connection,
): Promise<{ registryPda: PublicKey; merkleTree: PublicKey }> {
  const registryPda = pda([BUBBLEGUM_REGISTRY_SEED]);

  if (!(await exists(connection, registryPda))) {
    console.error(
      "No bubblegum registry found on-chain.\n" +
      "Run setup.ts first, or use scripts/devnet-hook/benchmark-cu.ts with devnet-state.json."
    );
    process.exit(1);
  }

  const registry = await program.account.bubblegumTreeRegistry.fetch(registryPda);
  return { registryPda, merkleTree: registry.merkleTree as PublicKey };
}

async function main() {
  const { runs, rpc, live } = parseArgs();
  const wallet = loadWallet();
  const connection = new Connection(rpc, "confirmed");
  const circuitsBase = path.join(__dirname, "..", "circuits", "target");
  const proofAndWitness = loadProofAndWitness(circuitsBase);

  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  const program = new Program(idlJson as any, provider);

  const issuerPda = pda([ISSUER_SEED, wallet.publicKey.toBuffer()]);
  const hookPayloadPda = pda([HOOK_PAYLOAD_SEED, wallet.publicKey.toBuffer()]);

  console.log("=== ZKSettle CU Benchmark ===\n");
  console.log(`Wallet:          ${wallet.publicKey.toBase58()}`);
  console.log(`Program:         ${ZKSETTLE_PROGRAM_ID.toBase58()}`);
  console.log(`RPC:             ${connection.rpcEndpoint}`);
  console.log(`Proof+witness:   ${proofAndWitness.length} bytes`);
  console.log(`Mode:            ${live ? "LIVE (on-chain)" : "SIMULATE"}`);
  console.log(`Runs:            ${runs}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance:         ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.error("Need ≥ 0.5 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  await ensureIssuer(program, wallet, connection);

  const { registryPda, merkleTree } = await resolveRegistryTree(program, connection);

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < runs; i++) {
    console.log(`\n--- Run ${i + 1}/${runs} ---`);

    console.log("Uploading proof...");
    await uploadProof(
      program, wallet, connection, proofAndWitness,
      issuerPda, hookPayloadPda, FIXTURE_MINT, FIXTURE_RECIPIENT,
    );
    console.log("Proof uploaded and finalized.");

    console.log(`${live ? "Executing" : "Simulating"} settle_hook...`);

    try {
      const { cu, logs } = live
        ? await liveSettle(program, wallet, connection, hookPayloadPda, issuerPda, FIXTURE_MINT, FIXTURE_RECIPIENT, registryPda, merkleTree)
        : await simulateSettle(program, wallet, connection, hookPayloadPda, issuerPda, FIXTURE_MINT, FIXTURE_RECIPIENT, registryPda, merkleTree);

      const cost = solCostFromCu(cu);
      results.push({ run: i + 1, cuConsumed: cu, solCost: cost, logs });

      console.log(`  CU consumed: ${cu.toLocaleString()}`);
      console.log(`  SOL cost:    ${cost.toFixed(6)} SOL`);

      const probes = logs.filter(l => l.includes("cu-probe"));
      for (const p of probes) console.log(`  ${p}`);

      const verifyPassed = logs.some(l =>
        l.includes("post-verify_bundle") || l.includes("Groth16 verification passed")
      );
      if (verifyPassed) console.log("  ✓ Gnark verification passed");

      const errLog = logs.find(l => l.includes("failed:") || l.includes("Error"));
      if (errLog) console.log(`  Note: ${errLog.trim()}`);
    } catch (err: any) {
      const errMsg = err.message?.slice(0, 200) || String(err);
      console.error(`  Failed: ${errMsg}`);

      let cu = 0;
      if (err.logs) {
        const cuLog = err.logs.find((l: string) => l.includes("consumed"));
        if (cuLog) {
          const match = cuLog.match(/consumed (\d+)/);
          if (match) cu = parseInt(match[1], 10);
        }
      }
      results.push({ run: i + 1, cuConsumed: cu, solCost: solCostFromCu(cu), logs: err.logs ?? [], error: errMsg });
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

  const successful = results.filter(r => r.cuConsumed > 0);
  if (successful.length === 0) {
    console.log("\n=== No successful measurements ===");
    console.log("All runs failed. Check program deployment and account state.");
    process.exit(1);
  }

  const cuValues = successful.map(r => r.cuConsumed).sort((a, b) => a - b);
  const costValues = successful.map(r => r.solCost).sort((a, b) => a - b);

  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(60));
  console.log(`\nSuccessful runs: ${successful.length}/${runs}`);
  console.log(`\nCompute Units:`);
  console.log(`  Min:    ${cuValues[0].toLocaleString()}`);
  console.log(`  Median: ${percentile(cuValues, 50).toLocaleString()}`);
  console.log(`  Max:    ${cuValues[cuValues.length - 1].toLocaleString()}`);
  console.log(`  p95:    ${percentile(cuValues, 95).toLocaleString()}`);
  console.log(`  Target: < 250,000`);
  console.log(`  Status: ${percentile(cuValues, 50) < 250_000 ? "PASS ✓" : "FAIL ✗"}`);

  console.log(`\nSOL Cost per Verification (@ ${PRIORITY_FEE_MICRO_LAMPORTS} µlam/CU priority fee):`);
  console.log(`  Min:    ${costValues[0].toFixed(6)} SOL`);
  console.log(`  Median: ${percentile(costValues, 50).toFixed(6)} SOL`);
  console.log(`  Max:    ${costValues[costValues.length - 1].toFixed(6)} SOL`);
  console.log(`  Target: < 0.001 SOL`);
  console.log(`  Status: ${percentile(costValues, 50) < 0.001 ? "PASS ✓" : "FAIL ✗"}`);

  const report = {
    timestamp: new Date().toISOString(),
    config: { runs, rpc, live, priorityFeeMicroLamports: PRIORITY_FEE_MICRO_LAMPORTS },
    results: results.map(({ run, cuConsumed, solCost, error }) => ({ run, cuConsumed, solCost, error })),
    summary: {
      successfulRuns: successful.length,
      cu: {
        min: cuValues[0],
        median: percentile(cuValues, 50),
        max: cuValues[cuValues.length - 1],
        p95: percentile(cuValues, 95),
      },
      solCost: {
        min: costValues[0],
        median: percentile(costValues, 50),
        max: costValues[costValues.length - 1],
      },
      targetCu: 250_000,
      targetSol: 0.001,
      cuPass: percentile(cuValues, 50) < 250_000,
      solPass: percentile(costValues, 50) < 0.001,
    },
  };

  const outPath = path.join(__dirname, "..", "docs", "benchmark-cu-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
