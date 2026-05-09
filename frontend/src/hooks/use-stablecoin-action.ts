"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";

import { useConnection, useWallet } from "@/hooks/use-wallet-connection";
import { redemptionsQueryKey } from "@/hooks/use-redemption-requests";
import { treasuryQueryKey } from "@/hooks/use-treasury";
import { SOLANA_NETWORK } from "@/lib/config";

interface BuildTxArgs {
  payer: PublicKey;
  connection: Connection;
}

interface UseStablecoinActionArgs {
  mint: PublicKey;
  buildTransaction: (args: BuildTxArgs) => Promise<Transaction>;
}

export interface StablecoinActionResult {
  signature: string;
  solscanUrl: string;
}

function buildSolscanUrl(signature: string): string {
  if (SOLANA_NETWORK === WalletAdapterNetwork.Mainnet) {
    return `https://solscan.io/tx/${signature}`;
  }
  return `https://solscan.io/tx/${signature}?cluster=${SOLANA_NETWORK}`;
}

export function useStablecoinAction({
  mint,
  buildTransaction,
}: UseStablecoinActionArgs) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  return useMutation<StablecoinActionResult>({
    mutationFn: async () => {
      if (!publicKey) {
        throw new Error("Connect a wallet to submit this action.");
      }
      const tx = await buildTransaction({ payer: publicKey, connection });
      const signature = await sendTransaction(tx, connection);
      return { signature, solscanUrl: buildSolscanUrl(signature) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: treasuryQueryKey(mint) });
      queryClient.invalidateQueries({ queryKey: redemptionsQueryKey(mint) });
    },
  });
}
