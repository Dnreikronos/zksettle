import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACTIVE_KEY_COOKIE, keyPrefix } from "@/lib/server/active-key-cookie";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  const key = store.get(ACTIVE_KEY_COOKIE)?.value;
  if (!key) {
    return NextResponse.json(
      { hasKey: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(
    { hasKey: true, prefix: keyPrefix(key) },
    { headers: { "cache-control": "no-store" } },
  );
}
