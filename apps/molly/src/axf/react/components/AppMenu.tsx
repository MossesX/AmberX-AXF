/**
 * Application menu renderer (app-menu asset + run-time contributions + live lists; core/engines/appmenu.ts).
 *
 * `AppMenuDropdown` draws one top-level menu: nested flyouts on desktop, drill-down panels on phones (≤ 480 px, a
 * Back row on top), live lists (`provider`) loaded when their submenu opens (a loading row meanwhile), badges
 * (runtime counters), check marks (`checked` bindings), shortcuts and keyboard navigation (arrows, Home/End, Enter,
 * Escape). Theme tokens only (`.fx-menu__*`); `data-axf-menu-item` names each row for tests and screenshots.
 *
 * Live-list rows with `buttons` (e.g. Deny / Approve on each waiting approval) draw them on the row itself, framework
 * `Button`s with big tap targets; a tap runs the provider's `act` (`rt.runAppMenuButton`) without closing the menu,
 * the row flips to the result in place (`Running`, `Denied`) and then drops off. Only that row changes: the list is
 * not reloaded. A row with a `deadline` counts down on its own tick (the rest of the menu doesn't re-render).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CompiledMenuButton } from '../../core/engines/appmenu';
import type { CompiledMenu, CompiledMenuItem } from '../../core/engines/appmenu';
import { MenuSub } from './MenuList';
import { useRuntime } from '../AxfProvider';
import { Icon } from './Icon';
import { Button, Chip, Kbd } from './Controls';

/** Phones drill down instead of opening flyouts (the same breakpoint as the banner's label cut). */
export const APP_MENU_PHONE_QUERY = '(max-width: 480px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(APP_MENU_PHONE_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(APP_MENU_PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}

type Loaded = { state: 'loading' } | { state: 'ready'; items: CompiledMenuItem[] } | { state: 'error'; message: string };

/** Loads a live list once its submenu opens; re-runs when `open` flips back on (the list may have changed). */
function useProviderItems(provider: string | undefined, open: boolean, depth: number): Loaded | null {
  const rt = useRuntime();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!provider || !open) { setLoaded(null); return; }
    let alive = true;
    setLoaded({ state: 'loading' });
    rt.loadAppMenuProvider(provider, { depth }).then(
      (items) => { if (alive) setLoaded({ state: 'ready', items }); },
      (err) => { if (alive) { setLoaded({ state: 'error', message: String((err as Error)?.message ?? err) }); rt.terminal.warn('menus', `live list "${provider}" failed: ${String(err)}`); } },
    );
    return () => { alive = false; };
  }, [rt, provider, open, depth]);
  return loaded;
}

interface ListProps {
  items: CompiledMenuItem[];
  depth: number;
  onDone: () => void;
  /** phone: enter a submenu (drill down) instead of opening a flyout */
  onEnter?: (item: CompiledMenuItem) => void;
  autoFocus?: boolean;
}

/** How long a row shows what its button did before it drops off the list. */
export const LIVE_ROW_DROP_MS = 1_600;

/** `m:ss` (or `h:mm:ss`) for a row's countdown. */
export function rowCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** The countdown on a row: its own one-second tick, so nothing else in the menu re-renders. */
function RowCountdown({ deadline, paused }: { deadline: number; paused?: string }) {
  const left = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [sec, setSec] = useState(left);
  useEffect(() => {
    if (paused) return;
    setSec(left());
    const t = setInterval(() => setSec(left()), 1_000);
    return () => clearInterval(t);
  }, [deadline, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  if (paused) return <span className="fx-menu__count is-paused">{paused}</span>;
  return <span className={`fx-menu__count${sec <= 30 ? ' is-urgent' : ''}`} role="timer" aria-live="off">{sec > 0 ? rowCountdown(sec) : 'Running'}</span>;
}

/* ---- expandable live rows (Brett, Nov 1 2026: every approval row expands in place) ---- */

/** Draws the open part of a live row whose `expand` is `<kind>:<key>` (gets the key). */
export type MenuRowDetails = (key: string) => ReactNode;
const rowDetails = new Map<string, MenuRowDetails>();
/** Registers the details renderer for one `expand` kind (e.g. lib-approvals: `approval`); returns the remover. */
export function registerMenuRowDetails(kind: string, render: MenuRowDetails): () => void {
  rowDetails.set(kind, render);
  return () => { if (rowDetails.get(kind) === render) rowDetails.delete(kind); };
}
const expandParts = (expand: string | undefined): [MenuRowDetails, string] | null => {
  const i = expand ? expand.indexOf(':') : -1;
  const r = i > 0 ? rowDetails.get(expand!.slice(0, i)) : undefined;
  return r ? [r, expand!.slice(i + 1)] : null;
};
/** Open rows (by row id), outside React: a live list read again (the menu reopened, a refresh) keeps them open. */
const openRows = new Set<string>();
export const menuRowOpen = (id: string): boolean => openRows.has(id);

type RowRun = { phase: 'idle' } | { phase: 'busy'; button: string } | { phase: 'done'; ok: boolean; state: string };

/** A live-list row with buttons: label (cut first) + second line + countdown, then the buttons, which never shrink. */
function LiveRow({ item, onGone }: { item: CompiledMenuItem; onGone: (id: string) => void }) {
  const rt = useRuntime();
  const [run, setRun] = useState<RowRun>({ phase: 'idle' });
  const provider = item.origin.startsWith('provider:') ? item.origin.slice('provider:'.length) : '';
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const tap = async (b: CompiledMenuButton) => {
    if (run.phase !== 'idle') return;
    setRun({ phase: 'busy', button: b.id });
    const r = await rt.runAppMenuButton(provider, item.id, b);
    if (!alive.current) return;
    if (!r.ok) { if (r.message) rt.toast(r.message, 'danger', item.label); setRun({ phase: 'idle' }); return; }
    if (r.message) rt.toast(r.message, 'success', item.label);
    if (r.keep) { setRun({ phase: 'idle' }); return; }
    setRun({ phase: 'done', ok: true, state: r.state || 'Done' });
    setTimeout(() => { if (alive.current) onGone(item.id); }, LIVE_ROW_DROP_MS);
  };
  const done = run.phase === 'done';
  // An expandable row: a tap on the row (or the caret on the far right) opens its details in place, no navigation.
  const details = expandParts(item.expand);
  const [open, setOpen] = useState(() => openRows.has(item.id));
  const toggle = () => setOpen((o) => { const n = !o; if (n) openRows.add(item.id); else openRows.delete(item.id); return n; });
  const bodyId = `fx-menu-details-${item.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return (
    <li className={`fx-menu__li fx-menu__live${done ? ' is-done' : ''}${details ? ' is-expandable' : ''}${open && details ? ' is-open' : ''}`} data-axf-live-row={item.id} data-axf-row-state={done ? run.state : undefined}>
      <button
        type="button" role="menuitem" className="fx-menu__item fx-menu__live-main" disabled={item.locked || (done && !details)}
        data-axf-menu-item={item.id} data-axf-origin={item.origin} title={item.detail ? `${item.label}\n${item.detail}` : item.label}
        aria-expanded={details ? open && !!details : undefined} aria-controls={details ? bodyId : undefined}
        onClick={(e) => { if (details) { e.stopPropagation(); toggle(); } else if (item.action) rt.dispatch(item.action); }}
      >
        <span className="fx-menu__icon"><Icon name={item.icon} size={15} /></span>
        <span className="fx-menu__live-text">
          <span className="fx-menu__label fx-menu__live-label">{item.label}</span>
          {(item.tag || item.chip) && (
            <span className="fx-menu__live-tags">
              {item.tag && <span title={item.tag.title}><Chip tone={item.tag.tone}>{item.tag.label}</Chip></span>}
              {item.chip && <Chip>{item.chip}</Chip>}
            </span>
          )}
          {item.detail && <span className="fx-menu__live-detail">{item.detail}</span>}
        </span>
        {!done && item.deadline !== undefined && <RowCountdown deadline={item.deadline} paused={item.paused} />}
      </button>
      <div className="fx-menu__acts" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <span className="fx-menu__live-state" role="status"><Icon name="check" size={14} />{run.state}</span>
        ) : item.buttons!.map((b) => (
          <Button
            key={b.id} tone={b.tone ?? 'neutral'} icon={b.icon} busy={run.phase === 'busy' && run.button === b.id}
            disabled={b.locked || run.phase !== 'idle'} data-axf-row-button={b.id} data-help={`menu-row-${b.id}`} aria-label={`${b.label}: ${item.label}`}
            onClick={() => void tap(b)}
          >{b.label}</Button>
        ))}
      </div>
      {details && (
        <button type="button" className="fx-iconbtn fx-menu__caret" aria-expanded={open} aria-controls={bodyId}
          aria-label={open ? `Fold the details: ${item.label}` : `Show the details: ${item.label}`} data-help="menu-row-details" title={open ? 'Fold' : 'Details'}
          onClick={(e) => { e.stopPropagation(); toggle(); }}>
          <Icon name="chevron-down" size={15} className={open ? 'fx-menu__caret-open' : ''} />
        </button>
      )}
      {details && open && (
        // Clicks and keys inside stay inside: they never close the menu or move its focus.
        <div className="fx-menu__details" id={bodyId} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {details[0](details[1])}
        </div>
      )}
    </li>
  );
}

const focusables = (root: HTMLElement | null) => root ? Array.from(root.querySelectorAll<HTMLButtonElement>(':scope > li > [role="menuitem"]:not(:disabled)')) : [];

/** One level of the menu. Submenus open as flyouts (desktop) or through `onEnter` (phone). */
export function AppMenuList({ items, depth, onDone, onEnter, autoFocus }: ListProps) {
  const rt = useRuntime();
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const onGone = useCallback((id: string) => setGone((g) => new Set(g).add(id)), []);
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => { if (autoFocus) focusables(ref.current)[0]?.focus(); }, [autoFocus]);

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = focusables(ref.current);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => { list[(i + list.length) % list.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); e.stopPropagation(); go(at + 1); break;
      case 'ArrowUp': e.preventDefault(); e.stopPropagation(); go(at - 1); break;
      case 'Home': e.preventDefault(); e.stopPropagation(); go(0); break;
      case 'End': e.preventDefault(); e.stopPropagation(); go(list.length - 1); break;
      case 'ArrowRight': {
        const id = list[at]?.dataset.axfMenuItem;
        const item = items.find((i) => i.id === id);
        if (item && (item.items || item.provider)) { e.preventDefault(); e.stopPropagation(); if (onEnter) onEnter(item); else setOpenSub(item.id); }
        break;
      }
      case 'ArrowLeft': if (openSub && !onEnter) { e.preventDefault(); e.stopPropagation(); setOpenSub(null); list[at]?.focus(); } break;
      default: break;
    }
  };

  const shown = gone.size ? items.filter((i) => !gone.has(i.id)) : items;
  if (gone.size && !shown.some((i) => !i.separator)) return <div className="fx-menu__row fx-menu__empty">Nothing waiting</div>;
  return (
    <ul className="fx-menu" role="menu" ref={ref} onKeyDown={onKey} data-axf-menu-depth={depth}>
      {shown.map((item) => {
        if (item.buttons?.length) return <LiveRow key={item.id} item={item} onGone={onGone} />;
        if (item.separator) return <li key={item.id} className="fx-menu__sep" role="separator" />;
        const hasSub = !!item.items || !!item.provider;
        const sub = hasSub && openSub === item.id && !onEnter;
        return (
          <li key={item.id} className={`fx-menu__li ${sub ? 'is-open' : ''}`} onMouseEnter={() => !onEnter && setOpenSub(hasSub ? item.id : null)}>
            <button
              type="button"
              role={item.check !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.check}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? sub : undefined}
              className={`fx-menu__item ${item.check ? 'is-checked' : ''}`}
              disabled={item.locked}
              data-axf-menu-item={item.id}
              data-axf-origin={item.origin}
              title={item.locked ? (rt.lockedByHost({ action: item.action, provider: item.provider }) ?? (item.requires ? `Requires ${item.requires}` : 'Not available')) : undefined}
              onClick={(e) => {
                if (hasSub) { e.stopPropagation(); if (onEnter) onEnter(item); else setOpenSub(item.id); return; }
                onDone();
                if (item.action) rt.dispatch(item.action);
              }}
            >
              {item.check !== undefined
                ? <span className="fx-menu__check" aria-hidden="true">{item.check && <Icon name="check" size={14} />}</span>
                : <span className="fx-menu__icon">{item.locked ? <Icon name="lock" size={14} /> : <Icon name={item.icon} size={15} />}</span>}
              <span className="fx-menu__label">{item.label}</span>
              {item.count !== undefined && item.count > 0 && <span className="fx-menu__badge" aria-label={`${item.count} new`}>{item.count > 99 ? '99+' : item.count}</span>}
              {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              {hasSub && <Icon name="chevron-right" size={14} className="fx-menu__chevron" />}
            </button>
            {sub && (
              <MenuSub role="presentation">
                <SubmenuBody item={item} depth={depth + 1} onDone={onDone} open />
              </MenuSub>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The items of a submenu: the compiled ones, or the live list loaded on open. */
function SubmenuBody({ item, depth, onDone, onEnter, open, autoFocus }: { item: CompiledMenuItem; depth: number; onDone: () => void; onEnter?: (i: CompiledMenuItem) => void; open: boolean; autoFocus?: boolean }) {
  const loaded = useProviderItems(item.provider, open, depth - 1);
  if (item.provider) {
    if (!loaded || loaded.state === 'loading') return <div className="fx-menu__row fx-menu__loading" role="status"><span className="fx-menu__spinner" aria-hidden="true" />Loading…</div>;
    if (loaded.state === 'error') return <div className="fx-menu__row fx-menu__error" role="alert"><Icon name="alert" size={14} />Couldn't load this list</div>;
    if (!loaded.items.length) return <div className="fx-menu__row fx-menu__empty">Nothing here</div>;
    return <AppMenuList items={loaded.items} depth={depth} onDone={onDone} onEnter={onEnter} autoFocus={autoFocus} />;
  }
  return <AppMenuList items={item.items ?? []} depth={depth} onDone={onDone} onEnter={onEnter} autoFocus={autoFocus} />;
}

/**
 * One top-level menu's dropdown. Desktop: the root list with flyouts. Phone: a stack of panels; entering a submenu
 * pushes a panel with a Back row (Escape or Back pops it; Escape at the root closes the menu).
 */
export function AppMenuDropdown({ menu, onDone }: { menu: CompiledMenu; onDone: () => void }) {
  const phone = useIsPhone();
  const [stack, setStack] = useState<CompiledMenuItem[]>([]);
  const enter = useCallback((item: CompiledMenuItem) => setStack((s) => [...s, item]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  useEffect(() => { if (!phone) setStack([]); }, [phone]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (stack.length) back(); else onDone(); }
    else if (e.key === 'ArrowLeft' && stack.length) { e.preventDefault(); e.stopPropagation(); back(); }
  };
  const top = stack[stack.length - 1];
  return (
    <div className={`fx-dropdown fx-popover ${phone ? 'fx-dropdown--phone' : ''}`} onKeyDown={onKey} data-axf-menu={menu.id} data-axf-menu-origin={menu.origin}>
      {phone && top ? (
        <>
          <button type="button" className="fx-menu__back" onClick={back} aria-label={`Back to ${stack.length > 1 ? stack[stack.length - 2]!.label : menu.label}`}>
            <Icon name="chevron-left" size={14} />
            <span className="fx-menu__label">{top.label}</span>
          </button>
          <SubmenuBody key={stack.map((s) => s.id).join('/')} item={top} depth={stack.length + 1} onDone={onDone} onEnter={enter} open autoFocus />
        </>
      ) : (
        <AppMenuList items={menu.items} depth={1} onDone={onDone} onEnter={phone ? enter : undefined} autoFocus />
      )}
    </div>
  );
}
