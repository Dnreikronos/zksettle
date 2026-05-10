// @vitest-environment jsdom

import { BN } from "@coral-xyz/anchor";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Keypair, PublicKey } from "@solana/web3.js";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Treasury } from "@/lib/stablecoin";

const adminKey = Keypair.generate().publicKey;
const operatorKey = Keypair.generate().publicKey;
const otherKey = Keypair.generate().publicKey;
const mintKey = Keypair.generate().publicKey;

const baseTreasury: Treasury = {
  admin: adminKey,
  operator: operatorKey,
  mint: mintKey,
  totalMinted: new BN(0),
  totalBurned: new BN(0),
  decimals: 6,
  paused: false,
  pendingAdmin: null,
  mintCap: new BN(0),
  redemptionNonce: new BN(0),
};

const walletState: { publicKey: PublicKey | null } = { publicKey: null };
const treasuryState: {
  data: Treasury | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = {
  data: baseTreasury,
  isLoading: false,
  isError: false,
  error: null,
};

vi.mock("@/hooks/use-wallet-connection", () => ({
  useWallet: () => walletState,
}));

vi.mock("@/hooks/use-treasury", () => ({
  useTreasury: () => treasuryState,
  treasuryQueryKey: (mint: PublicKey) => ["stablecoin", "treasury", mint.toBase58()],
}));

import { useStablecoinRole } from "./use-stablecoin-role";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  walletState.publicKey = null;
  treasuryState.data = baseTreasury;
  treasuryState.isLoading = false;
  treasuryState.isError = false;
  treasuryState.error = null;
});

describe("useStablecoinRole", () => {
  it("returns none when wallet is disconnected", () => {
    walletState.publicKey = null;
    const { result } = renderHook(() => useStablecoinRole(mintKey), { wrapper });
    expect(result.current.role).toBe("none");
  });

  it("returns admin when wallet matches admin key", () => {
    walletState.publicKey = adminKey;
    treasuryState.data = { ...baseTreasury, operator: otherKey };
    const { result } = renderHook(() => useStablecoinRole(mintKey), { wrapper });
    expect(result.current.role).toBe("admin");
  });

  it("returns operator when wallet matches operator key", () => {
    walletState.publicKey = operatorKey;
    treasuryState.data = { ...baseTreasury, admin: otherKey };
    const { result } = renderHook(() => useStablecoinRole(mintKey), { wrapper });
    expect(result.current.role).toBe("operator");
  });

  it("returns both when admin === operator === wallet", () => {
    walletState.publicKey = adminKey;
    treasuryState.data = { ...baseTreasury, operator: adminKey };
    const { result } = renderHook(() => useStablecoinRole(mintKey), { wrapper });
    expect(result.current.role).toBe("both");
  });

  it("flags pending admin when wallet matches pending_admin", () => {
    walletState.publicKey = otherKey;
    treasuryState.data = { ...baseTreasury, pendingAdmin: otherKey };
    const { result } = renderHook(() => useStablecoinRole(mintKey), { wrapper });
    expect(result.current.role).toBe("none");
    expect(result.current.isPendingAdmin).toBe(true);
  });
});
