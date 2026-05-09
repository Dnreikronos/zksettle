"use client";

import { useState, type ReactNode } from "react";

import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { useRedemptionRequests } from "@/hooks/use-redemption-requests";
import {
  type StablecoinActionResult,
  useStablecoinAction,
} from "@/hooks/use-stablecoin-action";
import {
  formatAmount,
  formatDuration,
  formatPubkey,
  getStablecoinAdapter,
  redemptionExpiry,
  type RedemptionRequest,
  type Treasury,
} from "@/lib/stablecoin";

interface RedemptionQueueProps {
  treasury: Treasury;
  onActionComplete: (result: StablecoinActionResult, summary: string) => void;
}

interface PendingAction {
  request: RedemptionRequest;
  kind: "approve" | "cancel";
  title: string;
  description: ReactNode;
  summary: string;
}

export function RedemptionQueue({
  treasury,
  onActionComplete,
}: RedemptionQueueProps) {
  const adapter = getStablecoinAdapter();
  const { data, isLoading, isError, error } = useRedemptionRequests(
    treasury.mint,
  );
  const [pending, setPending] = useState<PendingAction | null>(null);

  const mutation = useStablecoinAction({
    mint: treasury.mint,
    buildTransaction: ({ payer }) => {
      if (!pending) throw new Error("No redemption selected");
      return pending.kind === "approve"
        ? adapter.buildApproveRedemption({ payer }, treasury.mint, pending.request)
        : adapter.buildCancelRedemption({ payer }, treasury.mint, pending.request);
    },
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
      // surfaced via mutation.error
    }
  };

  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null;

  const requests = data ?? [];

  return (
    <section className="rounded-[var(--radius-6)] border border-border-subtle bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base text-ink">Redemption queue</h3>
        <span className="font-mono text-[11px] text-muted">
          {requests.length} open
        </span>
      </div>

      {isError ? (
        <p role="alert" className="mt-4 font-mono text-xs text-rust">
          Failed to load redemptions:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : isLoading ? (
        <p className="mt-4 font-mono text-xs text-muted">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="mt-4 font-mono text-xs text-muted">
          No pending redemptions.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border-subtle">
          {requests.map((req) => {
            const expiry = redemptionExpiry(req);
            const amountText = formatAmount(req.amount, treasury.decimals);
            const queueApprove = () =>
              setPending({
                request: req,
                kind: "approve",
                title: "Approve redemption?",
                description: (
                  <>
                    Approve redemption of <code>{amountText}</code> tokens for{" "}
                    <code>{formatPubkey(req.holder, 6, 6)}</code>? Tokens will be
                    burned.
                  </>
                ),
                summary: `Redemption approved for ${formatPubkey(req.holder)}`,
              });
            const queueCancel = () =>
              setPending({
                request: req,
                kind: "cancel",
                title: "Cancel redemption?",
                description:
                  "The holder regains transfer ability and the request is closed.",
                summary: `Redemption cancelled for ${formatPubkey(req.holder)}`,
              });

            return (
              <li
                key={req.pda.toBase58()}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-xs text-quill">
                    {formatPubkey(req.holder, 6, 6)}
                  </span>
                  <span className="text-xs text-stone">
                    {amountText} tokens · nonce {req.nonce.toString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {expiry.expired ? (
                    <StatusPill kind="warning" label="Expired" />
                  ) : (
                    <span className="font-mono text-[11px] text-muted">
                      {formatDuration(expiry.secondsRemaining)} left
                    </span>
                  )}
                  {expiry.expired ? (
                    <Button size="sm" variant="ghost" onClick={queueCancel}>
                      Cancel (expired)
                    </Button>
                  ) : (
                    <Button size="sm" onClick={queueApprove} disabled={treasury.paused}>
                      Approve
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmActionDialog
        open={!!pending}
        title={pending?.title ?? ""}
        description={pending?.description ?? null}
        confirmLabel={pending?.kind === "approve" ? "Approve" : "Cancel"}
        destructive={pending?.kind === "cancel"}
        pending={mutation.isPending}
        errorMessage={errorMessage}
        onConfirm={submit}
        onCancel={closeDialog}
      />
    </section>
  );
}
