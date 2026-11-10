#!/usr/bin/env node
/**
 * Molly menus and skin, without the UI (flagship skin s10): the engine behind this plugin's REST routes (server/),
 * and through plugin-commands@1 its MCP tools, CLI and voice. Molly is a browser app, so everything here works on what
 * Molly itself reads live: its look document on axHub (skin, slots: Molly follows a change at once through the hub's
 * change feed), its menu assets, the look choices (apps/molly/menus/choices.json) and its deep links
 * (apps/molly/src/molly/links.ts) for what only a browser can do (open a menu, run a menu action, open a dialog).
 *
 *   node molly.mjs state                    skin, every choice's value, live status, deep links
 *   node molly.mjs tree [app-menu|context-menu]   the menus with paths, kinds, actions, current values and status sources
 *   node molly.mjs choices                  the look choices and their current values
 *   node molly.mjs set <choice> <value>     set a look choice (skin, mode, density, text, motion)
 *   node molly.mjs skin [<id>|own]          read, or switch the skin (own = Molly's own look)
 *   node molly.mjs invoke <path> [<value>]  run a menu item: a choice is set, anything else answers the deep link that runs it
 *   node molly.mjs links                    every deep link (skin picker, app menu, each sub-menu, item settings)
 *   node molly.mjs status                   live status: axHub, look sync, skin
 *   add --json for machine output. AXF_MOLLY_URL = Molly's address (default https://molly.amberxai.com).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLook, writeLook, readGlobal, skinRows, snapshot } from '../../../../framework/cli/skins.mjs';
import { pickSkin, setLookSlot, setUseSkin, resolveLookSkin } from '../../../../framework/core/engines/skin-rules.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../..'));
export const APP = 'molly';
export const MOLLY_URL = (process.env.AXF_MOLLY_URL || 'https://molly.amberxai.com').replace(/\/+$/, '');
const MOLLY = join(ROOT, 'apps/molly');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export class MollyError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const choiceDefs = () => readJson(join(MOLLY, 'menus/choices.json'))?.choices ?? [];
const manifest = () => readJson(join(MOLLY, 'axf.manifest.json')) ?? { defaults: {} };
const assetFile = (type, id) => [join(MOLLY, 'src/assets', type, `${id}.json`), join(MOLLY, 'src/axf/assets', type, `${id}.json`)].find(existsSync);
const asset = (type, id) => { const f = assetFile(type, id); return f ? readJson(f) : null; };
export const link = (hash) => `${MOLLY_URL}/#/${hash}`;

/* ---------------- the look: skin and slots as Molly will draw them ---------------- */

function look() { return readLook(APP); }
function ensureLook() {
  const l = look();
  if (l) return l;
  snapshot(APP); // first change: Molly's look document starts from the shared look, like Settings → Appearance does
  const n = look();
  if (!n) throw new MollyError('unexpected', "can't create Molly's look document on axHub");
  return n;
}

/** The skin in force for Molly ('own' = none) and where it came from. */
export function skinState() {
  const l = look();
  const r = resolveLookSkin(l, readGlobal(), null);
  const id = r?.id || '';
  const row = skinRows().find((s) => s.id === id);
  return { id: id || 'own', name: row?.name ?? "Molly's own look", from: r?.from ?? 'app', useSkin: !!l?.skin.use, picked: l?.skin.id ?? '', document: !!l };
}

/** The asset in a slot as Molly draws it: the skin (and its overrides) while one is on, else Molly's own picks, else its defaults. */
export function slotValue(slot) {
  const l = look();
  const sk = skinState();
  if (sk.id !== 'own') {
    if (l?.skin.overrides?.[slot]) return l.skin.overrides[slot];
    const data = asset('skin', sk.id)?.data ?? asset('design-package', sk.id)?.data;
    const theme = { 'color-theme': 'colorTheme', 'style-theme': 'styleTheme', layout: 'layoutTheme' }[slot];
    const fromSkin = theme ? data?.[theme] : data?.assets?.[slot] ?? data?.extras?.slots?.[slot] ?? data?.[slot];
    if (fromSkin) return fromSkin;
  }
  return l?.own?.slots?.[slot] ?? l?.default?.slots?.[slot] ?? manifest().defaults?.[slot] ?? '';
}

export function choiceValue(d) {
  if (d.kind === 'skin') return skinState().id;
  if (d.kind === 'mode') {
    const sk = skinState().id;
    const by = (map, id) => Object.keys(map ?? {}).find((m) => map[m] === id);
    return (sk !== 'own' ? by(d.skins, sk) : by(d.colors, slotValue('color-theme'))) ?? d.values[0];
  }
  return slotValue(d.slot);
}

export function choices() {
  return choiceDefs().map((d) => ({ id: d.id, key: d.key, label: d.label, kind: d.kind, values: d.values, value: choiceValue(d), link: (v) => link(`set/${d.id}/${v}`) })).map((c) => ({ ...c, links: Object.fromEntries(c.values.map((v) => [v, c.link(v)])), link: undefined }));
}

export function findChoice(id) {
  const d = choiceDefs().find((x) => x.id === id || x.key === id);
  if (!d) throw new MollyError('not_found', `no look choice "${id}": one of ${choiceDefs().map((x) => x.id).join(', ')}`);
  return d;
}

/** Set one look choice in Molly's look document. Molly follows it live. */
export function setChoice(id, value, by = 'molly-menus') {
  const d = findChoice(id);
  if (!d.values.includes(value)) throw new MollyError('validation', `${d.label} is one of: ${d.values.join(', ')}`);
  const l = ensureLook();
  let next;
  if (d.kind === 'skin') next = value === 'own' ? setUseSkin(l, false) : setUseSkin(pickSkin(l, value), true);
  else if (d.kind === 'mode') {
    const sk = skinState().id;
    next = Object.values(d.skins ?? {}).includes(sk) && d.skins[value] ? setUseSkin(pickSkin(l, d.skins[value]), true) : setLookSlot(l, 'color-theme', d.colors[value]);
  } else next = setLookSlot(l, d.slot, value);
  writeLook(next, by);
  return { changed: true, choice: d.id, value: choiceValue(d), skin: skinState() };
}

export function setSkin(id, by = 'molly-menus') {
  if (id !== 'own' && !skinRows().some((s) => s.id === id)) throw new MollyError('not_found', `no skin "${id}": one of own, ${skinRows().map((s) => s.id).join(', ')}`);
  const l = ensureLook();
  writeLook(id === 'own' ? setUseSkin(l, false) : setUseSkin(pickSkin(l, id), true), by);
  return { changed: true, skin: skinState() };
}

/* ---------------- menus ---------------- */

/** Molly's own menus, each row with its path (menu-item@2), kind, action, current value and status source. */
export function tree(root = '') {
  const choicesByKey = Object.fromEntries(choiceDefs().map((d) => [d.key, d]));
  const node = (it, trail) => {
    const path = [...trail, it.id].join('/');
    if (it.separator) return { id: it.id, path, kind: 'separator' };
    const kind = it.setting ? 'choice' : it.items ? 'submenu' : it.provider ? 'live-list' : 'action';
    const out = { id: it.id, path, kind, label: it.label, icon: it.icon, hint: it.hint };
    if (it.action) out.action = it.action;
    if (it.shortcut) out.shortcut = it.shortcut;
    if (it.setting) {
      const d = choicesByKey[it.setting];
      out.setting = it.setting;
      out.choices = it.choices;
      if (d) out.value = choiceValue(d);
    }
    if (it.status) out.status = typeof it.status === 'string' ? it.status : it.status.source;
    if (it.items) out.items = it.items.map((c) => node(c, [...trail, it.id]));
    if (root !== 'raw' && trail[0] === 'app-menu' && kind === 'submenu') out.link = link(`menu/${[...trail.slice(1), it.id].join('/')}`);
    if (kind !== 'separator') out.settingsLink = link(`item-settings/${path}`);
    return out;
  };
  const menus = asset('app-menu', 'molly')?.data?.menus ?? [];
  const ctx = asset('context-menu', 'molly')?.data?.targets ?? {};
  const out = {};
  if (!root || root === 'app-menu') out['app-menu'] = menus.map((m) => ({ id: m.id, label: m.label, path: `app-menu/${m.id}`, link: link(`menu/${m.id}`), items: m.items.map((i) => node(i, ['app-menu', m.id])) }));
  if (!root || root === 'context-menu') out['context-menu'] = Object.entries(ctx).map(([t, items]) => ({ id: t, path: `context-menu/${t}`, items: items.map((i) => node(i, ['context-menu', t])) }));
  out.note = 'Molly\'s own menus. Plugins add theirs at run time (View: Layout, Navigation, Banners, Toolbar designer; context rows) and the framework adds Help and the chrome rows: apps/molly/menus/inventory.md lists every command.';
  return out;
}

function findItem(path) {
  const t = tree();
  let hit = null;
  const walk = (items) => { for (const i of items ?? []) { if (i.path === path) hit = i; walk(i.items); } };
  for (const m of t['app-menu']) walk(m.items);
  for (const c of t['context-menu']) walk(c.items);
  if (!hit) throw new MollyError('not_found', `no menu item at ${path} (molly.mjs tree lists the paths)`);
  return hit;
}

/** Run a menu item: a choice is set here; anything else answers the deep link that runs it in Molly. */
export function invoke(path, value = '', payload = '') {
  const it = findItem(path);
  if (it.kind === 'separator') throw new MollyError('validation', `${path} is a separator`);
  if (it.kind === 'choice') {
    const d = choiceDefs().find((x) => x.key === it.setting);
    if (!d) throw new MollyError('not_implemented', `${path} sets ${it.setting}, which is not a look choice`);
    const v = value || (it.choices?.length === 2 ? it.choices.find((c) => c.value !== choiceValue(d))?.value : '');
    if (!v) throw new MollyError('validation', `${it.label} needs a value: one of ${d.values.join(', ')}`);
    return { ran: 'set', ...setChoice(d.id, String(v)) };
  }
  if (it.kind === 'submenu') return { ran: 'link', link: it.link ?? link(`menu/${path.split('/').slice(1).join('/')}`), note: 'opens the sub-menu' };
  let action = it.action ?? '';
  if (action.includes('{payload}')) {
    if (!payload) throw new MollyError('validation', `${it.label} needs a payload (an app id: amberx, axhub, console, expenses)`);
    action = action.replace('{payload}', payload);
  }
  const nav = /^nav:([a-z0-9-]+)$/.exec(action);
  return { ran: 'link', action, link: nav ? link(nav[1]) : link(`do/${action}`), note: 'open the link on the device running Molly; it runs there at once' };
}

export function links() {
  const t = tree('app-menu');
  const subs = [];
  const walk = (items) => { for (const i of items ?? []) { if (i.kind === 'submenu') subs.push({ path: i.path, label: i.label, link: i.link }); walk(i.items); } };
  for (const m of t['app-menu']) walk(m.items);
  return {
    molly: MOLLY_URL,
    skinPicker: link('skin'),
    appMenu: t['app-menu'].map((m) => ({ id: m.id, label: m.label, link: m.link })),
    subMenus: subs,
    itemSettings: `${MOLLY_URL}/#/item-settings/<item path>`,
    setChoice: `${MOLLY_URL}/#/set/<choice>/<value>`,
    runAction: `${MOLLY_URL}/#/do/<action from Molly's menus>`,
    apps: ['amberx', 'axhub', 'console', 'expenses'].map((a) => ({ app: a, link: link(a) })),
  };
}

/** Live status as the server sees it: axHub answering, Molly's look document, the skin in force. */
export async function status() {
  const hub = manifest().developer?.hub ?? 'https://axhub.amberxai.com';
  let hubState = { state: 'unknown', text: 'Not checked' };
  try {
    const r = await fetch(hub, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(4000) });
    hubState = r.status < 500 ? { state: 'on', text: `axHub answered ${r.status}` } : { state: 'off', text: `axHub answered ${r.status}` };
  } catch (e) { hubState = { state: 'off', text: `axHub unreachable: ${String(e?.message ?? e).slice(0, 120)}` }; }
  const l = look();
  const lookState = l ? { state: 'on', text: `Look document on axHub, updated ${l.updatedAt ?? 'unknown'} by ${l.updatedBy ?? 'unknown'}` } : { state: 'warn', text: 'No look document yet: Molly uses its defaults until the first change' };
  const sk = skinState();
  return { hub: { ...hubState, url: hub }, look: lookState, skin: { state: sk.id === 'own' ? 'unknown' : 'on', text: sk.name, id: sk.id } };
}

export async function state() {
  return { app: APP, url: MOLLY_URL, skin: skinState(), skins: [{ id: 'own', name: "Molly's own look" }, ...skinRows().map((s) => ({ id: s.id, name: s.name, kind: s.kind }))], choices: choices(), status: await status(), links: links() };
}

/* ---------------- CLI ---------------- */

async function cli(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const [cmd = 'state', a, b, c] = args;
  const out = cmd === 'state' ? await state()
    : cmd === 'tree' ? tree(a ?? '')
    : cmd === 'choices' ? { choices: choices() }
    : cmd === 'set' ? setChoice(a ?? '', b ?? '', 'molly-menus-cli')
    : cmd === 'skin' ? (a ? setSkin(a, 'molly-menus-cli') : { skin: skinState() })
    : cmd === 'invoke' ? invoke(a ?? '', b ?? '', c ?? '')
    : cmd === 'links' ? links()
    : cmd === 'status' ? await status()
    : (() => { throw new MollyError('invalid', `unknown command ${cmd}: state | tree | choices | set | skin | invoke | links | status`); })();
  process.stdout.write(json ? `${JSON.stringify({ ok: true, ...out })}\n` : `${JSON.stringify(out, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch((e) => {
    const code = e instanceof MollyError ? e.code : 'unexpected';
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ ok: false, code, message: e.message })}\n`);
    else console.error(`molly-menus: ${e.message}`);
    process.exit(1);
  });
}
