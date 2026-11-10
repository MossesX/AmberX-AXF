import type { AxfRuntime } from '../axf/core';
import CHOICES from '../../menus/choices.json';
import appMenu from '../assets/app-menu/molly.json';
import contextMenu from '../assets/context-menu/molly.json';

/**
 * Molly's deep links for its menus and skin (flagship skin s10). Every one is a hash on Molly's address, so the console
 * API (REST, MCP, CLI, voice) hands out a link that opens the same thing a click would:
 *
 *   #/menu/<menu>[/<item>…]        open the application menu, then each sub-menu on the way (#/menu/molly/appearance)
 *   #/skin                         Settings → Appearance (the skin picker)
 *   #/item-settings/<path>         the item-settings dialog of one menu row (path: app-menu/molly/apps/go-axhub)
 *   #/set/<choice>/<value>         a look choice (menus/choices.json: skin, mode, density, text, motion), applied at once
 *   #/do/<action>                  run an action that one of Molly's menus offers (nothing else)
 *
 * `#/<app>/<route>` (molly/apps.ts) stays the link to an app. A link that doesn't match is ignored.
 */
type Item = { id?: string; action?: string; items?: Item[] };

/** Every action Molly's own menus offer (the only ones #/do/ runs). */
export function menuActions(): Set<string> {
  const out = new Set<string>();
  const walk = (items: Item[] = []) => { for (const i of items) { if (i.action) out.add(i.action.replace(/:\{payload\}$/, '')); walk(i.items); } };
  for (const m of (appMenu as { data: { menus: { items: Item[] }[] } }).data.menus) walk(m.items);
  for (const t of Object.values((contextMenu as { data: { targets: Record<string, Item[]> } }).data.targets)) walk(t);
  return out;
}

const choices = (CHOICES as { choices: { id: string; key: string; values: string[] }[] }).choices;

export type MollyLink =
  | { kind: 'menu'; path: string[] }
  | { kind: 'skin' }
  | { kind: 'item-settings'; path: string }
  | { kind: 'set'; key: string; value: string }
  | { kind: 'do'; action: string };

/** What a hash asks for, or null. Pure. */
export function parseMollyLink(hash: string): MollyLink | null {
  const parts = hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  const [head, ...rest] = parts;
  if (head === 'menu' && rest[0]) return { kind: 'menu', path: rest.filter(Boolean) };
  if (head === 'skin') return { kind: 'skin' };
  if (head === 'item-settings' && rest.length >= 3) return { kind: 'item-settings', path: rest.join('/') };
  if (head === 'set' && rest.length === 2) {
    const c = choices.find((x) => x.id === rest[0] || x.key === rest[0]);
    return c && c.values.includes(rest[1]!) ? { kind: 'set', key: c.key, value: rest[1]! } : null;
  }
  if (head === 'do' && rest.length) {
    const action = rest.join('/');
    const base = action.split(':').slice(0, 2).join(':');
    const known = menuActions();
    return known.has(action) || known.has(base) || known.has(action.split(':')[0]!) ? { kind: 'do', action } : null;
  }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open the application menu along a path: the menu's button, then each sub-menu row (hover opens it). */
async function openMenu(path: string[]) {
  const [menu, ...items] = path;
  for (let i = 0; i < 20 && !document.querySelector(`[data-axf-menu-btn="${CSS.escape(menu!)}"]`); i++) await wait(100);
  const btn = document.querySelector<HTMLButtonElement>(`[data-axf-menu-btn="${CSS.escape(menu!)}"]`);
  if (!btn) return;
  if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
  let prefix = `app-menu/${menu}`;
  for (const id of items) {
    prefix = `${prefix}/${id}`;
    await wait(60);
    const row = document.querySelector<HTMLElement>(`[data-axf-path="${CSS.escape(prefix)}"]`);
    if (!row) return;
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }
}

/** Follow a Molly link. Returns whether the hash was one. */
export function followMollyLink(rt: AxfRuntime, hash: string): boolean {
  const l = parseMollyLink(hash);
  if (!l) return false;
  if (l.kind === 'menu') void openMenu(l.path);
  else if (l.kind === 'skin') rt.dispatch('settings.open:appearance');
  else if (l.kind === 'item-settings') rt.dispatch(`menu.item.settings:${l.path}`);
  else if (l.kind === 'set') rt.settings.set(l.key, l.value);
  else rt.dispatch(l.action);
  return true;
}
