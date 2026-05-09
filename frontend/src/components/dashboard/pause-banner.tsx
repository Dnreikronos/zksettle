import { WarningTriangle } from "iconoir-react";

export function PauseBanner() {
  return (
    <section
      role="alert"
      className="flex items-start gap-3 rounded-[var(--radius-6)] border border-rust/40 bg-danger-bg px-5 py-4"
    >
      <WarningTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rust" />
      <div className="flex flex-col gap-1">
        <p className="font-display text-sm text-rust">Stablecoin paused</p>
        <p className="font-mono text-xs text-rust/80">
          Minting, redemptions, and freezes are blocked. Only thaw remains
          available while paused.
        </p>
      </div>
    </section>
  );
}
