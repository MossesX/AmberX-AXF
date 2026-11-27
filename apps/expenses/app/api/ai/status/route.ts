import { aiStatus } from "../../../../src/server/ai/assistant";
import { caller } from "../../../../src/server/ai/http";

import { corsRoute, preflight } from "../../../../src/server/cors";

export const dynamic = "force-dynamic";

async function handleGET(request: Request): Promise<Response> {
  const c = await caller(request);
  return Response.json(await aiStatus(c.user, c.model));
}

/* Molly (molly.amberxai.com) reaches the assistant cross-origin with the signed-in session: src/server/cors.ts */
export const GET = corsRoute(handleGET);
export const OPTIONS = preflight;
