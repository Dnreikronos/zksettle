import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  buildAcceptAdminIx,
  buildApproveRedemptionIx,
  buildCancelPendingAdminIx,
  buildCancelRedemptionIx,
  buildFreezeAccountIx,
  buildMintTokensIx,
  buildPauseIx,
  buildProposeAdminIx,
  buildSetOperatorIx,
  buildThawAccountIx,
  buildUnpauseIx,
  buildUpdateMintCapIx,
  decodeRedemptionRequest,
  decodeTreasury,
  findTreasuryPda,
  REDEMPTION_REQUEST_DATA_LEN,
  type RedemptionRequest as SdkRedemptionRequest,
  type Treasury as SdkTreasury,
} from "@zksettle/sdk";

import { STABLECOIN_PROGRAM_ID } from "./program";
import type {
  AdapterContext,
  RedemptionRequest,
  StablecoinAdapter,
  Treasury,
} from "./types";

const REDEMPTION_TREASURY_OFFSET = 8 + 32;

function toLocalTreasury(sdk: SdkTreasury): Treasury {
  return {
    admin: sdk.admin,
    operator: sdk.operator,
    mint: sdk.mint,
    totalMinted: new BN(sdk.totalMinted.toString()),
    totalBurned: new BN(sdk.totalBurned.toString()),
    decimals: sdk.decimals,
    paused: sdk.paused,
    pendingAdmin: sdk.pendingAdmin,
    mintCap: new BN(sdk.mintCap.toString()),
    redemptionNonce: new BN(sdk.redemptionNonce.toString()),
  };
}

function toLocalRedemption(
  pda: PublicKey,
  sdk: SdkRedemptionRequest,
): RedemptionRequest {
  return {
    pda,
    holder: sdk.holder,
    treasury: sdk.treasury,
    mint: sdk.mint,
    tokenAccount: sdk.tokenAccount,
    amount: new BN(sdk.amount.toString()),
    nonce: new BN(sdk.nonce.toString()),
    requestedAt: Number(sdk.requestedAt),
  };
}

function toBigInt(value: BN): bigint {
  return BigInt(value.toString());
}

function wrap(payer: PublicKey, ix: TransactionInstruction): Transaction {
  const tx = new Transaction();
  tx.feePayer = payer;
  tx.add(ix);
  return tx;
}

async function getTreasury(
  connection: Connection,
  mint: PublicKey,
): Promise<Treasury | null> {
  const [treasuryPda] = findTreasuryPda(mint);
  const info = await connection.getAccountInfo(treasuryPda);
  if (!info) return null;
  return toLocalTreasury(decodeTreasury(info.data));
}

async function listRedemptions(
  connection: Connection,
  mint: PublicKey,
): Promise<RedemptionRequest[]> {
  const [treasuryPda] = findTreasuryPda(mint);
  const accounts = await connection.getProgramAccounts(
    STABLECOIN_PROGRAM_ID,
    {
      filters: [
        { dataSize: REDEMPTION_REQUEST_DATA_LEN },
        {
          memcmp: {
            offset: REDEMPTION_TREASURY_OFFSET,
            bytes: treasuryPda.toBase58(),
          },
        },
      ],
    },
  );

  const decoded: RedemptionRequest[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      decoded.push(toLocalRedemption(pubkey, decodeRedemptionRequest(account.data)));
    } catch {
      // skip accounts that don't match the redemption discriminator
    }
  }
  return decoded;
}

export const sdkAdapter: StablecoinAdapter = {
  getTreasury,
  listRedemptions,
  async buildSetOperator(ctx: AdapterContext, mint, newOperator) {
    return wrap(ctx.payer, buildSetOperatorIx(ctx.payer, mint, newOperator));
  },
  async buildProposeAdmin(ctx: AdapterContext, mint, newAdmin) {
    return wrap(ctx.payer, buildProposeAdminIx(ctx.payer, mint, newAdmin));
  },
  async buildAcceptAdmin(ctx: AdapterContext, mint) {
    return wrap(ctx.payer, buildAcceptAdminIx(ctx.payer, mint));
  },
  async buildCancelPendingAdmin(ctx: AdapterContext, mint) {
    return wrap(ctx.payer, buildCancelPendingAdminIx(ctx.payer, mint));
  },
  async buildUpdateMintCap(ctx: AdapterContext, mint, newCap) {
    return wrap(
      ctx.payer,
      buildUpdateMintCapIx(ctx.payer, mint, toBigInt(newCap)),
    );
  },
  async buildPause(ctx: AdapterContext, mint) {
    return wrap(ctx.payer, buildPauseIx(ctx.payer, mint));
  },
  async buildUnpause(ctx: AdapterContext, mint) {
    return wrap(ctx.payer, buildUnpauseIx(ctx.payer, mint));
  },
  async buildFreezeAccount(ctx: AdapterContext, mint, tokenAccount) {
    return wrap(ctx.payer, buildFreezeAccountIx(ctx.payer, mint, tokenAccount));
  },
  async buildThawAccount(ctx: AdapterContext, mint, tokenAccount) {
    return wrap(ctx.payer, buildThawAccountIx(ctx.payer, mint, tokenAccount));
  },
  async buildMintTokens(ctx: AdapterContext, mint, destination, amount) {
    return wrap(
      ctx.payer,
      buildMintTokensIx(ctx.payer, mint, destination, toBigInt(amount)),
    );
  },
  async buildApproveRedemption(ctx: AdapterContext, mint, redemption) {
    return wrap(
      ctx.payer,
      buildApproveRedemptionIx(
        ctx.payer,
        redemption.holder,
        mint,
        redemption.tokenAccount,
        toBigInt(redemption.nonce),
      ),
    );
  },
  async buildCancelRedemption(ctx: AdapterContext, mint, redemption) {
    return wrap(
      ctx.payer,
      buildCancelRedemptionIx(
        ctx.payer,
        redemption.holder,
        mint,
        redemption.tokenAccount,
        toBigInt(redemption.nonce),
      ),
    );
  },
};
