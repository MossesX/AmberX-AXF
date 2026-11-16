/**
 * @file Cross-origin access to the ledger API (Nov 2026).
 *
 * Another app on the same site (amberxai.com) may draw the Expense Tracker's screens natively and read / write the same
 * ledger through `/api/expenses/v1/*` with the user's own `axs_session` cookie (`credentials: "include"`); the Lax
 * session cookie rides along, and what the browser still needs is CORS.
 *
 * The standalone app is untouched: a request without an `Origin`, or from this app's own origin, gets no extra headers.
 * Only origins on the allow-list get `Access-Control-Allow-Origin` (exact echo, never `*`) with credentials. The list is
 * `EXPENSES_CORS_ORIGINS` (comma separated, container env, e.g. `http://localhost:5173` for a dev client); empty by
 * default, so nothing cross-origin is allowed until it is set.
 */

import { axsUserFromCookieHeader } from "@axs/modules/accounts/lib/session";

const DEFAULT_ORIGINS: string[] = [];

export function allowedOrigins(): string[] {
  const extra = (process.env.EXPENSES_CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

/** The request's Origin when it is on the allow-list, else null. */
export function corsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return allowedOrigins().includes(origin) ? origin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-expenses-user",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** Adds the CORS headers to `response` when the request came from an allowed origin. */
export function withCors(request: Request, response: Response): Response {
  const origin = corsOrigin(request);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The preflight answer: 204 with CORS headers for an allowed origin, 403 for any other. */
export function preflight(request: Request): Response {
  const origin = corsOrigin(request);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Wraps a route handler for cross-origin clients: an allowed cross-origin call must carry a signed-in session (never the signed-out
 * "local" owner the app itself falls back to) and gets CORS headers; same-origin and tool calls run unchanged.
 */
export function corsRoute<A extends unknown[]>(handler: (request: Request, ...rest: A) => Promise<Response>) {
  return async (request: Request, ...rest: A): Promise<Response> => {
    if (corsOrigin(request) && !axsUserFromCookieHeader(request.headers.get("cookie"))) {
      return withCors(request, Response.json({ error: "sign in to Expenses" }, { status: 401 }));
    }
    return withCors(request, await handler(request, ...rest));
  };
}
