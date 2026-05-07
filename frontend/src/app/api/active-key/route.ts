import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ACTIVE_KEY_COOKIE,
  KEY_FORMAT,
  clearActiveKeyCookie,
  setActiveKeyCookie,
} from "@/lib/server/active-key-cookie";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const key = (body as { key?: unknown })?.key;
  if (typeof key !== "string" || !KEY_FORMAT.test(key)) {
    return NextResponse.json({ error: "invalid_key_format" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  setActiveKeyCookie(res, key);
  return res;
}

export async function DELETE() {
  const store = await cookies();
  if (!store.get(ACTIVE_KEY_COOKIE)) {
    return NextResponse.json({ ok: true, cleared: false });
  }
  const res = NextResponse.json({ ok: true, cleared: true });
  clearActiveKeyCookie(res);
  return res;
}
