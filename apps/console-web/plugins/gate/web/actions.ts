/**
 * The gate plugin's console actions: what voice (AmberX, the wake listener), the action bus, control@1 and
 * plugin-commands run in the open console. Each calls the same REST route as the page, the CLI and MCP.
 *   gate.open[:tab]              open Builds → Gate & rules (tab rules | auto-lander | history)
 *   gate.rule:<id>[:on|off]      switch one gate rule (no on/off = flip it)
 *   lander.land-now:<pr>         land a PR next (destructive: the console confirms first)
 *   lander.pause[:why] · lander.resume
 *   gate.build-rules.open[:id]            open the Build rules tab (and one rule's History)
 *   gate.build-rules.list[:vps|session]   say how many build rules there are and who does them
 *   gate.build-rules.toggle:<id>[:on|off] switch one build rule (no on/off = flip it)
 *   gate.build-rules.who:<id>             say who does a rule (the VPS or the session) and when
 *   gate.build-rules.add:<id>:<title>     add a session rule (judgement, dispatch, Rules block); edit it in the tab
 *   gate.build-rules.run:<build>:<phase>  run a phase's rules for a build now (before | after | gate)
 */
import type { AxfRuntime } from '@console/axf/core';
import { confirmed, gateCall, isTab, showTab, type BuildRule, type BuildRuleList, type GateRule, type LanderStatus } from './api';
import { showBuildRule } from './buildRulesState';

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

  // ---------------------------------------------------------------- build rules (build-rules@1): the same REST as MCP and the CLI
  const BR = 'Build rules';
  rt.actions.register('gate.build-rules.open', ([id = '']) => { rt.navigate('gate'); showTab('build-rules'); if (id) showBuildRule(id, 'history'); }, { label: 'Open the build rules', params: true, effect: 'navigate' });
  rt.actions.register('gate.build-rules.list', ([doer = '']) => {
    void gateCall<BuildRuleList>(`build-rules${doer === 'vps' || doer === 'session' ? `?doer=${doer}` : ''}`).then((r) => rt.toast(`${r.counts.total} build rules: ${r.counts.vps} done by the VPS, ${r.counts.session} by the session, ${r.counts.on} on.`, 'info', BR), fail(rt));
  }, { label: 'How many build rules, and who does them', params: true, effect: 'read' });
  rt.actions.register('gate.build-rules.toggle', ([id = '', want = '']) => {
    if (!id) { rt.toast('Say which rule, for example gate.build-rules.toggle:home-card:off.', 'warning', BR); return; }
    void gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}/toggle`, 'POST', { ...(want === 'on' || want === 'off' ? { enabled: want === 'on' } : {}), by: 'voice' })
      .then((r) => rt.toast(`${r.rule.title || r.rule.id} is ${r.rule.enabled ? 'on' : 'off'}.`, 'success', BR), fail(rt));
  }, { label: 'Switch a build rule on or off', params: true, effect: 'write' });
  rt.actions.register('gate.build-rules.who', ([id = '']) => {
    if (!id) { rt.toast('Say which rule, for example gate.build-rules.who:ui-review-submit.', 'warning', BR); return; }
    void gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}`).then((r) => rt.toast(`${r.rule.title}: ${r.rule.doer === 'vps' ? 'the VPS does it' : 'the build session does it'}, ${r.rule.phase}${r.rule.enabled ? '' : ' (off)'}.`, 'info', BR), fail(rt));
  }, { label: 'Who does a build rule', params: true, effect: 'read' });
  rt.actions.register('gate.build-rules.add', ([id = '', ...words]) => {
    const title = words.join(':').trim();
    if (!id || !title) { rt.toast('Say an id and the rule, for example gate.build-rules.add:short-prs:Keep PRs small.', 'warning', BR); return; }
    void gateCall<{ rule: BuildRule }>('build-rules', 'POST', { rule: { id, title, text: title, doer: 'session', kind: 'judgement', phase: 'dispatch', briefBlock: 'rules' }, by: 'voice' })
      .then((r) => { rt.toast(`Added ${r.rule.id}. Edit it in Build rules.`, 'success', BR); rt.navigate('gate'); showTab('build-rules'); showBuildRule(r.rule.id, 'edit'); }, fail(rt));
  }, { label: 'Add a build rule', params: true, effect: 'write' });
  rt.actions.register('gate.build-rules.run', ([build = '', phase = 'after']) => {
    if (!build) { rt.toast('Say which build, for example gate.build-rules.run:my-build:after.', 'warning', BR); return; }
    void gateCall<{ pass: boolean; counts: Record<string, number> }>('build-rules/run', 'POST', { build, phase, by: 'voice' })
      .then((r) => rt.toast(`${build} ${phase}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`, r.pass ? 'success' : 'warning', BR), fail(rt));
  }, { label: 'Run the build rules for a build', params: true, effect: 'write' });
}
