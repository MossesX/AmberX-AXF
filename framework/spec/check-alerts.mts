/**
 * Self-test for the alerts core on the web port (CI: npx -y tsx framework/spec/check-alerts.mts).
 * The engine itself is pinned by spec/fixtures/alerts.json; this checks what the fixtures can't: the runtime's
 * conflict detection (asset ids, setting keys, settings tabs) and the AlertCenter wrapper.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlertCenter, diagnosticToAlert, type Diagnostic } from '../core/engines/alerts';
import { AssetRegistry } from '../core/registry';
import { AxfRuntime } from '../core/runtime';
import { SettingsRegistry } from '../core/settings';

const root = new URL('../', import.meta.url).pathname;

// asset registry: same origin = an update (no report); another origin with other content = a conflict
{
  const reg = new AssetRegistry();
  const seen: unknown[] = [];
  reg.onReplace = (r) => seen.push(r);
  const theme = JSON.parse(readFileSync(join(root, 'assets/color-theme', readdirSync(join(root, 'assets/color-theme'))[0]!), 'utf8'));
  assert.equal(reg.register(theme, 'builtin').ok, true);
  reg.register(theme, 'builtin');
  reg.register({ ...theme }, 'imported', 'ai.example.a'); // same content from someone else: not a clash
  assert.equal(seen.length, 0);
  reg.register({ ...theme, name: 'Other' }, 'imported', 'ai.example.b');
  assert.deepEqual(seen, [{ type: 'color-theme', id: theme.id, was: 'ai.example.a', now: 'ai.example.b' }]);
}

// settings registry: two modules, same key / tab / group id
{
  const s = new SettingsRegistry('test:settings');
  const seen: { what: string; id: string }[] = [];
  s.onConflict = (c) => seen.push({ what: c.what, id: c.id });
  s.addTab({ id: 'themes', label: 'Themes', icon: 'palette', order: 1, module: 'a' });
  s.addTab({ id: 'themes', label: 'Themes', icon: 'palette', order: 1, module: 'a' }); // re-install: fine
  s.addTab({ id: 'themes', label: 'Themes 2', icon: 'palette', order: 2, module: 'b' });
  s.addGroup({ id: 'a.colors', tab: 'themes', title: 'A', module: 'a', settings: [{ key: 'theme.accent', label: 'Accent', kind: 'text', default: '' }] } as never);
  s.addGroup({ id: 'b.colors', tab: 'themes', title: 'B', module: 'b', settings: [{ key: 'theme.accent', label: 'Accent', kind: 'text', default: '' }] } as never);
  assert.deepEqual(seen, [{ what: 'tab', id: 'themes' }, { what: 'setting', id: 'theme.accent' }]);
}

// runtime: reports reach diagnostics (and are kept for late subscribers); badges
{
  const assets = ['color-theme', 'style-theme', 'layout', 'app-menu', 'toolbar', 'nav-menu', 'context-menu', 'dialog', 'popup', 'button', 'slider', 'container', 'uac-policy']
    .flatMap((t) => readdirSync(join(root, 'assets', t)).map((f) => JSON.parse(readFileSync(join(root, 'assets', t, f), 'utf8'))));
  const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
  const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults: defaults.defaults ?? defaults } as never, assets, storageKey: 'test:rt' });
  const theme = assets.find((a) => a.type === 'color-theme');
  rt.importAsset({ ...theme, name: 'Clash' }, false, 'ai.example.themes');
  const late: Diagnostic[] = [];
  rt.diagnostics.subscribe((d) => late.push(d), true);
  assert.equal(late.length, 1);
  assert.equal(late[0]!.kind, 'asset-conflict');
  assert.equal(diagnosticToAlert(late[0]!).key, `conflict:asset:color-theme/${theme.id}`);
  assert.equal(rt.badge('alerts.unread'), 0);
  rt.setBadge('alerts.unread', 3);
  assert.equal(rt.badge('alerts.unread'), 3);
}

// AlertCenter: raise → change with targets; repeat keeps ack; unread
{
  let now = 1000;
  const c = new AlertCenter({ now: () => now });
  const changes: string[] = [];
  c.onChange((x) => changes.push(`${x.event}:${x.targets.join('+')}`));
  c.raise({ source: 'ci', severity: 'error', title: 'Red' });
  c.ack('all');
  now = 2000;
  c.raise({ source: 'ci', severity: 'error', title: 'Red' });
  assert.equal(c.unread, 0, 'a repeat keeps the acknowledgement');
  c.raise({ source: 'ci', severity: 'critical', title: 'Red' });
  assert.equal(c.unread, 1);
  assert.deepEqual(changes, ['new:bell+ntfy+webpush', 'repeat:bell', 'escalated:bell+ntfy+webpush']);
}

console.log('alerts library core: all checks passed');
