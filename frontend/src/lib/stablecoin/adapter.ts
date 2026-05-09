import { mockAdapter } from "./mock-adapter";
import { sdkAdapter } from "./sdk-adapter";
import type { StablecoinAdapter } from "./types";

export type AdapterKind = "mock" | "sdk";

function resolveAdapterKind(): AdapterKind {
  const raw = process.env.NEXT_PUBLIC_STABLECOIN_ADAPTER;
  if (raw === "mock") return "mock";
  if (raw === "sdk") return "sdk";
  return "sdk";
}

export const STABLECOIN_ADAPTER_KIND: AdapterKind = resolveAdapterKind();

export function getStablecoinAdapter(): StablecoinAdapter {
  return STABLECOIN_ADAPTER_KIND === "sdk" ? sdkAdapter : mockAdapter;
}
