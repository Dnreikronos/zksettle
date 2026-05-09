import type { BN } from "@coral-xyz/anchor";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";

export type StablecoinRole = "admin" | "operator" | "both" | "none";

export interface Treasury {
  admin: PublicKey;
  operator: PublicKey;
  mint: PublicKey;
  totalMinted: BN;
  totalBurned: BN;
  decimals: number;
  paused: boolean;
  pendingAdmin: PublicKey | null;
  mintCap: BN;
  redemptionNonce: BN;
}

export interface RedemptionRequest {
  pda: PublicKey;
  holder: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  tokenAccount: PublicKey;
  amount: BN;
  nonce: BN;
  requestedAt: number;
}

export interface AdapterContext {
  payer: PublicKey;
}

export type ActionKind =
  | "set_operator"
  | "propose_admin"
  | "accept_admin"
  | "cancel_pending_admin"
  | "update_mint_cap"
  | "pause"
  | "unpause"
  | "freeze_account"
  | "thaw_account"
  | "mint_tokens"
  | "approve_redemption"
  | "cancel_redemption";

export interface StablecoinAdapter {
  getTreasury(connection: Connection, mint: PublicKey): Promise<Treasury | null>;
  listRedemptions(
    connection: Connection,
    mint: PublicKey,
  ): Promise<RedemptionRequest[]>;
  buildSetOperator(
    ctx: AdapterContext,
    mint: PublicKey,
    newOperator: PublicKey,
  ): Promise<Transaction>;
  buildProposeAdmin(
    ctx: AdapterContext,
    mint: PublicKey,
    newAdmin: PublicKey,
  ): Promise<Transaction>;
  buildAcceptAdmin(ctx: AdapterContext, mint: PublicKey): Promise<Transaction>;
  buildCancelPendingAdmin(
    ctx: AdapterContext,
    mint: PublicKey,
  ): Promise<Transaction>;
  buildUpdateMintCap(
    ctx: AdapterContext,
    mint: PublicKey,
    newCap: BN,
  ): Promise<Transaction>;
  buildPause(ctx: AdapterContext, mint: PublicKey): Promise<Transaction>;
  buildUnpause(ctx: AdapterContext, mint: PublicKey): Promise<Transaction>;
  buildFreezeAccount(
    ctx: AdapterContext,
    mint: PublicKey,
    tokenAccount: PublicKey,
  ): Promise<Transaction>;
  buildThawAccount(
    ctx: AdapterContext,
    mint: PublicKey,
    tokenAccount: PublicKey,
  ): Promise<Transaction>;
  buildMintTokens(
    ctx: AdapterContext,
    mint: PublicKey,
    destination: PublicKey,
    amount: BN,
  ): Promise<Transaction>;
  buildApproveRedemption(
    ctx: AdapterContext,
    mint: PublicKey,
    redemption: RedemptionRequest,
  ): Promise<Transaction>;
  buildCancelRedemption(
    ctx: AdapterContext,
    mint: PublicKey,
    redemption: RedemptionRequest,
  ): Promise<Transaction>;
}
