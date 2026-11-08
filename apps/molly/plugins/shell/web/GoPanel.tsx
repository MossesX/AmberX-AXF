/**
 * Go to anything: Molly's one menu over every app (menu-index@1), as a sliding menu. The top level is Favorites,
 * Recent and one entry per app; tapping a group slides into it (Back slides out); typing searches every app at once.
 * Each item opens with a tap; its star adds it to Favorites; on a wide screen the side buttons open it in a pane or a
 * floating window. Items can be dragged (text/x-axf-ref) for hosts that take a dropped ref.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { MenuGroupNode, MenuNode } from '../../../src/axf/core/engines/menu-index';
import { searchMenu } from '../../../src/axf/core/engines/menu-index';
import type { OpenTarget } from '../../../src/axf/core/engines/xlayout';
import { Icon, IconButton, TextField } from '../../../src/axf/react';
import type { ShellModel } from './model';

export const REF_MIME = 'text/x-axf-ref';

export function GoPanel({ model, close, query: q0 = '' }: { model: ShellModel; close: () => void; query?: string }) {
  useSyncExternalStore((f) => model.subscribe(f), () => model.rev, () => model.rev);
  const index = useMemo(() => model.index(), [model, model.rev]);
  const [stack, setStack] = useState<MenuGroupNode[]>([]);
  const [query, setQuery] = useState(q0);
  const level: MenuNode[] = stack.length ? stack[stack.length - 1]!.children : index.roots;
  const recents = model.recents();
  const hits = query.trim() ? searchMenu(index, query, { recents, limit: 40 }) : null;
  const open = (ref: string, target: OpenTarget = 'main') => { if (model.open(ref, target)) close(); };

  const itemRow = (n: { id: string; label: string; icon?: string; favorite?: boolean }, detail?: string) => (
    <li key={n.id} className="fx-menu__li axp-shell-go__row" draggable onDragStart={(e) => { e.dataTransfer.setData(REF_MIME, n.id); e.dataTransfer.setData('text/plain', n.id); e.dataTransfer.effectAllowed = 'copy'; }}>
      <button type="button" className="fx-menu__item" onClick={() => open(n.id)} data-axf-ref={n.id}>
        <span className="fx-menu__icon"><Icon name={n.icon ?? 'arrow-right'} size={14} /></span>
        <span className="fx-menu__label">{n.label}{detail && <span className="fx-muted axp-shell-go__detail"> · {detail}</span>}</span>
      </button>
      <span className="axp-shell-go__acts">
        <IconButton icon="star" label={n.favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!n.favorite} onClick={() => model.toggleFavorite(n.id)} />
        <IconButton className="axp-shell-go__wide" icon="grid" label="Open in a pane" onClick={() => open(n.id, 'pane')} />
        <IconButton className="axp-shell-go__wide" icon="monitor" label="Open in a floating window" onClick={() => open(n.id, 'floating')} />
      </span>
    </li>
  );

  return (
    <div className="axp-shell-go" data-fx-ctx-target="shell-go">
      <TextField label="Go to" placeholder="Search every app: screens, plugins, actions, settings" value={query} onChange={setQuery} autoFocus />
      {hits ? (
        <ul className="fx-menu axp-shell-go__list" aria-label="Results">
          {hits.length ? hits.map((h) => itemRow({ id: h.id, label: h.label, icon: h.icon, favorite: h.favorite }, h.path.join(' › '))) : <li className="fx-empty">Nothing matches “{query}”.</li>}
        </ul>
      ) : (
        <>
          {stack.length > 0 && (
            <button type="button" className="fx-menu__back" data-fx-row onClick={() => setStack(stack.slice(0, -1))} aria-label={`Back to ${stack.length > 1 ? stack[stack.length - 2]!.label : 'everything'}`}>
              <Icon name="chevron-left" size={14} /> {stack.map((g) => g.label).join(' › ')}
            </button>
          )}
          <ul className="fx-menu axp-shell-go__list" aria-label={stack.length ? stack[stack.length - 1]!.label : 'Everything'}>
            {level.map((n) => (n.kind === 'group' ? (
              <li key={n.id} className="fx-menu__li">
                <button type="button" className="fx-menu__item" onClick={() => setStack([...stack, n])} aria-haspopup="menu">
                  <span className="fx-menu__icon"><Icon name={n.icon ?? (n.range ? 'list' : 'folder')} size={14} /></span>
                  <span className="fx-menu__label">{n.label}</span>
                  <span className="fx-menu__count">{n.count}</span>
                  <Icon name="chevron-right" size={14} className="fx-menu__chevron" />
                </button>
              </li>
            ) : itemRow(n)))}
            {!level.length && <li className="fx-empty">Nothing here yet.</li>}
          </ul>
        </>
      )}
      <p className="fx-muted axp-shell-go__foot">{index.total} places in {index.roots.filter((r) => r.id !== 'favorites' && r.id !== 'recents').length} apps.</p>
    </div>
  );
}
