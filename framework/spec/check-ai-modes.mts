/**
 * Self-test for ai-modes@1 on the web port (CI: npx -y tsx framework/spec/check-ai-modes.mts).
 *  1. replays spec/fixtures/ai-modes.json against core/ai-modes.ts (the Kotlin kernel's AiModesConformanceTest replays the same file)
 *  2. runs a request end to end: a trigger (triggers@1) opens a mode with an override, the UAC policy gates it, the model
 *     is chosen by tier, the request goes to a fake AiSessionClient over a LiveEventLog; the placeholder refuses.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_MODES_CONTRACT, AI_SESSION_CAPABILITY, AI_SESSION_HOST, AiModeRegistry, BUILTIN_AI_MODES, DEFAULT_ALLOWED_MODES, DEFAULT_MODE, MODEL_TIERS, PlaceholderAiSessionClient,
  allowedModes, buildRequest, chooseModel, resolveMode, type AiMode, type AiModeDiagnostic, type AiModePolicy, type AiSessionClient, type AiSessionRequest, type ModelOption,
} from '../core/ai-modes';
import { LIVE_KINDS, LiveEventLog, type LiveEvent, type LiveSessionInfo } from '../core/live-session';
import { matchTriggers, type Trigger } from '../core/triggers';

const f = JSON.parse(readFileSync(new URL('./fixtures/ai-modes.json', import.meta.url), 'utf8'));
let checks = 0;
const norm = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const eq = (a: unknown, b: unknown, what: string) => { assert.deepEqual(norm(a), norm(b), what); checks++; };

/* ---------- 1. fixture replay ---------- */
eq([AI_MODES_CONTRACT, AI_SESSION_CAPABILITY, AI_SESSION_HOST, MODEL_TIERS, DEFAULT_MODE, DEFAULT_ALLOWED_MODES], [f.contract, f.capability, f.host, f.tiers, f.defaultMode, f.defaultAllowed], 'constants');
eq(BUILTIN_AI_MODES, f.builtins, 'built-in modes');
const custom: AiMode = { id: 'notes.summarize', label: 'Summarize notes', requiresPermission: 'notes.ai', readOnly: true, needsApproval: false, sessionKind: 'assistant.chat', tier: 'fast', module: 'ai.amberx.axf.notes' };
{
  const raised: AiModeDiagnostic[] = [];
  const reg = new AiModeRegistry((d) => raised.push(d));
  const d1 = reg.register(custom);
  const d2 = reg.register({ ...custom, module: 'ai.amberx.axf.other', label: 'Other' });
  const d3 = reg.register({ ...BUILTIN_AI_MODES[0]!, module: 'ai.amberx.axf.plugin', label: 'Plugin chat' });
  eq([d1, d2, d3], f.registry.diagnostics, 'registry diagnostics');
  eq(raised, f.registry.diagnostics.filter(Boolean), 'diagnostics were reported');
  eq({ builtin: reg.unregister('ai.chat'), custom: reg.unregister('notes.summarize'), missing: reg.unregister('x.y') }, f.registry.removed, 'unregister');
  eq(reg.list().map((m) => [m.id, m.module, m.label]), f.registry.list, 'registry list');
}
const modes = [...BUILTIN_AI_MODES, custom];
const policies: Record<string, AiModePolicy> = f.policies;
for (const c of f.allowed) eq(allowedModes(modes, policies[c.policy]!).map((m) => m.id), c.modes, `allowed ${c.policy}`);
for (const c of f.resolve) eq(resolveMode(modes, policies[c.policy]!, c.pick), c.result, `resolve ${c.policy} ${JSON.stringify(c.pick)}`);
const optionSets: Record<string, ModelOption[]> = f.options;
for (const c of f.choices) eq(chooseModel(modes.find((m) => m.id === c.mode)!, optionSets[c.options]!, policies.anonymous!), c.choice, `choose ${c.options} ${c.mode}`);
for (const c of f.userPicks) eq(chooseModel(BUILTIN_AI_MODES[0]!, optionSets.all!, policies[c.policy]!, c.pick), c.choice, `user pick ${c.policy} ${c.pick}`);
for (const c of f.requests) eq(buildRequest(modes, policies[c.policy]!, optionSets.all!, c.input), c.result, `request ${c.policy} ${JSON.stringify(c.input).slice(0, 60)}`);

/* ---------- 2. a request end to end ---------- */
const ph = new PlaceholderAiSessionClient();
eq([ph.host, await ph.available(), await ph.list()], [AI_SESSION_HOST, false, []], 'placeholder client is the axHub host, not available');
await ph.start({} as AiSessionRequest).then(() => assert.fail('must refuse'), (e: Error & { capability?: string }) => eq([e.name, e.capability], ['NotImplemented', AI_SESSION_CAPABILITY], 'placeholder refuses with its capability'));

/** A fake host: one LiveEventLog per session, replies echo the prompt; approval-needing sessions wait first. */
class FakeClient implements AiSessionClient {
  readonly host = AI_SESSION_HOST;
  readonly sessions = new Map<string, { info: LiveSessionInfo; log: LiveEventLog; req: AiSessionRequest }>();
  async available() { return true; }
  async start(req: AiSessionRequest) {
    const id = `s${this.sessions.size + 1}`;
    const log = new LiveEventLog();
    log.append(LIVE_KINDS.open, { title: req.title, mode: req.mode }, 1);
    log.append(LIVE_KINDS.turnStart, { prompt: req.prompt }, 2);
    if (req.needsApproval) log.append(LIVE_KINDS.wait, { approval: req.mode }, 3);
    else { log.append('text', { text: `echo: ${req.prompt}` }, 3); log.append(LIVE_KINDS.turnEnd, undefined, 4); }
    const info: LiveSessionInfo = { id, kind: req.sessionKind, title: req.title, state: req.needsApproval ? 'waiting' : 'idle', host: this.host, createdAt: 1, updatedAt: 4, lastSeq: log.lastSeq, viewers: 0 };
    this.sessions.set(id, { info, log, req });
    return info;
  }
  async attach(id: string, after: number, onEvent: (e: LiveEvent) => void) { for (const e of this.sessions.get(id)!.log.since(after).events) onEvent(e); return () => {}; }
  async send(id: string, input: { prompt: string }) { const s = this.sessions.get(id)!; s.log.append(LIVE_KINDS.turnStart, { prompt: input.prompt }, 5); s.log.append('text', { text: `echo: ${input.prompt}` }, 6); s.log.append(LIVE_KINDS.turnEnd, undefined, 7); }
  async stream(id: string, after: number, max = 500) { return this.sessions.get(id)!.log.since(after, max); }
  async stop() {}
  async close(id: string) { this.sessions.get(id)!.log.append(LIVE_KINDS.close, undefined, 9); }
  async list() { return [...this.sessions.values()].map((s) => s.info); }
}

// a voice trigger that opens the assistant with a per-trigger mode override
const triggers: Trigger[] = [
  { id: 'notes.ask', kind: 'voice', source: 'permanent', module: 'ai.amberx.axf.notes', label: 'Ask', phrases: ['ask amber <text>'], action: 'ai.open', args: { mode: 'ai.chat' }, threshold: 80, worksIn: [], arming: 'always' },
  { id: 'notes.build', kind: 'voice', source: 'permanent', module: 'ai.amberx.axf.notes', label: 'Build', phrases: ['build me <text>'], action: 'ai.open', args: { mode: 'ai.build-request' }, threshold: 80, worksIn: [], arming: 'always' },
];
const client = new FakeClient();
const options = optionSets.all!;
const open = async (heard: string, policy: AiModePolicy) => {
  const fired = matchTriggers(triggers, { kind: 'voice', heard: [heard], at: 1000 }, { context: 'notes' }).fired;
  if (!fired) return { fired: null };
  const built = buildRequest(modes, policy, options, { prompt: String(fired.args.text), override: String(fired.args.mode), triggerId: fired.triggerId });
  if (!built.request) return { fired, resolution: built.resolution };
  const info = await client.start(built.request);
  const texts: string[] = [];
  await client.attach(info.id, 0, (e) => { if (e.kind === 'text') texts.push((e.data as { text: string }).text); });
  return { fired, resolution: built.resolution, model: built.model, info, texts };
};
const asUser = await open('ask amber what is on my list', policies.chatOnly!);
eq([asUser.resolution?.mode?.id, asUser.resolution?.reason, asUser.model?.model, asUser.info?.state, asUser.texts], ['ai.chat', 'override', 'claude-sonnet', 'idle', ['echo: what is on my list']], 'a user chats through a trigger');
const userBuild = await open('build me a notes app', policies.chatOnly!);
eq([userBuild.resolution?.mode?.id, userBuild.resolution?.reason, userBuild.resolution?.denied, userBuild.info?.state], ['ai.chat', 'fallback', 'ai.build-request', 'idle'], 'a build request from a user falls back to chat');
const adminBuild = await open('build me a notes app', policies.admin!);
eq([adminBuild.resolution?.mode?.id, adminBuild.model?.model, adminBuild.info?.state, adminBuild.info?.kind, adminBuild.texts], ['ai.build-request', 'claude-opus', 'waiting', 'agent.run', []], 'an admin build request waits for approval on a deep model');
const nobody = await open('build me a notes app', policies.nothing!);
eq([nobody.fired?.triggerId, nobody.resolution?.mode, nobody.resolution?.reason, nobody.info], ['notes.build', null, 'denied', undefined], 'nothing allowed: no session is opened');
await client.send(asUser.info!.id, { prompt: 'and tomorrow?' });
const more = await client.stream(asUser.info!.id, 4);
eq(more.events.map((e) => e.kind), ['turn.start', 'text', 'turn.end'], 'a second turn streams after the seq already seen');
await client.close(asUser.info!.id);
eq((await client.list()).length, 3, 'sessions stay listed; close is explicit');

console.log(`✓ ai-modes@1: ${checks} checks (fixture ai-modes.json + triggers → modes → UAC → model → a session client)`);
