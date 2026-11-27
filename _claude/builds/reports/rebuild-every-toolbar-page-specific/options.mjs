#!/usr/bin/env node
/**
 * UI Review options for the rebuilt page toolbars (build rebuild-every-toolbar-page-specific, s27; ui-choices@1).
 * Three looks per toolbar, each a real toolbar asset (the same buttons and bindings, another look):
 *   dense    icons only, everything on the bar
 *   labels   icons + text (what ships by default)
 *   grouped  icons + text, the first group on the bar and the rest in More
 * Writes, for every page toolbar asset, a choices file for review.mjs submit --choices and one capture plan for
 * framework/cli/rebuild-shots.mjs (each option is drawn on its page by restyling the live toolbar: a predicted look).
 *
 *   node _claude/builds/reports/rebuild-every-toolbar-page-specific/options.mjs <out dir>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = resolve(process.argv[2] ?? '/tmp/toolbar-options');
mkdirSync(out, { recursive: true });

/** Where each toolbar lives: the console search phrase that opens its page (the capture's first step). */
const OPEN = {
  'build-orchestrator': 'Build orchestrator', 'ui-review': 'UI Review', 'plan-studio': 'Plan Studio', 'terminal': 'Terminal',
  'plugin-manager': 'Plugin Manager', 'push-banner': 'Merge queue', 'agent-swarm': 'Agent swarm', 'systems-check': 'Systems check',
  'notify-control': 'Notifications', 'chat-viewer': 'Chats', 'codebase-changes': 'Codebase changes', 'theme-manager': 'Theme manager',
  'gate': 'Gate & rules', 'glossary-index': 'Glossary', 'claude-accounts': 'Claude accounts', 'data-store': 'Data store',
  'shipped-features': 'Shipped features', 'wake-listener': 'Wake word',
};

const LOOKS = [
  { id: 'dense', label: 'Dense icons', notes: 'Icons only: every button on one short bar; the names are in the tooltips and the API.',
    data: (d) => ({ ...d, variant: 'icons', overflow: { when: 'auto', keep: 0, label: 'More' } }),
    css: '.fx-toolbar--page .fx-toolbtn > span:not(.fx-toolbtn__badge){display:none}' },
  { id: 'labels', label: 'Icons + text', notes: 'Icon and name on every button, overflow only when the bar runs out of room (ships as the default).',
    data: (d) => d, css: '' },
  { id: 'grouped', label: 'Grouped with overflow', notes: 'The first group on the bar, the rest in More: the calmest bar on a phone.',
    data: (d) => ({ ...d, groups: d.groups.map((g, i) => (i === 0 ? g : { ...g, items: g.items.map((it) => ({ ...it, overflow: 'always' })) })) }),
    css: '.fx-toolbar--page > .fx-toolbar__group:not(:first-child):not(.fx-toolbar__more){display:none}' },
];

const shots = [];
const items = [];
const base = join(ROOT, 'apps/console-web/plugins');
for (const folder of readdirSync(base).sort()) {
  const dir = join(base, folder, 'assets/toolbar');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if ((a.tags ?? []).includes('ui-choice')) continue;
    const scope = a.data.scope.split(':')[1];
    const id = `${scope}${a.data.slot && a.data.slot !== 'main' ? `.${a.data.slot}` : ''}`;
    const sel = `[data-axf-toolbar="${id}"]`;
    const open = OPEN[scope] ?? a.name;
    for (const look of LOOKS) {
      shots.push({ name: `opt-${look.id}--${a.id}`, steps: [
        { search: open }, { wait: 1500 },
        ...(look.css ? [{ eval: `(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(look.css)};document.head.appendChild(s);})()` }] : []),
        { eval: `document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'center'})` }, { wait: 400 },
      ], viewports: ['phone', 'desktop'] });
    }
    items.push({ asset: a.id, toolbar: id, owner: folder, name: a.name, file: join(dir, f) });
    writeFileSync(join(out, `choices-${a.id}.json`), `${JSON.stringify({
      assetType: 'toolbar', owner: folder, set: `toolbar-${a.id}`,
      options: LOOKS.map((look) => ({ id: look.id, label: look.label, notes: look.notes, shots: ['phone', 'desktop'].map((v) => join(out, 'after', `opt-${look.id}--${a.id}-${v}.png`)), data: { ...look.data(a.data), scope: a.data.scope, ...(a.data.slot ? { slot: a.data.slot } : {}) } })),
    }, null, 2)}\n`);
  }
}
writeFileSync(join(out, 'shots.json'), `${JSON.stringify(shots, null, 2)}\n`);
writeFileSync(join(out, 'items.json'), `${JSON.stringify(items, null, 2)}\n`);
console.log(`${items.length} toolbars, ${shots.length} option captures → ${out}`);
