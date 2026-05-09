"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";

import { useConnection } from "@/hooks/use-wallet-connection";
import {
  getStablecoinAdapter,
  STABLECOIN_ADAPTER_KIND,
  STABLECOIN_MINT_CONFIGURED,
} from "@/lib/stablecoin";

export const treasuryQueryKey = (mint: PublicKey) =>
  ["stablecoin", "treasury", mint.toBase58()] as const;

export function useTreasury(mint: PublicKey) {
  const { connection } = useConnection();
  const enabled =
    STABLECOIN_ADAPTER_KIND === "mock" || STABLECOIN_MINT_CONFIGURED;
  return useQuery({
    queryKey: treasuryQueryKey(mint),
    queryFn: () => getStablecoinAdapter().getTreasury(connection, mint),
    refetchInterval: 30_000,
    enabled,
  });
}
