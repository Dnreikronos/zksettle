"use client";

import { useMemo } from "react";
import type { PublicKey } from "@solana/web3.js";

import { useWallet } from "@/hooks/use-wallet-connection";
import { useTreasury } from "@/hooks/use-treasury";
import { pubkeysEqual } from "@/lib/stablecoin";
import type { StablecoinRole, Treasury } from "@/lib/stablecoin";

interface UseStablecoinRoleResult {
  role: StablecoinRole;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  treasury: Treasury | null;
  isPendingAdmin: boolean;
}

export function useStablecoinRole(mint: PublicKey): UseStablecoinRoleResult {
  const { publicKey } = useWallet();
  const { data: treasury, isLoading, isError, error } = useTreasury(mint);

  return useMemo(() => {
    const baseError = error instanceof Error ? error : null;
    if (!publicKey || !treasury) {
      return {
        role: "none",
        isLoading,
        isError,
        error: baseError,
        treasury: treasury ?? null,
        isPendingAdmin: false,
      };
    }

    const isAdmin = pubkeysEqual(publicKey, treasury.admin);
    const isOperator = pubkeysEqual(publicKey, treasury.operator);
    const isPendingAdmin = pubkeysEqual(publicKey, treasury.pendingAdmin);

    let role: StablecoinRole = "none";
    if (isAdmin && isOperator) role = "both";
    else if (isAdmin) role = "admin";
    else if (isOperator) role = "operator";

    return {
      role,
      isLoading,
      isError,
      error: baseError,
      treasury,
      isPendingAdmin,
    };
  }, [publicKey, treasury, isLoading, isError, error]);
}
