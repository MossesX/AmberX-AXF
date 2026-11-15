/**
 * The gate plugin's console actions: what voice (AmberX, the wake listener), the action bus, control@1 and
 * plugin-commands run in the open console. Each calls the same REST route as the page, the CLI and MCP.
 *   gate.open[:tab]              open Builds → Gate & rules (tab rules | auto-lander | history)
 *   gate.rule:<id>[:on|off]      switch one gate rule (no on/off = flip it)
 *   lander.land-now:<pr>         land a PR next (destructive: the console confirms first)
 *   lander.pause[:why] · lander.resume
 */
import type { AxfRuntime } from '@console/axf/core';
import { confirmed, gateCall, isTab, showTab, type GateRule, type LanderStatus } from './api';

const fail = (rt: AxfRuntime) => (e: Error) => rt.toast(e.message, 'danger', 'Gate & rules');

export function registerGateActions(rt: AxfRuntime): void {
  rt.actions.register('gate.open', ([tab]) => { rt.navigate('gate'); if (isTab(tab)) showTab(tab); }, { label: 'Open Gate & rules', effect: 'navigate' });
  rt.actions.register('gate.rule', ([id = '', want = '']) => {
    if (!id) { rt.toast('Say which rule, for example gate.rule:ui-review:off.', 'warning', 'Gate & rules'); return; }
    void gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}`).then((cur) => {
      const enabled = want === 'on' ? true : want === 'off' ? false : !cur.rule.enabled;
      return gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}/toggle`, 'POST', { enabled, by: 'voice' });
    }).then((r) => rt.toast(`${r.rule.title || r.rule.id} is ${r.rule.enabled ? 'on' : 'off'}.`, 'success', 'Gate & rules'), fail(rt));
  }, { label: 'Switch a gate rule on or off', params: true, effect: 'write' });
  rt.actions.register('lander.land-now', ([pr = '']) => {
    if (!pr) { rt.toast('Say which PR, for example lander.land-now:705.', 'warning', 'Auto-lander'); return; }
    void confirmed<{ pr: number; via: string }>('lander/land-now', { pr, by: 'voice' }).then((r) => rt.toast(`#${r.pr} lands next (${r.via}).`, 'success', 'Auto-lander'), fail(rt));
  }, { label: 'Land a PR next', params: true, effect: 'destructive' });
  rt.actions.register('lander.pause', (args) => {
    void gateCall<LanderStatus>('lander/pause', 'POST', { why: args.join(':') || 'paused from the console', by: 'voice' }).then(() => rt.toast('The auto-lander is paused.', 'success', 'Auto-lander'), fail(rt));
  }, { label: 'Pause the auto-lander', effect: 'write' });
  rt.actions.register('lander.resume', () => {
    void gateCall<LanderStatus>('lander/resume', 'POST', { by: 'voice' }).then((r) => rt.toast(`The auto-lander is back on (${r.mergeQueue ? 'merge queue' : 'one at a time'}).`, 'success', 'Auto-lander'), fail(rt));
  }, { label: 'Resume the auto-lander', effect: 'write' });
}
