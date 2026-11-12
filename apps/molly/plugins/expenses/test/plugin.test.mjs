/**
 * Molly Expenses plugin checks (no browser): every plugin command's action is registered by the plugin, every screen
 * the manifest's surface lists is a view the plugin provides, and the three navigation options ship as assets.
 *
 *   node apps/molly/plugins/expenses/test/plugin.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
const src = ['index.tsx', 'screens.tsx', 'assistant.tsx'].map((f) => readFileSync(join(dir, 'web', f), 'utf8')).join('\n');
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log(`✗ ${m}`); } };

const registered = new Set([...src.matchAll(/on\('([a-z.]+)'/g)].map((m) => m[1]));
for (const c of manifest.commands.items) ok(registered.has(c.action), `command ${c.id} → action ${c.action} is registered`);
for (const a of ['expenses.open', 'expenses.add', 'expenses.edit', 'expenses.paydays.fill', 'expenses.report.copy', 'expenses.export', 'expenses.settings', 'expenses.refresh'])
  ok(registered.has(a), `UI action ${a} is registered`);
ok(manifest.surface.$axf === 'shell-surface@1' && manifest.surface.app.id === 'expenses' && manifest.surface.mount.kind === 'native', 'surface is a native shell-surface@1');
for (const it of manifest.surface.items) {
  if (it.kind === 'screen') ok(manifest.provides.includes(`view:expenses/${it.id}`) && src.includes(`id: '${it.id}'`), `surface screen ${it.id} is a provided view`);
  if (it.kind === 'action') ok(registered.has(it.id), `surface action ${it.id} is registered`);
}
const assets = readdirSync(join(dir, 'assets', 'nav-menu'));
ok(assets.length >= 3, 'three navigation options ship as nav-menu assets');
for (const f of assets) {
  const a = JSON.parse(readFileSync(join(dir, 'assets', 'nav-menu', f), 'utf8'));
  ok(a.$axf === 'asset@1' && a.type === 'nav-menu' && ['section', 'nested', 'menu'].includes(a.data.placement) && src.includes(`'${a.data.placement}'`), `${f} is a placement the plugin implements`);
}
ok(/role="toolbar" aria-label=/.test(src), 'toolbars carry role and label');

console.log(fails ? `✗ ${fails} of ${n} Molly Expenses plugin checks failed` : `✓ Molly Expenses plugin — ${n} checks`);
process.exit(fails ? 1 : 0);
