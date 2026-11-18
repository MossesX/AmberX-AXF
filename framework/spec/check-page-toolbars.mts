/**
 * check-page-toolbars — every page toolbar asset a plugin ships is wired and reachable the same way everywhere
 * (page-toolbar@1; build rebuild-every-toolbar-page-specific; Brett, Nov 8 2026: "Everything comes with an API").
 *
 * For each toolbar asset (`apps/<app>/plugins/<folder>/assets/toolbar/*.json`, or the files given):
 *   - the asset passes the contract (toolbarErrors) and is scoped to a page (view:<id> or plugin:<id>), never `app`;
 *   - every button is bound to an action ref, and the ref exists: a `command:` ref is a command of the plugin-commands
 *     registry, a `handler:` ref is registered by the plugin's page (useToolbarHandlers in its web sources), an
 *     `action:` ref is a console action the plugin registers, a `control:` ref is a valid console-control address; every icon is a framework icon;
 *   - the page draws it: a web source of the plugin renders `<PageToolbar … slot="<slot>">` for that view;
 *   - resolved through the engine with every ref wired and a state that meets its `when` terms, every button is
 *     enabled and has an invocation;
 *   - the API reaches it: the deep link `toolbar:<id>` and `toolbar:<id>/button:<b>` parse as console-control
 *     addresses; the CLI builds `POST /toolbars/<id>/press {button}` (REST), the MCP server offers
 *     `console_control_toolbar`, and the voice phrase "press <label> on the <toolbar> toolbar" asks for that button.
 *
 *   npx -y tsx framework/spec/check-page-toolbars.mts [asset.json …] [--json]
 * Exit 0 when every check passes, 1 otherwise. Each plugin's toolbar test runs this on its own assets.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePageToolbar, type ToolbarAssetLike } from '../core/engines/toolbar-actions';
import { pageToolbarSettingsId, parseActionRef, parseToolbarScope, parseWhen, toolbarErrors } from '../core/engines/toolbar-rules.mjs';
import { parseAddress } from '../core/engines/console-control';
import { voiceIntent } from '../core/engines/console-control-voice.mjs';
import { toRequest } from '../cli/console-control.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : walk(p)) : [p]; }) : []);

const ICONS = new Set([...read(join(ROOT, 'framework/react/components/Icon.tsx')).matchAll(/^\s+['"]?([a-z0-9-]+)['"]?\s*:/gm)].map((m) => m[1]!));
const SERVER_API = read(join(ROOT, 'apps/console-web/server/console_control_api.py'));
const SERVER_MCP = read(join(ROOT, 'apps/console-web/server/mcp_server.py'));

let commandCache: Set<string> | null = null;
async function knownCommands(): Promise<Set<string>> {
  if (commandCache) return commandCache;
  const m = (await import(join(ROOT, 'apps/console-web/plugins/plugin-commands/commands.mjs'))) as { registry: () => { plugins: { folder: string; commands?: { id: string }[] }[] } };
  commandCache = new Set(m.registry().plugins.flatMap((p) => (p.commands ?? []).map((c) => `${p.folder}/${c.id}`)));
  return commandCache;
}

/** A page state that meets every `when` term of the asset (so a fully wired toolbar resolves all-enabled). */
function satisfyingState(data: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const put = (key: string, v: unknown) => {
    const parts = key.split('.'); let cur = state;
    for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown>; }
    cur[parts[parts.length - 1]!] = v;
  };
  const groups = (data.groups ?? []) as { enabledWhen?: unknown; visibleWhen?: unknown; items?: { enabledWhen?: unknown; visibleWhen?: unknown }[] }[];
  const whens = groups.flatMap((g) => [g.enabledWhen, g.visibleWhen, ...(g.items ?? []).flatMap((i) => [i.enabledWhen, i.visibleWhen])]);
  for (const w of whens) for (const t of parseWhen(w) ?? []) {
    const n = Number(t.value);
    switch (t.op) {
      case 'truthy': put(t.key, !t.negate); break;
      case '=': put(t.key, Number.isFinite(n) && t.value !== '' ? n : t.value); break;
      case '!=': put(t.key, `${t.value}-other`); break;
      case '>': case '>=': put(t.key, n + 1); break;
      case '<': case '<=': put(t.key, n - 1); break;
    }
  }
  return state;
}

export interface ToolbarCheck { file: string; id: string; settingsId: string; buttons: number; errors: string[] }

export async function checkToolbarAsset(file: string): Promise<ToolbarCheck> {
  const errors: string[] = [];
  const rel = relative(ROOT, file);
  let asset: ToolbarAssetLike & { name?: string; type?: string };
  try { asset = JSON.parse(read(file)); } catch (e) { return { file: rel, id: '', settingsId: '', buttons: 0, errors: [`not JSON: ${(e as Error).message}`] }; }
  const data = asset.data as unknown as Record<string, unknown>;
  if (asset.type !== 'toolbar') errors.push(`type is "${asset.type}", not toolbar`);
  for (const e of toolbarErrors('toolbar', data) as string[]) errors.push(`contract: ${e}`);
  const scope = parseToolbarScope(data.scope);
  if (!scope || scope.kind === 'app') errors.push('not page-scoped: scope must be view:<id> or plugin:<id>');
  const slot = typeof data.slot === 'string' ? data.slot : 'main';
  const settingsId = pageToolbarSettingsId(scope ?? 'app', slot);

  // the plugin's web sources (handlers, wiring) — plugins/<folder>/assets/toolbar/x.json → plugins/<folder>/web
  const pluginDir = resolve(dirname(file), '..', '..');
  const folder = basename(pluginDir);
  const sources = walk(join(pluginDir, 'web')).filter((f) => /\.(tsx?|mts|mjs)$/.test(f)).map(read);
  const src = sources.join('\n');
  const view = scope?.kind === 'view' ? scope.id : null;
  const slotAttr = slot === 'main' ? null : `slot="${slot}"`;
  const wired = sources.some((s) => s.includes('<PageToolbar') && (!slotAttr || s.includes(slotAttr)) && (!view || s.includes(`'${view}'`) || s.includes(`"${view}"`)));
  if (!wired) errors.push(`not drawn: no <PageToolbar${view ? ` view="${view}"` : ''}${slotAttr ? ` ${slotAttr}` : ''}> in plugins/${folder}/web`);

  const commands = await knownCommands();
  const items = ((data.groups ?? []) as { id: string; items?: { id: string; label?: string; icon?: string; action?: string }[] }[]).flatMap((g) => (g.items ?? []).map((i) => ({ ...i, group: g.id })));
  const handlers: string[] = [];
  const actions: string[] = [];
  for (const it of items) {
    const where = `button ${it.group}/${it.id}`;
    if (it.icon && !ICONS.has(it.icon)) errors.push(`${where}: icon "${it.icon}" is not a framework icon`);
    const ref = parseActionRef(it.action);
    if (!ref) { errors.push(`${where}: no action ref`); continue; }
    if (ref.kind === 'command' && !commands.has(ref.id)) errors.push(`${where}: no plugin command "${ref.id}"`);
    if (ref.kind === 'handler') {
      if (!src.includes(`'${ref.id}'`) && !src.includes(`"${ref.id}"`)) errors.push(`${where}: handler "${ref.id}" is not registered in plugins/${folder}/web`);
      else handlers.push(ref.id);
    }
    if (ref.kind === 'control') { try { parseAddress(ref.id); } catch (e) { errors.push(`${where}: control address: ${(e as Error).message}`); } }
    if (ref.kind === 'action') {
      // a console action the plugin registers (rt.actions.register('<id>', …) in its web sources, or `action:<id>` in plugin.json provides)
      const id = ref.id.split(':')[0] ?? ref.id;
      const provides = read(join(pluginDir, 'plugin.json'));
      if (!src.includes(`register('${id}'`) && !src.includes(`register("${id}"`) && !provides.includes(`"action:${id}"`)) errors.push(`${where}: action "${id}" is not registered by plugins/${folder}`);
      else actions.push(id);
    }
  }

  // the engine, fully wired, in a state that meets every term
  const page = { view, plugin: scope?.kind === 'plugin' ? scope.id : null, slot };
  const t = resolvePageToolbar(asset, page, satisfyingState(data), { get: () => undefined, handlers, actions, commands: [...commands] });
  const buttons = t.groups.flatMap((g) => g.buttons);
  for (const b of buttons) {
    if (!b.visible || !b.enabled) errors.push(`button ${b.key}: ${b.reason ?? 'not enabled'} with every term met`);
    if (!b.invocation) errors.push(`button ${b.key}: no invocation`);
    // API: deep link, REST (through the CLI's request), MCP, voice
    try { parseAddress(b.address); } catch (e) { errors.push(`button ${b.key}: address ${b.address}: ${(e as Error).message}`); }
    const req = toRequest(['toolbar', 'press', t.id, b.id]) as { method: string; path: string; body?: { button?: string } };
    if (req.method !== 'POST' || req.path !== `/toolbars/${encodeURIComponent(t.id)}/press` || req.body?.button !== b.id) errors.push(`button ${b.key}: CLI/REST request is ${req.method} ${req.path}`);
    const phrase = `press ${b.label} on the ${asset.name ?? t.label} toolbar`;
    const intent = voiceIntent(phrase) as { verb?: string; find?: { q?: string; kinds?: string[] } } | null;
    const want = b.label.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    if (intent?.verb !== 'press' || !intent.find?.kinds?.includes('button') || !want.some((w) => (intent.find?.q ?? "").toLowerCase().includes(w))) errors.push(`button ${b.key}: voice "${phrase}" → ${JSON.stringify(intent)}`);
  }
  try { parseAddress(`toolbar:${t.id}`); } catch (e) { errors.push(`toolbar:${t.id}: ${(e as Error).message}`); }
  if (t.id !== settingsId) errors.push(`settings id ${t.id} ≠ ${settingsId}`);
  if (!SERVER_API.includes('/toolbars/{ref}/press')) errors.push('REST: no POST /api/console-control/toolbars/{ref}/press');
  if (!SERVER_MCP.includes('def console_control_toolbar')) errors.push('MCP: no console_control_toolbar tool');
  return { file: rel, id: asset.id, settingsId, buttons: buttons.length, errors };
}

export function pluginToolbarAssets(): string[] {
  const out: string[] = [];
  for (const app of ['apps/console-web/plugins', 'apps/molly/plugins', 'apps/amberx-droid/src/plugins', 'apps/axhub-web/src/plugins']) {
    const base = join(ROOT, app);
    if (!existsSync(base)) continue;
    for (const p of readdirSync(base)) {
      const d = join(base, p, 'assets', 'toolbar');
      // UI Review options (tag ui-choice) are looks of the same toolbar, used once picked: checked with their page's asset, not listed on their own
      // placeholder defaults (toolbar-owner@1: default-<plugin>-toolbar with only the Settings button) are not drawn by a page
      // until the plugin builds its own toolbar; framework/cli/toolbar-owner.mjs check holds them
      if (existsSync(d)) for (const f of readdirSync(d)) { if (!f.endsWith('.json')) continue; const tags: string[] = JSON.parse(read(join(d, f)) || '{}').tags ?? []; if (!tags.includes('ui-choice') && !tags.includes('placeholder')) out.push(join(d, f)); }
    }
  }
  return out.sort();
}

async function main(argv: string[]) {
  const json = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--')).map((f) => resolve(f));
  const list = files.length ? files : pluginToolbarAssets();
  const results = [];
  for (const f of list) results.push(await checkToolbarAsset(f));
  const bad = results.filter((r) => r.errors.length);
  if (json) console.log(JSON.stringify({ ok: !bad.length, results }, null, 2));
  else {
    for (const r of results) {
      console.log(`${r.errors.length ? '✗' : '✓'} toolbar:${r.settingsId} (${r.id}, ${r.buttons} buttons) — ${r.file}`);
      for (const e of r.errors) console.log(`    ${e}`);
    }
    console.log(bad.length ? `✗ ${bad.length} of ${results.length} page toolbar(s) fail` : `✓ ${results.length} page toolbar(s): wired, drawn, every button reachable by deep link, REST, MCP, CLI and voice`);
  }
  process.exitCode = bad.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2));
