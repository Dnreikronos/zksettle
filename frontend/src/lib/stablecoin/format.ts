import { BN } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";

import { REDEMPTION_EXPIRY_SECS } from "./program";
import type { RedemptionRequest, Treasury } from "./types";

const DECIMAL_BASE = 10n;

export function formatAmount(value: BN | bigint, decimals: number): string {
  const raw = typeof value === "bigint" ? value : BigInt(value.toString());
  if (decimals === 0) return raw.toString();
  const divisor = DECIMAL_BASE ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
}

export function formatPubkey(
  pubkey: PublicKey,
  head = 4,
  tail = 4,
): string {
  const s = pubkey.toBase58();
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function pubkeysEqual(
  a: PublicKey | null | undefined,
  b: PublicKey | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toBase58() === b.toBase58();
}

export interface MintCapProgress {
  capped: boolean;
  ratio: number;
  belowMinted: boolean;
}

export function mintCapProgress(treasury: Treasury): MintCapProgress {
  const cap = BigInt(treasury.mintCap.toString());
  const minted = BigInt(treasury.totalMinted.toString());
  if (cap === 0n) {
    return { capped: false, ratio: 0, belowMinted: false };
  }
  const ratio = minted === 0n ? 0 : Number(minted) / Number(cap);
  return {
    capped: true,
    ratio: Math.min(1, ratio),
    belowMinted: minted > cap,
  };
}

export function circulatingSupply(treasury: Treasury): bigint {
  const minted = BigInt(treasury.totalMinted.toString());
  const burned = BigInt(treasury.totalBurned.toString());
  return minted >= burned ? minted - burned : 0n;
}

export interface RedemptionExpiry {
  expiresAt: number;
  expired: boolean;
  secondsRemaining: number;
}

export function redemptionExpiry(
  request: RedemptionRequest,
  now: number = Math.floor(Date.now() / 1000),
): RedemptionExpiry {
  const expiresAt = request.requestedAt + REDEMPTION_EXPIRY_SECS;
  const secondsRemaining = expiresAt - now;
  return {
    expiresAt,
    expired: secondsRemaining <= 0,
    secondsRemaining: Math.max(0, secondsRemaining),
  };
}

export function parseAmountToUnits(raw: string, decimals: number): BN | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > decimals) return null;
  const fraction = fractionRaw.padEnd(decimals, "0");
  const combined = (whole + fraction).replace(/^0+/, "") || "0";
  return new BN(combined);
}

export function formatDuration(secs: number): string {
  if (secs <= 0) return "expired";
  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((secs % 3_600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
