/**
 * Look regression, static half (no browser): the validators and spec checks the appearance system depends on, the
 * inventory of assets and tokens, the control@1 catalogue, the MCP tool list (and every read-only tool with no
 * required arguments answering), and a hash of every data file a look migration may touch. Everything is recorded
 * as plain JSON so `run.mjs diff` can compare two records.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export const ROOT_OF = (here) => join(here, '../../..');

/** One command; records ok / exit code / time / the last lines. Never throws. */
export function runCheck(root, name, cmd, args, { cwd = root, timeout = 900_000, env = {} } = {}) {
  const t0 = Date.now();
  const p = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const out = `${p.stdout || ''}\n${p.stderr || ''}`.trim();
  const tail = out.split('\n').slice(-12).join('\n').slice(-2000);
  return { name, cmd: [cmd, ...args].join(' '), ok: p.status === 0, code: p.status, ms: Date.now() - t0, tail };
}

/** The checks: CI's appearance-related validators and spec checks (framework/.github/workflows/android.yml), by name. */
export function checkList() {
  const tsx = (f) => ['npx', ['-y', 'tsx', f]];
  const node = (f, ...a) => ['node', [f, ...a]];
  return [
    ['validate framework assets', ...node('framework/cli/axf.mjs', 'validate', '--framework')],
    ['validate console-web', ...node('framework/cli/axf.mjs', 'validate', 'apps/console-web')],
    ['validate molly', ...node('framework/cli/axf.mjs', 'validate', 'apps/molly')],
    ['validate axhub-web', ...node('framework/cli/axf.mjs', 'validate', 'apps/axhub-web')],
    ['validate amberx-droid', ...node('framework/cli/axf.mjs', 'validate', 'apps/amberx-droid')],
    ['validate walkthrough-studio', ...node('framework/cli/axf.mjs', 'validate', 'apps/walkthrough-studio')],
    ['validate demo', ...node('framework/cli/axf.mjs', 'validate', 'apps/demo')],
    ['project manifests', ...node('framework/cli/project.mjs', 'validate', '--all')],
    ['project fixtures', ...node('framework/spec/check-project-fixtures.mjs')],
    ['tracker', ...node('framework/cli/tracker.mjs', '--check')],
    ['plugins', ...node('framework/cli/plugins.mjs', '--check')],
    ['check-theme (tokens only)', ...node('framework/cli/check-theme.mjs')],
    ['check-controls', ...node('framework/cli/check-controls.mjs')],
    ['check-toolbars', ...node('framework/cli/check-toolbars.mjs')],
    ['check-chrome-assets', ...node('framework/cli/check-chrome-assets.mjs')],
    ['check-banner-widgets', ...node('framework/cli/check-banner-widgets.mjs')],
    ['check-plugin-pages', ...node('framework/cli/check-plugin-pages.mjs')],
    ['shared assets', ...node('framework/cli/shared-assets.mjs', 'check')],
    ['chrome settings', ...node('framework/cli/chrome-settings.mjs', 'check')],
    ['help coverage', ...node('framework/cli/help-coverage.mjs', '--check')],
    ['skin coverage', ...node('framework/spec/check-skin-coverage.mjs')],
    ['plugin commands', ...node('framework/spec/check-plugin-commands.mjs')],
    ['ui-review', ...node('framework/spec/check-ui-review.mjs')],
    ['spec skin', ...tsx('framework/spec/check-skin.mts')],
    ['spec behavior-theme', ...tsx('framework/spec/check-behavior-theme.mts')],
    ['spec interface', ...tsx('framework/spec/check-interface.mts')],
    ['spec roller', ...tsx('framework/spec/check-roller.mts')],
    ['spec appearance', ...tsx('framework/spec/check-appearance.mts')],
    ['spec appearance-lock', ...tsx('framework/spec/check-appearance-lock.mts')],
    ['spec hub-look', ...tsx('framework/spec/check-hub-look.mts')],
    ['spec hubsync (axHub shared settings round-trip)', ...tsx('framework/spec/check-hubsync.mts')],
    ['spec hubstore', ...tsx('framework/spec/check-hubstore.mts')],
    ['spec looktokens', ...tsx('framework/spec/check-looktokens.mts')],
    ['spec customize', ...tsx('framework/spec/check-customize.mts')],
    ['spec scale', ...tsx('framework/spec/check-scale.mts')],
    ['spec layout-tokens', ...tsx('framework/spec/check-layout-tokens.mts')],
    ['spec navstyle', ...tsx('framework/spec/check-navstyle.mts')],
    ['spec tab-group', ...tsx('framework/spec/check-tab-group.mts')],
    ['spec chrome-settings', ...tsx('framework/spec/check-chrome-settings.mts')],
    ['spec settings-ui', ...tsx('framework/spec/check-settings-ui.mts')],
    ['spec control', ...tsx('framework/spec/check-control.mts')],
    ['spec console-commands', ...tsx('framework/spec/check-console-commands.mts')],
    ['spec app-menu', ...tsx('framework/spec/check-app-menu.mts')],
    ['spec watch-live', ...tsx('framework/spec/check-watch-live.mts')],
    ['spec brand', ...tsx('framework/spec/check-brand.mts')],
    ['spec design-language', ...tsx('framework/spec/check-design-language.mts')],
    ['spec toolbars', ...tsx('framework/spec/check-toolbars.mts')],
    ['spec plugin-inventory', ...tsx('framework/spec/check-plugin-inventory.mts')],
    ['spec mcp', ...tsx('framework/spec/check-mcp.mts')],
    ['console menu reach', ...tsx('apps/console-web/scripts/menu-reach.mts')],
    ['token-control plugin tests', ...node('apps/console-web/plugins/token-control/test.mjs')],
    ['console-commands plugin tests', ...node('apps/console-web/plugins/console-commands/test.mjs')],
    ['plugin-commands plugin tests', ...node('apps/console-web/plugins/plugin-commands/test.mjs')],
    ['glossary catalog', ...node('apps/console-web/plugins/glossary-index/catalog.mjs', '--check')],
    ['console MCP tools (python)', 'python3', ['apps/console-web/server/test_mcp_tools.py']],
    ['plugin-commands server (python)', 'python3', ['apps/console-web/plugins/plugin-commands/server/test_plugin_commands.py']],
    ['axhub-web tests', ...tsx('apps/axhub-web/test.mjs')],
    ['amberx-droid tests', ...tsx('apps/amberx-droid/test.mjs')],
  ];
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Every asset id by type under one assets folder. */
export function assetIds(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const type of readdirSync(dir).sort()) {
    const d = join(dir, type);
    if (!statSync(d).isDirectory()) continue;
    out[type] = readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  }
  return out;
}

/** The data files a look migration may touch, each with its sha1. */
export function dataHashes(root) {
  const roots = ['framework/assets', 'framework/defaults.json', 'framework/schemas', 'framework/spec/fixtures', 'framework/catalog', 'framework/plan',
    'tracker.json', 'project.manifest.json', 'apps/console-web/axf.manifest.json', 'apps/console-web/axf.lock.json', 'apps/console-web/src/axf/assets',
    'apps/molly/axf.manifest.json', 'apps/molly/axf.lock.json', 'apps/molly/src/axf/assets', 'apps/axhub-web/axf.manifest.json', 'apps/axhub-web/axf.lock.json',
    'apps/axhub-web/src/axf/assets', 'apps/amberx-droid/axf.manifest.json', 'apps/amberx-droid/axf.lock.json', 'apps/amberx-droid/src/axf/assets',
    'apps/walkthrough-studio/axf.manifest.json', 'apps/walkthrough-studio/axf.lock.json', 'apps/demo/axf.manifest.json', 'apps/demo/axf.lock.json'];
  const out = {};
  for (const r of roots) {
    const p = join(root, r);
    if (!existsSync(p)) continue;
    const files = statSync(p).isDirectory() ? walk(p) : [p];
    for (const f of files) out[relative(root, f)] = sha1(readFileSync(f));
  }
  return out;
}

/** One control@1 command through the runner (`control.mjs run`), as the REST route and the MCP tools do. */
/** Runners read the code's defaults, never the live hub's saved look (deterministic between two records). */
const OFFLINE_ENV = () => ({ ...process.env, AXHUB_PROJECTS_DIR: mkdtempSync(join(tmpdir(), 'look-regression-projects-')), AXF_DATA_DIR: 'off' });

export function control(root, command) {
  const p = spawnSync('node', ['apps/console-web/plugins/token-control/control.mjs', 'run', JSON.stringify({ command, grants: ['*'], by: 'look-regression' })], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, env: OFFLINE_ENV() });
  try { return JSON.parse(p.stdout.trim().split('\n').pop()); } catch { return { ok: false, error: (p.stderr || p.stdout).trim().slice(-500) }; }
}

/** The control@1 catalogue: targets, tools, routes, and every list target's rows (ids + values for tokens). */
export function controlInventory(root) {
  const cli = (...a) => { const p = spawnSync('node', ['apps/console-web/plugins/token-control/control.mjs', ...a, '--json'], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, env: OFFLINE_ENV() }); try { return JSON.parse(p.stdout); } catch { return null; } };
  const targets = cli('targets') ?? {};
  const tools = (cli('tools') ?? []).map((t) => t.name).sort();
  const routes = (cli('routes') ?? []).map((r) => `${r.method} ${r.path} ${r.op}`).sort();
  const lists = {};
  for (const id of Object.keys(targets).sort()) {
    if (!targets[id].ops.includes('list')) continue;
    if (id === 'console.clients' || id.startsWith('amberx.') || id.startsWith('planner.')) continue; // live data, not the look
    const r = control(root, { op: 'list', target: id });
    const rows = (r.items ?? []).map((it) => {
      const row = { id: it.id };
      for (const k of ['token', 'kind', 'asset', 'value', 'base', 'title', 'label', 'actions']) if (it[k] !== undefined) row[k] = it[k];
      if (it.overridden !== undefined) row.overridden = !!it.overridden;
      return row;
    });
    lists[id] = { ok: !!r.ok, error: r.ok ? undefined : r.error ?? r.code, count: rows.length, rows: rows.sort((a, b) => String(a.id).localeCompare(String(b.id))) };
  }
  // the plugins domain (plugin-commands@1): every plugin's commands and reads, and the MCP tools projected from them
  const pc = (...a) => { const p = spawnSync('node', ['apps/console-web/plugins/plugin-commands/commands.mjs', ...a, '--json'], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }); try { return JSON.parse(p.stdout); } catch { return null; } };
  const reg = pc('registry');
  const plugins = {};
  for (const p of reg?.plugins ?? []) plugins[p.folder] = { commands: (p.commands ?? []).map((c) => c.id ?? c.name).sort(), reads: (p.reads ?? []).map((c) => c.id ?? c.name).sort() };
  const pluginTools = (pc('tools') ?? []).map((t) => t.name).sort();
  return { targets: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, { ops: v.ops, label: v.label }])), tools, routes, lists, plugins, pluginTools };
}

/** Console MCP tools: the names, and every read-only tool with no required argument answering through the local runner. */
export function mcpInventory(root) {
  const py = `
import asyncio, json, sys, os
sys.path.insert(0, os.path.join(${JSON.stringify(root)}, 'apps/console-web/server'))
import mcp_server
root = __import__('pathlib').Path(${JSON.stringify(root)})
server = mcp_server.build_server(mcp_server._local_call(root), control=mcp_server.control_runner(root), console=lambda c: {'ok': False, 'error': 'no console in a regression run'}, notes=lambda c: {'ok': False, 'error': 'no session'})
tools = asyncio.run(server.list_tools())
out = {'tools': {}, 'answers': {}}
schema = lambda t: getattr(t, 'inputSchema', None) or getattr(t, 'input_schema', None) or {}
ro = lambda a: bool(a and (getattr(a, 'readOnlyHint', None) or getattr(a, 'read_only_hint', None)))
de = lambda a: bool(a and (getattr(a, 'destructiveHint', None) or getattr(a, 'destructive_hint', None)))
for t in sorted(tools, key=lambda t: t.name):
    a = t.annotations
    out['tools'][t.name] = {'readOnly': ro(a), 'destructive': de(a), 'required': sorted(schema(t).get('required') or [])}
for t in sorted(tools, key=lambda t: t.name):
    if not ro(t.annotations) or schema(t).get('required'):
        continue
    try:
        r = asyncio.run(asyncio.wait_for(server.call_tool(t.name, {}), 120))
        text = ''.join(getattr(c, 'text', '') for c in (r if isinstance(r, list) else getattr(r, 'content', []) or []))
        bad = text.lstrip().startswith('{"ok": false') or text.lstrip().startswith('{"ok":false')
        out['answers'][t.name] = {'ok': not bad, 'chars': len(text), 'head': text[:120]}
    except Exception as e:
        out['answers'][t.name] = {'ok': False, 'error': str(e)[:300]}
print(json.dumps(out))
`;
  const p = spawnSync('python3', ['-c', py], { cwd: root, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 64 * 1024 * 1024, env: { ...OFFLINE_ENV(), AXF_ROOT: root } });
  try { return JSON.parse(p.stdout.trim().split('\n').pop()); } catch { return { error: (p.stderr || p.stdout).trim().slice(-1200) }; }
}

/** Theme token names: every --fx-* variable the colour / style / layout / scale / look engines emit for the default look. */
export function themeTokenNames(root) {
  const inv = {};
  for (const t of ['color-theme', 'style-theme', 'layout', 'typography', 'density', 'sizing', 'behavior-theme', 'design-package', 'style-package', 'skin', 'interface']) {
    const d = join(root, 'framework/assets', t);
    if (!existsSync(d)) continue;
    inv[t] = {};
    for (const f of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      const a = JSON.parse(readFileSync(join(d, f), 'utf8'));
      inv[t][f.slice(0, -5)] = { sections: Object.keys(a.data ?? a).sort(), tokens: Object.keys((a.data ?? a).tokens ?? (a.data ?? a).colors ?? {}).length, name: a.name ?? a.label ?? '' };
    }
  }
  return inv;
}

export function staticRecord(root, { only = null, skipChecks = false } = {}) {
  const rec = { at: new Date().toISOString(), checks: [], assets: {}, defaults: {}, themes: {}, control: {}, mcp: {}, data: {} };
  if (!skipChecks) {
    for (const [name, cmd, args] of checkList()) {
      if (only && !only.some((o) => name.includes(o))) continue;
      const r = runCheck(root, name, cmd, args);
      rec.checks.push(r);
      console.error(`${r.ok ? 'ok  ' : 'FAIL'} ${name} (${(r.ms / 1000).toFixed(1)} s)`);
    }
  }
  rec.assets.framework = assetIds(join(root, 'framework/assets'));
  for (const a of ['console-web', 'molly', 'axhub-web', 'amberx-droid']) rec.assets[a] = assetIds(join(root, 'apps', a, 'src/axf/assets'));
  rec.defaults = JSON.parse(readFileSync(join(root, 'framework/defaults.json'), 'utf8'));
  rec.themes = themeTokenNames(root);
  console.error('control@1 inventory…');
  rec.control = controlInventory(root);
  console.error('MCP tools…');
  rec.mcp = mcpInventory(root);
  rec.data = dataHashes(root);
  return rec;
}
