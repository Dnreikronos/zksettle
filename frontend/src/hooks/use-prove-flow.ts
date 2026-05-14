"use client";

import { useCallback, useReducer, useRef, type Dispatch } from "react";
import { TransactionExpiredBlockheightExceededError } from "@solana/web3.js";
import type { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { useWallet, useConnection } from "@/hooks/use-wallet-connection";
import { useProofGeneration } from "@/hooks/use-proof-generation";
import { useZkPrivateKey } from "@/hooks/use-zk-private-key";
import {
  getCredential,
  getJurisdictionProof,
  getMembershipProof,
  getSanctionsProof,
  getRoots,
} from "@/lib/api/endpoints";
import { bytesToHex } from "@/lib/wallet";
import { computeNullifier } from "@/lib/nullifier";
import { PROOF_FIXTURE } from "@/lib/proof-fixture";
import {
  flowReducer,
  INITIAL_STATE,
  assembleProofInputs,
  type FlowState,
  type FlowAction,
} from "@/lib/prove-flow";
import type { ProofInputs, ProofResult } from "@/types/proof";

export interface TransferParams {
  mint: string;
  recipient: string;
  amount: number;
}

export interface UseProveFlowReturn {
  state: FlowState;
  startFlow: (params: TransferParams) => Promise<void>;
  startDemo: () => Promise<void>;
  reset: () => void;
  canStart: boolean;
  isRunning: boolean;
  isDone: boolean;
  txUrl: string | null;
}

const CREDENTIAL_VALIDITY_SECS = 365 * 24 * 3600;

function formatProofPreview(proof: Uint8Array): string {
  return Array.from(proof.slice(0, 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Step runners (extracted to reduce cognitive complexity) ──────────

async function runDemoFlow(
  dispatch: Dispatch<FlowAction>,
  generate: (inputs: ProofInputs) => Promise<ProofResult>,
): Promise<void> {
  dispatch({ type: "STEP_RUNNING", step: 1 });
  dispatch({ type: "STEP_SUCCESS", step: 1, data: { demo: true } });

  dispatch({ type: "STEP_RUNNING", step: 2 });
  dispatch({ type: "STEP_SUCCESS", step: 2, data: { demo: true } });

  dispatch({ type: "STEP_RUNNING", step: 3 });
  const result = await generate(PROOF_FIXTURE);
  dispatch({
    type: "STEP_SUCCESS",
    step: 3,
    data: {
      proof: result.proof,
      publicInputs: result.publicInputs,
      proofPreview: formatProofPreview(result.proof),
      publicInputCount: result.publicInputs.length,
    },
    durationMs: result.durationMs,
  });

  dispatch({ type: "STEP_RUNNING", step: 4 });
  dispatch({ type: "STEP_SUCCESS", step: 4, data: { skipped: true } });

  dispatch({ type: "STEP_RUNNING", step: 5 });
  dispatch({ type: "STEP_SUCCESS", step: 5, data: { demo: true } });
}

async function runStepCredential(
  dispatch: Dispatch<FlowAction>,
  walletHex: string,
) {
  dispatch({ type: "STEP_RUNNING", step: 1 });
  const start = performance.now();
  const credential = await getCredential(walletHex);
  if (credential.revoked) throw new Error("Credential has been revoked.");
  const expiresAt = credential.issued_at + CREDENTIAL_VALIDITY_SECS;
  if (Math.floor(Date.now() / 1000) >= expiresAt) {
    throw new Error("Credential has expired. Re-issue from the Wallets & Credentials page.");
  }
  dispatch({
    type: "STEP_SUCCESS",
    step: 1,
    data: { jurisdiction: credential.jurisdiction },
    durationMs: performance.now() - start,
  });
  return credential;
}

async function runStepMerklePaths(
  dispatch: Dispatch<FlowAction>,
  walletHex: string,
  derivePrivateKey: () => Promise<string>,
) {
  dispatch({ type: "STEP_RUNNING", step: 2 });
  const start = performance.now();
  const [membership, sanctions, roots, jurisdictionProof, zkPrivateKey] =
    await Promise.all([
      getMembershipProof(walletHex),
      getSanctionsProof(walletHex),
      getRoots(),
      getJurisdictionProof(walletHex),
      derivePrivateKey(),
    ]);
  dispatch({
    type: "STEP_SUCCESS",
    step: 2,
    data: { root: roots.membership_root.slice(0, 16) },
    durationMs: performance.now() - start,
  });
  return { membership, sanctions, roots, jurisdictionProof, zkPrivateKey };
}

async function runStepProofGeneration(
  dispatch: Dispatch<FlowAction>,
  publicKey: PublicKey,
  credential: { issued_at: number; wallet: number[]; leaf_index: number; jurisdiction: string; revoked: boolean },
  paths: Awaited<ReturnType<typeof runStepMerklePaths>>,
  generate: (inputs: ProofInputs) => Promise<ProofResult>,
  transferParams: TransferParams,
) {
  dispatch({ type: "STEP_RUNNING", step: 3 });
  const { membership, sanctions, roots, jurisdictionProof, zkPrivateKey } = paths;
  const { PublicKey: SolPublicKey } = await import("@solana/web3.js");
  const mintPubkey = new SolPublicKey(transferParams.mint);
  const recipientPubkey = new SolPublicKey(transferParams.recipient);
  const mintBytes = mintPubkey.toBytes();
  const recipientBytes = recipientPubkey.toBytes();
  // Limb split must match on-chain `pubkey_to_limbs`
  // (programs/zksettle/src/instructions/verify_proof/helpers.rs:32): the LOW
  // limb carries the *trailing* 16 bytes of the pubkey, the HIGH limb the
  // *leading* 16. Swapping these silently passes the circuit (which just
  // hashes whatever it gets) but trips `check_bindings`' `MintMismatch` /
  // `RecipientMismatch` on `settle_hook`, since the on-chain re-derive uses
  // the canonical order against the witness positions.
  const mintLo = toHex(mintBytes.slice(16, 32));
  const mintHi = toHex(mintBytes.slice(0, 16));
  const recipientLo = toHex(recipientBytes.slice(16, 32));
  const recipientHi = toHex(recipientBytes.slice(0, 16));
  const epoch = String(Math.floor(Date.now() / 1000 / 86400));
  const amount = String(transferParams.amount);
  const timestamp = String(Number(epoch) * 86_400);
  const credentialExpiry = String(credential.issued_at + CREDENTIAL_VALIDITY_SECS);

  const nullifier = await computeNullifier({
    privateKey: zkPrivateKey,
    mintLo,
    mintHi,
    epoch,
    recipientLo,
    recipientHi,
    amount,
  });

  const inputs = assembleProofInputs(credential, membership, sanctions, roots, {
    nullifier,
    mintLo,
    mintHi,
    recipientLo,
    recipientHi,
    amount,
    epoch,
    privateKey: zkPrivateKey,
    credentialExpiry,
    jurisdictionPath: jurisdictionProof.path,
    jurisdictionPathIndices: jurisdictionProof.path_indices,
    timestamp,
  });

  const proofResult = await generate(inputs);
  dispatch({
    type: "STEP_SUCCESS",
    step: 3,
    data: {
      proof: proofResult.proof,
      publicInputs: proofResult.publicInputs,
      proofPreview: formatProofPreview(proofResult.proof),
      proofBytes: proofResult.proof.length,
      publicInputCount: proofResult.publicInputs.length,
    },
    durationMs: proofResult.durationMs,
  });
  return { proofResult, zkPrivateKey, credentialExpiry, jurisdictionProof };
}

// ── Submit helpers (module-level to keep runStepSubmit's cognitive complexity low) ──

type Blockhash = { blockhash: string; lastValidBlockHeight: number };
type ConfirmCommitment = "processed" | "confirmed" | "finalized";
type SendOpts = { skipPreflight?: boolean; maxRetries?: number };

const CONFIRM_FALLBACK_TIMEOUT_MS = 30_000;
const CONFIRM_FALLBACK_INITIAL_DELAY_MS = 1_000;
const CONFIRM_FALLBACK_MAX_DELAY_MS = 4_000;
const REBROADCAST_INTERVAL_MS = 2_000;
// Edge-window grace after bh expiry: a tx can land at the very last valid
// block while `getBlockHeight` already reports past `lastValidBlockHeight`.
const FINAL_POLL_TIMEOUT_MS = 30_000;

const HEX_BYTE_REGEX = /.{1,2}/g;
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(clean.match(HEX_BYTE_REGEX)?.map((b) => Number.parseInt(b, 16)) ?? []);
}

function commitmentReached(
  status: string | null | undefined,
  commitment: ConfirmCommitment,
): boolean {
  if (!status) return false;
  if (commitment === "processed") {
    return status === "processed" || status === "confirmed" || status === "finalized";
  }
  return status === "confirmed" || status === "finalized";
}

// BlockheightBasedTransactionConfirmationStrategy returns the moment current
// height passes lastValidBlockHeight, even if the tx lands at the edge of the
// validity window. Poll getSignatureStatus directly so a late inclusion isn't
// surfaced as a false-negative expiry.
async function tryConfirmViaPolling(
  connection: Connection,
  sig: string,
  commitment: ConfirmCommitment,
): Promise<boolean> {
  const deadline = Date.now() + CONFIRM_FALLBACK_TIMEOUT_MS;
  let delay = CONFIRM_FALLBACK_INITIAL_DELAY_MS;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatus(sig, {
      searchTransactionHistory: true,
    });
    if (commitmentReached(value?.confirmationStatus, commitment)) {
      if (value?.err) {
        throw new Error("tx landed but failed on chain", { cause: value.err });
      }
      return true;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, CONFIRM_FALLBACK_MAX_DELAY_MS);
  }
  return false;
}

// `confirmTransaction({signature, blockhash, lastValidBlockHeight})` ties the
// wait-loop expiry to the SAME blockhash the tx was signed with. Fetching a
// fresh blockhash here decouples the timeout from actual tx expiry and can
// yield false timeouts / false success (Solana docs). Always pass the bh that
// was set on `tx.recentBlockhash` before signing.
async function confirmTx(
  connection: Connection,
  sig: string,
  bh: Blockhash,
  commitment: ConfirmCommitment = "confirmed",
): Promise<void> {
  try {
    await connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      commitment,
    );
  } catch (err) {
    // Narrow: only fall back on the strategy's edge-window expiry. Other errors
    // (RPC/network/SendTransactionError) re-throw immediately so we don't burn
    // 30s polling on a failure that won't resolve.
    if (!(err instanceof TransactionExpiredBlockheightExceededError)) throw err;
    if (!(await tryConfirmViaPolling(connection, sig, commitment))) throw err;
  }
}

async function sendSigned(
  connection: Connection,
  signed: Transaction,
  bh: Blockhash,
  commitment: ConfirmCommitment = "confirmed",
  opts: SendOpts = {},
): Promise<string> {
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: opts.skipPreflight ?? true,
    maxRetries: opts.maxRetries ?? 3,
  });
  await confirmTx(connection, sig, bh, commitment);
  return sig;
}

async function pollFinalizeLanded(
  connection: Connection,
  sig: string,
): Promise<boolean> {
  let value: Awaited<ReturnType<typeof connection.getSignatureStatuses>>["value"];
  try {
    ({ value } = await connection.getSignatureStatuses([sig], {
      searchTransactionHistory: true,
    }));
  } catch {
    return false;
  }
  const status = value[0];
  if (!status) return false;
  if (status.err) {
    throw new Error("finalize landed but failed on chain", { cause: status.err });
  }
  return (
    status.confirmationStatus === "confirmed" ||
    status.confirmationStatus === "finalized"
  );
}

async function tryGetBlockHeight(connection: Connection): Promise<number | null> {
  try {
    return await connection.getBlockHeight("confirmed");
  } catch {
    return null;
  }
}

// RPC calls inside the loop (`getSignatureStatuses`, `getBlockHeight`,
// `sendRawTransaction`) are all wrapped so a transient devnet blip can't abort
// the rebroadcast loop before the bh window naturally ends. Only the "landed
// but failed on-chain" path propagates — that's a real failure.
async function rebroadcastUntilLandedOrExpired(
  connection: Connection,
  raw: Uint8Array,
  sig: string,
  bh: Blockhash,
): Promise<void> {
  let pastExpiry = false;
  let expiryDeadline = 0;
  while (true) {
    if (await pollFinalizeLanded(connection, sig)) return;
    if (!pastExpiry) {
      const height = await tryGetBlockHeight(connection);
      if (height !== null && height > bh.lastValidBlockHeight) {
        pastExpiry = true;
        expiryDeadline = Date.now() + FINAL_POLL_TIMEOUT_MS;
      } else {
        // Re-broadcast: same signed bytes → idempotent. Swallow errors so a
        // transient RPC blip doesn't kill the loop before bh expiry.
        await connection
          .sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })
          .catch(() => {});
      }
    } else if (Date.now() > expiryDeadline) {
      break;
    }
    await new Promise((r) => setTimeout(r, REBROADCAST_INTERVAL_MS));
  }
  throw new TransactionExpiredBlockheightExceededError(sig);
}

async function runStepSubmit(
  dispatch: Dispatch<FlowAction>,
  proofResult: ProofResult,
  publicKey: PublicKey,
  connection: Connection,
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>,
  submitCtx: {
    zkPrivateKey: string;
    credentialExpiry: string;
    jurisdictionProof: { path: string[]; path_indices: number[] };
    roots: import("@/lib/api/schemas").Roots;
  },
  transferParams: TransferParams,
): Promise<string | undefined> {
  dispatch({ type: "STEP_RUNNING", step: 4 });
  const start = performance.now();

  const [sdk, { BN }, { PublicKey: SolPublicKey, Transaction: SolTransaction, ComputeBudgetProgram }] = await Promise.all([
    import("@zksettle/sdk"),
    import("@coral-xyz/anchor"),
    import("@solana/web3.js"),
  ]);
  const {
    checkIssuerExists, buildRegisterIssuerIx,
    checkHookPayloadExists, buildCloseHookPayloadIx,
    buildInitHookPayloadIx, buildResizeHookPayloadIx,
    buildWriteChunkIx, buildFinalizeHookPayloadIx,
    CHUNK_SIZE,
  } = sdk;

  // Intermediate batches (init/resize/writes) use "processed" to skip the
  // ~5-15s confirmed-commitment wait. The next batch fetches a fresh
  // "confirmed" blockhash before signing, so account-state visibility is
  // still covered for the leader. Finalize stays at "confirmed" — it's the
  // final tx and the indexer keys off ProofSettled landing in a confirmed block.
  const signSendConfirmSingleIx = async (
    ix: TransactionInstruction,
    commitment: ConfirmCommitment,
  ): Promise<void> => {
    const tx = new SolTransaction().add(ix);
    tx.feePayer = publicKey;
    const bh = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    const [signed] = await signAllTransactions([tx]);
    await sendSigned(connection, signed!, bh, commitment);
  };

  const ensureIssuerRegistered = async (): Promise<void> => {
    if (await checkIssuerExists(publicKey, connection)) return;
    const { roots } = submitCtx;
    const ix = await buildRegisterIssuerIx(publicKey, {
      merkleRoot: hexToBytes(roots.membership_root),
      sanctionsRoot: hexToBytes(roots.sanctions_root),
      jurisdictionRoot: hexToBytes(roots.jurisdiction_root),
    }, connection);
    await signSendConfirmSingleIx(ix, "processed");
  };

  const cleanupStaleHookPayload = async (): Promise<void> => {
    if (!(await checkHookPayloadExists(publicKey, connection))) return;
    const ix = await buildCloseHookPayloadIx(publicKey, connection);
    await signSendConfirmSingleIx(ix, "processed");
  };

  const proofBytes = proofResult.proof;
  const nullifierBytes = hexToBytes(proofResult.publicInputs[1] ?? "");
  const mintPubkey = new SolPublicKey(transferParams.mint);
  const recipientPubkey = new SolPublicKey(transferParams.recipient);

  // Solana caps realloc at 10 KiB per instruction. Upper-bound the count from
  // proof size alone so we never under-allocate (extra resizes are idempotent
  // no-ops on-chain). Avoids hardcoding HookPayload::BASE_SPACE on the client.
  const buildResizeIxs = async (): Promise<TransactionInstruction[]> => {
    const count = Math.ceil(proofBytes.length / 10_240);
    const ixs: TransactionInstruction[] = [];
    for (let i = 0; i < count; i++) {
      ixs.push(await buildResizeHookPayloadIx(publicKey, connection));
    }
    return ixs;
  };

  const buildWriteIxs = async (): Promise<TransactionInstruction[]> => {
    const ixs: TransactionInstruction[] = [];
    for (let offset = 0; offset < proofBytes.length; offset += CHUNK_SIZE) {
      const chunk = proofBytes.slice(offset, Math.min(offset + CHUNK_SIZE, proofBytes.length));
      ixs.push(await buildWriteChunkIx(publicKey, offset, chunk, connection));
    }
    return ixs;
  };

  // ── Batch 1: init + resize (own blockhash + Phantom popup) ──
  // Pre-count resize ixs so they batch into one Phantom popup with init.
  const sendInitResizeBatch = async (
    initIx: TransactionInstruction,
    resizeIxs: TransactionInstruction[],
  ): Promise<void> => {
    const [firstResize, ...restResize] = resizeIxs;
    const initTx = new SolTransaction().add(initIx);
    if (firstResize) initTx.add(firstResize);
    const txs: Transaction[] = [initTx];
    for (const ix of restResize) {
      txs.push(new SolTransaction().add(ix));
    }
    const bh = await connection.getLatestBlockhash("confirmed");
    for (const tx of txs) {
      tx.feePayer = publicKey;
      tx.recentBlockhash = bh.blockhash;
    }
    const signed = await signAllTransactions(txs);
    for (const tx of signed) {
      await sendSigned(connection, tx, bh, "processed");
    }
  };

  // ── Batch 2: writes only (fresh blockhash + Phantom popup) ──
  // Send writes sequentially — the on-chain handler enforces that each chunk
  // offset matches high_water_mark, so ordering must be preserved. Confirming
  // the last write guarantees all prior writes landed.
  const sendWritesBatch = async (
    writeIxs: TransactionInstruction[],
  ): Promise<void> => {
    const WRITES_PER_TX = 2;
    const txs: Transaction[] = [];
    for (let i = 0; i < writeIxs.length; i += WRITES_PER_TX) {
      const tx = new SolTransaction();
      for (const ix of writeIxs.slice(i, i + WRITES_PER_TX)) tx.add(ix);
      txs.push(tx);
    }
    const bh = await connection.getLatestBlockhash("confirmed");
    for (const tx of txs) {
      tx.feePayer = publicKey;
      tx.recentBlockhash = bh.blockhash;
    }
    const signed = await signAllTransactions(txs);
    let lastSig = "";
    for (const tx of signed) {
      lastSig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
      });
    }
    if (lastSig) await confirmTx(connection, lastSig, bh, "processed");
  };

  // Dynamic prio fee: p75 of recent fees on the same writable accts, floored
  // at 200k µLam/CU (insurance) / ceilinged at 1M (cost cap). Static fees go
  // stale during congestion spikes; dynamic outbids the live mempool.
  // 200k floor × 400K CU ≈ 80k lamports ≈ 0.00008 SOL.
  const getDynamicPriorityFee = async (
    writableKeys: PublicKey[],
  ): Promise<number> => {
    try {
      const recentFees = await connection.getRecentPrioritizationFees({
        lockedWritableAccounts: writableKeys,
      });
      if (recentFees.length === 0) return 200_000;
      const sorted = recentFees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
      return Math.min(1_000_000, Math.max(200_000, p75));
    } catch {
      // RPC error → keep 200k floor. Cheap insurance vs another expired tx.
      return 200_000;
    }
  };

  // ── Batch 3: finalize (own fresh blockhash + Phantom popup) ──
  // Finalize is the final on-chain tx in this flow (settle_hook integration
  // pending Light CPI wiring). Three layers of defense vs devnet congestion:
  //   1. Dynamic prio fee — see getDynamicPriorityFee.
  //   2. Explicit CU limit: leaders prefer txs with set limits over the
  //      default 200K (a sentinel for "I don't know my cost").
  //   3. Manual rebroadcast loop: `sendRawTransaction`'s internal maxRetries
  //      is best-effort and often gives up before the bh window (60-90s)
  //      closes. We drive re-sends ourselves — same signed bytes → same
  //      signature → no double-execution risk.
  const sendFinalizeWithRebroadcast = async (
    finalizeIx: TransactionInstruction,
  ): Promise<string> => {
    const writableKeys = finalizeIx.keys
      .filter((k) => k.isWritable)
      .map((k) => k.pubkey);
    const prioFee = await getDynamicPriorityFee(writableKeys);

    const finalizeTx = new SolTransaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
      .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: prioFee }))
      .add(finalizeIx);
    const bh = await connection.getLatestBlockhash("confirmed");
    finalizeTx.feePayer = publicKey;
    finalizeTx.recentBlockhash = bh.blockhash;
    const [signedFinalize] = await signAllTransactions([finalizeTx]);

    const rawFinalize = signedFinalize!.serialize();
    const finalSig = await connection.sendRawTransaction(rawFinalize, {
      skipPreflight: true,
      maxRetries: 0,
    });
    await rebroadcastUntilLandedOrExpired(connection, rawFinalize, finalSig, bh);
    return finalSig;
  };

  // ── Pre-requisites (issuer registration, stale cleanup) ──
  // These need separate signing since they must complete before the proof upload.
  await ensureIssuerRegistered();
  await cleanupStaleHookPayload();

  // ── Build ALL proof upload transactions upfront ──
  const initIx = await buildInitHookPayloadIx(publicKey, proofBytes.length, connection);
  const resizeIxs = await buildResizeIxs();
  const writeIxs = await buildWriteIxs();
  const epoch = Math.floor(Date.now() / 1000 / 86400);
  const finalizeIx = await buildFinalizeHookPayloadIx(publicKey, {
    nullifierHash: nullifierBytes,
    mint: mintPubkey,
    epoch,
    recipient: recipientPubkey,
    amount: new BN(transferParams.amount),
  }, connection);

  await sendInitResizeBatch(initIx, resizeIxs);
  await sendWritesBatch(writeIxs);
  const finalSig = await sendFinalizeWithRebroadcast(finalizeIx);

  dispatch({ type: "SET_TX", signature: finalSig });
  dispatch({
    type: "STEP_SUCCESS",
    step: 4,
    data: { signature: finalSig },
    durationMs: performance.now() - start,
  });
  return finalSig;
}

async function runStepConfirm(dispatch: Dispatch<FlowAction>): Promise<void> {
  // Step 4 (`runStepSubmit`) already awaited `confirmTransaction` for the
  // finalize tx using its original signing blockhash. Re-confirming here with
  // a freshly-fetched blockhash would (a) decouple the wait-loop expiry from
  // the actual tx (Solana docs explicitly warn against this) and (b) be
  // redundant. Keep this step purely for the UI step-machine.
  dispatch({ type: "STEP_RUNNING", step: 5 });
  const start = performance.now();
  dispatch({
    type: "STEP_SUCCESS",
    step: 5,
    durationMs: performance.now() - start,
  });
}

function stepError(dispatch: Dispatch<FlowAction>, step: number, err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : fallback;
  dispatch({ type: "STEP_ERROR", step, error: msg });
  return msg;
}

interface LiveFlowContext {
  dispatch: Dispatch<FlowAction>;
  walletHex: string;
  publicKey: PublicKey;
  connection: Connection;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
  generate: (inputs: ProofInputs) => Promise<ProofResult>;
  derivePrivateKey: () => Promise<string>;
  transferParams: TransferParams;
}

function handleCredentialError(dispatch: Dispatch<FlowAction>, err: unknown): void {
  const msg = stepError(dispatch, 1, err, "Failed to fetch credential");
  if (msg.includes("404")) {
    dispatch({ type: "STEP_ERROR", step: 1, error: "No credential found for this wallet. Issue one from the Wallets & Credentials page, or try demo mode." });
  }
}

function handleSubmitError(dispatch: Dispatch<FlowAction>, err: unknown): void {
  console.error("[zksettle] Submit step error:", err);
  try { console.error("[zksettle] Error JSON:", JSON.stringify(err, Object.getOwnPropertyNames(err))); } catch { /* */ }
  const errRecord = err as Record<string, unknown>;
  const inner = errRecord?.error;
  if (inner) console.error("[zksettle] Inner error:", inner);
  const logs = (errRecord?.logs ?? (inner as Record<string, unknown>)?.logs) as string[] | undefined;
  if (logs) console.error("[zksettle] Transaction logs:", logs);
  const recordMessage = errRecord?.message;
  const message = err instanceof Error
    ? err.message
    : typeof recordMessage === "string"
      ? recordMessage
      : "Transaction failed";
  const isRejected = message.includes("rejected") || message.includes("User rejected");
  dispatch({ type: "STEP_ERROR", step: 4, error: isRejected ? "Transaction rejected by wallet." : message });
}

async function runLiveFlow(ctx: LiveFlowContext): Promise<void> {
  const { dispatch, walletHex, publicKey, connection, signAllTransactions, generate, derivePrivateKey, transferParams } = ctx;
  let credential;
  try { credential = await runStepCredential(dispatch, walletHex); }
  catch (err) { handleCredentialError(dispatch, err); return; }

  let paths;
  try { paths = await runStepMerklePaths(dispatch, walletHex, derivePrivateKey); }
  catch (err) { stepError(dispatch, 2, err, "Failed to fetch Merkle paths"); return; }

  let step3Result;
  try { step3Result = await runStepProofGeneration(dispatch, publicKey, credential, paths, generate, transferParams); }
  catch (err) { stepError(dispatch, 3, err, "Proof generation failed"); return; }

  let txSignature: string | undefined;
  try {
    txSignature = await runStepSubmit(dispatch, step3Result.proofResult, publicKey, connection, signAllTransactions, { ...step3Result, roots: paths.roots }, transferParams);
  } catch (err) {
    handleSubmitError(dispatch, err);
    return;
  }

  try { await runStepConfirm(dispatch); }
  catch (err) {
    if (txSignature) { stepError(dispatch, 5, err, "Confirmation failed"); }
    else { dispatch({ type: "STEP_SUCCESS", step: 5 }); }
  }
}

// ── Hook ────────────────────────────────────────────────────────────

export function useProveFlow(): UseProveFlowReturn {
  const [state, dispatch] = useReducer(flowReducer, INITIAL_STATE);
  const { connected, publicKey, signAllTransactions } = useWallet();
  const { connection } = useConnection();

  const walletHex = publicKey
    ? bytesToHex(Array.from(publicKey.toBytes()))
    : null;

  const { generate } = useProofGeneration();
  const { derivePrivateKey } = useZkPrivateKey();

  const runningRef = useRef(false);
  const isRunning = state.steps.some((s) => s.status === "running");
  const isDone = state.steps.at(-1)?.status === "success";
  const txUrl = state.txSignature
    ? `https://solscan.io/tx/${state.txSignature}?cluster=devnet`
    : null;

  const runFlow = useCallback(
    async (mode: "live" | "demo", params?: TransferParams) => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
      dispatch({ type: "START_FLOW", mode });

      dispatch({ type: "STEP_RUNNING", step: 0 });
      if (!connected || !publicKey) {
        dispatch({ type: "STEP_ERROR", step: 0, error: "Wallet not connected. Please connect your wallet first." });
        return;
      }
      dispatch({ type: "STEP_SUCCESS", step: 0 });

      if (mode === "demo") {
        try { await runDemoFlow(dispatch, generate); }
        catch (err) { stepError(dispatch, 3, err, "Proof generation failed"); }
        return;
      }

      if (!walletHex || !params) {
        dispatch({ type: "STEP_ERROR", step: 1, error: "Wallet not resolved." });
        return;
      }

      if (!signAllTransactions) {
        dispatch({ type: "STEP_ERROR", step: 1, error: "Wallet does not support batch transaction signing." });
        return;
      }

      await runLiveFlow({ dispatch, walletHex, publicKey, connection, signAllTransactions, generate, derivePrivateKey, transferParams: params });
      } finally { runningRef.current = false; }
    },
    [connected, publicKey, walletHex, connection, signAllTransactions, generate, derivePrivateKey],
  );

  const startFlow = useCallback((params: TransferParams) => runFlow("live", params), [runFlow]);
  const startDemo = useCallback(() => runFlow("demo"), [runFlow]);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return { state, startFlow, startDemo, reset, canStart: connected && !isRunning, isRunning, isDone, txUrl };
}
