import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";

import { STABLECOIN_DECIMALS } from "./program";
import type {
  AdapterContext,
  RedemptionRequest,
  StablecoinAdapter,
  Treasury,
} from "./types";

function unit(amount: number): BN {
  return new BN(amount).mul(new BN(10).pow(new BN(STABLECOIN_DECIMALS)));
}

function pubkeyFromEnv(value: string | undefined): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

// Deterministic 32-byte keys derived from a fixed seed phrase. Using
// PublicKey.unique() / Keypair.generate() drifts between runs and breaks
// snapshot stability for storybook / demo screenshots.
function keyFromLabel(label: string): PublicKey {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < label.length && i < 32; i++) {
    bytes[i] = label.charCodeAt(i) % 256;
  }
  bytes[31] = 1;
  return new PublicKey(bytes);
}

const MOCK_ADMIN =
  pubkeyFromEnv(process.env.NEXT_PUBLIC_STABLECOIN_MOCK_ADMIN) ??
  keyFromLabel("zksettle-mock-admin");
const MOCK_OPERATOR =
  pubkeyFromEnv(process.env.NEXT_PUBLIC_STABLECOIN_MOCK_OPERATOR) ??
  keyFromLabel("zksettle-mock-operator");
const MOCK_MINT = keyFromLabel("zksettle-mock-mint");

// Wall-clock-free baseline; ages below are computed against this fixed point
// so test runs and demo snapshots stay deterministic across executions.
const MOCK_NOW_SECS = 1_715_000_000;

const treasuryStore: Treasury = {
  admin: MOCK_ADMIN,
  operator: MOCK_OPERATOR,
  mint: MOCK_MINT,
  totalMinted: unit(420_000),
  totalBurned: unit(15_000),
  decimals: STABLECOIN_DECIMALS,
  paused: false,
  pendingAdmin: null,
  mintCap: unit(1_000_000),
  redemptionNonce: new BN(2),
};

function makeRedemption(
  amount: number,
  ageSecs: number,
  nonce: number,
): RedemptionRequest {
  return {
    pda: keyFromLabel(`zksettle-mock-redemption-pda-${nonce}`),
    holder: keyFromLabel(`zksettle-mock-redemption-holder-${nonce}`),
    treasury: keyFromLabel("zksettle-mock-treasury"),
    mint: treasuryStore.mint,
    tokenAccount: keyFromLabel(`zksettle-mock-redemption-ata-${nonce}`),
    amount: unit(amount),
    nonce: new BN(nonce),
    requestedAt: MOCK_NOW_SECS - ageSecs,
  };
}

const redemptionsStore: RedemptionRequest[] = [
  makeRedemption(250, 3_600, 1),
  makeRedemption(100, 700_000, 2),
];

function emptyTx(payer: PublicKey): Transaction {
  const tx = new Transaction();
  tx.feePayer = payer;
  return tx;
}

export const mockAdapter: StablecoinAdapter = {
  async getTreasury(_, mint): Promise<Treasury> {
    return { ...treasuryStore, mint };
  },
  async listRedemptions(_, mint): Promise<RedemptionRequest[]> {
    return redemptionsStore
      .filter((r) => r.mint.equals(mint) || r.mint.equals(treasuryStore.mint))
      .map((r) => ({ ...r, mint }));
  },
  async buildSetOperator(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildProposeAdmin(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildAcceptAdmin(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildCancelPendingAdmin(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildUpdateMintCap(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildPause(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildUnpause(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildFreezeAccount(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildThawAccount(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildMintTokens(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildApproveRedemption(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
  async buildCancelRedemption(ctx: AdapterContext) {
    return emptyTx(ctx.payer);
  },
};

export const __mockTreasury = treasuryStore;
export const __mockRedemptions = redemptionsStore;
export const __mockMint = MOCK_MINT;
export const __mockAdmin = MOCK_ADMIN;
export const __mockOperator = MOCK_OPERATOR;
