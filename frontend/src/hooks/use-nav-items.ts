"use client";

import { useMemo } from "react";

import { NAV_ITEMS, type NavItem } from "@/components/dashboard/nav-items";
import { useStablecoinRole } from "@/hooks/use-stablecoin-role";
import { STABLECOIN_MINT } from "@/lib/stablecoin";

export function useNavItems(): readonly NavItem[] {
  const { role } = useStablecoinRole(STABLECOIN_MINT);

  return useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!item.requiresStablecoinRole) return true;
        return role !== "none";
      }),
    [role],
  );
}
