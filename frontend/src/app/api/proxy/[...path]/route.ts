import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ACTIVE_KEY_COOKIE } from "@/lib/server/active-key-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_BASE_URL =
  process.env.GATEWAY_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000";

// Headers we never forward in either direction. Cookie/Set-Cookie are
// rewritten below to strip our own active-key cookie.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

function stripActiveKeyCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(/;\s*/)
    .filter((pair) => !pair.startsWith(`${ACTIVE_KEY_COOKIE}=`))
    .join("; ");
  return kept.length > 0 ? kept : null;
}

async function forward(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const search = new URL(request.url).search;
  const targetPath = `/${(path ?? []).join("/")}${search}`;
  const targetUrl = `${GATEWAY_BASE_URL}${targetPath}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "cookie") return; // handled below
    headers.set(key, value);
  });

  // Forward all cookies EXCEPT our active-key cookie (server-only secret).
  const forwardedCookies = stripActiveKeyCookie(request.headers.get("cookie"));
  if (forwardedCookies) headers.set("cookie", forwardedCookies);

  // Inject the bearer token from the active-key cookie.
  const cookieStore = await cookies();
  const apiKey = cookieStore.get(ACTIVE_KEY_COOKIE)?.value;
  if (apiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };
  if (hasBody) {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err) {
    return NextResponse.json(
      { error: "upstream_unreachable", message: (err as Error).message },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    // Set-Cookie can repeat — Headers#set would collapse it. Use append.
    if (key.toLowerCase() === "set-cookie") {
      responseHeaders.append("set-cookie", value);
      return;
    }
    responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
