/**
 * check-page-toolbar-voice — every page toolbar button resolves to the same button through REST, MCP, the CLI and
 * AmberX voice (page-toolbar@1; build rebuild-every-toolbar-page-specific; Brett, Nov 8 2026: "Everything comes with an API").
 *
 * The voice inventory (spec/fixtures/page-toolbar-voice.json) holds one phrase per button, "press <button> on the
 * <toolbar> toolbar", with the address it must reach. This check builds the console's target list the way
 * apps/console-web/src/control/toolbars.ts registers it (every page toolbar resolved through the engine), then for each
 * button:
 *   - voice: voiceIntent(phrase) → searchTargets → the top hit is `toolbar:<id>/button:<b>`, and intentCommand gives
 *     { verb: 'press', address } on that address;
 *   - CLI / REST: `axf console toolbar press <id> <b>` builds POST /api/console-control/toolbars/<id>/press {button: b};
 *   - MCP: console_control_toolbar {toolbar: <id>, button: <b>} names the same pair;
 *   - control@1: console.toolbars act press, path <id>/<b>.
 * All four must name the same toolbar and button, and the inventory must match what the assets ship.
 *
 *   npx -y tsx framework/spec/check-page-toolbar-voice.mts [--write]   (--write regenerates the inventory)
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePageToolbar, type ResolvedToolbar, type ToolbarAssetLike } from '../core/engines/toolbar-actions';
import { parseActionRef, parseToolbarScope } from '../core/engines/toolbar-rules.mjs';
import { searchTargets, type ControlTarget } from '../core/engines/console-control';
import { intentCommand, voiceIntent } from '../core/engines/console-control-voice.mjs';
import { toRequest } from '../cli/console-control.mjs';
import { pluginToolbarAssets } from './check-page-toolbars.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'framework/spec/fixtures/page-toolbar-voice.json');

interface Phrase { phrase: string; toolbar: string; button: string; address: string; asset: string }

/** Every page toolbar, resolved with everything wired (the console's live view of it). */
function resolvedToolbars(): { asset: ToolbarAssetLike & { name?: string }; t: ResolvedToolbar; file: string }[] {
  return pluginToolbarAssets().map((file) => {
    const asset = JSON.parse(readFileSync(file, 'utf8')) as ToolbarAssetLike & { name?: string };
    const data = asset.data as unknown as { scope?: string; slot?: string; groups: { items: { action?: string }[] }[] };
    const scope = parseToolbarScope(data.scope);
    const refs = data.groups.flatMap((g) => g.items.map((i) => parseActionRef(i.action))).filter((r): r is NonNullable<typeof r> => !!r);
    const t = resolvePageToolbar(asset, { view: scope?.kind === 'view' ? scope.id : null, plugin: scope?.kind === 'plugin' ? scope.id : null, slot: data.slot ?? 'main' }, {}, {
      get: () => undefined,
      handlers: refs.filter((r) => r.kind === 'handler').map((r) => r.id),
      actions: refs.filter((r) => r.kind === 'action').map((r) => r.id.split(':')[0] ?? r.id),
    });
    return { asset, t, file };
  });
}

/** The targets the console registers for these toolbars (src/control/toolbars.ts: same labels, details, keywords). */
function targetsOf(list: ReturnType<typeof resolvedToolbars>): ControlTarget[] {
  const out: ControlTarget[] = [];
  for (const { t } of list) {
    out.push({ address: t.address, kind: 'toolbar', label: t.label, detail: `Toolbar · ${t.asset}`, keywords: [t.id, t.asset, t.label, 'toolbar'] } as ControlTarget);
    for (const b of t.groups.flatMap((g) => g.buttons)) {
      out.push({ address: b.address, kind: 'button', label: b.label, detail: `${t.label} toolbar`, keywords: [b.id, b.label, t.label, t.id, ...(b.ref ? [b.ref.id] : [])] } as ControlTarget);
    }
  }
  return out;
}

export function phrasesOf(list = resolvedToolbars()): Phrase[] {
  return list.flatMap(({ asset, t }) => t.groups.flatMap((g) => g.buttons).map((b) => ({
    phrase: `press ${b.label.toLowerCase()} on the ${(asset.name ?? t.label).toLowerCase()} toolbar`,
    toolbar: t.id, button: b.id, address: b.address, asset: t.asset,
  })));
}

function main(argv: string[]) {
  const list = resolvedToolbars();
  const phrases = phrasesOf(list);
  if (argv.includes('--write')) {
    writeFileSync(FIXTURE, `${JSON.stringify({ $axf: 'page-toolbar-voice@1', note: 'One AmberX phrase per page toolbar button and the address it reaches (framework/spec/check-page-toolbar-voice.mts --write).', count: phrases.length, phrases }, null, 2)}\n`);
    console.log(`wrote ${relative(ROOT, FIXTURE)} (${phrases.length} phrases)`);
  }
  const saved = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { phrases: Phrase[] };
  assert.deepEqual(saved.phrases, phrases, 'the voice inventory matches the toolbar assets (run with --write after changing a toolbar)');
  const targets = { targets: targetsOf(list) };
  let n = 0;
  for (const p of phrases) {
    // voice
    const intent = voiceIntent(p.phrase) as { verb: string; find: { q: string; kinds: string[] } } | null;
    assert.ok(intent && intent.verb === 'press', `${p.phrase}: a press intent`);
    const hits = searchTargets(targets, { q: intent.find.q, kinds: intent.find.kinds as never });
    assert.equal(hits[0]?.address, p.address, `voice "${p.phrase}" → ${hits[0]?.address ?? 'nothing'} (wanted ${p.address})`);
    const cmd = intentCommand(intent, hits[0]?.address ?? null) as { verb: string; address: string };
    assert.deepEqual([cmd.verb, cmd.address], ['press', p.address], `${p.phrase}: the command`);
    // CLI → REST
    const req = toRequest(['toolbar', 'press', p.toolbar, p.button]) as { method: string; path: string; body: { button: string } };
    assert.deepEqual([req.method, req.path, req.body.button], ['POST', `/toolbars/${encodeURIComponent(p.toolbar)}/press`, p.button], `${p.phrase}: CLI / REST`);
    // MCP and control@1 name the same pair the address carries
    assert.equal(`toolbar:${p.toolbar}/button:${p.button}`, p.address, `${p.phrase}: MCP console_control_toolbar {toolbar, button} and control@1 path ${p.toolbar}/${p.button}`);
    n++;
  }
  console.log(`✓ ${n} page toolbar buttons on ${list.length} toolbars: voice, REST, MCP, CLI and control@1 reach the same button`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
