#!/usr/bin/env node
/**
 * The Hub screens' page toolbars (page-toolbar@1), three looks per screen, written from the hub-console@1 route table
 * (build move-everything-axhub-web-console s30; ui-choices@1: every option a real asset, picked or not):
 *
 *   hub-<screen>            Standard   icons + labels, the screen's commands in one row
 *   hub-<screen>-dense      Dense      icons only, compact, the phone's row
 *   hub-<screen>-grouped    Grouped    labels, the commands grouped (read / do / go to), a More menu early
 *
 * Buttons are the screen's non-person actions (`command:hub-admin/<command id>`, the same commands REST, MCP and the CLI
 * run) plus the jumps between hub screens (`hub.open:<screen>`). Person actions (approve, deny, grant, …) never sit on a
 * toolbar: they are Brett's tap on the row or the form. Assets land in assets/toolbar/; `--check` fails when they drift.
 *
 *   node apps/console-web/plugins/hub-admin/toolbars.mjs [--check] [--choices <out.json>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hc from '../../../../framework/core/hub-console.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const OUT = join(HERE, 'assets/toolbar');
const table = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/hub-console.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(HERE, 'plugin.json'), 'utf8'));
const commandIdOf = (route) => manifest.commands.items.find((it) => it.route === route && !it.skip)?.id ?? null;

const ICONS = { check: 'refresh', download: 'download', request: 'bell', 'go-end': 'pause', 'auto-stop': 'x-circle', 'notify-phone': 'smartphone', invite: 'plus', add: 'plus', 'sign-in': 'shield', send: 'rocket', 'client-add': 'plus', 'token-create': 'key' };
const JUMPS = { approvals: ['log', 'passes'], log: ['approvals'], passes: ['log', 'approvals'], users: ['auth', 'account'], account: ['users'], connectors: ['log', 'passes'], handoff: ['account'], auth: ['users'], apps: ['overview'], overview: ['approvals', 'connectors'] };

/** The buttons of one screen: screen-level commands (never a person's tap), then the jumps. */
export function buttonsOf(screen) {
  const cmds = [];
  for (const a of screen.actions) {
    if (a.who === 'person' || a.row) continue;
    const rest = hc.reachesOf(table, screen.id, { action: a.id }).rest.replace(`/api/plugins/${table.plugin}`, '');
    const cid = commandIdOf(rest);
    if (!cid) continue;
    cmds.push({ id: a.id, icon: ICONS[a.id] ?? (a.effect === 'destructive' ? 'trash' : a.effect === 'navigate' ? 'external' : 'play'), label: a.label.length > 24 ? a.label.split(/[:(]/)[0].trim() : a.label, action: `command:${table.plugin}/${cid}`, priority: a.id === 'check' ? 300 : a.who === 'confirm' ? 200 : 250, ...(a.who === 'confirm' ? { confirm: `${a.label}?` } : {}), ...(a.effect === 'destructive' ? { tone: 'danger' } : {}) });
  }
  const jumps = (JUMPS[screen.id] ?? []).map((id) => { const s = hc.screenOf(table, id); return { id: `go-${id}`, icon: s.icon, label: s.title, action: `hub.open:${id}`, priority: 100 }; });
  return { cmds, jumps };
}

export function assetsOf(screen) {
  const { cmds, jumps } = buttonsOf(screen);
  const base = { $axf: 'asset@1', type: 'toolbar', version: '1.0.0', author: 'AmberX AXF', tags: ['page', 'hub', screen.id] };
  const scope = { scope: `view:${table.view}`, slot: screen.id, showSearch: false };
  return [
    { ...base, id: `hub-${screen.id}`, name: `Hub · ${screen.title}`, description: `The ${screen.title} toolbar: its commands with icons and labels in one row, then the jumps to the hub screens it works with. Deciding (approve, deny, grant) stays on the rows and forms: Brett's own tap.`,
      data: { ...scope, variant: 'icons-labels', align: 'start', density: 'regular', overflow: { when: 'auto', keep: 2, label: 'More' }, groups: [{ id: 'do', label: screen.title, items: cmds }, { id: 'go', label: 'Go to', items: jumps }] } },
    { ...base, id: `hub-${screen.id}-dense`, name: `Hub · ${screen.title} (dense)`, description: `The ${screen.title} toolbar as icons only, compact: the phone's row. Labels are the tooltips.`,
      data: { ...scope, variant: 'icons', align: 'start', density: 'compact', overflow: { when: 'auto', keep: 3, label: 'More' }, groups: [{ id: 'do', label: screen.title, items: cmds }, { id: 'go', label: 'Go to', items: jumps }] } },
    { ...base, id: `hub-${screen.id}-grouped`, name: `Hub · ${screen.title} (grouped)`, description: `The ${screen.title} toolbar with labels only, its commands grouped by what they do and a More menu as soon as the row is tight.`,
      data: { ...scope, variant: 'labels', align: 'start', density: 'regular', divider: true, overflow: { when: 'auto', keep: 1, label: 'More' }, groups: [{ id: 'read', label: 'Read', items: cmds.filter((c) => c.priority === 300) }, { id: 'do', label: 'Do', items: cmds.filter((c) => c.priority !== 300) }, { id: 'go', label: 'Go to', items: jumps }].filter((g) => g.items.length) } },
  ];
}

export const OPTION_LABELS = { '': 'Standard: icons and labels', '-dense': 'Dense: icons only (phone)', '-grouped': 'Grouped: labels, early More menu' };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const ci = process.argv.indexOf('--choices');
  mkdirSync(OUT, { recursive: true });
  let drift = 0; const files = [];
  for (const s of hc.screensOf(table)) for (const a of assetsOf(s)) {
    const f = join(OUT, `${a.id}.json`); const text = JSON.stringify(a, null, 2) + '\n';
    files.push(f);
    if (check) { if (!existsSync(f) || readFileSync(f, 'utf8') !== text) { drift++; console.error(`drift: ${f}`); } }
    else writeFileSync(f, text);
  }
  if (ci > 0) {
    const sets = hc.screensOf(table).map((s) => ({ screen: s.id, title: s.title, choices: { assetType: 'toolbar', owner: table.plugin, options: assetsOf(s).map((a, i) => ({ id: a.id, label: OPTION_LABELS[['', '-dense', '-grouped'][i]], notes: a.description, data: a })) } }));
    writeFileSync(process.argv[ci + 1], JSON.stringify(sets, null, 1));
  }
  if (check) { console.log(drift ? `✗ ${drift} toolbar asset(s) drift from the table (run toolbars.mjs)` : `✓ ${files.length} hub toolbar assets current`); process.exitCode = drift ? 1 : 0; }
  else console.log(`wrote ${files.length} toolbar assets to ${OUT}`);
}
