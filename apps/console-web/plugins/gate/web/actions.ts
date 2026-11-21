/**
 * The gate plugin's console actions: what voice (AmberX, the wake listener), the action bus, control@1 and
 * plugin-commands run in the open console. Each calls the same REST route as the page, the CLI and MCP, and says what
 * the server answered: no action decides anything itself.
 *   gate.open[:tab]              open Builds → Gate & rules (tab overview | rules | build-rules | line | auto-lander | limits | triage | history)
 *   gate.rule:<id>[:on|off]      switch one gate rule (no on/off = flip it)
 *   lander.land-now:<pr>         land a PR next (destructive: the console confirms first)
 *   lander.pause[:why] · lander.resume
 *   gate.build-rules.open[:id]            open the Build rules tab (and one rule's History)
 *   gate.build-rules.list[:vps|session]   say how many build rules there are and who does them
 *   gate.build-rules.toggle:<id>[:on|off] switch one build rule (no on/off = flip it)
 *   gate.build-rules.who:<id>             say who does a rule (the VPS or the session) and when
 *   gate.build-rules.add:<id>:<title>     add a rule (the server fills in a session rule's defaults); edit it in the tab
 *   gate.build-rules.run:<build>:<phase>  run a phase's rules for a build now (before | after | gate)
 *   gate.auto-lander.status                 say what the server auto-lander is doing (auto-lander@1)
 *   gate.auto-lander.open[:build]           open Gate → Auto-lander (and one build's attempt log)
 *   gate.auto-lander.run                    ask the service for a tick now
 *   gate.auto-lander.retry:<build> · gate.auto-lander.fix:<build>   reset a build (fix = and start a fix session)
 *   gate.auto-lander.pause · gate.auto-lander.resume
 *   gate.auto-lander.set:<key>:<value>      one setting (enabled, sizeCapLines, flakyReruns, backoffBaseMin, …, notifyAfterAttempts)
 */
import type { AxfRuntime } from '@console/axf/core';
import { confirmed, gateCall, isTab, showTab, type BuildRule, type BuildRuleList, type GateRule, type LanderStatus } from './api';
import { showBuildRule } from './buildRulesState';
import { autoLanderPath, showAutoLanderBuild, type AutoLanderStatus } from './autoLanderState';

const fail = (rt: AxfRuntime) => (e: Error) => rt.toast(e.message, 'danger', 'Gate & rules');

export function registerGateActions(rt: AxfRuntime): void {
  rt.actions.register('gate.open', ([tab]) => { rt.navigate('gate'); if (isTab(tab)) showTab(tab); }, { label: 'Open Gate & rules', effect: 'navigate' });
  rt.actions.register('gate.rule', ([id = '', want = '']) => {
    if (!id) { rt.toast('Say which rule, for example gate.rule:ui-review:off.', 'warning', 'Gate & rules'); return; }
    void gateCall<{ rule: GateRule }>(`rules/${encodeURIComponent(id)}/toggle`, 'POST', { ...(want ? { enabled: want } : {}), by: 'voice' })
      .then((r) => rt.toast(`${r.rule.title || r.rule.id} is ${r.rule.enabled ? 'on' : 'off'}.`, 'success', 'Gate & rules'), fail(rt));
  }, { label: 'Switch a gate rule on or off', params: true, effect: 'write' });
  rt.actions.register('lander.land-now', ([pr = '']) => {
    if (!pr) { rt.toast('Say which PR, for example lander.land-now:705.', 'warning', 'Auto-lander'); return; }
    void confirmed<{ pr: number; via: string }>('lander/land-now', { pr, by: 'voice' }).then((r) => rt.toast(`#${r.pr} lands next (${r.via}).`, 'success', 'Auto-lander'), fail(rt));
  }, { label: 'Land a PR next', params: true, effect: 'destructive' });
  rt.actions.register('lander.pause', (args) => {
    void gateCall<LanderStatus>('lander/pause', 'POST', { why: args.join(':'), by: 'voice' }).then(() => rt.toast('The auto-lander is paused.', 'success', 'Auto-lander'), fail(rt));
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
    void gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}/toggle`, 'POST', { ...(want ? { enabled: want } : {}), by: 'voice' })
      .then((r) => rt.toast(`${r.rule.title || r.rule.id} is ${r.rule.enabled ? 'on' : 'off'}.`, 'success', BR), fail(rt));
  }, { label: 'Switch a build rule on or off', params: true, effect: 'write' });
  rt.actions.register('gate.build-rules.who', ([id = '']) => {
    if (!id) { rt.toast('Say which rule, for example gate.build-rules.who:ui-review-submit.', 'warning', BR); return; }
    void gateCall<{ rule: BuildRule }>(`build-rules/${encodeURIComponent(id)}`).then((r) => rt.toast(`${r.rule.title}: ${r.rule.doer === 'vps' ? 'the VPS does it' : 'the build session does it'}, ${r.rule.phase}${r.rule.enabled ? '' : ' (off)'}.`, 'info', BR), fail(rt));
  }, { label: 'Who does a build rule', params: true, effect: 'read' });
  rt.actions.register('gate.build-rules.add', ([id = '', ...words]) => {
    const title = words.join(':').trim();
    if (!id || !title) { rt.toast('Say an id and the rule, for example gate.build-rules.add:short-prs:Keep PRs small.', 'warning', BR); return; }
    void gateCall<{ rule: BuildRule }>('build-rules', 'POST', { rule: { id, title, text: title }, by: 'voice' })
      .then((r) => { rt.toast(`Added ${r.rule.id}. Edit it in Build rules.`, 'success', BR); rt.navigate('gate'); showTab('build-rules'); showBuildRule(r.rule.id, 'edit'); }, fail(rt));
  }, { label: 'Add a build rule', params: true, effect: 'write' });
  rt.actions.register('gate.build-rules.run', ([build = '', phase = 'after']) => {
    if (!build) { rt.toast('Say which build, for example gate.build-rules.run:my-build:after.', 'warning', BR); return; }
    void gateCall<{ pass: boolean; counts: Record<string, number> }>('build-rules/run', 'POST', { build, phase, by: 'voice' })
      .then((r) => rt.toast(`${build} ${phase}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`, r.pass ? 'success' : 'warning', BR), fail(rt));
  }, { label: 'Run the build rules for a build', params: true, effect: 'write' });

  // ---------------------------------------------------------------- the server auto-lander (auto-lander@1): the same REST as MCP and the CLI
  const AL = 'Auto-lander';
  rt.actions.register('gate.auto-lander.status', () => {
    void gateCall<AutoLanderStatus>(autoLanderPath()).then((s) => {
      const failing = s.failing.length ? ` ${s.failing.length} failing (it retries by itself): ${s.failing.map((f) => `${f.build}, attempt ${f.attempt}`).join('; ')}.` : '';
      rt.toast(`The lander is ${s.service.state ?? 'unknown'}${s.current ? `, landing ${s.current}` : ''}; ${s.builds.length} waiting to land.${failing}`, s.failing.length || s.service.state !== 'up' ? 'warning' : 'info', AL);
    }, fail(rt));
  }, { label: 'What the lander is doing', effect: 'read' });
  rt.actions.register('gate.auto-lander.open', ([build = '']) => { rt.navigate('gate'); showTab('auto-lander'); if (build) showAutoLanderBuild(build); }, { label: 'Open the server auto-lander', params: true, effect: 'navigate' });
  rt.actions.register('gate.auto-lander.run', () => {
    void gateCall(autoLanderPath('run'), 'POST', { by: 'voice' }).then(() => rt.toast('The auto-lander runs within a minute.', 'success', AL), fail(rt));
  }, { label: 'Run the server auto-lander now', effect: 'write' });
  for (const [verb, label, done] of [['retry', 'Retry a build in the auto-lander', 'tries again'], ['fix', 'Fix a build now (auto-lander)', 'gets a fix session within a minute']] as const) {
    rt.actions.register(`gate.auto-lander.${verb}`, ([build = '']) => {
      if (!build) { rt.toast(`Say which build, for example gate.auto-lander.${verb}:my-build.`, 'warning', AL); return; }
      void gateCall(autoLanderPath(`${verb}/${encodeURIComponent(build)}`), 'POST', { by: 'voice' }).then(() => rt.toast(`${build} ${done}.`, 'success', AL), fail(rt));
    }, { label, params: true, effect: 'write' });
  }
  rt.actions.register('gate.auto-lander.pause', () => {
    void gateCall(autoLanderPath('pause'), 'POST', { by: 'voice' }).then(() => rt.toast('The server auto-lander is paused.', 'success', AL), fail(rt));
  }, { label: 'Pause the server auto-lander', effect: 'write' });
  rt.actions.register('gate.auto-lander.resume', () => {
    void gateCall(autoLanderPath('resume'), 'POST', { by: 'voice' }).then(() => rt.toast('The server auto-lander is back on.', 'success', AL), fail(rt));
  }, { label: 'Resume the server auto-lander', effect: 'write' });
  rt.actions.register('gate.auto-lander.set', ([key = '', value = '']) => {
    if (!key || !value) { rt.toast('Say a setting and a value, for example gate.auto-lander.set:sizeCapLines:3000.', 'warning', AL); return; }
    void gateCall<{ settings: Record<string, unknown> }>(autoLanderPath('settings'), 'POST', { key, value, by: 'voice' }).then((r) => rt.toast(`${key} is ${String(r.settings[key])}.`, 'success', AL), fail(rt));
  }, { label: 'Change a server auto-lander setting', params: true, effect: 'write' });
}
