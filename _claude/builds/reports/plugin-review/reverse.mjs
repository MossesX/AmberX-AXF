#!/usr/bin/env node
/**
 * Plugin review, step 2: reverse map (used by) and what breaks when each console plugin is removed.
 *
 * Read-only. Input is deps.json (plugin-review-deps@1, written by extract.mjs in step 1). Output is reverse.json
 * (plugin-review-reverse@1) and REVERSE.md next to this file.
 *
 * For every plugin X it inverts the resolved edges of all other plugins:
 *
 *   usedBy     every plugin that looks up a capability X provides, dispatches one of X's console actions or
 *              listens for an event X emits, with how the dependency is declared
 *   breaks     what stops working when X is removed (or disabled), by severity:
 *                hard      a dependent declares the capability as required, or dispatches an action X registers;
 *                          also the console shell or the framework naming X by path or route
 *                degrades  a dependent declares the capability optional, uses it without declaring it, or listens
 *                          for an event X emits: it keeps running without the feature. Undeclared lookups are
 *                          guarded in the code checked (push-banner, activity: "without it: nothing") but the
 *                          Plugin Manager cannot warn before removal, so each one is also listed under fixes
 *                silenced  events X listens for that other plugins emit (their signal goes unheard)
 *              A capability with a second provider is reported as covered, not broken.
 *   cascade    the transitive set of plugins that break hard (removing X breaks Y, which breaks Z …)
 *   core       true when removing X breaks the console shell, the framework or another plugin hard, when X
 *              provides a framework contract (control@1, plugin-commands@1, console-commands@1), or when at least
 *              HUB plugins use it (removal degrades a wide part of the console). Reasons listed.
 *   tier       core | shared (only soft dependents) | leaf (nothing depends on it)
 *   fixes      manifest corrections the map exposes: undeclared lookups of X's capabilities, capabilities X
 *              provides in code but does not declare (and the reverse), weak folder-word references to check by hand
 *
 *   node _claude/builds/reports/plugin-review/reverse.mjs           writes reverse.json + REVERSE.md
 *   node _claude/builds/reports/plugin-review/reverse.mjs --json    prints the JSON instead
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const deps = JSON.parse(readFileSync(join(here, 'deps.json'), 'utf8'));

/** Capabilities other code is built against as framework contracts: a plugin providing one is core by definition. */
const CONTRACTS = new Set(['control@1', 'plugin-commands@1', 'console-commands@1']);

/** A plugin used by at least this many others is core even when every use is soft. */
const HUB = 5;

const norm = (cap) => cap.replace(/^service:/, '');
const plugins = deps.plugins;
const byFolder = new Map(plugins.map((p) => [p.folder, p]));

// Capability → providers (declared or in code); de-duplicated after normalising the stray `service:` prefix.
const providers = new Map();
for (const [cap, list] of Object.entries(deps.providers)) {
  const k = norm(cap);
  providers.set(k, [...new Set([...(providers.get(k) || []), ...list])]);
}

// Action id → registering plugin.
const actionOwner = new Map();
for (const p of plugins) for (const a of p.real.actionsRegistered) actionOwner.set(a, p.folder);

const rev = new Map(plugins.map((p) => [p.folder, { usedBy: [], hard: [], degrades: [], silenced: [], covered: [] }]));

for (const p of plugins) {
  for (const e of p.resolution.edges) {
    if (e.kind === 'service') {
      const cap = norm(e.target);
      const provs = (providers.get(cap) || e.detail.providers || []).filter((f) => f !== p.folder);
      for (const prov of provs) {
        const r = rev.get(prov);
        if (!r) continue;
        const entry = { plugin: p.folder, kind: 'service', target: cap, via: e.via, files: e.detail.files || [] };
        r.usedBy.push(entry);
        if (provs.length > 1) { r.covered.push({ ...entry, otherProviders: provs.filter((x) => x !== prov) }); continue; }
        if (e.via === 'required') r.hard.push(entry);
        else r.degrades.push(entry); // optional or undeclared (guarded lookup, no Plugin Manager warning)
      }
    } else if (e.kind === 'action') {
      const owner = e.target;
      if (owner === p.folder || !rev.has(owner)) continue;
      const entry = { plugin: p.folder, kind: 'action', target: e.detail.action, via: 'dispatch', files: [] };
      rev.get(owner).usedBy.push(entry);
      rev.get(owner).hard.push(entry);
    } else if (e.kind === 'event') {
      // p listens for an event e.target emits.
      const emitter = e.target;
      if (emitter === p.folder || !rev.has(emitter)) continue;
      const entry = { plugin: p.folder, kind: 'event', target: e.detail.event, via: 'listens', files: [] };
      rev.get(emitter).usedBy.push(entry);
      rev.get(emitter).degrades.push(entry);
      rev.get(p.folder).silenced.push({ plugin: emitter, kind: 'event', target: e.detail.event, via: 'emits', files: [] });
    }
  }
}

// Transitive hard cascade.
const hardDeps = (f) => [...new Set(rev.get(f).hard.map((x) => x.plugin))];
function cascade(f) {
  const seen = new Set();
  const stack = hardDeps(f);
  while (stack.length) {
    const g = stack.pop();
    if (g === f || seen.has(g)) continue;
    seen.add(g);
    stack.push(...hardDeps(g));
  }
  return [...seen].sort();
}

const out = [];
for (const p of plugins) {
  const r = rev.get(p.folder);
  const shell = [...p.folderRefs.consoleShell, ...p.folderRefs.framework].map((x) => ({ file: x.file, lines: x.lines }));
  const otherPluginRefs = p.folderRefs.otherPlugins.map((x) => x.file || x);
  const provides = [...new Set([...p.declared.provides.filter((c) => c.startsWith('service:')).map(norm), ...Object.keys(p.real.servicesProvided)])];
  const contracts = provides.filter((c) => CONTRACTS.has(c));
  const casc = cascade(p.folder);
  const reasons = [];
  if (shell.length) reasons.push(`named by the console shell / framework: ${shell.map((s) => s.file).join(', ')}`);
  if (r.hard.length) reasons.push(`hard dependents: ${[...new Set(r.hard.map((x) => x.plugin))].join(', ')}`);
  const users = new Set(r.usedBy.map((x) => x.plugin));
  if (users.size >= HUB) reasons.push(`used by ${users.size} plugins`);
  if (contracts.length) reasons.push(`provides framework contract ${contracts.join(', ')}`);
  if (otherPluginRefs.length) reasons.push(`another plugin names it by folder: ${otherPluginRefs.join(', ')}`);
  const core = reasons.length > 0;
  const tier = core ? 'core' : r.usedBy.length ? 'shared' : 'leaf';

  const undeclaredUses = r.degrades.filter((x) => x.via === 'undeclared').map((x) => `${x.plugin} uses ${x.target} without declaring it`);
  const fixes = [
    ...undeclaredUses,
    ...p.resolution.providesInCodeNotDeclared.map((c) => `provides ${c} in code but not in plugin.json`),
    ...p.resolution.providesDeclaredNotInCode.map((c) => `declares ${c} but no provide call found (check by hand: may be web-side or a data contract)`),
    ...p.declared.provides.filter((c) => /^service:service:/.test(c) || (c.startsWith('service:') && deps.providers[c])).map((c) => `malformed provide string ${c}`),
    ...p.folderRefs.weak.map((w) => `folder word quoted in ${w.file} (check by hand)`),
  ];

  out.push({
    folder: p.folder,
    name: p.declared.name,
    tier,
    core,
    coreReasons: reasons,
    provides,
    actions: p.real.actionsRegistered,
    usedBy: r.usedBy,
    usedByPlugins: [...new Set(r.usedBy.map((x) => x.plugin))].sort(),
    breaks: { hard: r.hard, degrades: r.degrades, silenced: r.silenced, covered: r.covered, shell },
    cascade: casc,
    fixes,
  });
}
out.sort((a, b) => (b.core - a.core) || (b.cascade.length - a.cascade.length) || (b.usedByPlugins.length - a.usedByPlugins.length) || a.folder.localeCompare(b.folder));

const doc = {
  $axf: 'plugin-review-reverse@1',
  generatedAt: new Date().toISOString(),
  source: 'deps.json (plugin-review-deps@1)',
  count: out.length,
  summary: {
    core: out.filter((x) => x.tier === 'core').map((x) => x.folder),
    shared: out.filter((x) => x.tier === 'shared').map((x) => x.folder),
    leaf: out.filter((x) => x.tier === 'leaf').map((x) => x.folder),
    undeclaredDependencies: out.reduce((n, x) => n + x.breaks.degrades.filter((h) => h.via === 'undeclared').length, 0),
  },
  plugins: out,
};

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
  process.exit(0);
}

// ---------- REVERSE.md ----------
const esc = (s) => String(s).replace(/\|/g, '\\|');
const dep = (x) => `${x.plugin} (${x.kind === 'service' ? x.target : x.target}${x.via === 'undeclared' ? ', undeclared' : x.via === 'required' ? ', required' : ''})`;
const L = [];
L.push('# Plugin review: used by and what breaks');
L.push('');
L.push(`Generated ${doc.generatedAt} from deps.json by reverse.mjs. ${out.length} console plugins.`);
L.push('');
L.push('Severity: **hard** = a dependent stops working (required capability, or an action it dispatches); **degrades** = a dependent loses a feature but keeps running (optional or undeclared capability, or an event it listens for; undeclared ones are marked because the Plugin Manager cannot warn before removal); **silenced** = events this plugin listens for go unheard; **shell** = the console shell or framework names the plugin by path.');
L.push('');
L.push(`Core = removal breaks the shell, the framework or another plugin hard; or the plugin provides a framework contract (${[...CONTRACTS].join(', ')}); or ${HUB}+ plugins use it.`);
L.push('');
L.push('## Summary');
L.push('');
L.push(`| Tier | Count | Plugins |`);
L.push(`|---|---|---|`);
for (const t of ['core', 'shared', 'leaf']) L.push(`| ${t} | ${doc.summary[t].length} | ${doc.summary[t].join(', ')} |`);
L.push('');
L.push(`Undeclared dependencies (real lookups missing from the consumer's plugin.json): ${doc.summary.undeclaredDependencies}.`);
L.push('');
L.push('## Core plugins');
L.push('');
L.push('| Plugin | Why core | Breaks hard | Cascade |');
L.push('|---|---|---|---|');
for (const x of out.filter((x) => x.core)) {
  L.push(`| ${x.folder} | ${esc(x.coreReasons.join('; '))} | ${esc(x.breaks.hard.map(dep).join(', ') || '-')} | ${x.cascade.join(', ') || '-'} |`);
}
L.push('');
L.push('## Reverse map');
L.push('');
L.push('| Plugin | Tier | Used by | Hard | Degrades |');
L.push('|---|---|---|---|---|');
for (const x of out) {
  L.push(`| ${x.folder} | ${x.tier} | ${x.usedByPlugins.length} | ${x.breaks.hard.length} | ${x.breaks.degrades.length} |`);
}
L.push('');
L.push('## Per plugin');
for (const x of out) {
  L.push('');
  L.push(`### ${x.folder}${x.core ? ' (core)' : ''}`);
  L.push('');
  L.push(`${x.name}. Tier: ${x.tier}.${x.provides.length ? ` Provides ${x.provides.join(', ')}.` : ''}`);
  L.push('');
  const rows = [];
  if (x.coreReasons.length) rows.push(['Why core', x.coreReasons.join('; ')]);
  rows.push(['Used by', x.usedByPlugins.join(', ') || 'nothing']);
  if (x.breaks.shell.length) rows.push(['Breaks: shell / framework', x.breaks.shell.map((s) => `${s.file}: ${s.lines.map((l) => l.trim().slice(0, 100)).join(' / ')}`).join('; ')]);
  if (x.breaks.hard.length) rows.push(['Breaks: hard', x.breaks.hard.map(dep).join(', ')]);
  if (x.breaks.degrades.length) rows.push(['Breaks: degrades', x.breaks.degrades.map(dep).join(', ')]);
  if (x.breaks.silenced.length) rows.push(['Silenced', x.breaks.silenced.map((s) => `${s.target} from ${s.plugin}`).join(', ')]);
  if (x.breaks.covered.length) rows.push(['Covered by another provider', x.breaks.covered.map((c) => `${c.plugin} (${c.target} → ${c.otherProviders.join(', ')})`).join(', ')]);
  if (x.cascade.length) rows.push(['Cascade', x.cascade.join(', ')]);
  if (x.fixes.length) rows.push(['Fix / check', x.fixes.join('; ')]);
  if (!x.breaks.hard.length && !x.breaks.degrades.length && !x.breaks.shell.length) rows.push(['Removal', 'safe: nothing else breaks']);
  L.push('| | |');
  L.push('|---|---|');
  for (const [k, v] of rows) L.push(`| ${k} | ${esc(v)} |`);
}
L.push('');

writeFileSync(join(here, 'reverse.json'), JSON.stringify(doc, null, 2) + '\n');
writeFileSync(join(here, 'REVERSE.md'), L.join('\n'));
console.log(`reverse.json + REVERSE.md: ${out.length} plugins, core ${doc.summary.core.length}, shared ${doc.summary.shared.length}, leaf ${doc.summary.leaf.length}, undeclared ${doc.summary.undeclaredDependencies}`);
