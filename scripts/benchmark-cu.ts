/**
 * On-chain CU benchmark for zksettle verify_proof (issue #99, PRD §11).
 *
 * STATUS: This script registers the issuer and validates the VK match, but
 * cannot yet complete the full flow. See docs/benchmarks.md §3 for blockers:
 *   - Chunked upload instructions not yet deployed
 *   - Bubblegum tree init hits 10KB CPI realloc limit
 *   - Light Protocol state trees not initialized on devnet
 *
 * Steps (once blockers are resolved):
 *   1. Register issuer with fixture roots (if not already registered)
 *   2. Init Bubblegum attestation tree (if registry doesn't exist)
 *   3. Upload proof via init_hook_payload → write_hook_proof → finalize
 *   4. Call settle_hook and parse compute_units_consumed from tx logs
 *
 * Prerequisites:
 *   - zksettle program redeployed with chunked upload instructions
 *   - Pre-created Bubblegum tree account (top-level, not CPI)
 *   - Funded wallet (≥ 2 SOL)
 *   - Light Protocol state trees available on devnet
 *   - Circuit artifacts built: circuits/target/zksettle_slice.{proof,pw}
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/benchmark-cu.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ZKSETTLE_PROGRAM_ID = new PublicKey(
  "AyZk4CYFAFFJiFC2WqqXY2oq2pgN6vvrWwYbbWz7z7Jo"
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

// Fixture public inputs from Prover.toml
const MERKLE_ROOT = Buffer.from(
  "0408f1aa9155d9f7405d652b9c5dd4cd69602fff5fba80e1d6bd0a36c3add6d1",
  "hex"
);
const NULLIFIER = Buffer.from(
  "1d6ac8cee9f7b2d8f092a9169a9f49d81bb1ef665e21732414dcbe559ea0d560",
  "hex"
);
const SANCTIONS_ROOT = Buffer.from(
  "03f5d399d3a5403fafb12fdab7483b3170812ee4e66e812bc8587e6921da2b4a",
  "hex"
);
const JURISDICTION_ROOT = Buffer.from(
  "0408f1aa9155d9f7405d652b9c5dd4cd69602fff5fba80e1d6bd0a36c3add6d1",
  "hex"
);

function loadWallet(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config/solana/id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadIdl(): any {
  const idlPath = path.join(
    __dirname,
    "..",
    "sdk",
    "dist",
    "idl",
    "zksettle.json"
  );
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function loadProofAndWitness(): Buffer {
  const proofPath = path.join(
    __dirname,
    "..",
    "circuits",
    "target",
    "zksettle_slice.proof"
  );
  const witnessPath = path.join(
    __dirname,
    "..",
    "circuits",
    "target",
    "zksettle_slice.pw"
  );

  if (!fs.existsSync(proofPath) || !fs.existsSync(witnessPath)) {
    console.error(
      "Missing circuit artifacts. Run from circuits/:\n" +
        "  nargo compile && nargo execute && sunspot prove target/zksettle_slice.json target/zksettle_slice.gz target/zksettle_slice.ccs target/zksettle_slice.pk"
    );
    process.exit(1);
  }

  const proof = fs.readFileSync(proofPath);
  const witness = fs.readFileSync(witnessPath);
  return Buffer.concat([proof, witness]);
}

function findPda(
  seeds: Buffer[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

async function accountExists(
  connection: Connection,
  pubkey: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(pubkey);
  return info !== null;
}

async function ensureIssuerRegistered(
  program: Program,
  wallet: Keypair,
  connection: Connection
): Promise<PublicKey> {
  const [issuerPda] = findPda(
    [ISSUER_SEED, wallet.publicKey.toBuffer()],
    ZKSETTLE_PROGRAM_ID
  );

  if (await accountExists(connection, issuerPda)) {
    console.log(`Issuer already registered: ${issuerPda.toBase58()}`);
    // Update roots to ensure they match fixture and refresh root_slot
    const tx = await program.methods
      .updateIssuerRoot(
        Array.from(MERKLE_ROOT),
        Array.from(SANCTIONS_ROOT),
        Array.from(JURISDICTION_ROOT)
      )
      .accounts({
        authority: wallet.publicKey,
        issuer: issuerPda,
      })
      .signers([wallet])
      .rpc({ commitment: "confirmed" });
    console.log(`  Updated issuer roots: ${tx}`);
    return issuerPda;
  }

  console.log("Registering issuer...");
  const tx = await program.methods
    .registerIssuer(
      Array.from(MERKLE_ROOT),
      Array.from(SANCTIONS_ROOT),
      Array.from(JURISDICTION_ROOT)
    )
    .accounts({
      authority: wallet.publicKey,
      issuer: issuerPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([wallet])
    .rpc({ commitment: "confirmed" });

  console.log(`  Issuer registered: ${issuerPda.toBase58()}`);
  console.log(`  tx: ${tx}`);
  return issuerPda;
}

async function ensureAttestationTree(
  program: Program,
  wallet: Keypair,
  connection: Connection,
  issuerPda: PublicKey
): Promise<{
  registryPda: PublicKey;
  merkleTree: PublicKey;
  treeConfig: PublicKey;
  treeCreator: PublicKey;
}> {
  const [registryPda] = findPda(
    [BUBBLEGUM_REGISTRY_SEED],
    ZKSETTLE_PROGRAM_ID
  );
  const [treeCreator] = findPda(
    [BUBBLEGUM_TREE_CREATOR_SEED],
    ZKSETTLE_PROGRAM_ID
  );

  if (await accountExists(connection, registryPda)) {
    const registry = await program.account.bubblegumTreeRegistry.fetch(
      registryPda
    );
    const merkleTree = registry.merkleTree as PublicKey;
    const [treeConfig] = PublicKey.findProgramAddressSync(
      [merkleTree.toBuffer()],
      MPL_BUBBLEGUM_ID
    );
    console.log(`Attestation tree already initialized:`);
    console.log(`  Registry: ${registryPda.toBase58()}`);
    console.log(`  Merkle tree: ${merkleTree.toBase58()}`);
    return { registryPda, merkleTree, treeConfig, treeCreator };
  }

  console.log("Initializing attestation tree...");
  const merkleTreeKeypair = Keypair.generate();
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [merkleTreeKeypair.publicKey.toBuffer()],
    MPL_BUBBLEGUM_ID
  );

  const tx = await program.methods
    .initAttestationTree()
    .accounts({
      authority: wallet.publicKey,
      issuer: issuerPda,
      registry: registryPda,
      merkleTree: merkleTreeKeypair.publicKey,
      treeConfig,
      treeCreator,
      bubblegumProgram: MPL_BUBBLEGUM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
      logWrapper: NOOP_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([wallet, merkleTreeKeypair])
    .rpc({ commitment: "confirmed" });

  console.log(`  Attestation tree initialized: ${tx}`);
  console.log(`  Merkle tree: ${merkleTreeKeypair.publicKey.toBase58()}`);

  return {
    registryPda,
    merkleTree: merkleTreeKeypair.publicKey,
    treeConfig,
    treeCreator,
  };
}

async function getComputeUnits(
  connection: Connection,
  signature: string
): Promise<{ cu: number; logs: string[] }> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  return {
    cu: tx?.meta?.computeUnitsConsumed ?? 0,
    logs: tx?.meta?.logMessages ?? [],
  };
}

async function main() {
  const wallet = loadWallet();
  const connection = new Connection(
    process.env.RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const idl = loadIdl();
  const proofAndWitness = loadProofAndWitness();

  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: "confirmed" }
  );
  const program = new Program(idl, provider);

  console.log("=== ZKSettle CU Benchmark ===\n");
  console.log(`Wallet:  ${wallet.publicKey.toBase58()}`);
  console.log(`Program: ${ZKSETTLE_PROGRAM_ID.toBase58()}`);
  console.log(`RPC:     ${connection.rpcEndpoint}`);
  console.log(`Proof+witness size: ${proofAndWitness.length} bytes\n`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  if (balance < 0.5 * 1e9) {
    console.error("Need at least 0.5 SOL. Run: solana airdrop 2 --url devnet");
    process.exit(1);
  }

  // Step 1: Register issuer
  const issuerPda = await ensureIssuerRegistered(program, wallet, connection);

  // Step 2: Init attestation tree
  const { registryPda, merkleTree, treeConfig, treeCreator } =
    await ensureAttestationTree(program, wallet, connection, issuerPda);

  // Step 3: Call verify_proof
  // The fixture uses dummy mint/recipient values. We construct Pubkeys from
  // the mint_lo/mint_hi fields in the Prover.toml fixture.
  //
  // mint_lo = mint_hi = 1334440654591915542993625911497130241 (decimal)
  // This encodes to a 16-byte pattern: 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01
  // The full 32-byte pubkey is [0..16 zeros | 16 bytes of 0x01]
  const mintBytes = Buffer.alloc(32);
  for (let i = 16; i < 32; i++) mintBytes[i] = 0x01;
  const mint = new PublicKey(mintBytes);

  // recipient_lo = recipient_hi = 2668881309183831085987251822994260482 (decimal)
  // = 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02 02
  const recipientBytes = Buffer.alloc(32);
  for (let i = 16; i < 32; i++) recipientBytes[i] = 0x02;
  const recipient = new PublicKey(recipientBytes);

  const epoch = 0; // from Prover.toml
  const amount = 1000; // from Prover.toml

  console.log("\nSubmitting verify_proof...");
  console.log(`  Mint:      ${mint.toBase58()}`);
  console.log(`  Recipient: ${recipient.toBase58()}`);
  console.log(`  Epoch:     ${epoch}`);
  console.log(`  Amount:    ${amount}`);

  try {
    // Build verify_proof instruction
    // Light Protocol requires validity_proof and address_tree_info
    // For devnet, we need to use the public Light state trees
    //
    // NOTE: This will likely fail at the Light CPI step because we need
    // a real Light Protocol validity proof for the address derivation.
    // But the gnark verification (the expensive part) happens BEFORE
    // the Light CPI, so we can still measure it from the CU probe logs
    // if the program is built with hook-cu-probe.

    const sig = await program.methods
      .verifyProof(
        Buffer.from(proofAndWitness),
        Array.from(NULLIFIER),
        mint,
        new BN(epoch),
        recipient,
        new BN(amount),
        {
          compressedProof: null,
        },
        {
          addressMerkleTreePubkeyIndex: 0,
          addressQueuePubkeyIndex: 0,
          rootIndex: 0,
        },
        0
      )
      .accounts({
        payer: wallet.publicKey,
        issuer: issuerPda,
        registry: registryPda,
        leafOwner: recipient,
        merkleTree,
        treeConfig,
        treeCreator,
        bubblegumProgram: MPL_BUBBLEGUM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
        logWrapper: NOOP_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet])
      .rpc({ commitment: "confirmed" });

    const { cu, logs } = await getComputeUnits(connection, sig);

    console.log(`\n=== SUCCESS ===`);
    console.log(`Signature: ${sig}`);
    console.log(`Compute units consumed: ${cu}`);
    console.log(`\nTransaction logs:`);
    for (const log of logs) {
      console.log(`  ${log}`);
    }

    // Extract CU probe values if present
    const probeLines = logs.filter((l) => l.includes("cu-probe"));
    if (probeLines.length > 0) {
      console.log(`\nCU Probes:`);
      for (const line of probeLines) {
        console.log(`  ${line}`);
      }
    }
  } catch (err: any) {
    // Even if the tx fails, we might be able to extract CU from logs
    console.error(`\nTransaction failed (expected if Light CPI not set up):`);
    console.error(`  ${err.message?.slice(0, 200)}`);

    // Try to get logs from the failed tx
    if (err.logs) {
      console.log(`\nTransaction logs from failed tx:`);
      for (const log of err.logs) {
        console.log(`  ${log}`);
      }

      const probeLines = err.logs.filter((l: string) =>
        l.includes("cu-probe") || l.includes("compute units")
      );
      if (probeLines.length > 0) {
        console.log(`\nCU Probes (from failed tx):`);
        for (const line of probeLines) {
          console.log(`  ${line}`);
        }
      }

      // Check if gnark verification passed before failure
      const verifyPassed = err.logs.some(
        (l: string) =>
          l.includes("post-verify_bundle") || l.includes("post-light-cpi")
      );
      if (verifyPassed) {
        console.log(
          "\n>>> Gnark verification PASSED (failure was in Light/Bubblegum CPI)"
        );
        console.log(
          ">>> The CU probes above show verification cost before the failure point."
        );
      }
    }

    // Try to extract signature from error for CU lookup
    if (err.signature) {
      try {
        const { cu, logs } = await getComputeUnits(connection, err.signature);
        console.log(`\nCompute units consumed (from failed tx): ${cu}`);
      } catch {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
