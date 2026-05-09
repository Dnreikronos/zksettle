import { PublicKey } from "@solana/web3.js";

export const STABLECOIN_PROGRAM_ID = new PublicKey(
  "2CdXRSPo6QLfLBJTikmrqmBiWwa1HpuuYJ2Qu6Yy3Liv",
);

export const STABLECOIN_DECIMALS = 6;

export const REDEMPTION_EXPIRY_SECS = 604_800;

export const SEEDS = {
  treasury: "treasury",
  mintAuthority: "mint-authority",
  freezeAuthority: "freeze-authority",
  redemption: "redemption",
  escrowAuthority: "escrow-authority",
} as const;

const FALLBACK_MINT = "11111111111111111111111111111111";

function resolveMint(value: string | undefined): PublicKey {
  if (!value) return new PublicKey(FALLBACK_MINT);
  try {
    return new PublicKey(value);
  } catch {
    return new PublicKey(FALLBACK_MINT);
  }
}

export const STABLECOIN_MINT = resolveMint(
  process.env.NEXT_PUBLIC_STABLECOIN_MINT,
);

export const STABLECOIN_MINT_CONFIGURED =
  !!process.env.NEXT_PUBLIC_STABLECOIN_MINT;
