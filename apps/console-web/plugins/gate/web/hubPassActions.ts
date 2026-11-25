/**
 * The hub's passes without the page (build approval-pass-covers-every-call, s9): console actions that read a pass,
 * switch one on with what it covers, change what it covers and end it. Each one is a pass-voice@1 intent
 * (pass-voice.mjs), which is the MCP call `axhub.pass_grant | pass_update | pass_revoke | pass_status`, sent as the
 * hub's REST twin through the console's hub relay (a wall admin's session, never a token). So voice (AmberX, the wake
 * listener), the action bus, control@1 and the page all send the hub the same thing.
 *
 *   axhub.passes.open[:<id>]                 open the hub's passes, or one pass (`#/passes/<id>`)
 *   axhub.passes.status[:<id>]               say which passes are on: what each covers, time left, runs under it
 *   axhub.passes.grant:<minutes>[:<covers>]  switch a pass on; covers = all (default) or entries: vps,vps.run,scope:tokens.theme
 *   axhub.passes.update:<id|active>:<covers> change what a pass covers
 *   axhub.passes.quiet:<id|active>:<on|off>  one quiet line per covered run, or nothing
 *   axhub.passes.revoke[:<id|active>]        end a pass now
 *   axhub.passes.voice:<phrase>              a spoken pass command ("pass for vps for an hour", "end the pass")
 */
import type { AxfRuntime } from '@console/axf/core';
import { hubGet, hubPost } from '@console/hubPages/api';
import { go } from '@console/hubPages/route';
import { activePassId, passVoiceIntent, passVoiceReply, passVoiceRest, type PassVoiceIntent } from './pass-voice.mjs';

const T = 'axHub passes';

export interface PassRun { ok: boolean; say: string; intent: PassVoiceIntent | null; answer?: unknown }

/** Say a line through the agent voice (when it is on): the voice plugin listens for this event. */
function speak(text: string): void {
  if (typeof window === 'undefined' || !text) return;
  window.dispatchEvent(new CustomEvent('axf:agent-voice.say', { detail: { agentId: 'amber', agentName: 'Amber', text } }));
}

/** Runs one intent against the hub and answers what to say. Never throws. */
export async function runPassIntent(intent: PassVoiceIntent | null, id = ''): Promise<PassRun> {
  if (!intent) return { ok: false, say: "That isn't a pass command I know.", intent };
  try {
    let pass = id && id !== 'active' ? id : '';
    if (intent.needsId && !pass) {
      pass = activePassId((await hubGet<{ active?: unknown[] }>('/auth/api/passes')).active);
      if (!pass) return { ok: false, say: 'No pass is on.', intent };
    }
    const req = passVoiceRest(intent, pass);
    if (!req) return { ok: false, say: 'Say which pass.', intent };
    const answer = req.method === 'GET' ? await hubGet<unknown>(req.path) : await hubPost<unknown>(req.path, req.body ?? {});
    return { ok: true, say: passVoiceReply(intent, answer), intent, answer };
  } catch (e) {
    return { ok: false, say: e instanceof Error ? e.message : String(e), intent };
  }
}

export function registerHubPassActions(rt: AxfRuntime): void {
  const run = (intent: PassVoiceIntent | null, id = '', aloud = false) => {
    void runPassIntent(intent, id).then((r) => {
      rt.toast(r.say, r.ok ? (intent?.tool === 'axhub.pass_status' ? 'info' : 'success') : 'warning', T);
      if (aloud) speak(r.say);
    });
  };
  const reason = (what: string) => ({ title: what, description: `${what}, asked for by voice or an action in the console.` });

  rt.actions.register('axhub.passes.open', ([id = '']) => go(rt, 'passes', id ? { id } : {}), { label: "Open the hub's passes, or one pass", params: true, effect: 'navigate' });
  rt.actions.register('axhub.passes.status', ([id = '']) => run({ tool: 'axhub.pass_status', arguments: id ? { id } : {} }), { label: 'Which hub passes are on, what they cover and the runs under them', params: true, effect: 'read' });
  rt.actions.register('axhub.passes.grant', ([minutes = '', ...covers]) => {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 1) { rt.toast('Say how many minutes, for example axhub.passes.grant:30 or axhub.passes.grant:60:vps.run,axf-console.', 'warning', T); return; }
    run({ tool: 'axhub.pass_grant', arguments: { covers: covers.join(':') || 'all', minutes: n, reason: reason(`Pass for ${n} minutes`) } });
  }, { label: 'Switch a hub pass on (everything, or the tools named)', params: true, effect: 'write' });
  rt.actions.register('axhub.passes.update', ([id = '', ...covers]) => {
    if (!covers.join('')) { rt.toast('Say what it covers, for example axhub.passes.update:active:all or axhub.passes.update:active:vps.run.', 'warning', T); return; }
    run({ tool: 'axhub.pass_update', arguments: { covers: covers.join(':') }, needsId: true }, id);
  }, { label: 'Change what a hub pass covers', params: true, effect: 'write' });
  rt.actions.register('axhub.passes.quiet', ([id = '', want = 'on']) => run({ tool: 'axhub.pass_update', arguments: { quiet_notice: want !== 'off' }, needsId: true }, id), { label: 'A quiet line per run under a hub pass, on or off', params: true, effect: 'write' });
  rt.actions.register('axhub.passes.revoke', ([id = '']) => run({ tool: 'axhub.pass_revoke', arguments: {}, needsId: true }, id), { label: 'End a hub pass now', params: true, effect: 'write' });
  rt.actions.register('axhub.passes.voice', (args) => { run(passVoiceIntent(args.join(':')), '', true); return true; }, { label: 'Voice command for the hub passes (grant, cover, end, status)', params: true, module: 'axhub.passes' });
}
