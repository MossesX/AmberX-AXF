/**
 * Item settings for any menu row (menu-item@2 s4; Brett, Nov 10 2026: "Access everything, even redundantly"): right-click
 * a row of the application menu or a context menu and this dialog opens on the row's path. Two tabs:
 *
 *   Behaviour   label, icon, hint, action, shortcut, visible, order
 *   Appearance  text colour, icon colour, weight, emphasis, text size (theme tokens only, never a literal colour)
 *
 * Every field is a token on that one item (core/engines/menu-item-rules.mjs MENU_ITEM_TOKENS). What the person sets is
 * saved as an override under `axf.tokens.menu` through `rt.setMenuToken` (the same store control@1 `tokens.menu` and the
 * inline-edit build's element dialog write), shared through the axHub look; the item inherits everything left unset.
 * Reset puts one token, or the whole item, back to what the asset says. Open menus re-render as the values change.
 *
 * Reached without the UI: action `menu.item.settings:<path>` (console_action, voice), `menu.item.set:<path>:<token>:<value>`,
 * `menu.item.reset:<path>[:<token>]`; REST / MCP / CLI through control@1 `tokens.menu` (spec/CONTROL.md).
 */
import { useState } from 'react';
import { MENU_ITEM_APPEARANCE_TOKENS, MENU_ITEM_BEHAVIOR_TOKENS, MENU_ITEM_DIALOG, MENU_ITEM_TOKENS, type CompiledMenuItem, type MenuTokenValue } from '../../core/engines/appmenu';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, IconButton } from './Controls';
import { Note, SelectField, Switch, TextField } from './Forms';
import { Icon } from './Icon';
import type { DialogMap } from './Overlays';
import { TabGroup } from './TabGroup';

export const MENU_ITEM_SETTINGS_DIALOG = MENU_ITEM_DIALOG;
type Tab = 'behaviour' | 'appearance';

/** The compiled application-menu item at `path`, when the path is in the application menu (context items have no tree at hand). */
export function findMenuItem(items: readonly CompiledMenuItem[], path: string): CompiledMenuItem | null {
  for (const it of items) {
    if (it.path === path) return it;
    if (it.items?.length) { const hit = findMenuItem(it.items, path); if (hit) return hit; }
  }
  return null;
}

const titleCase = (s: string) => s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const optionLabel = (token: string, v: string) => (v === 'theme' ? 'The theme’s' : v === 'none' && token === 'emphasis' ? 'None' : titleCase(v));

/** The dialog body: two tabs of per-item tokens with per-token reset, and Reset this item. */
export function MenuItemSettingsPanel({ path }: { path: string }) {
  const rt = useRuntime();
  useAxfState();
  const [tab, setTab] = useState<Tab>('behaviour');
  const over = rt.menuItemTokens(path);
  // the row as the asset and contributions say it (before any override: the inherited values); a context-menu row only shows its path
  const item = path.startsWith('app-menu/') ? rt.appMenu({ overrides: false }).menus.flatMap((m) => findMenuItem(m.items, path) ? [findMenuItem(m.items, path)!] : [])[0] ?? null : null;
  const inherited = (token: string): MenuTokenValue | undefined => {
    if (!item) return MENU_ITEM_TOKENS[token]?.default;
    switch (token) {
      case 'label': return item.label; case 'icon': return item.icon ?? ''; case 'hint': return item.hint ?? ''; case 'action': return item.action ?? ''; case 'shortcut': return item.shortcut ?? '';
      default: return MENU_ITEM_TOKENS[token]?.default;
    }
  };
  const shown = (token: string): MenuTokenValue => (token in over ? over[token]! : inherited(token) ?? '');
  const set = (token: string, v: MenuTokenValue | null) => {
    // typing back the inherited value clears the override: the item keeps following the asset
    const base = inherited(token);
    rt.setMenuToken(path, token, v !== null && base !== undefined && String(v) === String(base) && (MENU_ITEM_TOKENS[token]!.kind === 'text' || MENU_ITEM_TOKENS[token]!.kind === 'icon' || MENU_ITEM_TOKENS[token]!.kind === 'action') ? null : v);
  };
  const changed = Object.keys(over).length;
  const tokens = tab === 'behaviour' ? MENU_ITEM_BEHAVIOR_TOKENS : MENU_ITEM_APPEARANCE_TOKENS;
  return (
    <div className="fx-stack axf-menu-item-settings" data-axf-menu-item-settings={path}>
      <p className="fx-muted axf-menu-item-settings__path">
        <Icon name={item?.icon ?? 'menu'} size={14} /> {item?.label ?? path.split('/').pop()} <code className="fx-kbd" title="This item's path: what control@1 tokens.menu and the inline-edit dialog address">{path}</code>
      </p>
      <TabGroup<Tab> id="axf.menu.item.settings" label="Item settings" value={tab} onChange={setTab} size="sm"
        tabs={[{ value: 'behaviour', label: 'Behaviour', icon: 'settings', badge: MENU_ITEM_BEHAVIOR_TOKENS.filter((t) => t in over).length }, { value: 'appearance', label: 'Appearance', icon: 'palette', badge: MENU_ITEM_APPEARANCE_TOKENS.filter((t) => t in over).length }]}>
        <div className="fx-stack" role="group" aria-label={tab === 'behaviour' ? 'Behaviour tokens' : 'Appearance tokens'}>
          {tokens.map((token) => {
            const spec = MENU_ITEM_TOKENS[token]!;
            const isOver = token in over;
            const reset = isOver ? <IconButton icon="undo" label={`Reset ${spec.label} to the asset`} size={13} data-axf-reset-token={token} onClick={() => rt.setMenuToken(path, token, null)} /> : null;
            const label = <span className="axf-menu-item-settings__label">{spec.label}{isOver && <span className="fx-chip fx-chip--accent" title="Overrides the asset (and what axHub inherits)">changed</span>}{reset}</span>;
            switch (spec.kind) {
              case 'boolean': return (
                <div key={token} className="fx-row axf-menu-item-settings__switch">
                  <Switch label={spec.label} checked={shown(token) === true} onChange={(v) => set(token, v)} hint={token === 'visible' ? 'Off hides this row everywhere.' : undefined} />
                  {isOver && <span className="fx-chip fx-chip--accent" title="Overrides the asset (and what axHub inherits)">changed</span>}{reset}
                </div>
              );
              case 'number': return <TextField key={token} label={label} type="number" value={String(shown(token) ?? '')} onChange={(v) => set(token, v === '' ? null : Number(v))} hint={`${spec.min} to ${spec.max}; rows with an order sort by it, the rest keep their place.`} />;
              case 'enum': return <SelectField key={token} label={label} value={String(shown(token))} options={spec.options!.map((o) => ({ value: o, label: optionLabel(token, o) }))} onChange={(v) => set(token, v)} />;
              case 'icon': return <TextField key={token} label={<span className="axf-menu-item-settings__icon">{label} <Icon name={String(shown(token) || '') || undefined} size={14} /></span>} value={String(shown(token) ?? '')} onChange={(v) => set(token, v)} placeholder="icon name" />;
              case 'action': return <TextField key={token} label={label} value={String(shown(token) ?? '')} onChange={(v) => set(token, v)} mono placeholder="file.save · nav:builds · dialog:about" hint={item?.kind === 'choice' || item?.kind === 'live-list' ? 'A choice setting or live list keeps its own action; this one is ignored for it.' : 'The action spec this row runs.'} />;
              default: return <TextField key={token} label={label} value={String(shown(token) ?? '')} onChange={(v) => set(token, v)} placeholder={token === 'hint' ? 'What the row does (its tooltip)' : token === 'shortcut' ? 'Ctrl+S' : undefined} />;
            }
          })}
        </div>
      </TabGroup>
      <Note tone="info">
        Each field is a token on this one item, saved as an override on top of the asset and shared through the axHub look (control@1 <code className="fx-kbd">tokens.menu</code>). What you leave alone keeps following the asset; a reset puts just this item back.
      </Note>
      <div className="fx-row axf-menu-item-settings__foot">
        <Button icon="undo" disabled={!changed} data-axf-reset-item onClick={() => rt.resetMenuItem(path)}>{changed ? `Reset this item (${changed} changed)` : 'Nothing changed on this item'}</Button>
      </div>
    </div>
  );
}

const pathOf = (p: Record<string, unknown>): string => (typeof p.path === 'string' ? p.path : '');

/** The dialog AppShell registers: right-click on any menu row opens it (`menu.item.settings:<path>` too). */
export const menuItemDialogs: DialogMap = {
  [MENU_ITEM_SETTINGS_DIALOG]: { title: 'Menu item', icon: 'menu', searchable: false, render: (p) => (pathOf(p) ? <MenuItemSettingsPanel path={pathOf(p)} /> : <Note tone="warning">No menu item was named.</Note>) },
};
