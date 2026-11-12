/**
 * The console itself in the registry (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s7):
 * what the plugin manifests and control@1 targets do not already declare.
 *
 *   settings registries   every plugin `registry.json` with a `settings` list (claude-settings-registry@1 and any other
 *                         *-registry@1 of that shape): one `setting` entry per key with its kind, options or range,
 *                         default and owner flag; read and written through `value:<key>` (the plugin's
 *                         GET settings/{key} and PUT settings { values } routes, run as control@1 plugin commands)
 *   display options       every swappable asset type of the console (src/axf/assets/<type>/*.json with two or more
 *                         assets): a `display` entry whose `swap` action lists every asset id it can take; the design
 *                         and style packages; spacing and help mode as `setting` entries; randomize / reset assets
 *   conventions           parameters named like ids, targets, files, queries and limits get the allowed values that
 *                         name means everywhere in the console (pattern, range or length), so they are checked too
 *   voice                 an entry nobody declared phrases for gets "<verb> <label>" phrases, kept only when no other
 *                         entry claims the same words (the dispatcher stays exact: nothing fuzzy, no clash)
 *
 * Pure reads of the repo; no AI.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanParam, foldPhrase } from '../../../../framework/core/engines/control-registry.mjs';

const CONSOLE = 'console-web';
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const slug = (s) => String(s).replace(/[^A-Za-z0-9._:@-]+/g, '-').replace(/^-+|-+$/g, '');

/* ================================================================== settings registries */

/** A settings-registry setting → the parameter its value is. */
export function settingParam(s) {
  const base = { name: 'value', required: true, position: 0, ...(s.default !== undefined ? { default: s.default } : {}), description: s.label ?? s.key };
  const kind = s.kind ?? 'text';
  if (kind === 'toggle' || kind === 'boolean') return cleanParam({ ...base, type: 'boolean' });
  if ((kind === 'choice' || kind === 'select' || kind === 'enum') && Array.isArray(s.options)) {
    const values = s.options.map((o) => (isObj(o) ? o.value : o));
    const labels = Object.fromEntries(s.options.filter(isObj).filter((o) => o.label).map((o) => [String(o.value), o.label]));
    return cleanParam({ ...base, type: 'enum', enum: values, ...(Object.keys(labels).length ? { enumLabels: labels } : {}) });
  }
  if (kind === 'number' || kind === 'integer' || kind === 'slider') return cleanParam({ ...base, type: kind === 'integer' ? 'integer' : 'number', ...(s.min !== undefined ? { min: s.min } : { min: 0 }), ...(s.max !== undefined ? { max: s.max } : {}), ...(s.step !== undefined ? { step: s.step } : {}) });
  if (kind === 'time') return cleanParam({ ...base, type: 'time', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' });
  if (kind === 'list' || kind === 'tags') return cleanParam({ ...base, type: 'array', items: 'string' });
  return cleanParam({ ...base, type: 'string', maxLength: s.maxLength ?? 500, ...(s.pattern ? { pattern: s.pattern } : {}) });
}

/** Every plugin settings registry of the console as `setting` entries. */
export function collectSettingsRegistries(root, plugins) {
  const out = [];
  for (const p of plugins) {
    if (p.app !== CONSOLE) continue;
    const file = join(p.dir.startsWith('/') ? p.dir : join(root, p.dir), 'registry.json');
    const reg = existsSync(file) ? readJson(file) : null;
    if (!reg || !Array.isArray(reg.settings) || !/-registry@1$/.test(String(reg.$axf ?? ''))) continue;
    const groups = Object.fromEntries((reg.groups ?? []).map((g) => [g.id, g]));
    const pname = p.manifest?.name ?? p.folder;
    for (const s of reg.settings) {
      if (!s?.key) continue;
      const g = groups[s.group];
      const param = settingParam(s);
      const owner = s.owner === true ? 'only Brett, in his signed-in console' : s.owner === 'raise' ? 'anyone may lower it, only Brett raises it' : s.locked ? 'locked' : '';
      out.push({
        type: 'setting', id: `${CONSOLE}/setting/${p.folder}/${slug(s.key)}`, owner: CONSOLE,
        label: `${s.label ?? s.key}`, description: `${s.description ?? ''}${owner ? ` (${owner})` : ''}`.trim(),
        where: { app: CONSOLE, plugin: p.folder, settingsTab: `plugins/${p.folder}`, setting: s.key, ...(g ? { group: g.label } : {}), file: relative(root, file) },
        open: { kind: 'settings', target: `plugins/${p.folder}`, deepLink: `?axf-settings=plugins/${p.folder}&anchor=setting:${encodeURIComponent(s.key)}` },
        state: { read: `value:${s.key}`, fields: [{ ...param, name: s.key }] },
        actions: [
          { id: 'get', label: `Read ${s.label ?? s.key}`, effect: 'read', run: `value:${s.key}` },
          { id: 'set', label: `Set ${s.label ?? s.key}`, effect: 'write', run: `value:${s.key}`, params: [param], ...(s.owner === true ? { permission: 'owner' } : {}), phrases: [`set ${foldPhrase(s.label ?? s.key)} to {value}`, ...(param.type === 'boolean' ? [`turn ${foldPhrase(s.label ?? s.key)} {value}`] : [])] },
          ...(s.default !== undefined ? [{ id: 'reset', label: `Reset ${s.label ?? s.key}`, effect: 'write', run: `value:${s.key}`, params: [cleanParam({ ...param, required: false, default: s.default, position: undefined, description: `back to ${JSON.stringify(s.default)}` })] }] : []),
          { id: 'open', label: `Show ${s.label ?? s.key} in Settings`, effect: 'navigate', run: `settings:plugins/${p.folder}`, params: [cleanParam({ name: 'anchor', type: 'string', default: `setting:${s.key}`, enum: [`setting:${s.key}`] })] },
        ],
        synonyms: [s.label, g?.label].filter(Boolean), keywords: [s.key, s.group, pname].filter(Boolean), tags: ['setting', ...(s.owner === true ? ['owner-only'] : [])],
        parent: `${CONSOLE}/plugin/${p.folder}`, source: { kind: 'declared', file: relative(root, file), frame: reg.$axf },
      });
    }
  }
  return out;
}

/* ================================================================== display options */

/** Asset types whose slot can be swapped: two or more assets of that type in the console's asset folder. */
export function swappableTypes(root) {
  const dir = join(root, 'apps', CONSOLE, 'src', 'axf', 'assets');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const type of readdirSync(dir).sort()) {
    const tdir = join(dir, type);
    let files = [];
    try { files = readdirSync(tdir).filter((f) => f.endsWith('.json')); } catch { continue; }
    const assets = files.map((f) => readJson(join(tdir, f))).filter((a) => a?.$axf === 'asset@1' && a.id && (a.type === type || !a.type)).map((a) => ({ id: a.id, name: a.name ?? a.id }));
    if (assets.length >= 2) out.push({ type, assets: assets.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return out;
}

/** The console's display options: one entry per swappable asset type, plus packages, spacing, help mode, randomize / reset. */
export function collectDisplayOptions(root) {
  const out = [];
  const types = swappableTypes(root);
  for (const { type, assets } of types) {
    if (type === 'design-package' || type === 'style-package') continue;
    const human = type.replace(/-/g, ' ');
    out.push({
      type: 'display', id: `${CONSOLE}/display/asset/${type}`, owner: CONSOLE, label: `${human[0].toUpperCase()}${human.slice(1)}`,
      description: `Which ${human} asset the console uses (hot-swappable; every swap is the same as swap:${type}:<id>).`,
      where: { app: CONSOLE, assetType: type, file: `apps/${CONSOLE}/src/axf/assets/${type}` },
      open: { kind: 'dialog', target: 'asset-picker', deepLink: '?axf-dialog=asset-picker' },
      actions: [
        { id: 'swap', label: `Use another ${human}`, effect: 'write', run: `action:swap:${type}`, params: [cleanParam({ name: 'asset', type: 'enum', enum: [...assets.map((a) => a.id), 'next'], enumLabels: Object.fromEntries(assets.map((a) => [a.id, a.name])), required: true, position: 0, description: `the ${human} asset, or next` })], phrases: [`use the {asset} ${human}`, `switch ${human} to {asset}`, `change ${human} to {asset}`, `next ${human}`].map((x) => (x === `next ${human}` ? x : x)) },
        { id: 'next', label: `Next ${human}`, effect: 'write', run: `action:swap:${type}:next` },
      ],
      synonyms: [human, `${human}s`], keywords: [type, 'asset', 'swap', 'theme', 'look'], tags: ['display', 'asset'],
      source: { kind: 'declared', file: `apps/${CONSOLE}/src/axf/assets/${type}`, frame: 'asset@1' },
    });
  }
  for (const pk of types.filter((t) => t.type === 'design-package' || t.type === 'style-package')) {
    const action = pk.type === 'design-package' ? 'design.package' : 'style.package';
    const human = pk.type.replace(/-/g, ' ');
    out.push({
      type: 'display', id: `${CONSOLE}/display/${pk.type}`, owner: CONSOLE, label: `${human[0].toUpperCase()}${human.slice(1)}`,
      description: `Apply a ${human}: every theme it bundles at once (${action}:<id>).`, where: { app: CONSOLE, assetType: pk.type },
      actions: [{ id: 'apply', label: `Apply a ${human}`, effect: 'write', run: `action:${action}`, params: [cleanParam({ name: 'package', type: 'enum', enum: pk.assets.map((a) => a.id), enumLabels: Object.fromEntries(pk.assets.map((a) => [a.id, a.name])), required: true, position: 0 })], phrases: [`apply the {package} ${human}`, `use {package} ${human}`] }],
      synonyms: [human], keywords: [pk.type, 'package', 'theme'], tags: ['display', 'asset'], source: { kind: 'declared', file: `apps/${CONSOLE}/src/axf/assets/${pk.type}`, frame: 'asset@1' },
    });
  }
  const rt = `apps/${CONSOLE}/src/axf/core/runtime.ts`;
  out.push(
    { type: 'setting', id: `${CONSOLE}/setting/spacing`, owner: CONSOLE, label: 'Spacing', description: 'How tight the console is laid out.', where: { app: CONSOLE, file: rt },
      actions: [{ id: 'set', label: 'Change spacing', effect: 'write', run: 'action:spacing', params: [cleanParam({ name: 'spacing', type: 'enum', enum: ['tight', 'compact', 'regular'], required: true, position: 0 })], phrases: ['make it {spacing}', 'spacing {spacing}', 'set spacing to {spacing}'] }],
      synonyms: ['density', 'spacing'], tags: ['setting', 'display'], source: { kind: 'declared', file: rt } },
    { type: 'setting', id: `${CONSOLE}/setting/help-mode`, owner: CONSOLE, label: 'Help mode', description: 'Tooltips on every control.', where: { app: CONSOLE, file: rt },
      actions: [
        { id: 'set', label: 'Help mode on or off', effect: 'write', run: 'action:help.mode', params: [cleanParam({ name: 'mode', type: 'enum', enum: ['on', 'off', 'toggle'], required: true, position: 0 })], phrases: ['help mode {mode}', 'turn help mode {mode}'] },
        { id: 'intros', label: 'Show the screen intros again', effect: 'write', run: 'action:help.intros.reset' },
      ], synonyms: ['tooltips', 'help'], tags: ['setting'], source: { kind: 'declared', file: rt } },
    { type: 'behavior', id: `${CONSOLE}/behavior/assets`, owner: CONSOLE, label: 'Assets', description: 'Randomize every asset slot, or put every asset back to the defaults.', where: { app: CONSOLE, file: rt },
      actions: [
        { id: 'random', label: 'Randomize assets', effect: 'write', run: 'action:assets.random', phrases: ['randomize the assets', 'surprise me'] },
        { id: 'reset', label: 'Reset assets to defaults', effect: 'destructive', confirm: true, run: 'action:assets.reset', phrases: ['reset the assets to defaults'] },
      ], tags: ['behavior', 'display'], source: { kind: 'declared', file: rt } },
  );
  return out;
}

/* ================================================================== parameter conventions */

const ID_NAMES = /^(id|ids|cid|sid|aid|iid|uid|pid|tid|rid|eid|build|key|slug|folder|plugin|app|coll|collection|kind|profile|project|session|target|account|agent|group|list|step|phase|feature|plan|model|provider|connection|host|channel|tab|view|dialog|screen|type|asset|instance|role|version|tag|branch|ref|name|owner|repo|service|unit|domain|record|zone|server|container|env|stage|status|mode|scope|level|lang|locale|voice|device|client|parent|category|priority|format|source|by|op|icon|item|batch|run|archive|narrator|location|due|targetDate|t)$|^[a-z]{0,3}id$|(Id|_id|-id)$/;
const TEXT_NAMES = /^(q|query|text|message|msg|note|notes|title|description|body|comment|reason|say|label|content|prompt|summary|caption|subject|value|answer|question|search|filter|words|phrase|input|data|json|markdown|md|html|css|code|script|why|said|detail|details|request|goal|instructions|feedback)$/;
const PATH_NAMES = /^(file|dir|path|folder_path|src|dest|from|to_path|cwd|glob|pattern)$/;
const COUNT_NAMES = { limit: [1, 2000], offset: [0, 1_000_000], since: [0, 9_999_999_999_999], until: [0, 9_999_999_999_999], page: [1, 100_000], per_page: [1, 500], perPage: [1, 500], n: [1, 1000], count: [0, 100_000], days: [0, 3650], hours: [0, 8760], minutes: [0, 525_600], seconds: [0, 31_536_000], port: [1, 65535], lines: [1, 100_000], tail: [1, 100_000], depth: [0, 50], width: [0, 10_000], height: [0, 10_000], max: [0, 1_000_000], min: [0, 1_000_000], timeout: [0, 3600], ttl: [0, 31_536_000], index: [0, 1_000_000], at: [0, 9_999_999_999_999], ms: [0, 86_400_000], size: [0, 1_000_000_000], phase: [1, 50] };

/** The allowed values a parameter's name means, when it declares none. → the extra fields, or null. */
export function conventionFor(p) {
  if (!['string', 'number', 'integer'].includes(p.type) || p.enum !== undefined || p.min !== undefined || p.max !== undefined || p.pattern || p.of || p.maxLength !== undefined) return null;
  const n = String(p.name);
  if (p.type !== 'string') { const r = COUNT_NAMES[n] ?? (/^[a-z]{0,3}id$|Id$/.test(n) ? [0, Number.MAX_SAFE_INTEGER] : n === 'pr' ? [1, 1_000_000] : /^(parallel|max|min)[A-Z]|Runs$|PerAccount$/.test(n) ? [0, 1000] : n === 'speed' ? [0.25, 4] : /Pct$/.test(n) ? [0, 100] : /Usd$/.test(n) ? [0, 100_000] : /(Min|Minutes)$/.test(n) ? [0, 525_600] : n === 'order' ? [-1_000_000_000, 1_000_000_000] : n === 'version' ? [0, 1_000_000] : null); return r ? { min: r[0], max: r[1] } : null; }
  if (/^(since|until|at|after|before|mergedAt|createdAt|updatedAt)$/.test(n)) return { pattern: '^(\\d{4}-\\d{2}-\\d{2}([T ][0-9:.]+(Z|[+-]\\d{2}:?\\d{2})?)?|\\d{10,13})$' };
  if (/^(start|end)$/.test(n)) return { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
  if (n === 'version') return { pattern: '^[A-Za-z0-9._-]{1,64}$' };
  if (n === 'pr') return { pattern: '^#?\\d{1,7}$' };
  if (n === 'to') return { pattern: '^(recent|all|[A-Za-z0-9_.:-]{1,80})$' };
  if (n === 'args' || n === 'arg') return { maxLength: 500 };
  if (n === 'url' || n === 'href' || n === 'link') return { pattern: '^(https?://|/|\\?)[^\\s]{0,2000}$' };
  if (n === 'color' || n === 'colour') return { pattern: '^(#[0-9a-fA-F]{3,8}|[a-z-]+|rgba?\\([^)]*\\))$' };
  if (/^(date|day)$/.test(n)) return { pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
  if (/^(time)$/.test(n)) return { pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
  if (/^(email)$/.test(n)) return { pattern: '^[^@\\s]+@[^@\\s]+$' };
  if (PATH_NAMES.test(n)) return { pattern: '^(?!.*(^|/)\\.\\.(/|$))[^\\0]{1,500}$' };
  if (ID_NAMES.test(n)) return { pattern: '^[A-Za-z0-9][A-Za-z0-9 ._:@/+#=,-]{0,199}$' };
  if (TEXT_NAMES.test(n)) return { maxLength: 20_000 };
  return null;
}

/** Apply the conventions to every action parameter of raw entries (in place; returns how many were filled). */
export function applyConventions(entries) {
  let n = 0;
  for (const e of entries) for (const a of e.actions ?? []) for (const p of a.params ?? []) { const c = conventionFor(p); if (c) { Object.assign(p, c); n++; } }
  return n;
}

/* ================================================================== voice */

const VERB = { navigate: 'open', read: 'show', write: '', destructive: '', person: '' };

/**
 * "<verb> <label>" phrases for entries that have none: navigate → "open <label>", a write → "<action label>", kept
 * only when the folded phrase is unique across the index and not already someone's phrase.
 */
export function generatePhrases(entries) {
  const taken = new Map();
  const claim = (ph, key) => taken.set(ph, taken.has(ph) && taken.get(ph) !== key ? null : key);
  for (const e of entries) for (const a of e.actions ?? []) for (const ph of a.phrases ?? []) claim(foldPhrase(ph), `${e.id}#${a.id}`);
  const proposals = [];
  const labels = new Map();
  // when entries share a label, the one a person most likely means owns "<verb> <label>": a page, then an app, …
  const RANK = { page: 0, app: 1, display: 2, setting: 3, behavior: 4, tool: 5, plugin: 6 };
  const owner = new Map();
  for (const e of entries) { const l = foldPhrase(e.label ?? ''); labels.set(l, (labels.get(l) ?? 0) + 1); const o = owner.get(l); if (!o || RANK[e.type] < RANK[o.type]) owner.set(l, e); }
  for (const e of entries) {
    if ((e.actions ?? []).some((a) => a.phrases?.length) || (Array.isArray(e.surfaces?.voice) && e.surfaces.voice.length)) continue;
    for (const a of e.actions ?? []) {
      if (a.effect === 'read' && e.type === 'tool') continue;
      const label = foldPhrase(e.label ?? '');
      if (!label || label.length < 3) continue;
      const verb = a.effect === 'navigate' && !['open', 'launch', 'run'].includes(a.id) ? foldPhrase(a.id) : VERB[a.effect ?? 'write'];
      const al = foldPhrase(a.label ?? '');
      const settings = e.type === 'plugin' && a.effect === 'navigate';
      if (settings && labels.has(`${label} settings`)) continue; // its settings-tab page says the same and opens the same tab
      // a label two entries share would make "<verb> <label>" pick one at random: only the action's own label is safe then
      if (labels.get(label) > 1 && !settings && owner.get(label) !== e && !(al && al !== label && al.split(' ').length > 2)) continue;
      const ph = settings ? `open ${label} settings` : verb ? `${verb} ${label}` : al && al.includes(label) ? al : `${foldPhrase(a.id)} ${label}`;
      if (ph.split(' ').length < 2) continue;
      proposals.push({ e, a, ph });
      claim(ph, `${e.id}#${a.id}`);
    }
  }
  let n = 0;
  for (const { a, e, ph } of proposals) if (taken.get(ph) === `${e.id}#${a.id}`) { a.phrases = [ph]; if (e.surfaces?.voice === false) delete e.surfaces.voice; n++; }
  return n;
}

/* ================================================================== app plugins outside the plugin homes */

const ACTION_RE = /(?:actions\.register|\bon)\(\s*'([a-z0-9][a-z0-9.:-]*)'[\s\S]{0,600}?\{\s*label:\s*'([^']+)'/g;

/**
 * Plugins of apps the plugin-commands registry does not cover (apps/<app>/plugins/<folder>/plugin.json, e.g. Molly):
 * a plugin entry, a page per view / dialog / settings tab and a tool per action it registers in code. They run only
 * inside that app's window, so each says so as a gap (no remote command channel yet) instead of claiming a surface.
 */
export function collectAppPlugins(root, { apps = ['molly'] } = {}) {
  const out = [];
  for (const app of apps) {
    const dir = join(root, 'apps', app, 'plugins');
    if (!existsSync(dir)) continue;
    const why = `runs only inside ${app}'s window: ${app} has no remote command channel yet`;
    const gaps = ['rest', 'mcp', 'cli'].map((what) => ({ what, why, plan: `a ${app} command client on console-commands@1 (app '${app}')` }));
    const surf = { rest: false, mcp: false, cli: false };
    for (const folder of readdirSync(dir).sort()) {
      const m = readJson(join(dir, folder, 'plugin.json'));
      if (!m || folder.startsWith('_')) continue;
      const file = `apps/${app}/plugins/${folder}/plugin.json`;
      const name = m.name ?? folder;
      const src = { kind: 'plugin-manifest', file, frame: 'plugin@1' };
      out.push({ type: 'plugin', id: `${app}/plugin/${folder}`, owner: app, label: name, description: String(m.description ?? '').slice(0, 2000), where: { app, plugin: folder, file },
        actions: [], surfaces: { ...surf, voice: false }, gaps: [{ what: 'actions', why, plan: gaps[0].plan }], aliases: [`${app}:${folder}`], tags: ['plugin'], source: src });
      for (const pr of (m.provides ?? []).map(String)) {
        const [kind, ...rest] = pr.split(':'); const pname = rest.join(':');
        if (!['view', 'dialog', 'settings-tab'].includes(kind) || !pname) continue;
        out.push({ type: 'page', id: `${app}/page/${kind === 'settings-tab' ? `settings/${pname}` : kind === 'dialog' ? `dialog/${pname}` : pname}`, owner: app,
          label: `${name} ${kind === 'view' ? '' : kind === 'dialog' ? 'dialog' : 'settings'}`.trim(), where: { app, plugin: folder, [kind === 'view' ? 'view' : kind === 'dialog' ? 'dialog' : 'settingsTab']: pname, file },
          actions: [{ id: 'open', label: `Open ${name}${kind === 'settings-tab' ? ' settings' : ''}`, effect: 'navigate', run: `channel:${app}/${kind === 'view' ? 'nav' : kind === 'dialog' ? 'dialog' : 'settings.open'}:${pname}`, surfaces: surf }],
          surfaces: { ...surf }, gaps: [...gaps, { what: 'deepLink', why: `${app} deep links open its framed apps only (#/<app>/<route>), not its own ${kind === 'view' ? 'views' : kind === 'dialog' ? 'dialogs' : 'settings tabs'}`, plan: gaps[0].plan }],
          aliases: [`${app}:${pr}`], tags: [kind], parent: `${app}/plugin/${folder}`, source: src });
      }
      const web = join(dir, folder, 'web');
      for (const f of existsSync(web) ? readdirSync(web).filter((n) => /\.(tsx?|mjs)$/.test(n)) : []) {
        const text = readFileSync(join(web, f), 'utf8');
        for (const [, id, label] of text.matchAll(ACTION_RE)) {
          out.push({ type: 'tool', id: `${app}/tool/${folder}/${id}`, owner: app, label, where: { app, plugin: folder, action: id, file: `apps/${app}/plugins/${folder}/web/${f}` },
            actions: [{ id: 'run', label, effect: /reset|clear/.test(id) ? 'write' : /open|settings|dialog|layout|get/.test(id) ? 'navigate' : 'write', run: `channel:${app}/${id}`, params: [cleanParam({ name: 'args', type: 'string', maxLength: 500, description: 'its arguments (a:b:c), when it takes any' })], surfaces: surf }],
            surfaces: { ...surf }, gaps, tags: ['action'], parent: `${app}/plugin/${folder}`, source: { kind: 'plugin-manifest', file: `apps/${app}/plugins/${folder}/web/${f}`, frame: 'actions' } });
        }
      }
    }
    // the app's own actions (src/actions.ts)
    const own = join(root, 'apps', app, 'src', 'actions.ts');
    if (existsSync(own)) for (const [, id, label] of readFileSync(own, 'utf8').matchAll(ACTION_RE)) {
      out.push({ type: 'tool', id: `${app}/tool/${id}`, owner: app, label, where: { app, action: id, file: `apps/${app}/src/actions.ts` },
        actions: [{ id: 'run', label, effect: /own-tab|open/.test(id) ? 'navigate' : 'write', run: `channel:${app}/${id}`, surfaces: surf }], surfaces: { ...surf }, gaps, tags: ['action'], parent: `${app}/app/${app}`, source: { kind: 'declared', file: `apps/${app}/src/actions.ts`, frame: 'actions' } });
    }
  }
  return out;
}

/** control-registry@1 declarations an app or a provider keeps beside its code: apps/<app>/registry.json, apps/<app>/registry/*.json, apps/<app>/providers/<p>/registry.json. */
export function appDeclarationFiles(root) {
  const out = [];
  const appsDir = join(root, 'apps');
  for (const app of existsSync(appsDir) ? readdirSync(appsDir).sort() : []) {
    const base = join(appsDir, app);
    const cands = [join(base, 'registry.json')];
    const regDir = join(base, 'registry'); if (existsSync(regDir)) { try { cands.push(...readdirSync(regDir).filter((f) => f.endsWith('.json')).sort().map((f) => join(regDir, f))); } catch { /* not a folder */ } }
    const prov = join(base, 'providers'); if (existsSync(prov)) for (const p of readdirSync(prov).sort()) cands.push(join(prov, p, 'registry.json'));
    for (const f of cands) { const d = existsSync(f) ? readJson(f) : null; if (d?.$axf === 'control-registry@1') out.push({ file: relative(root, f), declaration: d }); }
  }
  return out;
}
