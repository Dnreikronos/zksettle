# Gotchas

## scripts/devnet-hook/transfer.ts: missing `resize_hook_payload` call

Program flow requires: `init_hook_payload` → `resize_hook_payload` → `write_hook_proof` → `finalize_hook_payload` → `settle_hook`.

`init_hook_payload` only allocates `BASE_SPACE` (header). `resize_hook_payload` is what grows the PDA AND allocates `proof_and_witness: vec![0u8; expected]`. Skipping resize leaves the Vec at length 0, so `write_hook_proof_handler` panics at `handlers.rs:91` on `copy_from_slice` into len-0 slice with message `range end index N out of range for slice of length 0`.

For proofs > ~10 KB the client must call `resizeHookPayload()` multiple times until `data_len >= target`.

<!-- markdownlint-disable-next-line MD038 -->
## Helius webhook auth: `Bearer ` prefix required (with trailing space)

<!-- markdownlint-disable-next-line MD038 -->
Indexer `verify_auth` (`backend/crates/indexer/src/routes/webhook.rs:107`) strips the literal 7-character prefix `Bearer ` from the `Authorization` header. The trailing space matters — Helius sends the dashboard's "Authentication Header" value verbatim, so it must be exactly:

```text
Bearer <INDEXER_HELIUS_AUTH_TOKEN value>
```

Without the prefix (or with the space missing) → 401. After fix → 200.

## Frontend prove flow was missing `settle_hook` call entirely

`use-prove-flow.ts` stopped at `finalizeHookPayload`. No `settleHook`, no Token-2022 `transferChecked` triggering the hook. Result: real proofs were staged in the `hook_payload` PDA but the verifier never ran, so `ProofSettled` was never emitted and the indexer's `events` table stayed empty — even with a fully wired Helius → indexer pipeline returning 200.

Settlement path (direct call) needs ~13 accounts including `registry.merkle_tree` (fetch from chain) and PDAs `tree_config` / `tree_creator`. `buildSettleHookIx` in `sdk/src/wrap/index.ts` resolves them.

## SDK `uploadProofChunked` skipped resize step

Same bug as the original `transfer.ts`: helper exported from the SDK but built `init → write → finalize` only. Fortunately nothing outside the SDK called it, so no production impact — but the helper itself would have panicked on first use. Fixed to include `resize_hook_payload` loop matching the on-chain realloc cap (10 KiB / ix).

## `confirmTransaction` MUST use the same blockhash the tx was signed with

In `@solana/web3.js`, `connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, commitment)` ties the wait-loop's expiry to the supplied `lastValidBlockHeight`. Confirming a tx using a **fresh** `getLatestBlockhash()` instead of the one that was set on `tx.recentBlockhash` decouples the timeout from the actual tx expiry — Solana docs explicitly warn this yields incorrect results (false timeouts or false success). The string-only deprecated overload `confirmTransaction(sig, commitment)` is safer than passing a mismatched strategy because it just polls signature status. Pattern in this repo: capture `bh = await getLatestBlockhash("confirmed")`, set `tx.recentBlockhash = bh.blockhash`, sign+send, then confirm using the *same* `bh`.

## Anchor 0.31 `new Program(idl, provider)` uses `idl.address`, not a separate `programId` arg

`@coral-xyz/anchor` 0.31 dropped the `programId` parameter from the `Program` constructor. The program address comes from `idl.address`. If a wrapper helper accepts a `programId` override and derives PDAs from it but constructs the `Program` from the raw IDL, the helper will derive PDAs for one program while encoding the instruction with the IDL's embedded address — silent mismatch. Always clone the IDL and override `idl.address = programId.toBase58()` before `new Program(...)` when honoring a programId override.

## `signAndSend` callbacks: confirmation contract must be explicit

In `ChunkedUploadOptions.signAndSend(tx) => Promise<string>` (SDK `uploadProofChunked`) the contract did not require the callback to confirm — only sign+send. Reading `getAccountInfo` immediately after a send races the network: the account may be `null` or stale, tripping the new "missing after init/resize" guards. Fix: either document confirmation as part of the callback contract, or have the SDK explicitly `await connection.confirmTransaction(sig, ...)` before reading. Picking the latter is more defensive because most wallet adapters' `signAndSendTransaction` returns after broadcast, not after confirmation.

## `write_hook_proof` ordering: confirm between writes too

The same `signAndSend`-resolves-on-broadcast hazard bites the write loop in `uploadProofChunked`. `write_hook_proof_handler` enforces `offset == high_water_mark`; if the wallet adapter returns after broadcast, the next chunk's submit can race ahead of the previous one and the program rejects it. Unlike the frontend (which sets `maxRetries: 5` on `sendRawTransaction`), the SDK has no retry path, so out-of-order arrival is unrecoverable. Confirm each chunk before the next — same pattern as init/resize. The finalize step also reads cumulative high_water_mark, so the last write must be confirmed before finalize (subsumed by per-write confirm).

## `runStepConfirm` is purely UI now — do not re-confirm

`use-prove-flow.ts` step 4 (`runStepSubmit`) already awaits `confirmTransaction` for the settle tx using its **original signing blockhash**. Re-confirming in step 5 with a fresh `getLatestBlockhash()` would re-introduce the very bug step 4 fixed (decoupled wait-loop expiry). Step 5 exists only to drive the UI step machine — keep it side-effect free.
