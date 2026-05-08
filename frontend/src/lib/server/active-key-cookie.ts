import type { NextResponse } from "next/server";

export const ACTIVE_KEY_COOKIE = "zks_active_key";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge?: number;
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SEVEN_DAYS_SECONDS,
  };
}

export function setActiveKeyCookie(res: NextResponse, key: string): void {
  res.cookies.set(ACTIVE_KEY_COOKIE, key, cookieOptions());
}

export function clearActiveKeyCookie(res: NextResponse): void {
  res.cookies.set(ACTIVE_KEY_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}

export function keyPrefix(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export const KEY_FORMAT = /^zks_[A-Za-z0-9_-]{32,}$/;
