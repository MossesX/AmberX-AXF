import { caller, json, str } from "../../../../../src/server/ai/http";
import { deleteConversation, getConversation, summary, updateConversation } from "../../../../../src/server/ai/store";
import { MODES, type AssistantMode } from "../../../../../src/server/ai/types";

import { corsRoute, preflight } from "../../../../../src/server/cors";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(request: Request, ctx: Ctx): Promise<Response> {
  const c = await caller(request);
  const conv = await getConversation(c.user, Number((await ctx.params).id));
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json({ conversation: summary(conv), messages: conv.messages });
}

export async function PUT(request: Request, ctx: Ctx): Promise<Response> {
  const c = await caller(request);
  const b = await json(request);
  const patch: { title?: string; mode?: AssistantMode } = {};
  if (str(b.title, 80).trim()) patch.title = str(b.title, 80);
  if (MODES.includes(b.mode as AssistantMode)) patch.mode = b.mode as AssistantMode;
  const conv = await updateConversation(c.user, Number((await ctx.params).id), patch);
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json({ conversation: summary(conv) });
}

export async function DELETE(request: Request, ctx: Ctx): Promise<Response> {
  const c = await caller(request);
  const ok = await deleteConversation(c.user, Number((await ctx.params).id));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Conversation not found" }, { status: 404 });
}

/* Molly (molly.amberxai.com) reaches the assistant cross-origin with the signed-in session: src/server/cors.ts */
export const GET = corsRoute(handleGET);
export const OPTIONS = preflight;
