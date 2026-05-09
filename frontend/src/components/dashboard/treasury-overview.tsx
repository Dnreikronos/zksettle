"use client";

import { Copy } from "iconoir-react";
import { useState, type ReactNode } from "react";
import type { PublicKey } from "@solana/web3.js";

import { StatCard } from "@/components/dashboard/stat-card";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  circulatingSupply,
  formatAmount,
  formatPubkey,
  pubkeysEqual,
  type Treasury,
} from "@/lib/stablecoin";

interface TreasuryOverviewProps {
  treasury: Treasury;
  walletPublicKey: PublicKey | null;
}

interface FieldRowProps {
  label: string;
  value: ReactNode;
  copyValue?: string;
  badge?: ReactNode;
}

function FieldRow({
  label,
  value,
  copyValue,
  badge,
}: Readonly<FieldRowProps>) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-ink">{label}</span>
        {badge ? <span className="mt-1">{badge}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-quill">{value}</code>
        {copyValue ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopy}
            aria-label={`Copy ${label}`}
          >
            <Copy aria-hidden="true" className="size-4" />
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function youBadge() {
  return (
    <span className="inline-flex w-fit items-center rounded-[var(--radius-2)] bg-mint px-2 py-[2px] font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-forest">
      You
    </span>
  );
}

export function TreasuryOverview({
  treasury,
  walletPublicKey,
}: Readonly<TreasuryOverviewProps>) {
  const decimals = treasury.decimals;
  const circulatingDisplay = formatAmount(circulatingSupply(treasury), decimals);

  const mintCapDisplay =
    treasury.mintCap.isZero()
      ? "Unlimited"
      : `${formatAmount(treasury.mintCap, decimals)}`;

  const adminBadge = pubkeysEqual(walletPublicKey, treasury.admin)
    ? youBadge()
    : null;
  const operatorBadge = pubkeysEqual(walletPublicKey, treasury.operator)
    ? youBadge()
    : null;
  const pendingAdminBadge =
    treasury.pendingAdmin && pubkeysEqual(walletPublicKey, treasury.pendingAdmin)
      ? youBadge()
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total minted"
          value={formatAmount(treasury.totalMinted, decimals)}
        />
        <StatCard
          label="Circulating"
          value={circulatingDisplay}
          sub={`Burned: ${formatAmount(treasury.totalBurned, decimals)}`}
        />
        <StatCard label="Mint cap" value={mintCapDisplay} />
      </div>

      <section
        aria-labelledby="treasury-heading"
        className="rounded-[var(--radius-6)] border border-border-subtle bg-surface p-6"
      >
        <div className="flex items-baseline justify-between">
          <span
            id="treasury-heading"
            className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
          >
            Treasury
          </span>
          <StatusPill
            kind={treasury.paused ? "blocked" : "verified"}
            label={treasury.paused ? "Paused" : "Active"}
          />
        </div>

        <ul className="mt-4 flex flex-col divide-y divide-border-subtle">
          <FieldRow
            label="Mint"
            value={formatPubkey(treasury.mint, 6, 6)}
            copyValue={treasury.mint.toBase58()}
          />
          <FieldRow
            label="Admin"
            value={formatPubkey(treasury.admin, 6, 6)}
            copyValue={treasury.admin.toBase58()}
            badge={adminBadge}
          />
          <FieldRow
            label="Operator"
            value={formatPubkey(treasury.operator, 6, 6)}
            copyValue={treasury.operator.toBase58()}
            badge={operatorBadge}
          />
          {treasury.pendingAdmin ? (
            <FieldRow
              label="Pending admin"
              value={formatPubkey(treasury.pendingAdmin, 6, 6)}
              copyValue={treasury.pendingAdmin.toBase58()}
              badge={pendingAdminBadge}
            />
          ) : null}
        </ul>
      </section>
    </div>
  );
}
