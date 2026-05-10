"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";

import { useConnection } from "@/hooks/use-wallet-connection";
import {
  getStablecoinAdapter,
  STABLECOIN_ADAPTER_KIND,
  STABLECOIN_MINT_CONFIGURED,
} from "@/lib/stablecoin";

export const redemptionsQueryKey = (mint: PublicKey) =>
  ["stablecoin", "redemptions", mint.toBase58()] as const;

export function useRedemptionRequests(mint: PublicKey) {
  const { connection } = useConnection();
  const enabled =
    STABLECOIN_ADAPTER_KIND === "mock" || STABLECOIN_MINT_CONFIGURED;
  return useQuery({
    queryKey: redemptionsQueryKey(mint),
    queryFn: () => getStablecoinAdapter().listRedemptions(connection, mint),
    refetchInterval: 30_000,
    enabled,
  });
}
