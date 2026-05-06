# zksettle compliance circuit

Noir 1.0.0-beta.18 circuit that enforces five compliance checks in a single
Groth16 proof:

1. **Merkle membership** of a `wallet` leaf under a public `merkle_root`
   (depth 20, Poseidon2 hash).
2. **Nullifier derivation**: binds the prover's private key to the transfer
   context — `nullifier == Poseidon2(private_key, mint_lo, mint_hi, epoch,
   recipient_lo, recipient_hi, amount)`.
3. **Sanctions exclusion**: proves the wallet does not appear in the sanctions
   Sparse Merkle Tree. Path indices are derived from the wallet leaf to
   prevent opening arbitrary zero-leaves.
4. **Jurisdiction validation**: proves the jurisdiction leaf exists in an
   allowed-jurisdictions Merkle tree.
5. **Credential expiry**: asserts `timestamp <= credential_expiry`.

## Public-input layout

| slot | field               |
|------|---------------------|
| 0    | `merkle_root`       |
| 1    | `nullifier`         |
| 2    | `mint_lo`           |
| 3    | `mint_hi`           |
| 4    | `epoch`             |
| 5    | `recipient_lo`      |
| 6    | `recipient_hi`      |
| 7    | `amount`            |
| 8    | `sanctions_root`    |
| 9    | `jurisdiction_root` |
| 10   | `timestamp`         |

Order is load-bearing. It must stay in sync with the `*_IDX` constants in
`backend/crates/zksettle-types/src/lib.rs` and the on-chain `check_bindings`
call in `backend/programs/zksettle/src/instructions/verify_proof/bindings.rs`.

## Private inputs

`wallet`, `path[20]`, `path_indices[20]` (u1), `private_key`,
`sanctions_path[20]`, `sanctions_path_indices[20]` (u1),
`sanctions_leaf_value`, `jurisdiction`, `jurisdiction_path[20]`,
`jurisdiction_path_indices[20]` (u1), `credential_expiry`.

## Why a hand-rolled sponge?

noir_stdlib 1.0.0-beta.18 exposes `poseidon2_permutation` publicly but marks
the `Poseidon2::hash` sponge as `pub(crate)`. `main.nr` reimplements the
sponge on top of the permutation so both the on-circuit hash and the fixture
generator in `../scripts/fixture-noir/` use the exact same parameters.

## Toolchain

- `nargo` 1.0.0-beta.18 (Noir compiler).
- `sunspot` Go CLI at rev `ce4765ccdf050507874bbb544be992a11dc48ffc`. Build
  with `cd go && go build -o sunspot .` from
  <https://github.com/reilabs/sunspot> and place the binary on `$PATH`.

## Regenerating the committed VK

`backend/programs/zksettle/default.vk` is the verifying key the on-chain
program is built against. To regenerate:

```bash
cd circuits
rm -rf target

# 1. Produce canonical public-input values for the default Prover.toml.
( cd ../scripts/fixture-noir && nargo execute )
# Copy the hex values from the `Circuit output: [..]` line into Prover.toml.

# 2. Compile the circuit to ACIR JSON, then to gnark constraint system.
nargo compile
nargo execute
sunspot compile target/zksettle_slice.json
sunspot setup   target/zksettle_slice.ccs

# 3. Install the VK and (optionally) check a proof round-trip.
cp target/zksettle_slice.vk ../backend/programs/zksettle/default.vk
sunspot prove target/zksettle_slice.json target/zksettle_slice.gz \
              target/zksettle_slice.ccs target/zksettle_slice.pk
```

## Trusted setup

`sunspot setup` currently invokes `groth16.Setup` from gnark, which
generates a non-ceremonial SRS in-memory — safe for development but **not**
for production. A real MPC ceremony (e.g. Hermez
`powersOfTau28_hez_final_14.ptau`) is required before mainnet deployment;
wiring it through sunspot is future work.

## CI determinism

Given the same ACIR (`target/zksettle_slice.json`) and the same sunspot
revision, `target/zksettle_slice.vk` is deterministic. A good invariant for
CI: regenerate and diff against `backend/programs/zksettle/default.vk`;
unexpected drift is a review signal.

## Regenerating the integration-test artifacts

The ignored tests in `backend/programs/zksettle/tests/` assume the
`target/zksettle_slice.{json,ccs,pk}` artifacts above exist. After the
steps in "Regenerating the committed VK", the tests shell out to `nargo
execute` + `sunspot prove` themselves. Run with:

```bash
cd backend && anchor build
cd programs/zksettle && cargo test -- --ignored
```
