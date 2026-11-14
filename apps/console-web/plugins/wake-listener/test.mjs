#!/usr/bin/env node
/**
 * Self-test for the Wake listener core, store and CLI (wake-listener@1): settings normalised and patched, wake phrases
 * matched (lead-in words, longest phrase, word boundary), the state machine (idle → awake → command, wizard has the
 * floor, the switch), the banner light, the store's JSON and the CLI's answers.
 *
 *   node apps/console-web/plugins/wake-listener/test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'axf-wake-listener-'));
process.env.AXF_WAKE_LISTENER_DATA_DIR = dataDir;
const core = await import('./core.mjs');
const store = await import('./listener.mjs');
const { normalizeSettings, normalizePhrases, applyPatch, matchWake, isBareWake, pickEngine, initialState, hear, sleep, wizardOn, wizardOff, switched, light, stateLine, DEFAULT_PHRASES } = core;

let n = 0; let failed = 0;
const ok = (c, what) => { n++; if (!c) { failed++; console.log(`FAIL ${what}`); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

/* settings */
const d = normalizeSettings(null);
ok(d.on === true && d.phrases.join('|') === DEFAULT_PHRASES.join('|') && d.engine === 'auto' && d.awakeSec === 8 && d.indicator === 'always', 'defaults');
ok(normalizeSettings({ on: 'false', awakeSec: 500, engine: 'bogus', phrases: 'Hey Console, AMBER!, , hey console' }).awakeSec === 60, 'awakeSec clamped');
ok(normalizeSettings({ on: 'false' }).on === false, 'on from a string');
ok(normalizeSettings({ engine: 'bogus' }).engine === 'auto', 'unknown engine → auto');
ok(normalizePhrases('Hey Console, AMBER!, , hey console').join('|') === 'hey console|amber', 'phrases cleaned and deduped');
ok(normalizePhrases(Array.from({ length: 30 }, (_, i) => `p${i}`)).length === 12, 'at most 12 phrases');
ok(normalizeSettings({ phrases: [] }).phrases.length === 2, 'no phrases → the defaults (never none)');
const patched = applyPatch(d, { addPhrase: 'Gizmo', speak: false });
ok(patched.phrases.includes('gizmo') && patched.speak === false, 'applyPatch adds a phrase and sets a flag');
ok(applyPatch(patched, { removePhrase: 'gizmo' }).phrases.length === 2, 'removePhrase');
ok(throwsCode(() => applyPatch(d, { bogus: 1 }), 'invalid'), 'unknown key → invalid');

/* wake phrase */
ok(matchWake('Hey Console, approve', ['hey console']).rest === 'approve', 'lead-in + phrase + command');
ok(matchWake('ok amber', ['amber']).rest === '' && isBareWake('ok amber', ['amber']), 'bare wake');
ok(matchWake('amberly open builds', ['amber']) === null, 'word boundary: amberly is not amber');
ok(matchWake('hey console app open settings', ['hey console', 'hey console app']).wake === 'hey console app', 'longest phrase wins');
ok(matchWake('open builds', ['amber']) === null, 'no phrase → null');
ok(pickEngine('auto', { native: true, webspeech: true }) === 'native' && pickEngine('auto', { webspeech: true }) === 'webspeech' && pickEngine('off', { native: true }) === 'none' && pickEngine('native', {}) === 'none', 'pickEngine');

/* state machine */
const s = normalizeSettings({ phrases: ['amber'], awakeSec: 5 });
let st = initialState(s, 1000);
ok(st.phase === 'idle' && st.on, 'initial idle');
let r = hear(st, s, 'open builds', 1000);
ok(r.event === 'ignored' && r.state.lastHeard === 'open builds', 'asleep: ignored but logged');
r = hear(r.state, s, 'amber', 2000);
ok(r.event === 'wake' && r.state.phase === 'awake' && r.state.awakeUntil === 7000 && r.state.lastWake === 'amber', 'wake → awake for awakeSec');
r = hear(r.state, s, 'approve', 3000);
ok(r.event === 'command' && r.command === 'approve' && r.state.phase === 'idle', 'command inside the window, back to idle');
r = hear(initialState(s, 0), s, 'Amber, approve all pending', 10);
ok(r.event === 'command' && r.command === 'approve all pending', 'phrase + command in one breath');
let late = hear(initialState(s, 0), s, 'amber', 0).state;
ok(sleep(late, 6000).phase === 'idle' && sleep(late, 3000).phase === 'awake', 'sleep after the window');
ok(hear(late, s, 'open builds', 9000).event === 'ignored', 'too late: ignored');
const w = wizardOn(initialState(s, 0));
ok(w.phase === 'wizard' && hear(w, s, 'Gizmo Johnson', 1).event === 'wizard' && hear(w, s, 'Gizmo Johnson', 1).command === 'gizmo johnson', 'wizard has the floor, no wake word needed');
ok(hear(w, s, 'amber yes', 1).command === 'yes', 'wake phrase in front of an answer is fine');
ok(wizardOff(w).phase === 'idle' && wizardOn(switched(w, false)).phase === 'off', 'wizardOff / off stays off');
const off = switched(initialState(s, 0), false);
ok(off.phase === 'off' && !off.on && hear(off, s, 'amber', 1).event === 'ignored' && switched(off, true).phase === 'idle', 'the switch');

/* light + line */
ok(light(off).label === 'Mic off' && !light(off).lit, 'light off');
ok(light({ ...initialState(s), listening: true }).tone === 'success' && light({ ...w, listening: true }).tone === 'accent' && light({ ...late, listening: true }).tone === 'warning' && light({ ...initialState(s), listening: true, error: 'x' }).tone === 'danger', 'light tones');
ok(stateLine(off, s).startsWith('Wake listener off'), 'stateLine off');

/* store */
const s1 = store.readSettings();
ok(s1.on && s1.phrases.length === 2 && s1.updatedAt === '', 'store defaults before a write');
const s2 = store.writeSettings({ addPhrase: 'hey gizmo', on: false }, 'test');
ok(s2.phrases.includes('hey gizmo') && !s2.on && s2.updatedBy === 'test' && store.readSettings().updatedBy === 'test', 'writeSettings persists');
const st1 = store.readState(Date.now());
ok(st1.phase === 'off' && !st1.fresh && st1.line.startsWith('Wake listener off'), 'state follows the switch when nothing reported');
store.writeSettings({ on: true });
store.writeState({ phase: 'idle', engine: 'webspeech', listening: true, micOpen: true, lastHeard: 'amber' });
const st2 = store.readState(Date.now());
ok(st2.fresh && st2.listening && st2.engine === 'webspeech' && st2.lastHeard === 'amber', 'reported state read back fresh');
ok(!store.readState(Date.now() + 10 * 60_000).listening, 'stale report: not listening');

/* CLI */
const cli = (...a) => JSON.parse(execFileSync('node', [new URL('./listener.mjs', import.meta.url).pathname, ...a, '--json'], { env: process.env, encoding: 'utf8' }).trim().split('\n').pop());
ok(cli('settings').settings.phrases.includes('hey gizmo'), 'cli settings');
ok(cli('phrases', 'add', 'hey', 'console', 'app').phrases.includes('hey console app'), 'cli phrases add');
ok(cli('off').on === false && cli('on').on === true, 'cli on/off');
ok(cli('set', 'awakeSec=12', 'speak=false').settings.awakeSec === 12 && cli('settings').settings.speak === false, 'cli set');
ok(cli('hear', 'hey', 'gizmo', 'approve').event === 'command' && cli('hear', 'hey gizmo approve').command === 'approve', 'cli hear dry run');
ok(cli('state').state.phase !== undefined, 'cli state');

/* ------------------------------------------------------------------ the catalog (s2) */
const cat = await import('./catalog.mjs');
const { registry } = await import('../../../../framework/cli/plugin-commands.mjs');
const { CONTROL_TARGETS } = await import('../../../../framework/core/engines/control-rules.mjs');
const { parseDuration, buildCatalog, matchCommand, startWizard, answerWizard, requestFor, summaryOf, entriesFromActions, searchCatalog, speakResult, fillTemplate, slug, titleCase } = cat;

ok(parseDuration('two hours') === 120 && parseDuration('90 minutes') === 90 && parseDuration('an hour and a half') === 90 && parseDuration('1h 30m') === 90 && parseDuration('half an hour') === 30 && parseDuration('soon') === null, 'parseDuration');
ok(slug('Gizmo Johnson') === 'gizmo-johnson' && titleCase('gizmo johnson') === 'Gizmo Johnson', 'slug / titleCase');
ok(JSON.stringify(fillTemplate({ a: '{title:name}', b: '{slug:name}', c: '{kind|app}', d: '{minutes:duration}' }, { name: 'gizmo johnson', duration: 'two hours' })) === JSON.stringify({ a: 'Gizmo Johnson', b: 'gizmo-johnson', c: 'app', d: 120 }), 'fillTemplate transforms and defaults');

const reg = registry({ apps: ['console-web'] });
const catalog = buildCatalog({ registry: reg, targets: CONTROL_TARGETS, actions: [{ id: 'plan-studio.open', meta: { label: 'Plan Studio', effect: 'navigate' } }, { id: 'x.params', meta: { label: 'Needs args', params: true } }] });
ok(catalog.entries.length > 200, `catalog has every plugin command (${catalog.entries.length})`);
ok(catalog.entries.some((e) => e.id === 'project-wizard/run' && e.source === 'phrasebook' && e.say[0] === 'create a new project named {name}'), 'project wizard entry from the phrasebook');
ok(catalog.entries.some((e) => e.id === 'build-orchestrator/pipeline-split') && catalog.entries.some((e) => e.id === 'build-orchestrator/priority-set') && catalog.entries.some((e) => e.id === 'build-orchestrator/pipeline-request'), 'pipeline entries');
ok(catalog.entries.some((e) => e.id === 'control:pass.scopes') && catalog.entries.some((e) => e.id === 'control:planner.builds:list') && catalog.entries.some((e) => e.id === 'control:amberx.items:note'), 'control@1 entries: phrasebook + list reads');
ok(catalog.entries.some((e) => e.id === 'action:plan-studio.open' && e.group === 'navigation') && !catalog.entries.some((e) => e.id === 'action:x.params'), 'page actions: argument-free only');
ok(catalog.entries.some((e) => e.id === 'amberx-listeners/restart' && e.source === 'registry' && e.fields.some((f) => f.name === 'id' && !f.optional)), 'a registry command without a phrasebook line still gets fields from its schema');
ok(new Set(catalog.entries.map((e) => e.id)).size === catalog.entries.length, 'ids unique');

// matching
let m = matchCommand(catalog, 'create a new project named Gizmo Johnson');
ok(m && m.entry.id === 'project-wizard/run' && m.slots.name === 'gizmo johnson' && m.missing.length === 0, 'project with a name: slot filled');
m = matchCommand(catalog, 'create a new project');
ok(m && m.entry.id === 'project-wizard/run' && m.missing.join() === 'name', 'project without a name: asks for it');
m = matchCommand(catalog, 'approve');
ok(m && m.entry.id === 'approvals.review', '"approve" → the review');
m = matchCommand(catalog, 'approve all pending');
ok(m && m.entry.id === 'approvals.all', '"approve all pending" → approve all');
m = matchCommand(catalog, 'change the veto timer to two hours');
ok(m && m.entry.id === 'control:pass.scopes' && m.slots.duration === 'two hours' && !m.missing.length, 'veto timer → pass with a duration');
const vr = requestFor(m.entry, m.slots);
ok(vr.kind === 'control' && vr.command.target === 'pass.scopes' && vr.command.action === 'grant' && vr.command.input.minutes === 120, 'veto pass request: act pass.scopes all grant 120');
m = matchCommand(catalog, 'prioritise console app wake word urgent');
ok(m && m.entry.id === 'build-orchestrator/priority-set' && m.slots.priority === 'urgent' && m.slots.builds === 'console app wake word', 'prioritise with the priority word');
m = matchCommand(catalog, 'stop build gizmo-rebuild');
ok(m && m.entry.id === 'build-orchestrator/pipeline-build-action' && m.slots.action === 'hold' && m.slots.id === 'gizmo-rebuild', 'stop build → hold');
m = matchCommand(catalog, 'land console-app-wake-word-voice-listener');
ok(m && m.entry.id === 'control:planner.builds:land', 'land → build complete');
m = matchCommand(catalog, 'split build abc into steps');
ok(m && m.entry.id === 'build-orchestrator/pipeline-split' && m.slots.id === 'abc', 'split');
m = matchCommand(catalog, 'add a note buy milk');
ok(m && m.entry.id === 'control:amberx.items:note' && requestFor(m.entry, m.slots).command.value.title === 'buy milk', 'add a note');
m = matchCommand(catalog, 'go to the top');
ok(m && m.entry.run.kind === 'voice', 'scrolling goes to the console voice intents');
m = matchCommand(catalog, 'open plan studio');
ok(m && (m.entry.run.kind === 'voice' || m.entry.run.kind === 'plugin-action'), 'open <screen>: a registered open action, else the console voice intents');
m = matchCommand(catalog, 'please review the approvals now');
ok(m && m.entry.id === 'approvals.review', 'fuzzy: filler words dropped');
ok(matchCommand(catalog, 'flibbertigibbet wobble') === null, 'nonsense → null');
ok(matchCommand(catalog, 'what are my wake phrases')?.entry.id === 'wake-listener/settings', 'own settings entry');

// the spoken wizard: create a new project → name? → Gizmo Johnson → kind? skip → confirm → run
let wz = startWizard(matchCommand(catalog, 'create a new project').entry, {});
ok(wz.step === 'ask' && wz.field === 'name' && /called/.test(wz.prompt), 'wizard asks the name');
wz = answerWizard(wz, 'Gizmo Johnson');
ok(wz.step === 'ask' && wz.field === 'kind' && wz.optional && /skip/.test(wz.prompt), 'then the optional kind');
wz = answerWizard(wz, 'skip');
ok(wz.step === 'confirm' && wz.prompt === 'Create the project Gizmo Johnson. Yes or no?', `confirm line: ${wz.prompt}`);
ok(answerWizard(wz, 'nah what').step === 'retry' && answerWizard(wz, 'no').step === 'cancelled', 'confirm: retry / no');
wz = answerWizard(wz, 'yes');
ok(wz.step === 'run', 'yes → run');
const req = requestFor(wz.entry, wz.slots);
ok(req.kind === 'plugin-route' && req.folder === 'project-wizard' && req.method === 'POST' && req.path === '/run' && req.body.plan.display === 'Gizmo Johnson' && req.body.plan.name === 'gizmo-johnson' && req.body.plan.kind === 'app' && req.body.plan.source.kind === 'new', 'project request body');
let w2 = startWizard(matchCommand(catalog, 'file a build').entry, {});
w2 = answerWizard(w2, 'a dark mode for the console');
ok(w2.step === 'ask' && w2.field === 'priority', 'file a build: asks the priority (optional)');
w2 = answerWizard(w2, 'urgent');
ok(w2.step === 'confirm' && requestFor(w2.entry, w2.slots).body.priority === 'urgent' && requestFor(w2.entry, w2.slots).body.title === 'a dark mode for the console', 'priority filled');
let w3 = startWizard(matchCommand(catalog, 'set the veto timer').entry, {});
ok(w3.step === 'ask' && answerWizard(w3, 'soon').step === 'retry' && answerWizard(w3, 'two hours').step === 'confirm', 'duration field: retry on nonsense, confirm on a time');
ok(summaryOf(matchCommand(catalog, 'queue build xyz').entry, { id: 'xyz' }) === 'Queue xyz', 'summary line');
const unq = startWizard(matchCommand(catalog, 'take abc out of the queue').entry, matchCommand(catalog, 'take abc out of the queue').slots);
ok(unq.step === 'confirm' && requestFor(unq.entry, unq.slots).body.id === 'abc', 'unqueue: id from the phrase, confirm');
ok(entriesFromActions([{ id: 'a.open', meta: { label: 'Open A', personOnly: true } }]).length === 0, 'person-only actions stay out');
ok(searchCatalog(catalog, 'veto').some((e) => e.id === 'control:pass.scopes') && searchCatalog(catalog, 'project').length >= 1, 'searchCatalog');
ok(speakResult({ speak: '' }, { ok: false, message: 'nope' }) === 'That failed: nope.' && speakResult({ speak: '' }, { ok: true }) === 'Done.' && speakResult({ speak: 'items' }, { items: [] }) === 'Nothing open.', 'speakResult');
ok(cli('match', 'create a new project named Gizmo Johnson').match.entry.id === 'project-wizard/run' && cli('catalog', 'veto').count >= 1, 'cli match / catalog');

/* Claude mode settings (build voice-listener-use-claude-when-connected) */
ok(d.useClaude === true && d.claudeTimeoutSec === 8, 'Claude mode: on by default, 8 s timeout');
ok(applyPatch(d, { 'axf.voice.useClaude': false }).useClaude === false && applyPatch(d, { useClaude: 'false' }).useClaude === false, 'Claude mode: console key and store key both switch it');
ok(applyPatch(d, { 'axf.voice.claudeTimeoutSec': 99 }).claudeTimeoutSec === 30 && applyPatch(d, { claudeTimeoutSec: 0 }).claudeTimeoutSec === 2, 'Claude timeout clamped 2..30');
ok(cli('set', 'axf.voice.useClaude=false').settings.useClaude === false && cli('set', 'useClaude=true', 'claudeTimeoutSec=5').settings.claudeTimeoutSec === 5, 'cli set Claude mode');

ok(core.claudeGate({ useClaude: false }, 'create a new project named Gizmo Johnson').claude === false && core.claudeGate({ useClaude: false }, 'x').reason === 'off', 'Claude gate: switch off → scripted, never Claude');
ok(core.claudeGate({ useClaude: true }, 'create a new project').claude === true, 'Claude gate: switch on → Claude first');
ok(['approve', 'deny that one', 'approve all pending', 'set the veto timer to two hours', 'reject it'].every((t) => core.claudeGate({ useClaude: true }, t).reason === 'approvals'), 'Claude gate: approve / deny / veto words stay scripted');
// the page's flow asks claudeGate before any understand call (web/flow.ts handleCommand)
{ const flow = (await import('node:fs')).readFileSync(new URL('./web/flow.ts', import.meta.url), 'utf8'); const i = flow.indexOf('claudeGate({'); const j = flow.indexOf('await understand(t, '); ok(i > 0 && j > i && /if \(!gate\.claude\) reason = gate\.reason;\s*else \{/.test(flow), 'flow: understand is only called when the gate says Claude'); }

/* the mode indicator (s8) */
{
  const mi = core.modeIndicator;
  ok(mi({ useClaude: false }, {}, { claudeConnected: false }).label === 'Scripted' && !mi({ useClaude: false }, {}, {}).offline, 'indicator: switch off = Scripted, never offline');
  ok(mi({}, {}, { claudeConnected: true }).mode === 'claude' && !mi({}, {}, { claudeConnected: true }).offline, 'indicator: Claude connected = Claude mode');
  ok(mi({}, {}, { claudeConnected: false, offlineReason: 'no-llm' }).offline && mi({}, {}, { claudeConnected: false, offlineReason: 'no-llm' }).reason === 'no-llm', 'indicator: Claude away = Offline mode with the reason');
  ok(mi({}, { lastMode: 'scripted', lastFallbackReason: 'timeout' }, { claudeConnected: true }).offline, 'indicator: the fallback handled the last command = Offline mode');
  ok(!mi({}, { lastMode: 'scripted', lastFallbackReason: 'approvals' }, { claudeConnected: true }).offline, 'indicator: a spoken approval is by design, not offline');
  ok(core.initialState({}).lastMode === '' && core.initialState({}).lastFallbackReason === '', 'state carries lastMode / lastFallbackReason');
}

/* history (s9) */
{
  const old = core.normalizeHistoryEntry({ at: 5, heard: 'approve', command: 'approvals.review', reply: 'x' });
  ok(old.mode === 'scripted' && old.reason === '', 'history: an entry from before Claude mode reads as scripted');
  ok(core.normalizeHistoryEntry({ mode: 'claude', reason: 'timeout' }).reason === '', 'history: a Claude entry has no fallback reason');
  const list = [{ at: 1, mode: 'claude' }, { at: 3, mode: 'scripted', reason: 'timeout' }, { at: 2 }];
  ok(core.filterHistory(list).map((e) => e.at).join() === '3,2,1' && core.filterHistory(list, { mode: 'scripted' }).length === 2 && core.filterHistory(list, { mode: 'claude' }).length === 1, 'history: newest first, filter by mode');
  cli('record'); // empty stdin is fine
  execFileSync('node', [new URL('./listener.mjs', import.meta.url).pathname, 'record', '--json'], { env: process.env, input: JSON.stringify({ heard: 'create a project', command: 'project-wizard/run', mode: 'claude' }) });
  execFileSync('node', [new URL('./listener.mjs', import.meta.url).pathname, 'record', '--json'], { env: process.env, input: JSON.stringify({ heard: 'help', command: 'listener.help', mode: 'scripted', reason: 'timeout' }) });
  const h = cli('history'); const hc = cli('history', '--mode', 'claude');
  ok(h.count === 3 && hc.count === 1 && hc.entries[0].command === 'project-wizard/run' && cli('history', '--mode', 'scripted').entries[0].reason === 'timeout', 'cli history: mode recorded, filter works');
}

/* parity: REST, MCP, CLI and voice reach the same routes (s11) */
{
  const { requestOf } = await import('./cli.mjs');
  const { registry } = await import('../../../../framework/cli/plugin-commands.mjs');
  const reg = registry({ apps: ['console-web'] });
  const mine = reg.plugins.find((p) => p.folder === 'wake-listener');
  const mcp = (id) => { const c = mine.commands.find((x) => x.id === id); return c?.run?.route ? `${c.run.route.method} ${c.run.route.path.replace(/^\//, '')}` : ''; };
  const server = (await import('node:fs')).readFileSync(new URL('./server/__init__.py', import.meta.url), 'utf8');
  const rest = (m, p) => server.includes(`@router.${m.toLowerCase()}("/${p}")`);
  const cliReq = (...w) => { const r = requestOf(w); return `${r.method} ${r.path.split('?')[0]}`; };
  const voice = (phrase) => { const m = matchCommand(catalog, phrase); const r = m && requestFor(m.entry, m.slots); return r?.kind === 'plugin-route' && r.folder === 'wake-listener' ? `${r.method} ${r.path.replace(/^\//, '')}` : `none (${m?.entry.id})`; };
  for (const [what, id, words, phrase] of [['on', 'claude-on', ['claude', 'on'], 'use Claude for voice'], ['off', 'claude-off', ['claude', 'off'], 'stop using Claude for voice'], ['status', 'claude', ['claude', 'status'], 'is claude mode on']]) {
    const want = mcp(id);
    const [m, p] = want.split(' ');
    ok(want && rest(m, p) && cliReq(...words) === want && voice(phrase) === want, `parity ${what}: REST, MCP (wake-listener_${id}), CLI (axf voice ${words.join(' ')}) and voice ("${phrase}") → ${want}`);
  }
  ok(mcp('claude-test') === 'POST claude/test' && cliReq('claude', 'test', 'make', 'a', 'project') === 'POST claude/test' && rest('POST', 'claude/test'), 'parity test: REST, MCP and CLI dry runs share POST claude/test');
  ok(mcp('history') === 'GET history' && cliReq('history', 'claude') === 'GET history' && rest('GET', 'history'), 'parity history: REST, MCP and CLI share GET history');
  ok(requestOf(['claude', 'timeout', '12']).body.timeoutSec === 12 && requestOf(['claude', 'nope']).error && requestOf(['history', 'bogus']).error, 'cli: timeout body, errors on unknown words');
  const local = JSON.parse(execFileSync('node', [new URL('./cli.mjs', import.meta.url).pathname, 'claude', 'off', '--local', '--json'], { env: process.env, encoding: 'utf8' }));
  ok(local.settings.useClaude === false && cli('settings').settings.useClaude === false, 'axf voice claude off --local writes the shared store');
  execFileSync('node', [new URL('./cli.mjs', import.meta.url).pathname, 'claude', 'on', '--local', '--json'], { env: process.env });
  ok(speakResult(matchCommand(catalog, 'use claude for voice').entry, { ok: true, useClaude: true, claudeConnected: true }) === 'Claude mode is on.', 'voice: the reply says the mode');
  const axfOut = execFileSync('node', [new URL('../../../../framework/cli/axf.mjs', import.meta.url).pathname, 'voice', 'claude', 'status', '--local', '--json'], { env: process.env, encoding: 'utf8' });
  ok(JSON.parse(axfOut).useClaude === true, 'axf voice routes to the listener by capability');
}

console.log(`${n - failed}/${n} wake-listener checks passed`);
process.exit(failed ? 1 : 0);
