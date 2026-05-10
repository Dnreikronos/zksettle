// @vitest-environment jsdom

import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StablecoinRole, Treasury } from "@/lib/stablecoin";

const roleState: {
  role: StablecoinRole;
  treasury: Treasury | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isPendingAdmin: boolean;
} = {
  role: "none",
  treasury: null,
  isLoading: false,
  isError: false,
  error: null,
  isPendingAdmin: false,
};

const walletState: { publicKey: PublicKey | null } = { publicKey: null };

vi.mock("@/hooks/use-wallet-connection", () => ({
  useWallet: () => walletState,
  useConnection: () => ({ connection: {} }),
}));

vi.mock("@/hooks/use-stablecoin-role", () => ({
  useStablecoinRole: () => roleState,
}));

vi.mock("@/lib/stablecoin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stablecoin")>(
    "@/lib/stablecoin",
  );
  return {
    ...actual,
    STABLECOIN_MINT_CONFIGURED: true,
    // Bypass the real adapter entirely so the SDK module never has to
    // resolve in tests — defends against future static imports leaking
    // in via the barrel export.
    getStablecoinAdapter: () => ({
      getTreasury: vi.fn().mockResolvedValue(null),
      listRedemptions: vi.fn().mockResolvedValue([]),
    }),
  };
});

vi.mock("@/components/dashboard/treasury-overview", () => ({
  TreasuryOverview: () => <div data-testid="treasury-overview" />,
}));
vi.mock("@/components/dashboard/admin-controls", () => ({
  AdminControls: () => <div data-testid="admin-controls" />,
}));
vi.mock("@/components/dashboard/operator-controls", () => ({
  OperatorControls: () => <div data-testid="operator-controls" />,
}));
vi.mock("@/components/dashboard/redemption-queue", () => ({
  RedemptionQueue: () => <div data-testid="redemption-queue" />,
}));
vi.mock("@/components/dashboard/pause-banner", () => ({
  PauseBanner: () => <div data-testid="pause-banner" />,
}));

import { AdminPanels } from "./admin-panels";

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

afterEach(() => {
  cleanup();
  walletState.publicKey = null;
  roleState.role = "none";
  roleState.treasury = baseTreasury;
  roleState.isLoading = false;
  roleState.isError = false;
  roleState.error = null;
  roleState.isPendingAdmin = false;
});

describe("AdminPanels", () => {
  it("renders an error alert when treasury fetch fails", () => {
    walletState.publicKey = adminKey;
    roleState.role = "none";
    roleState.treasury = null;
    roleState.isError = true;
    roleState.error = new Error("rpc unavailable");
    render(<AdminPanels />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("rpc unavailable");
  });

  it("renders nothing when role is none", () => {
    walletState.publicKey = adminKey;
    roleState.role = "none";
    roleState.treasury = baseTreasury;
    const { container } = render(<AdminPanels />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only admin controls for admin role", () => {
    walletState.publicKey = adminKey;
    roleState.role = "admin";
    roleState.treasury = baseTreasury;
    render(<AdminPanels />);
    expect(screen.getByTestId("treasury-overview")).toBeTruthy();
    expect(screen.getByTestId("admin-controls")).toBeTruthy();
    expect(screen.queryByTestId("operator-controls")).toBeNull();
    expect(screen.queryByTestId("redemption-queue")).toBeNull();
  });

  it("renders only operator controls for operator role", () => {
    walletState.publicKey = operatorKey;
    roleState.role = "operator";
    roleState.treasury = baseTreasury;
    render(<AdminPanels />);
    expect(screen.queryByTestId("admin-controls")).toBeNull();
    expect(screen.getByTestId("operator-controls")).toBeTruthy();
    expect(screen.getByTestId("redemption-queue")).toBeTruthy();
  });

  it("renders both panels for both role", () => {
    walletState.publicKey = adminKey;
    roleState.role = "both";
    roleState.treasury = baseTreasury;
    render(<AdminPanels />);
    expect(screen.getByTestId("admin-controls")).toBeTruthy();
    expect(screen.getByTestId("operator-controls")).toBeTruthy();
    expect(screen.getByTestId("redemption-queue")).toBeTruthy();
  });

  it("shows the pause banner when treasury is paused", () => {
    walletState.publicKey = adminKey;
    roleState.role = "admin";
    roleState.treasury = { ...baseTreasury, paused: true };
    render(<AdminPanels />);
    expect(screen.getByTestId("pause-banner")).toBeTruthy();
  });

  it("renders admin controls for an incoming admin (isPendingAdmin)", () => {
    walletState.publicKey = otherKey;
    roleState.role = "none";
    roleState.isPendingAdmin = true;
    roleState.treasury = baseTreasury;
    render(<AdminPanels />);
    expect(screen.getByTestId("admin-controls")).toBeTruthy();
  });
});
