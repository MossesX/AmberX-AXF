/*
 * The left side: collapsible categories (framework/core/engines/ui-manager-rules.mjs elementTree). The first,
 * "On screen now", holds shortcuts ({ ref }) to the visible elements, like Windows shortcuts: the shortcut and the
 * element in its own category point at one element, so both show the same selection and the same override count,
 * and an edit made through either lands on the same override.
 */
import { useState } from 'react';
import { Button, Icon } from '@console/axf/react';
import type { TreeCategory, UiElement, UiShortcut } from '../../../../../framework/core/engines/ui-manager-rules.mjs';
import { setUi, toggleIn, type UiState } from './state';
import type { ElementRow } from './useElements';

const PAGE = 200;
const isShortcut = (x: UiElement | UiShortcut): x is UiShortcut => 'ref' in x;

export function Tree({ tree, byId, ui, onOpen }: { tree: TreeCategory[]; byId: Map<string, ElementRow>; ui: UiState; onOpen?: (id: string) => void }) {
  const [shown, setShown] = useState<Record<string, number>>({});
  if (!tree.length) return <p className="fx-muted">Nothing matches. Change the search or the filters.</p>;
  return (
    <ul className="axp-uim__list" role="tree" aria-label="UI elements">
      {tree.map((c) => {
        const open = !ui.collapsed.includes(c.id);
        const limit = shown[c.id] ?? PAGE;
        return (
          <li key={c.id} className="axp-uim__cat" role="treeitem" aria-expanded={open}>
            <button type="button" className="axp-uim__cathead" data-fx-row onClick={() => setUi((s) => ({ collapsed: toggleIn(s.collapsed, c.id) }))}>
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
              <Icon name={c.icon} size={14} />
              <span className="axp-uim__grow">{c.label}</span>
              <span className="fx-small axp-uim__muted">{c.items.length}{c.live ? ' · live' : ''}</span>
            </button>
            {open && (
              <ul className="axp-uim__list" role="group">
                {c.items.slice(0, limit).map((x) => {
                  const id = isShortcut(x) ? x.ref : x.id;
                  const target = byId.get(id);
                  const on = ui.selected === id;
                  const n = target?.overrides ?? 0;
                  return (
                    <li key={`${c.id}:${id}`} role="none">
                      <button type="button" role="treeitem" aria-selected={on} data-fx-row className={`axp-uim__row${on ? ' is-on' : ''}`}
                        title={isShortcut(x) ? `Shortcut to ${x.label} in ${x.category}: same element, same settings` : id}
                        onClick={() => { setUi({ selected: id }); onOpen?.(id); }}>
                        {isShortcut(x) ? <span className="axp-uim__shortcut"><Icon name="external" size={12} /></span> : null}
                        <span className="axp-uim__grow">{x.label}</span>
                        <span className="fx-small axp-uim__muted">{x.kind}{n ? ` · ${n} changed` : ''}</span>
                      </button>
                    </li>
                  );
                })}
                {c.items.length > limit && (
                  <li><Button size="sm" tone="ghost" onClick={() => setShown((m) => ({ ...m, [c.id]: limit + PAGE * 5 }))}>Show more ({c.items.length - limit} left)</Button></li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
