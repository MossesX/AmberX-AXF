#!/usr/bin/env node
/**
 * Plugin review, step 3: the four plain-English lists per plugin, written into the Plan Studio plan
 * "Plugin review: what to disable" and into _claude/builds/reports/plugin-review.md.
 *
 * Read-only on the codebase. Inputs are deps.json (step 1, plugin-review-deps@1) and reverse.json (step 2,
 * plugin-review-reverse@1) next to this file. For every console plugin it writes four lists:
 *
 *   does       what the plugin is and ships: its description, screens, dialogs, settings tab, banner, context-menu
 *              entries, console actions, API routes, plugin commands (CLI, MCP, voice) and the services it provides
 *   breaks     what stops when it is disabled: everything in "does" goes away, then every other plugin that breaks
 *              hard (required capability, dispatched action), loses a feature (optional or undeclared capability,
 *              event), or goes unheard, the shell and framework paths that name it, and the hard cascade
 *   dependsOn  every plugin it looks up, with how (required, optional, undeclared, action, API route) and
 *              capabilities nothing provides
 *   usedBy     every plugin that uses it, with how
 *
 * Core = step 2's core flag (removal breaks the shell, the framework or another plugin hard; provides a framework
 * contract; 5+ users) plus the plugins Brett named core in the build brief. A core step's text carries the warning.
 *
 * Two renderings of the same facts: the full one goes to plugin-review.md and plan-lists.json; a compact one goes
 * into the plan, because control@1 caps one `set` value at 64 KB (framework/spec/CONTROL.md) and a plan record is
 * streamed to every open Plan Studio. The plan is changed through control@1 (planner.plans set, the command
 * control_set sends; `axf control run` on stdin) in two writes: the steps, then the body. Each step keeps its id,
 * model and done state and gains `lists` {does, breaks, dependsOn, usedBy}, `core`, `coreReasons` and `tier`; the
 * body gets one generated section between markers, replaced on re-run, so Brett's Decisions section is never touched.
 *
 *   node _claude/builds/reports/plugin-review/plan.mjs            writes plugin-review.md and plan-lists.json, prints sizes
 *   node _claude/builds/reports/plugin-review/plan.mjs --apply    also writes the plan through control@1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const deps = JSON.parse(readFileSync(join(here, 'deps.json'), 'utf8'));
const rev = JSON.parse(readFileSync(join(here, 'reverse.json'), 'utf8'));
const apply = process.argv.includes('--apply');

const PLAN_ID = 'plugin-review-what-to-disable-8i0h';
const MARK_START = '<!-- plugin-review:lists start -->';
const MARK_END = '<!-- plugin-review:lists end -->';
const LIMIT = 65536; // control@1: one set value
/** Named core by Brett in the build brief, whatever the dependency map says. */
const BRETT_CORE = ['plugin-manager', 'build-orchestrator', 'approvals-banner', 'hub-sync'];

const byFolder = new Map(deps.plugins.map((p) => [p.folder, p]));
const revBy = new Map(rev.plugins.map((p) => [p.folder, p]));
const nameOf = (f) => byFolder.get(f)?.declared?.name || f;
const uniq = (a) => [...new Set(a.filter(Boolean))];
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
const list = (xs, max = 6) => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`);
const sentence = (s, max) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const first = m ? m[1] : t;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
};
const kind = (p, k) => (p.declared.provides || []).filter((x) => x.startsWith(`${k}:`)).map((x) => x.slice(k.length + 1));
const idOnly = (x) => x.replace(/^[a-z-]+:/, '');
const how = (u) => {
  if (u.kind === 'service') return `${u.target} (${u.via === 'dispatch' ? 'action' : u.via})`;
  if (u.kind === 'action') return `action ${u.target}`;
  if (u.kind === 'event') return `event ${u.target}`;
  if (u.kind === 'route') return `API ${u.target}`;
  return `${u.kind} ${u.target}${u.via ? ` (${u.via})` : ''}`;
};
const grouped = (rows) => {
  const m = new Map();
  for (const x of rows) { if (!m.has(x.plugin)) m.set(x.plugin, []); m.get(x.plugin).push(how(x)); }
  for (const [k, v] of m) m.set(k, uniq(v));
  return m;
};

/* ------------------------------------------------------------------ facts per plugin */

function facts(folder) {
  const p = byFolder.get(folder);
  const r = revBy.get(folder);
  if (!p) return { folder, name: folder, missing: true, core: false, coreReasons: [], tier: 'unknown' };
  const d = p.declared;
  const b = r?.breaks || {};
  const depm = new Map();
  const add = (pl, text) => { if (!depm.has(pl)) depm.set(pl, []); depm.get(pl).push(text); };
  for (const e of p.resolution?.edges || []) {
    if (e.kind === 'service') for (const pr of e.detail?.providers || []) add(pr, `${e.target} (${e.via})`);
    else if (e.kind === 'action') add(e.target, `action ${e.detail?.action}`);
    else if (e.kind === 'route') add(e.target, `API ${e.detail?.route || e.detail?.path || ''}`.trim());
    else if (e.kind === 'event') add(e.target, `event ${e.detail?.event || ''}`.trim());
    else if (e.target) add(e.target, `${e.kind}${e.via ? ` (${e.via})` : ''}`);
  }
  for (const [pl, routes] of Object.entries(p.real.pluginRoutesCalled || {})) if (!depm.has(pl)) add(pl, `API ${list(Array.isArray(routes) ? routes : Object.keys(routes), 3)}`);
  for (const [k, v] of depm) depm.set(k, uniq(v));
  const reasons = [...(r?.coreReasons || [])];
  if (BRETT_CORE.includes(folder)) reasons.push('named core by Brett in the build brief');
  const hard = grouped(b.hard || []);
  return {
    folder, name: d.name || folder, missing: false,
    core: !!r?.core || BRETT_CORE.includes(folder), coreReasons: reasons, tier: r?.tier || 'leaf',
    description: d.description || p.readme?.summary || '',
    views: kind(p, 'view'), dialogs: kind(p, 'dialog'), tabs: kind(p, 'settings-tab'), panels: kind(p, 'settings-panel'), menus: kind(p, 'context-menu'),
    banner: !!d.banner, bannerItems: p.real.banners || [], slots: p.real.slots || [],
    actions: uniq(p.real.actionsRegistered || []), routes: p.real.routeCount || 0, sockets: p.real.websocketRoutes || 0,
    commands: d.commands?.items || [], autoCommands: !!d.commands?.auto,
    services: uniq([...kind(p, 'service').map(idOnly), ...Object.keys(p.real.servicesProvided || {})]),
    events: p.real.eventsEmitted || [], offByDefault: d.enabledByDefault === false,
    hard, degrades: grouped(b.degrades || []), silenced: grouped(b.silenced || []),
    shell: (b.shell || []).map((s) => s.file || s.target || JSON.stringify(s)),
    cascade: (r?.cascade || []).filter((x) => !hard.has(x)),
    deps: depm, unprovided: p.resolution?.unprovidedCaps || [], undeclared: p.resolution?.usedNotDeclared || [], frameworkPython: p.real.frameworkPython || [],
    usedBy: grouped(r?.usedBy || []),
  };
}

const ships = (f, long) => {
  const bits = [];
  if (f.views.length) bits.push(long ? `${n(f.views.length, 'screen', 'screens')} (${list(f.views)})` : n(f.views.length, 'screen', 'screens'));
  if (f.dialogs.length) bits.push(long ? `${n(f.dialogs.length, 'dialog', 'dialogs')} (${list(f.dialogs)})` : n(f.dialogs.length, 'dialog', 'dialogs'));
  if (f.banner) bits.push('a banner strip');
  if (f.tabs.length || f.panels.length) bits.push(long ? `Settings ${list(uniq([...f.tabs.map((t) => `tab ${t}`), ...f.panels.map((t) => `panel ${t}`)]))}` : 'a Settings tab');
  if (f.menus.length) bits.push(long ? `${n(f.menus.length, 'context-menu entry', 'context-menu entries')} (${list(f.menus)})` : n(f.menus.length, 'context-menu entry', 'context-menu entries'));
  if (f.actions.length) bits.push(long ? `${n(f.actions.length, 'console action', 'console actions')} (${list(f.actions, 8)})` : `${n(f.actions.length, 'action', 'actions')} (${list(f.actions, 3)})`);
  if (f.routes) bits.push(`${n(f.routes, 'API route', 'API routes')}${f.sockets ? ` + ${n(f.sockets, 'websocket', 'websockets')}` : ''}`);
  if (f.commands.length) bits.push(long ? `${n(f.commands.length, 'plugin command', 'plugin commands')} for CLI, MCP and voice (${list(f.commands, 8)})` : `${n(f.commands.length, 'command', 'commands')} (CLI, MCP, voice)`);
  return bits;
};

/* ------------------------------------------------------------------ full lists (report) */

function fullLists(f) {
  if (f.missing) return { does: [`No folder apps/console-web/plugins/${f.folder} at the time of the review: already removed, not analysed.`], breaks: ['Nothing to analyse.'], dependsOn: ['Nothing to analyse.'], usedBy: ['Nothing to analyse.'] };
  const does = [sentence(f.description, 260) || `${f.name}: no description in plugin.json or README.`];
  if (f.views.length) does.push(`${n(f.views.length, 'screen', 'screens')}: ${list(f.views)}.`);
  if (f.dialogs.length) does.push(`${n(f.dialogs.length, 'dialog', 'dialogs')}: ${list(f.dialogs)}.`);
  if (f.banner) does.push('A banner strip in the console chrome.');
  if (f.tabs.length || f.panels.length) does.push(`Settings: ${list(uniq([...f.tabs.map((t) => `tab ${t}`), ...f.panels.map((t) => `panel ${t}`)]))}.`);
  if (f.menus.length) does.push(`${n(f.menus.length, 'context-menu entry', 'context-menu entries')}: ${list(f.menus)}.`);
  if (f.actions.length) does.push(`${n(f.actions.length, 'console action', 'console actions')} (MCP console_action, CLI axf console action): ${list(f.actions, 10)}.`);
  if (f.routes) does.push(`${n(f.routes, 'API route', 'API routes')} under /api/plugins/${f.folder}${f.sockets ? ` plus ${n(f.sockets, 'websocket', 'websockets')}` : ''}.`);
  if (f.commands.length) does.push(`${n(f.commands.length, 'plugin command', 'plugin commands')} callable from the CLI, MCP and voice: ${list(f.commands, 10)}.`);
  else if (f.autoCommands) does.push('Plugin commands are generated from its actions and settings (CLI, MCP, voice).');
  if (f.services.length) does.push(`Provides ${n(f.services.length, 'service', 'services')} other plugins can look up: ${list(f.services)}.`);
  if (f.events.length) does.push(`Emits ${n(f.events.length, 'event', 'events')}: ${list(f.events, 4)}.`);
  if (f.bannerItems.length) does.push(`Banner items: ${list(f.bannerItems, 4)}.`);
  if (f.slots.length) does.push(`Fills slots: ${list(f.slots, 4)}.`);
  if (f.offByDefault) does.push('Off by default.');

  const g = ships(f, false);
  const breaks = [g.length ? `Gone from the console: ${list(g, 8)}.` : 'Gone from the console: its background work (no screen of its own).'];
  for (const [pl, hs] of f.hard) breaks.push(`Stops working: ${nameOf(pl)} (${pl}): ${hs.join(', ')}.`);
  for (const [pl, hs] of f.degrades) breaks.push(`Loses a feature: ${nameOf(pl)} (${pl}): ${hs.join(', ')}.`);
  for (const [pl, hs] of f.silenced) breaks.push(`Goes unheard: ${nameOf(pl)} (${pl}): ${hs.join(', ')}.`);
  for (const s of f.shell) breaks.push(`Named by the console shell or framework: ${s}.`);
  if (f.cascade.length) breaks.push(`Cascade: ${list(f.cascade)} break next.`);
  if (!f.hard.size && !f.degrades.size && !f.silenced.size && !f.shell.length) breaks.push('No other plugin, banner or voice command depends on it.');
  if (f.banner || f.bannerItems.length) breaks.push('Its banner items disappear from the console chrome and from the phone.');
  if (f.commands.length) breaks.push('Its voice and CLI commands stop answering (AmberX, MCP, axf).');

  const dependsOn = [...f.deps].map(([pl, hs]) => `${nameOf(pl)} (${pl}): ${hs.join(', ')}.`);
  for (const c of f.unprovided) dependsOn.push(`${c}: no plugin provides it.`);
  for (const c of f.undeclared) if (!dependsOn.some((x) => x.includes(`${c} (undeclared)`))) dependsOn.push(`${c}: used but not declared in plugin.json.`);
  if (f.frameworkPython.length) dependsOn.push(`Framework code: ${list(f.frameworkPython, 4)}.`);
  if (!dependsOn.length) dependsOn.push('No other plugin: it stands alone.');

  const usedBy = [...f.usedBy].map(([pl, hs]) => `${nameOf(pl)} (${pl}): ${hs.join(', ')}.`);
  if (!usedBy.length) usedBy.push('No other plugin uses it.');
  return { does, breaks, dependsOn, usedBy };
}

/* ------------------------------------------------------------------ compact lists (the plan) */

const short = (hs) => hs.map((h) => h.replace(/ \((required|optional|undeclared|action)\)/, (_, v) => ({ required: '*', optional: '?', undeclared: '!', action: '' })[v] ?? '')).join(', ');
function compactLists(f) {
  if (f.missing) return { does: ['No plugin folder: already removed.'], breaks: ['Nothing to analyse.'], dependsOn: [], usedBy: [] };
  const does = [sentence(f.description, 150) || `${f.name}.`];
  const g = ships(f, true);
  if (g.length) does.push(`Ships ${g.join('; ')}.`);
  else if (f.autoCommands) does.push('Background only; commands generated from its settings.');
  if (f.services.length) does.push(`Provides ${list(f.services)}.`);
  if (f.events.length) does.push(`Emits ${list(f.events, 3)}.`);
  if (f.bannerItems.length) does.push(`Banner items ${list(f.bannerItems, 3)}.`);
  if (f.offByDefault) does.push('Off by default.');
  const breaks = [ships(f, false).length ? `Gone: ${ships(f, false).join(', ')}.` : 'Gone: its background work.'];
  if (f.hard.size) breaks.push(`Stops: ${[...f.hard].map(([pl, hs]) => `${pl} (${short(hs)})`).join('; ')}.`);
  if (f.degrades.size) breaks.push(`Degrades: ${[...f.degrades].map(([pl, hs]) => `${pl} (${short(hs)})`).join('; ')}.`);
  if (f.silenced.size) breaks.push(`Unheard: ${[...f.silenced].map(([pl, hs]) => `${pl} (${short(hs)})`).join('; ')}.`);
  if (f.shell.length) breaks.push(`Named by shell/framework: ${list(f.shell, 3)}.`);
  if (f.cascade.length) breaks.push(`Cascade: ${list(f.cascade)}.`);
  if (!f.hard.size && !f.degrades.size && !f.silenced.size && !f.shell.length) breaks.push('Nothing else depends on it.');
  if (f.commands.length) breaks.push('Its voice/CLI/MCP commands stop.');
  const dependsOn = [...f.deps].map(([pl, hs]) => `${pl}: ${short(hs)}`);
  for (const c of f.unprovided) dependsOn.push(`${c}: no provider`);
  if (!dependsOn.length) dependsOn.push('Nothing: stands alone.');
  const usedBy = [...f.usedBy].map(([pl, hs]) => `${pl}: ${short(hs)}`);
  if (!usedBy.length) usedBy.push('No other plugin.');
  return { does, breaks, dependsOn, usedBy };
}

/* ------------------------------------------------------------------ the plan */

const axf = (...args) => JSON.parse(execFileSync('node', [join(root, 'framework/cli/axf.mjs'), ...args, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const control = (command) => JSON.parse(execFileSync('node', [join(root, 'framework/cli/axf.mjs'), 'control', 'run'], { cwd: root, encoding: 'utf8', input: JSON.stringify({ command }), maxBuffer: 64 * 1024 * 1024 }));
const plan = axf('plan', 'get', PLAN_ID).item;
const folders = plan.steps.map((s) => String(s.text).split(/\s/)[0]);
const records = folders.map((f) => { const x = facts(f); return { ...x, lists: fullLists(x), compact: compactLists(x) }; });
const unplanned = deps.plugins.map((p) => p.folder).filter((f) => !folders.includes(f));
const coreList = records.filter((r) => r.core).map((r) => r.folder);

const stepText = (rec) => (rec.missing ? `${rec.folder} (no plugin folder: already removed)` : rec.core ? `${rec.folder} ⚠ core: never disable (${rec.coreReasons.join('; ')})` : rec.folder);
const steps = plan.steps.map((s, i) => ({ ...s, text: stepText(records[i]), lists: records[i].compact, core: records[i].core, coreReasons: records[i].coreReasons, tier: records[i].tier }));

const compactMd = (rec) => [
  `### ${rec.folder}${rec.core ? ` ⚠ core: never disable (${rec.coreReasons.join('; ')})` : ''}`,
  `- **Does:** ${rec.compact.does.join(' ')}`,
  `- **Breaks if disabled:** ${rec.compact.breaks.join(' ')}`,
  `- **Depends on:** ${rec.compact.dependsOn.join('; ')}`,
  `- **Used by:** ${rec.compact.usedBy.join('; ')}`,
  '',
].join('\n');
const section = [
  MARK_START,
  '## Plugin lists (generated)',
  '',
  `From the dependency map of ${new Date().toISOString().slice(0, 10)} (_claude/builds/reports/plugin-review/: deps.json, reverse.json). Full lists: _claude/builds/reports/plugin-review.md. Marks: * required · ? optional · ! undeclared in plugin.json. Re-run plan.mjs --apply to refresh; the Decisions section above is Brett's and is left alone.`,
  '',
  `Core (never disable): ${coreList.join(', ')}.`,
  unplanned.length ? `Plugins with no step in this plan: ${unplanned.join(', ')}.` : '',
  '',
  ...records.map(compactMd),
  MARK_END,
].filter((x) => x !== null).join('\n');
const oldBody = String(plan.body || '');
const si = oldBody.indexOf(MARK_START); const ei = oldBody.indexOf(MARK_END);
const body = si >= 0 && ei > si ? `${oldBody.slice(0, si)}${section}${oldBody.slice(ei + MARK_END.length)}` : `${oldBody.trimEnd()}\n\n${section}\n`;

/* ------------------------------------------------------------------ the report */

const fullMd = (rec) => [
  `### ${rec.folder}${rec.core ? ' ⚠ core: never disable' : ''}`,
  ...(rec.core ? [`> Core because: ${rec.coreReasons.join('; ')}.`] : []),
  '', '**What it does**', ...rec.lists.does.map((x) => `- ${x}`),
  '', '**What breaks if disabled**', ...rec.lists.breaks.map((x) => `- ${x}`),
  '', '**Depends on**', ...rec.lists.dependsOn.map((x) => `- ${x}`),
  '', '**Used by**', ...rec.lists.usedBy.map((x) => `- ${x}`),
  '',
].join('\n');
const cell = (xs) => xs.map((x) => x.replace(/\|/g, '\\|')).join('<br>');
const report = [
  '# Plugin review: what each plugin does, depends on, and breaks',
  '',
  `Generated ${new Date().toISOString()} by _claude/builds/reports/plugin-review/plan.mjs from deps.json (step 1) and reverse.json (step 2). ${records.filter((r) => !r.missing).length} console plugins. The same four lists, in compact form, sit on every step of the Plan Studio plan "Plugin review: what to disable" (${PLAN_ID}) and in its body.`,
  '',
  'Read-only analysis: nothing is disabled here. Brett decides keep or disable per plugin in the plan.',
  '',
  'Severity: **stops working** = a required capability or a dispatched action; **loses a feature** = optional or undeclared capability, or an event; **goes unheard** = an event this plugin listens for. Undeclared lookups are a manifest gap: the Plugin Manager cannot warn before removal (REVERSE.md lists the fixes).',
  '',
  '## Core plugins: never disable',
  '',
  '| Plugin | Why |',
  '|---|---|',
  ...records.filter((r) => r.core).map((r) => `| ${r.folder} | ${r.coreReasons.join('; ')} |`),
  '',
  '## The table',
  '',
  '| Plugin | Tier | What it does | What breaks if disabled | Depends on | Used by |',
  '|---|---|---|---|---|---|',
  ...records.map((r) => `| **${r.folder}**${r.core ? ' ⚠ core' : ''} | ${r.tier} | ${cell(r.lists.does)} | ${cell(r.lists.breaks)} | ${cell(r.lists.dependsOn)} | ${cell(r.lists.usedBy)} |`),
  '',
  '## Per plugin',
  '',
  ...records.map(fullMd),
  unplanned.length ? `## Not in the plan\n\n${unplanned.join(', ')}\n` : '',
].join('\n');

writeFileSync(join(here, '..', 'plugin-review.md'), report);
writeFileSync(join(here, 'plan-lists.json'), `${JSON.stringify({ $axf: 'plugin-review-lists@1', generatedAt: new Date().toISOString(), plan: PLAN_ID, count: records.length, core: coreList, unplanned, plugins: records.map(({ compact, ...r }) => ({ folder: r.folder, name: r.name, missing: r.missing, core: r.core, coreReasons: r.coreReasons, tier: r.tier, lists: r.lists, compact })) }, null, 1)}\n`);

const stepsBytes = Buffer.byteLength(JSON.stringify({ steps }));
const bodyBytes = Buffer.byteLength(JSON.stringify({ body }));
console.log(`${records.length} steps · core ${coreList.length}: ${coreList.join(', ')}`);
if (records.some((r) => r.missing)) console.log(`steps with no plugin folder: ${records.filter((r) => r.missing).map((r) => r.folder).join(', ')}`);
if (unplanned.length) console.log(`plugins with no step: ${unplanned.join(', ')}`);
console.log(`set payloads: steps ${stepsBytes} B, body ${bodyBytes} B (limit ${LIMIT}) · body ${oldBody.length} → ${body.length} chars · longest step text ${Math.max(...steps.map((s) => s.text.length))}`);
if (stepsBytes > LIMIT || bodyBytes > LIMIT) { console.error('a payload is over the control@1 limit: shorten the compact lists'); process.exit(1); }

if (apply) {
  const reason = 'Plugin review step 3: the four lists (does, breaks, depends on, used by) on every plugin step and in the body';
  for (const [what, value] of [['steps', { steps }], ['body', { body }]]) {
    const r = control({ op: 'set', target: 'planner.plans', path: PLAN_ID, value, by: 'plugin-review build', reason: `${reason} (${what})` });
    console.log(r.ok ? `plan ${PLAN_ID} ${what} written: version ${r.item?.version}, ${r.item?.steps?.length} steps, changed ${r.changed}` : `plan ${what} write failed: ${JSON.stringify(r).slice(0, 400)}`);
    if (!r.ok) process.exit(1);
  }
} else {
  console.log('dry run: pass --apply to write the plan through control@1');
}
