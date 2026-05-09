"use client";

import { PublicKey } from "@solana/web3.js";
import { useState, type ReactNode } from "react";

import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type StablecoinActionResult,
  useStablecoinAction,
} from "@/hooks/use-stablecoin-action";
import {
  formatAmount,
  formatPubkey,
  getStablecoinAdapter,
  parseAmountToUnits,
  type Treasury,
} from "@/lib/stablecoin";

interface AdminControlsProps {
  treasury: Treasury;
  walletPublicKey: PublicKey;
  onActionComplete: (result: StablecoinActionResult, summary: string) => void;
  isPendingAdmin: boolean;
}

interface PendingAction {
  title: string;
  description: ReactNode;
  destructive?: boolean;
  summary: string;
  buildTransaction: Parameters<typeof useStablecoinAction>[0]["buildTransaction"];
  confirmLabel: string;
}

function isValidPubkey(value: string): boolean {
  try {
    new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

function PanelSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-6)] border border-border-subtle bg-surface p-5">
      <h3 className="font-display text-base text-ink">{title}</h3>
      <p className="mt-1 text-xs text-stone">{description}</p>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function AdminControls({
  treasury,
  walletPublicKey,
  onActionComplete,
  isPendingAdmin,
}: AdminControlsProps) {
  const adapter = getStablecoinAdapter();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const [newOperator, setNewOperator] = useState("");
  const [newAdmin, setNewAdmin] = useState("");
  const [newCap, setNewCap] = useState("");
  const [freezeTarget, setFreezeTarget] = useState("");

  const mutation = useStablecoinAction({
    mint: treasury.mint,
    buildTransaction: pending?.buildTransaction ?? (() => {
      throw new Error("No action selected");
    }),
  });

  const closeDialog = () => {
    if (mutation.isPending) return;
    setPending(null);
    mutation.reset();
  };

  const submit = async () => {
    if (!pending) return;
    try {
      const result = await mutation.mutateAsync();
      onActionComplete(result, pending.summary);
      setPending(null);
      mutation.reset();
    } catch {
      // mutation.error surfaces below
    }
  };

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null;

  const operatorValid = newOperator.trim().length > 0 && isValidPubkey(newOperator);
  const adminValid = newAdmin.trim().length > 0 && isValidPubkey(newAdmin);
  const freezeValid = freezeTarget.trim().length > 0 && isValidPubkey(freezeTarget);
  const capRaw = newCap.trim();
  const decimals = treasury.decimals;
  const capUnits = capRaw === "" ? null : parseAmountToUnits(capRaw, decimals);
  const capValid = capRaw === "" || capUnits !== null;

  const queueSetOperator = () => {
    const next = new PublicKey(newOperator.trim());
    setPending({
      title: "Change operator?",
      description: (
        <>
          Change operator to <code>{formatPubkey(next, 6, 6)}</code>? The current
          operator will lose minting and redemption approval rights.
        </>
      ),
      summary: `Operator changed to ${formatPubkey(next)}`,
      confirmLabel: "Change operator",
      buildTransaction: ({ payer }) =>
        adapter.buildSetOperator({ payer }, treasury.mint, next),
    });
  };

  const queueProposeAdmin = () => {
    const next = new PublicKey(newAdmin.trim());
    setPending({
      title: "Propose new admin?",
      description: (
        <>
          Propose <code>{formatPubkey(next, 6, 6)}</code> as new admin. They must
          call accept_admin to complete the transfer.
        </>
      ),
      summary: `Proposed ${formatPubkey(next)} as new admin`,
      confirmLabel: "Propose admin",
      buildTransaction: ({ payer }) =>
        adapter.buildProposeAdmin({ payer }, treasury.mint, next),
    });
  };

  const queueCancelPendingAdmin = () => {
    setPending({
      title: "Cancel admin transfer?",
      description: "The pending admin will no longer be able to accept the role.",
      summary: "Pending admin transfer cancelled",
      confirmLabel: "Cancel transfer",
      destructive: true,
      buildTransaction: ({ payer }) =>
        adapter.buildCancelPendingAdmin({ payer }, treasury.mint),
    });
  };

  const queueAcceptAdmin = () => {
    setPending({
      title: "Accept admin role?",
      description: "You become admin immediately after this transaction confirms.",
      summary: "Admin role accepted",
      confirmLabel: "Accept admin",
      buildTransaction: ({ payer }) =>
        adapter.buildAcceptAdmin({ payer }, treasury.mint),
    });
  };

  const queueUpdateMintCap = () => {
    if (!capUnits) return;
    setPending({
      title: "Update mint cap?",
      description: (
        <>
          Set mint cap to <code>{capRaw}</code>{" "}
          {capUnits.lt(treasury.totalMinted) ? (
            <span className="block pt-1 text-rust">
              Warning: new cap is below current total minted (
              {formatAmount(treasury.totalMinted, decimals)}).
            </span>
          ) : null}
        </>
      ),
      summary: `Mint cap updated to ${capRaw}`,
      confirmLabel: "Update cap",
      buildTransaction: ({ payer }) =>
        adapter.buildUpdateMintCap({ payer }, treasury.mint, capUnits),
    });
  };

  const queuePauseToggle = () => {
    if (treasury.paused) {
      setPending({
        title: "Unpause stablecoin?",
        description: "Minting, redemptions, and freezes will resume.",
        summary: "Stablecoin unpaused",
        confirmLabel: "Unpause",
        buildTransaction: ({ payer }) =>
          adapter.buildUnpause({ payer }, treasury.mint),
      });
    } else {
      setPending({
        title: "Pause the stablecoin?",
        description:
          "This blocks ALL minting, redemptions, and freezing. Only thaw remains available.",
        summary: "Stablecoin paused",
        destructive: true,
        confirmLabel: "Pause",
        buildTransaction: ({ payer }) =>
          adapter.buildPause({ payer }, treasury.mint),
      });
    }
  };

  const queueFreeze = (kind: "freeze" | "thaw") => {
    const target = new PublicKey(freezeTarget.trim());
    setPending({
      title: kind === "freeze" ? "Freeze account?" : "Thaw account?",
      description: (
        <>
          {kind === "freeze" ? "Freeze" : "Thaw"} token account{" "}
          <code>{formatPubkey(target, 6, 6)}</code>?
          {kind === "freeze"
            ? " The holder will not be able to transfer or request redemption."
            : " The holder regains transfer ability."}
        </>
      ),
      summary:
        kind === "freeze"
          ? `Account ${formatPubkey(target)} frozen`
          : `Account ${formatPubkey(target)} thawed`,
      destructive: kind === "freeze",
      confirmLabel: kind === "freeze" ? "Freeze" : "Thaw",
      buildTransaction: ({ payer }) =>
        kind === "freeze"
          ? adapter.buildFreezeAccount({ payer }, treasury.mint, target)
          : adapter.buildThawAccount({ payer }, treasury.mint, target),
    });
  };

  const isAdmin = walletPublicKey.toBase58() === treasury.admin.toBase58();

  return (
    <div className="flex flex-col gap-4">
      {isPendingAdmin && !isAdmin ? (
        <PanelSection
          title="Incoming admin role"
          description="The current admin proposed you as the new admin. Accept to take over."
        >
          <Button onClick={queueAcceptAdmin}>Accept admin role</Button>
        </PanelSection>
      ) : null}

      {isAdmin ? (
        <>
          <PanelSection
            title="Operator"
            description={`Current: ${formatPubkey(treasury.operator, 6, 6)}`}
          >
            <Input
              value={newOperator}
              onChange={(e) => setNewOperator(e.target.value)}
              placeholder="New operator pubkey"
              className="font-mono text-xs"
            />
            <div>
              <Button
                size="sm"
                onClick={queueSetOperator}
                disabled={!operatorValid}
              >
                Change operator
              </Button>
            </div>
          </PanelSection>

          <PanelSection
            title="Admin transfer"
            description={
              treasury.pendingAdmin
                ? `Pending admin: ${formatPubkey(treasury.pendingAdmin, 6, 6)}`
                : "Two-step transfer: propose, then the new admin accepts."
            }
          >
            {treasury.pendingAdmin ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={queueCancelPendingAdmin}
                >
                  Cancel pending transfer
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.value)}
                  placeholder="New admin pubkey"
                  className="font-mono text-xs"
                />
                <div>
                  <Button
                    size="sm"
                    onClick={queueProposeAdmin}
                    disabled={!adminValid}
                  >
                    Propose admin
                  </Button>
                </div>
              </>
            )}
          </PanelSection>

          <PanelSection
            title="Mint cap"
            description={
              treasury.mintCap.isZero()
                ? "Currently uncapped."
                : `Current: ${formatAmount(treasury.mintCap, decimals)}`
            }
          >
            <Input
              value={newCap}
              onChange={(e) => setNewCap(e.target.value)}
              placeholder="New cap (token units, e.g. 1000000)"
              inputMode="decimal"
              className="font-mono text-xs"
            />
            <div>
              <Button
                size="sm"
                onClick={queueUpdateMintCap}
                disabled={!capValid || capRaw === ""}
              >
                Update cap
              </Button>
            </div>
          </PanelSection>

          <PanelSection
            title="Emergency"
            description="Pause halts every flow except thaw. Use for incident response."
          >
            <div>
              <Button
                size="sm"
                variant={treasury.paused ? "primary" : "ghost"}
                onClick={queuePauseToggle}
                className={treasury.paused ? undefined : "border-rust text-rust hover:bg-rust hover:text-canvas"}
              >
                {treasury.paused ? "Unpause" : "Pause"}
              </Button>
            </div>
          </PanelSection>

          <PanelSection
            title="Freeze / thaw"
            description={
              treasury.paused
                ? "While paused, only thaw is available."
                : "Block or restore transfers for a specific token account."
            }
          >
            <Input
              value={freezeTarget}
              onChange={(e) => setFreezeTarget(e.target.value)}
              placeholder="Token account pubkey"
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => queueFreeze("freeze")}
                disabled={!freezeValid || treasury.paused}
              >
                Freeze
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => queueFreeze("thaw")}
                disabled={!freezeValid}
              >
                Thaw
              </Button>
            </div>
          </PanelSection>
        </>
      ) : null}

      <ConfirmActionDialog
        open={!!pending}
        title={pending?.title ?? ""}
        description={pending?.description ?? null}
        confirmLabel={pending?.confirmLabel ?? "Confirm"}
        destructive={pending?.destructive}
        pending={mutation.isPending}
        errorMessage={errorMessage}
        onConfirm={submit}
        onCancel={closeDialog}
      />
    </div>
  );
}
