"use client";

import { WarningTriangle, Xmark } from "iconoir-react";
import { useEffect, useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <dialog
      open
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 m-0 h-full w-full max-w-none max-h-none border-none bg-transparent p-0"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          if (!pending) onCancel();
        }}
        className="absolute inset-0 cursor-pointer bg-ink/40 backdrop-blur-[1px]"
      />
      <div className="absolute left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-6)] border border-border-subtle bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          {destructive ? (
            <WarningTriangle
              aria-hidden="true"
              className="mt-1 size-5 shrink-0 text-rust"
            />
          ) : null}
          <div className="flex flex-1 flex-col gap-1">
            <h2 id={titleId} className="font-display text-xl text-ink">
              {title}
            </h2>
            <div id={descId} className="text-sm text-stone">
              {description}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[2px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:opacity-50"
          >
            <Xmark className="size-4" aria-hidden="true" />
          </button>
        </div>

        {errorMessage ? (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-3)] border border-rust/30 bg-danger-bg px-3 py-2 font-mono text-xs text-rust"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={pending}
            className={destructive ? "bg-rust hover:bg-rust/80" : undefined}
          >
            {pending ? "Submitting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
