import { caller, json, str } from "../../../../src/server/ai/http";
import { createConversation, listConversations, summary } from "../../../../src/server/ai/store";
import { MODES, type AssistantMode } from "../../../../src/server/ai/types";

import { corsRoute, preflight } from "../../../../src/server/cors";

export const dynamic = "force-dynamic";

async function handleGET(request: Request): Promise<Response> {
  const c = await caller(request);
  const mode = new URL(request.url).searchParams.get("mode") ?? "";
  return Response.json({ conversations: await listConversations(c.user, MODES.includes(mode as AssistantMode) ? (mode as AssistantMode) : undefined) });
}

async function handlePOST(request: Request): Promise<Response> {
  const c = await caller(request);
  const b = await json(request);
  const mode = MODES.includes(b.mode as AssistantMode) ? (b.mode as AssistantMode) : "chat";
  const conv = await createConversation(c.user, mode, str(b.title, 80));
  return Response.json({ conversation: summary(conv) }, { status: 201 });
}

/* Molly (molly.amberxai.com) reaches the assistant cross-origin with the signed-in session: src/server/cors.ts */
export const GET = corsRoute(handleGET);
export const POST = corsRoute(handlePOST);
export const OPTIONS = preflight;
