/**
 * The voice command catalog (wake-listener@1 catalog; build console-app-wake-word-voice-listener s2, Nov 13 2026).
 *
 * Brett: "every custom command the console could need in wizard format with an entry, pipelines, create a new project
 * named Gizmo Johnson". One entry per thing the console can do, built from the API registry so a new plugin's commands
 * appear by themselves: every plugin command (plugin-commands@1 registry: routes, actions, reads), every control@1 target
 * (tokens, planner items, builds, notes / tasks, veto passes), the console's own navigation and settings intents, the
 * approvals review and the listener itself. Console actions registered in the open page are added by the page
 * (`fromActions`). Each entry has spoken forms (`say`: templates with {field} slots), fields (what a wizard asks for,
 * in order, with the question to ask and allowed values), what runs it (`run`) and whether it confirms first.
 *
 * A **phrasebook** gives the commands Brett names most their natural spoken forms, field questions and body shapes, keyed
 * by registry id; a command without a phrasebook line still gets a form made from its title and its input schema. The
 * phrasebook never makes this plugin depend on another: an id whose plugin is not installed yields no entry.
 *
 * Pure: the Node CLI (listener.mjs catalog | match), the plugin server (GET /catalog, POST /match) and the page
 * (web/flow.ts) share it. Tests: test.mjs.
 */
import { normalizePhrase } from './core.mjs';
// No Node imports here: the page bundles this file. The control@1 targets (CONTROL_TARGETS) and the plugin-commands
// registry are passed in by the caller (listener.mjs in Node, web/flow.ts in the page).

export const CATALOG_FRAME = 'wake-listener-catalog@1';
export const GROUPS = ['approvals', 'projects', 'pipelines', 'settings', 'tokens', 'notes', 'navigation', 'plugins', 'listener', 'control'];
export const MATCH_THRESHOLD = 0.6;

/* ------------------------------------------------------------------ words */

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, sixty: 60, ninety: 90, hundred: 100 };
const FILLER = /\b(please|can you|could you|would you|for me|now|the|a|an|my|me|to|of|up|just|go ahead and)\b/g;

/** "two hours" / "90 minutes" / "an hour and a half" / "2h" → minutes, or null. */
export function parseDuration(text) {
  let t = normalizePhrase(text);
  if (!t) return null;
  let total = 0; let found = false;
  // "half an hour" and "… and a half" (after hours) first, then the plain number + unit pairs
  if (/\bhalf an? hour\b/.test(t)) { total += 30; found = true; t = t.replace(/\bhalf an? hour\b/g, ' '); }
  if (/\b(hours?|hrs?)\b.*\band a half\b|\ban hour and a half\b/.test(t)) { total += 30; found = true; t = t.replace(/\band a half\b/g, ' '); }
  t = t.replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  const re = /(\d+(?:\.\d+)?|[a-z]+(?: [a-z]+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|d)\b/g;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[1];
    const n = /^\d/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? NUMBER_WORDS[raw.split(' ').pop()];
    const unit = m[2];
    if (!Number.isFinite(n)) continue;
    found = true;
    total += /^h/.test(unit) ? n * 60 : /^d/.test(unit) ? n * 1440 : n;
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** "Gizmo Johnson" → "gizmo-johnson" */
export const slug = (s) => normalizePhrase(s).replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 63);
/** "gizmo johnson" → "Gizmo Johnson" */
export const titleCase = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
const humanize = (s) => String(s ?? '').replace(/[-_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();

/* ------------------------------------------------------------------ the phrasebook */

/**
 * Spoken forms for registry commands by `<plugin>/<command>` id (or `control:<target>`). `say`: templates ({field} is a
 * slot); `fields`: the wizard's questions in order ({ name, ask, type?, enum?, optional? }); `body`: the request body as a
 * template (strings may hold {field}, {slug:field}, {title:field}); `confirm`: say it back before running.
 */
export const PHRASEBOOK = {
  'project-wizard/run': {
    title: 'Create a new project', group: 'projects', confirm: true,
    say: ['create a new project named {name}', 'create a new project called {name}', 'create a project named {name}', 'new project named {name}', 'new project called {name}', 'create a new project', 'create a project', 'new project', 'make a new project {name}'],
    fields: [{ name: 'name', ask: 'What is the project called?' }, { name: 'kind', ask: 'What kind: app, library, plugin or site?', enum: ['app', 'library', 'plugin', 'site'], optional: true }],
    body: { plan: { source: { kind: 'new' }, display: '{title:name}', name: '{slug:name}', description: '', kind: '{kind|app}', visibility: 'private', port: 'no', sync: true } },
    summary: 'create the project {title:name}',
  },
  'build-orchestrator/pipeline-request': {
    title: 'File a build', group: 'pipelines', confirm: true,
    say: ['file a build {title}', 'file a build for {title}', 'file a build', 'ask for a build {title}', 'ask for a build', 'new build {title}', 'request a build {title}', 'request a build'],
    fields: [{ name: 'title', ask: 'What should it build, in one line?' }, { name: 'priority', ask: 'Priority: urgent, high, normal or low?', enum: ['urgent', 'high', 'normal', 'low'], optional: true }],
    body: { title: '{title}', said: '{title}', priority: '{priority|normal}', queue: true },
    summary: 'file the build "{title}"',
  },
  'build-orchestrator/pipeline-split': {
    title: 'Split a build into steps', group: 'pipelines', confirm: true,
    say: ['split build {id} into steps', 'split the build {id} into steps', 'split build {id}', 'split {id} into steps', 'split the build {id}', 'split {id}', 'split a build'],
    fields: [{ name: 'id', ask: 'Which build? Say its id or name.' }],
    body: { id: '{id}' }, summary: 'split {id} into steps',
  },
  'build-orchestrator/priority-set': {
    title: 'Set a build\'s priority', group: 'pipelines', confirm: true,
    say: ['prioritise {builds} {priority}', 'prioritize {builds} {priority}', 'make {builds} {priority}', 'set priority of {builds} to {priority}', 'set the priority of {builds} to {priority}', 'set {builds} to {priority} priority', 'prioritise {builds}', 'prioritize {builds}', 'prioritise a build', 'prioritize a build', 'set a priority'],
    fields: [{ name: 'builds', ask: 'Which build? Say its id or name.' }, { name: 'priority', ask: 'Which priority: urgent, high, normal or low?', enum: ['urgent', 'high', 'normal', 'low', 'p0', 'p1', 'p2', 'p3'] }],
    body: { builds: ['{builds}'], priority: '{priority}' }, summary: 'make {builds} {priority} priority',
  },
  'build-orchestrator/pipeline-queue': { title: 'Queue a build', group: 'pipelines', confirm: true, say: ['queue build {id}', 'queue {id}', 'queue the build {id}', 'queue a build'], fields: [{ name: 'id', ask: 'Which build?' }], body: { id: '{id}' }, summary: 'queue {id}' },
  'build-orchestrator/pipeline-unqueue': { title: 'Take a build out of the queue', group: 'pipelines', confirm: true, say: ['unqueue {id}', 'take {id} out of the queue', 'remove {id} from the queue', 'unqueue a build'], fields: [{ name: 'id', ask: 'Which build?' }], body: { id: '{id}' }, summary: 'take {id} out of the queue' },
  'build-orchestrator/pipeline-build-action': {
    title: 'Hold, release, archive, delete or restore a build', group: 'pipelines', confirm: true,
    say: ['stop build {id}', 'stop {id}', 'hold build {id}', 'hold {id}', 'pause build {id}', 'release build {id}', 'release {id}', 'resume build {id}', 'archive build {id}', 'archive {id}', 'restore build {id}', 'delete build {id}', 'stop a build', 'hold a build', 'archive a build'],
    fields: [{ name: 'id', ask: 'Which build? Say its id or name.' }, { name: 'action', ask: 'Do what: hold, release, archive, delete or restore?', enum: ['hold', 'release', 'archive', 'unarchive', 'delete', 'restore', 'unqueue'] }],
    body: { id: '{id}', action: '{action}', why: 'by voice (wake listener)' }, summary: '{action} the build {id}',
    /** the verb in the spoken form fills the action */
    verbs: { stop: 'hold', hold: 'hold', pause: 'hold', release: 'release', resume: 'release', archive: 'archive', restore: 'restore', delete: 'delete' },
  },
  'build-orchestrator/pipeline-route': { title: 'Route a build to API or subscriptions', group: 'pipelines', confirm: true, say: ['route {id} to {route}', 'run {id} on {route}', 'route a build'], fields: [{ name: 'id', ask: 'Which build?' }, { name: 'route', ask: 'API, subscription or auto?', enum: ['api', 'subscription', 'auto'] }], body: { id: '{id}', route: '{route}' }, summary: 'route {id} to {route}' },
  'build-orchestrator/pipeline-status': { title: 'Pipeline status', group: 'pipelines', say: ['pipeline status', 'how is the pipeline', 'what is the pipeline doing', 'pipeline'], fields: [], speak: 'pipeline' },
  'build-orchestrator/priority-list': { title: 'The build priority list', group: 'pipelines', say: ['what is queued', 'priority list', 'list the queue', 'what builds are queued'], fields: [], speak: 'priority' },
  'wake-listener/off': { title: 'Stop listening', group: 'listener', say: ['stop listening', 'turn off the listener', 'turn the listener off', 'mic off', 'listener off', 'go to sleep'], fields: [] },
  'wake-listener/claude-on': { title: 'Use Claude for voice (Claude mode on)', group: 'listener', say: ['use claude for voice', 'use claude for voice commands', 'use claude for the voice', 'turn on claude mode', 'turn claude mode on', 'claude mode on', 'switch on claude mode'], fields: [], speak: 'claude-mode' },
  'wake-listener/claude-off': { title: 'Stop using Claude for voice (Claude mode off)', group: 'listener', say: ['stop using claude for voice', 'stop using claude for voice commands', 'stop using claude', 'turn off claude mode', 'turn claude mode off', 'claude mode off', 'switch off claude mode'], fields: [], speak: 'claude-mode' },
  'wake-listener/claude': { title: 'Is Claude mode on', group: 'listener', say: ['is claude mode on', 'claude mode status', 'are you using claude', 'is claude connected'], fields: [], speak: 'claude-mode' },
  'wake-listener/settings': { title: 'The listener\'s settings', group: 'listener', say: ['what are my wake phrases', 'listener settings'], fields: [], speak: 'wake-settings' },
  'control:pass.scopes': {
    title: 'Veto pass: run everything without the veto wait for a while', group: 'approvals', confirm: true,
    say: ['set the veto timer to {duration}', 'change the veto timer to {duration}', 'veto timer {duration}', 'set veto timer {duration}', 'veto pass for {duration}', 'allow everything for {duration}', 'allow everything for the next {duration}', 'skip the veto for {duration}', 'no veto for {duration}', 'set the veto timer', 'veto pass'],
    fields: [{ name: 'duration', ask: 'For how long? Say minutes or hours.', type: 'duration' }],
    control: { op: 'act', target: 'pass.scopes', path: 'all', action: 'grant', input: { minutes: '{minutes:duration}', reason: 'Brett, by voice: veto timer {duration}' } },
    summary: 'ask axHub for a veto pass of {duration}: calls run at once instead of waiting for your veto, once you approve the pass',
  },
  'control:amberx.items:note': { title: 'Add a note', group: 'notes', say: ['add a note {title}', 'note {title}', 'make a note {title}', 'take a note {title}', 'add a note', 'new note {title}'], fields: [{ name: 'title', ask: 'What should the note say?' }], control: { op: 'add', target: 'amberx.items', value: { kind: 'note', title: '{title}' } }, summary: 'add the note "{title}"' },
  'control:amberx.items:task': { title: 'Add a task', group: 'notes', say: ['add a task {title}', 'add a to do {title}', 'add a todo {title}', 'new task {title}', 'remind me to {title}', 'add a task', 'add a to do'], fields: [{ name: 'title', ask: 'What is the task?' }], control: { op: 'add', target: 'amberx.items', value: { kind: 'task', title: '{title}' } }, summary: 'add the task "{title}"' },
  'control:amberx.items:list': { title: 'My open tasks', group: 'notes', say: ['what are my tasks', 'list my tasks', 'my open tasks', 'what is on my list', 'read my tasks'], fields: [], control: { op: 'list', target: 'amberx.items', select: { kind: 'task', status: 'open', limit: 10 } }, speak: 'items' },
  'control:tokens.slots': { title: 'Switch a skin or theme asset', group: 'tokens', confirm: true, say: ['switch {slot} to {asset}', 'change {slot} to {asset}', 'use the {asset} {slot}', 'set the {slot} to {asset}', 'switch the {slot} to {asset}'], fields: [{ name: 'slot', ask: 'Which slot: color theme, style theme, layout, button…?' }, { name: 'asset', ask: 'Which asset id?' }], control: { op: 'set', target: 'tokens.slots', path: '{slug:slot}', value: '{slug:asset}' }, summary: 'switch {slot} to {asset}' },
  'control:tokens.theme': { title: 'Set a colour token', group: 'tokens', confirm: true, say: ['set the {token} colour to {value}', 'set the {token} color to {value}', 'set colour token {token} to {value}', 'set color token {token} to {value}'], fields: [{ name: 'token', ask: 'Which colour token?' }, { name: 'value', ask: 'Which colour?' }], control: { op: 'set', target: 'tokens.theme', path: '{slug:token}', value: '{value}' }, summary: 'set the {token} colour to {value}' },
  'control:tokens.style': { title: 'Set a style token', group: 'tokens', confirm: true, say: ['set the {token} style token to {value}', 'set style token {token} to {value}', 'set style {token} to {value}'], fields: [{ name: 'token', ask: 'Which style token?' }, { name: 'value', ask: 'What value?' }], control: { op: 'set', target: 'tokens.style', path: '{slug:token}', value: '{value}' }, summary: 'set the {token} style token to {value}' },
  'control:planner.builds:note': { title: 'Add a note to a build', group: 'pipelines', confirm: true, say: ['add a note to build {id} {text}', 'note on build {id} {text}', 'add a note to a build'], fields: [{ name: 'id', ask: 'Which build?' }, { name: 'text', ask: 'What is the note?' }], control: { op: 'act', target: 'planner.builds', path: '{id}', action: 'note', input: { text: '{text}' } }, summary: 'add a note to {id}' },
  'control:planner.builds:approve': { title: 'Approve a build phase', group: 'pipelines', confirm: true, say: ['approve build {id}', 'approve the build {id}', 'approve phase {phase} of {id}', 'approve a build'], fields: [{ name: 'id', ask: 'Which build?' }, { name: 'phase', ask: 'Which phase number?', type: 'number', optional: true }], control: { op: 'act', target: 'planner.builds', path: '{id}', action: 'approve', input: { phase: '{number:phase|1}' } }, summary: 'approve build {id}' },
  'control:planner.builds:land': { title: 'Mark a build complete', group: 'pipelines', confirm: true, say: ['land {id}', 'land build {id}', 'land the build {id}', 'mark {id} complete', 'mark {id} done', 'complete build {id}', 'land a build'], fields: [{ name: 'id', ask: 'Which build?' }], control: { op: 'act', target: 'planner.builds', path: '{id}', action: 'status', input: { status: 'complete' } }, summary: 'mark the build {id} complete' },
  'control:planner.plans:add': { title: 'Put an idea in Plan Studio', group: 'projects', confirm: true, say: ['plan {title}', 'add a plan {title}', 'put {title} in a plan', 'park the idea {title}', 'add a plan'], fields: [{ name: 'title', ask: 'What is the plan called?' }], control: { op: 'add', target: 'planner.plans', value: { title: '{title:title}', status: 'parked' } }, summary: 'park the plan "{title}"' },
};

/* ------------------------------------------------------------------ built-in entries */

export const BUILTINS = [
  { id: 'approvals.review', title: 'Review what needs approval, one at a time', group: 'approvals', say: ['approve', 'approvals', 'review approvals', 'what needs approval', 'what needs my approval', 'anything to approve', 'pending approvals', 'review what is pending', 'approve or deny', 'go through approvals', 'what is waiting', 'what is waiting for me'], fields: [], run: { kind: 'builtin', what: 'approvals.review' }, effect: 'write' },
  { id: 'approvals.all', title: 'Approve everything pending', group: 'approvals', confirm: true, say: ['approve all pending', 'approve all', 'approve everything', 'approve them all', 'approve all of them', 'approve everything pending'], fields: [], run: { kind: 'builtin', what: 'approvals.all' }, effect: 'write', summary: 'approve every call waiting on axHub' },
  { id: 'approvals.denyAll', title: 'Deny everything pending', group: 'approvals', confirm: true, say: ['deny all pending', 'deny all', 'deny everything', 'deny them all'], fields: [], run: { kind: 'builtin', what: 'approvals.denyAll' }, effect: 'write', summary: 'deny every call waiting on axHub' },
  { id: 'approvals.count', title: 'How many approvals are waiting', group: 'approvals', say: ['how many approvals', 'how many are waiting', 'how many need approval', 'anything pending'], fields: [], run: { kind: 'builtin', what: 'approvals.count' }, effect: 'read' },
  { id: 'listener.help', title: 'What can I say', group: 'listener', say: ['what can i say', 'help', 'what can you do', 'list commands', 'commands'], fields: [], run: { kind: 'builtin', what: 'help' }, effect: 'read' },
  { id: 'listener.cancel', title: 'Cancel', group: 'listener', say: ['cancel', 'never mind', 'nevermind', 'forget it', 'stop', 'quit', 'exit'], fields: [], run: { kind: 'builtin', what: 'cancel' }, effect: 'read' },
  { id: 'listener.repeat', title: 'Say that again', group: 'listener', say: ['say that again', 'repeat', 'what did you say', 'pardon'], fields: [], run: { kind: 'builtin', what: 'repeat' }, effect: 'read' },
  { id: 'listener.wizard', title: 'Start a wizard for a command', group: 'listener', say: ['start wizard {id}', 'wizard {id}', 'start the {id} wizard', 'walk me through {id}'], fields: [{ name: 'id', ask: 'Which command?' }], run: { kind: 'builtin', what: 'wizard' }, effect: 'read' },
  // the console's own navigation and settings intents (console-control@1 voice): scroll, open, find, show a build step, plugins on / off, press, set a setting
  { id: 'console.open', title: 'Open a screen, tab, dialog or settings tab', group: 'navigation', say: ['open {target}', 'go to {target}', 'show {target}', 'show me {target}', 'take me to {target}', 'open the {target} tab', 'open {target} settings'], fields: [{ name: 'target', ask: 'Open what?' }], run: { kind: 'voice' }, effect: 'navigate' },
  { id: 'console.back', title: 'Go back / home', group: 'navigation', say: ['go back', 'back', 'go home', 'home', 'close this', 'close the dialog'], fields: [], run: { kind: 'voice' }, effect: 'navigate' },
  { id: 'console.scroll', title: 'Scroll', group: 'navigation', say: ['scroll down', 'scroll up', 'page down', 'page up', 'go to the top', 'go to the bottom', 'scroll down a bit', 'scroll up a bit'], fields: [], run: { kind: 'voice' }, effect: 'navigate' },
  { id: 'console.find', title: 'Find something', group: 'navigation', say: ['find {query}', 'search for {query}', 'search {query}', 'look for {query}'], fields: [{ name: 'query', ask: 'Find what?' }], run: { kind: 'voice' }, effect: 'read' },
  { id: 'console.step', title: 'Show a build step', group: 'pipelines', say: ['show step {step} of {build}', 'step {step} of {build}'], fields: [{ name: 'step', ask: 'Which step?' }, { name: 'build', ask: 'Which build?' }], run: { kind: 'voice' }, effect: 'navigate' },
  { id: 'console.press', title: 'Press a button', group: 'navigation', say: ['press {button}', 'click {button}', 'tap {button}'], fields: [{ name: 'button', ask: 'Press what?' }], run: { kind: 'voice' }, effect: 'write' },
  { id: 'console.set', title: 'Change a setting', group: 'settings', say: ['set {setting} to {value}', 'turn {setting} on', 'turn {setting} off', 'turn on {setting}', 'turn off {setting}', 'change {setting} to {value}'], fields: [{ name: 'setting', ask: 'Which setting?' }, { name: 'value', ask: 'To what?' }], run: { kind: 'voice' }, effect: 'write' },
  { id: 'console.plugin', title: 'Plugin on / off', group: 'plugins', say: ['disable plugin {plugin}', 'enable plugin {plugin}', 'turn off the {plugin} plugin', 'turn on the {plugin} plugin', 'enable the {plugin} plugin', 'disable the {plugin} plugin'], fields: [{ name: 'plugin', ask: 'Which plugin?' }], run: { kind: 'voice' }, effect: 'write' },
  { id: 'console.theme.next', title: 'Next theme / style / layout', group: 'tokens', say: ['next theme', 'next colour theme', 'next color theme', 'switch theme', 'next style', 'next style theme', 'next layout'], fields: [], run: { kind: 'voice' }, effect: 'write' },
];

/* ------------------------------------------------------------------ building the catalog */

const fill = (tpl, slots) => String(tpl).replace(/\{(\w+):(\w+)(?:\|([^}]*))?\}|\{(\w+)(?:\|([^}]*))?\}/g, (_, fn, k1, d1, k2, d2) => {
  const key = fn ? k1 : k2; const dflt = fn ? d1 : d2;
  const v = slots[key];
  if (v === undefined || v === null || v === '') return dflt ?? '';
  if (fn === 'slug') return slug(v);
  if (fn === 'title') return titleCase(v);
  if (fn === 'minutes') return String(parseDuration(v) ?? v);
  if (fn === 'number') return String(Number(String(v).replace(/[^\d.]/g, '')) || dflt || '');
  return String(v);
});

/** A body / value template filled with slots (numbers stay numbers when the whole string was one placeholder). */
export function fillTemplate(tpl, slots) {
  if (typeof tpl === 'string') {
    const whole = /^\{(\w+:)?(\w+)(\|[^}]*)?\}$/.exec(tpl);
    const out = fill(tpl, slots);
    if (whole && /^(minutes|number):/.test(whole[1] ?? '')) return Number(out);
    return out;
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fillTemplate(x, slots));
  if (tpl && typeof tpl === 'object') { const o = {}; for (const [k, v] of Object.entries(tpl)) o[k] = fillTemplate(v, slots); return o; }
  return tpl;
}

const schemaFields = (input) => {
  const props = input?.properties && typeof input.properties === 'object' ? input.properties : {};
  const req = new Set(Array.isArray(input?.required) ? input.required : []);
  return Object.entries(props).filter(([k]) => k !== 'to').map(([k, p]) => ({ name: k, ask: `${humanize(k)}?${p?.description ? ` (${String(p.description).slice(0, 80)})` : ''}`, type: p?.type === 'integer' || p?.type === 'number' ? 'number' : p?.type === 'boolean' ? 'boolean' : 'string', ...(Array.isArray(p?.enum) ? { enum: p.enum.map(String) } : {}), optional: !req.has(k) }));
};

/** One registry command → an entry (with its phrasebook line when it has one). */
export function entryFromCommand(plugin, cmd) {
  const id = `${plugin.folder}/${cmd.id}`;
  const pb = PHRASEBOOK[id];
  const fields = pb?.fields ?? schemaFields(cmd.input);
  const title = pb?.title ?? cmd.title ?? humanize(cmd.id);
  const say = pb?.say ?? sayFromTitle(title, fields);
  const run = cmd.run?.route ? { kind: 'plugin-route', folder: plugin.folder, method: cmd.run.route.method, path: cmd.run.route.path, params: cmd.run.route.params ?? [], body: pb?.body ?? null }
    : cmd.run?.action ? { kind: 'plugin-action', action: cmd.run.action }
      : cmd.run?.info ? { kind: 'plugin-info', folder: plugin.folder } : { kind: 'plugin-data', folder: plugin.folder, command: cmd.id };
  return { id, title, group: pb?.group ?? (cmd.effect === 'navigate' ? 'navigation' : 'plugins'), plugin: plugin.name || plugin.folder, say, fields, run, effect: cmd.effect ?? 'write', confirm: pb?.confirm ?? (cmd.effect === 'destructive'), summary: pb?.summary ?? '', speak: pb?.speak ?? '', verbs: pb?.verbs ?? null, source: pb ? 'phrasebook' : 'registry' };
}

/** A spoken form from a title: "Queue a build" + field id → ["queue a build {id}", "queue a build"]. */
export function sayFromTitle(title, fields) {
  const t = normalizePhrase(title).replace(/\s*\(.*$/, '').trim();
  if (!t) return [];
  const req = fields.filter((f) => !f.optional);
  const forms = [t];
  if (req.length === 1) forms.unshift(`${t} ${'{' + req[0].name + '}'}`);
  return forms;
}

/** Entries for control@1 targets: the phrasebook's, plus a plain "list <label>" read per target. */
export function entriesFromControl(targets = {}) {
  const out = [];
  for (const [key, pb] of Object.entries(PHRASEBOOK)) {
    if (!key.startsWith('control:')) continue;
    const target = key.split(':')[1];
    if (!targets[target]) continue;
    out.push({ id: key, title: pb.title, group: pb.group, say: pb.say, fields: pb.fields, run: { kind: 'control', command: pb.control }, effect: pb.control.op === 'list' || pb.control.op === 'get' ? 'read' : 'write', confirm: !!pb.confirm, summary: pb.summary ?? '', speak: pb.speak ?? '', verbs: null, source: 'phrasebook' });
  }
  for (const [target, t] of Object.entries(targets)) {
    if (!t.ops?.includes('list')) continue;
    const label = normalizePhrase(t.label);
    out.push({ id: `control:${target}:list`, title: `List ${t.label}`, group: 'control', say: [`list ${label}`, `list the ${label}`, `what ${label} are there`], fields: [], run: { kind: 'control', command: { op: 'list', target, select: { limit: 10 } } }, effect: 'read', confirm: false, summary: '', speak: 'list', verbs: null, source: 'control' });
  }
  return out;
}

/** Console actions registered in the open page → entries (argument-free, searchable ones; the page passes rt.actions.list()). */
export function entriesFromActions(actions) {
  const out = [];
  for (const a of actions ?? []) {
    const m = a.meta ?? {};
    if (m.params || m.searchable === false || m.personOnly || m.stub || !m.label) continue;
    if (/^wake-listener\./.test(a.id)) continue;
    const t = normalizePhrase(m.label).replace(/\s*\(.*$/, '').trim();
    if (!t || t.length > 60) continue;
    out.push({ id: `action:${a.id}`, title: m.label, group: m.effect === 'navigate' || /^nav:|\.open$|\.show$/.test(a.id) ? 'navigation' : 'plugins', say: [t], fields: [], run: { kind: 'console-action', action: a.id }, effect: m.effect ?? 'write', confirm: m.effect === 'destructive', summary: '', speak: '', verbs: null, source: 'actions' });
  }
  return out;
}

/** The catalog: built-ins, the registry's plugin commands, control@1 targets, the page's actions. */
export function buildCatalog({ registry = null, actions = null, targets = {} } = {}) {
  const entries = [...BUILTINS.map((b) => ({ confirm: false, summary: '', speak: '', verbs: null, source: 'builtin', ...b }))];
  for (const p of registry?.plugins ?? []) {
    if (p.app && p.app !== 'console-web') continue;
    if (p.enabled === false) continue;
    for (const c of p.commands ?? []) {
      if (c.id === 'info' || c.id === 'data' || c.id === 'data-file') continue;
      entries.push(entryFromCommand(p, c));
    }
  }
  entries.push(...entriesFromControl(targets));
  entries.push(...entriesFromActions(actions));
  const seen = new Set();
  return { $axf: CATALOG_FRAME, builtAt: new Date().toISOString(), entries: entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))), groups: GROUPS };
}

/* ------------------------------------------------------------------ matching */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A template → { re, slots }: "{x}" slots capture lazily, the last one greedily. */
function compile(tpl, fields = []) {
  const slots = [];
  // a slot marker that survives normalizePhrase (letters only), split back out afterwards
  const parts = normalizePhrase(tpl.replace(/\{(\w+)\}/g, ' qslotq$1qendq ')).split(/qslotq(\w+?)qendq/);
  let re = '^';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { const w = parts[i].trim(); if (w) re += `${re.length > 1 ? '\\s+' : ''}${esc(w)}`; }
    else {
      slots.push(parts[i]);
      const f = fields.find((x) => x.name === parts[i]);
      // an enum slot takes only one of its values; any other slot takes words lazily (the last one greedily)
      const pat = f?.enum?.length ? `(${f.enum.map((v) => esc(softPhrase(v))).sort((a, b) => b.length - a.length).join('|')})` : '(.+?)';
      re += `${re.length > 1 ? '\\s+' : ''}${pat}`;
    }
  }
  // the last slot may take the rest
  re = re.replace(/\(\.\+\?\)$/, '(.+)');
  return { re: new RegExp(`${re}$`), slots };
}

/** Like normalizePhrase but keeps hyphens inside words (build ids: "gizmo-rebuild"). */
export const softPhrase = (text) => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' -]+/g, ' ').replace(/'/g, '').replace(/\s+-\s+|\s+-|-\s+/g, ' ').replace(/\s+/g, ' ').trim();

const words = (s) => normalizePhrase(s).replace(FILLER, ' ').split(/\s+/).filter(Boolean);

/**
 * The best entry for a phrase: an exact template match (slots filled) first, else the entry whose template shares the most
 * words with the phrase (score ≥ MATCH_THRESHOLD). → { entry, slots, missing, score, template } or null.
 */
export function matchCommand(catalog, text) {
  const p = softPhrase(text);
  if (!p) return null;
  const stripped = p.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  let best = null;
  for (const e of catalog.entries) {
    for (const tpl of e.say) {
      const { re, slots } = compile(tpl, e.fields);
      for (const cand of [p, stripped]) {
        const m = re.exec(cand);
        if (!m) continue;
        const filled = {};
        let slotWords = 0;
        slots.forEach((k, i) => { filled[k] = m[i + 1].trim(); slotWords += filled[k].split(/\s+/).length; });
        if (e.verbs) { const verb = cand.split(' ')[0]; if (e.verbs[verb] && !filled.action) filled.action = e.verbs[verb]; }
        // the most literal words matched, the fewest words swallowed by slots, wins
        const specificity = tpl.replace(/\{\w+\}/g, '').trim().split(/\s+/).filter(Boolean).length;
        const score = 1 + (specificity - slotWords / 2) / 100 + (slots.length ? 0 : 0.5);
        if (!best || score > best.score) best = { entry: e, slots: filled, template: tpl, score: Number(score.toFixed(4)) };
      }
    }
  }
  if (best) return finish(best);
  // fuzzy: word overlap with slot-free templates
  const pw = new Set(words(p));
  for (const e of catalog.entries) {
    for (const tpl of e.say) {
      if (/\{/.test(tpl)) continue;
      const tw = words(tpl);
      if (!tw.length) continue;
      const hit = tw.filter((w) => pw.has(w)).length;
      const score = hit / Math.max(tw.length, pw.size);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { entry: e, slots: {}, template: tpl, score: Number(score.toFixed(2)) };
    }
  }
  return best ? finish(best) : null;
}

function finish(b) {
  const slots = { ...b.slots };
  for (const f of b.entry.fields) if (slots[f.name] !== undefined) { const v = coerceField(f, slots[f.name]); if (v === null) delete slots[f.name]; else slots[f.name] = v; }
  return { ...b, slots, missing: missingFields(b.entry, slots) };
}

/** A spoken answer for a field → the value, or null when it does not fit (an enum word not among the values, a bad number). */
export function coerceField(field, raw) {
  const t = normalizePhrase(raw);
  if (!t) return null;
  if (field.enum) {
    const hit = field.enum.find((v) => normalizePhrase(v) === t) ?? field.enum.find((v) => t.split(' ').includes(normalizePhrase(v))) ?? field.enum.find((v) => normalizePhrase(v).startsWith(t));
    if (hit) return hit;
    const map = { urgent: 'p0', high: 'p1', normal: 'p2', low: 'p3', p0: 'urgent', p1: 'high', p2: 'normal', p3: 'low' };
    const alt = map[t];
    return alt && field.enum.includes(alt) ? alt : null;
  }
  if (field.type === 'duration') return parseDuration(t) ? String(raw).trim() : null;
  if (field.type === 'number') { const n = NUMBER_WORDS[t] ?? Number(t.replace(/[^\d.]/g, '')); return Number.isFinite(n) && t.replace(/[^\d.]/g, '') !== '' || NUMBER_WORDS[t] ? String(NUMBER_WORDS[t] ?? n) : null; }
  if (field.type === 'boolean') return /^(yes|on|true|yeah|yep|sure)$/.test(t) ? 'true' : /^(no|off|false|nope)$/.test(t) ? 'false' : null;
  return String(raw).trim();
}

export const missingFields = (entry, slots) => entry.fields.filter((f) => !f.optional && (slots[f.name] === undefined || slots[f.name] === '')).map((f) => f.name);

/** Entries whose id, title or spoken forms contain the words. */
export function searchCatalog(catalog, q) {
  const ws = words(q);
  if (!ws.length) return catalog.entries;
  return catalog.entries.filter((e) => { const hay = `${e.id} ${e.title} ${e.say.join(' ')} ${e.group}`.toLowerCase(); return ws.every((w) => hay.includes(w)); });
}

/* ------------------------------------------------------------------ the spoken wizard */

export const YES = /^(yes|yeah|yep|yup|sure|ok|okay|do it|go|go ahead|confirm|correct|right|affirmative|please do)\b/;
export const NO = /^(no|nope|cancel|never mind|nevermind|stop|forget it|don t|do not|quit|abort|negative)\b/;
export const SKIP = /^(skip|next|pass|later|not now|leave it)\b/;

/** Starts a wizard for an entry with what is already known. → { entry, slots, step: 'ask'|'confirm'|'run', field?, prompt } */
export function startWizard(entry, slots = {}) { return advance({ entry, slots: { ...slots }, asked: [] }); }

function advance(w) {
  const missing = missingFields(w.entry, w.slots);
  if (missing.length) {
    const field = w.entry.fields.find((f) => f.name === missing[0]);
    return { ...w, step: 'ask', field: field.name, prompt: field.ask + (field.enum ? '' : '') };
  }
  // an optional field not yet asked and not filled: ask once ("say skip to leave it")
  const opt = w.entry.fields.find((f) => f.optional && w.slots[f.name] === undefined && !w.asked.includes(f.name));
  if (opt) return { ...w, step: 'ask', field: opt.name, optional: true, prompt: `${opt.ask} Say skip to leave it.` };
  if (w.entry.confirm) return { ...w, step: 'confirm', field: undefined, prompt: `${summaryOf(w.entry, w.slots)}. Yes or no?` };
  return { ...w, step: 'run', field: undefined, prompt: '' };
}

/** One spoken answer → the next wizard state (step 'ask' | 'confirm' | 'run' | 'cancelled' | 'retry'). */
export function answerWizard(w, text) {
  const t = normalizePhrase(text);
  if (NO.test(t) && w.step !== 'ask') return { ...w, step: 'cancelled', prompt: 'Cancelled.' };
  if (w.step === 'confirm') {
    if (YES.test(t)) return { ...w, step: 'run', prompt: '' };
    if (NO.test(t)) return { ...w, step: 'cancelled', prompt: 'Cancelled.' };
    return { ...w, step: 'retry', prompt: `Yes or no? ${summaryOf(w.entry, w.slots)}.` };
  }
  if (w.step === 'ask') {
    if (/^(cancel|never mind|nevermind|forget it|quit|abort)$/.test(t)) return { ...w, step: 'cancelled', prompt: 'Cancelled.' };
    const field = w.entry.fields.find((f) => f.name === w.field);
    const asked = [...w.asked, field.name];
    if (w.optional && SKIP.test(t)) return advance({ ...w, asked });
    const v = coerceField(field, text);
    if (v === null) return { ...w, step: 'retry', prompt: field.enum ? `Say one of: ${field.enum.join(', ')}.` : field.type === 'duration' ? 'Say a time, like two hours or ninety minutes.' : field.type === 'number' ? 'Say a number.' : field.ask };
    return advance({ ...w, asked, slots: { ...w.slots, [field.name]: v } });
  }
  return w;
}

/** The sentence said back before running. */
export function summaryOf(entry, slots) {
  const s = entry.summary ? fill(entry.summary, slots) : `${normalizePhrase(entry.title)}${Object.keys(slots).length ? ` with ${Object.entries(slots).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The request a complete entry makes (what the page or the CLI sends). */
export function requestFor(entry, slots) {
  const r = entry.run;
  if (r.kind === 'plugin-route') {
    let path = r.path;
    const used = new Set();
    for (const p of r.params ?? []) if (p.in === 'path' && slots[p.name] !== undefined) { path = path.replace(`{${p.name}}`, encodeURIComponent(String(slots[p.name]))); used.add(p.name); }
    const rest = Object.fromEntries(Object.entries(slots).filter(([k]) => !used.has(k)));
    const body = r.body ? fillTemplate(r.body, slots) : r.method === 'GET' ? null : rest;
    const query = r.method === 'GET' ? Object.fromEntries((r.params ?? []).filter((p) => p.in === 'query' && slots[p.name] !== undefined).map((p) => [p.name, String(slots[p.name])])) : {};
    return { kind: 'plugin-route', folder: r.folder, method: r.method, path, query, body };
  }
  if (r.kind === 'control') return { kind: 'control', command: fillTemplate(r.command, slots) };
  if (r.kind === 'plugin-action' || r.kind === 'console-action') return { kind: 'action', spec: slots.args ? `${r.action}:${slots.args}` : r.action };
  return { kind: r.kind, ...r };
}

/** A spoken line for a result (what a route or control command answered). */
export function speakResult(entry, result) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.ok === false) return `That failed: ${r.message || r.error || 'the console said no'}.`;
  if (entry.speak === 'items' && Array.isArray(r.data?.items ?? r.items)) { const items = r.data?.items ?? r.items; return items.length ? `${items.length} open: ${items.slice(0, 5).map((i) => i.title).join('; ')}${items.length > 5 ? ', and more' : ''}.` : 'Nothing open.'; }
  if (entry.speak === 'list' && Array.isArray(r.data?.items ?? r.items)) { const items = r.data?.items ?? r.items; return `${items.length} item${items.length === 1 ? '' : 's'}${items.length ? `: ${items.slice(0, 5).map((i) => i.title || i.label || i.id).join('; ')}` : ''}.`; }
  if (entry.speak === 'wake-settings' && r.settings) return `Wake phrases: ${r.settings.phrases.join(', ')}. The listener is ${r.settings.on ? 'on' : 'off'}.`;
  if (entry.speak === 'claude-mode' && typeof r.useClaude === 'boolean') return r.useClaude ? `Claude mode is on${r.claudeConnected === false ? `, but Claude isn't connected: the scripted matcher answers for now` : ''}.` : 'Claude mode is off. The scripted matcher answers, and nothing you say goes to Claude.';
  if (entry.speak === 'pipeline' && r.status) return `Pipeline: ${typeof r.status === 'string' ? r.status : JSON.stringify(r.status).slice(0, 160)}.`;
  if (entry.speak === 'priority' && Array.isArray(r.items ?? r.builds)) { const items = r.items ?? r.builds; return `${items.length} in the queue${items.length ? `: ${items.slice(0, 5).map((b) => b.title || b.id).join('; ')}` : ''}.`; }
  if (typeof r.message === 'string' && r.message) return r.message;
  if (r.state === 'pending' || r.pending) return 'Asked. axHub is waiting for your approval.';
  return 'Done.';
}

/** A short spoken help line: the groups and a few examples. */
export function helpLine(catalog) {
  const n = catalog.entries.length;
  return `${n} commands. Say approve to review approvals, create a new project, file a build, prioritise a build, set the veto timer to two hours, add a note, open a screen, or stop listening. Say the wake phrase first.`;
}
