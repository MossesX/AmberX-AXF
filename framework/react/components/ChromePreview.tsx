/**
 * The small live preview at the top of every chrome instance's settings dialog (build
 * per-instance-settings-small-live-preview; Brett, Nov 13 2026: "on the per toolbar, per nav menu, per application menu,
 * per tab group settings I need a small preview pane, a couple of icons or two tab groups with some seed data, showing
 * what the settings look like").
 *
 * It draws the real framework chrome (fx-toolbar / fx-toolbtn, the TabGroup component, fx-nav, fx-menubar + MenuList,
 * fx-ctx) with fixed seed data (core/engines/chrome-settings-rules.mjs CHROME_PREVIEW_SEED) and the instance's effective
 * data (its asset + its overrides). The style engine output of that data goes on the pane (vars + attrs), so every
 * field change shows the moment it is saved, before anything else on screen is looked at. The pane's own choices are
 * device settings (open, light / dark sample, hover / press demo), set by the bar or by `chrome.preview:<change>`.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CHROME_PREVIEW_DEMOS, CHROME_PREVIEW_DEMO_KEY, CHROME_PREVIEW_LABELS, CHROME_PREVIEW_OPEN_KEY, CHROME_PREVIEW_SCHEMES, CHROME_PREVIEW_SCHEME_KEY, CHROME_PREVIEW_SEED, appMenuStyle, chromeLabel, chromePreviewState, colorThemeVars, contextMenuStyle, navMenuStyle, toolbarStyle, type AppMenuData, type ChromePreviewDemo, type ChromePreviewScheme, type ChromeType, type ColorThemeData, type ContextMenuData, type MenuItem, type NavMenuData, type StyleOutput, type ToolbarData } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Segmented } from './Controls';
import { Icon } from './Icon';
import { MenuList } from './MenuList';
import { TabGroup } from './TabGroup';

/** Kinds the pane draws (a banner has its own preview in Banner settings). */
export const CHROME_PREVIEW_KINDS: readonly ChromeType[] = ['toolbar', 'tab-group', 'nav-menu', 'app-menu', 'context-menu'];

function usePreviewTick(keys: string[]): void {
  const rt = useRuntime();
  const [, setTick] = useState(0);
  useEffect(() => { const offs = keys.map((k) => rt.settings.onChange(k, () => setTick((n) => n + 1))); return () => offs.forEach((f) => f()); }, [rt, keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The style engine output of the instance's data, for the pane (the stylesheet reads it from the nearest ancestor). */
function styleOf(type: ChromeType, data: Record<string, unknown>): StyleOutput {
  if (type === 'toolbar') return toolbarStyle(data as unknown as ToolbarData);
  if (type === 'nav-menu') return navMenuStyle(data as unknown as NavMenuData);
  if (type === 'app-menu') return appMenuStyle(data as unknown as AppMenuData);
  if (type === 'context-menu') return contextMenuStyle(data as unknown as ContextMenuData);
  return { vars: {}, attrs: {} };
}

const seedItems = (items: { id: string; icon?: string; label: string; shortcut?: string; submenu?: { id: string; label: string }[] }[]): MenuItem[] =>
  items.map((i) => ({ id: `preview.${i.id}`, icon: i.icon, label: i.label, shortcut: i.shortcut, ...(i.submenu ? { items: i.submenu.map((s) => ({ id: `preview.${i.id}.${s.id}`, icon: 'file', label: s.label })) } : {}) }));

function Stage({ type, instance, data }: { type: ChromeType; instance: string; data: Record<string, unknown> }) {
  const seed = CHROME_PREVIEW_SEED[type];
  const [tabs, setTabs] = useState<Record<string, string>>({});
  if (!seed) return null;
  const demo = { 'data-fx-demo': seed.demo } as Record<string, string>;
  if (type === 'toolbar') {
    const variant = String(data.variant ?? 'icons');
    return (
      <div className={`fx-toolbar fx-toolbar--${variant}`} data-align={String(data.align ?? 'start')} role="toolbar" aria-label="Toolbar preview">
        {(seed.groups ?? []).map((g) => (
          <div key={g.id} className="fx-toolbar__group" role="group">
            {(g.items ?? []).map((it) => (
              <button key={it.id} type="button" tabIndex={-1} data-axf-target={`button:chrome.preview.${it.id}`} className={`fx-toolbtn${it.on ? ' is-on' : ''}`} aria-pressed={it.on ? true : undefined} aria-label={it.label} title={it.label} {...(it.id === seed.demo ? demo : {})}>
                {variant !== 'labels' && <Icon name={it.icon ?? 'box'} size={16} />}
                {variant !== 'icons' && <span>{it.label}</span>}
                {it.badge && <span className="fx-toolbtn__badge" aria-hidden="true">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
        {data.showSearch === true && <span className="fx-search" role="search"><Icon name="search" size={14} /><span className="fx-muted">Search…</span></span>}
      </div>
    );
  }
  if (type === 'tab-group') {
    return (
      <div className="fx-stack fx-stack--sm">
        {(seed.groups ?? []).map((g) => (
          <TabGroup key={g.id} id={`chrome.preview.${g.id}`} previewOf={instance} label={`${g.label ?? g.id} (preview)`} value={tabs[g.id] ?? g.active ?? ''} onChange={(v) => setTabs((s) => ({ ...s, [g.id]: v }))} tabs={(g.tabs ?? []).map((t) => ({ value: t.value, label: t.label, icon: t.icon, badge: t.badge }))} />
        ))}
      </div>
    );
  }
  if (type === 'nav-menu') {
    const style = String(data.style ?? 'list');
    return (
      <nav className={`fx-nav fx-nav--${style}`} data-orient="vertical" aria-label="Navigation preview" data-axf-not-nav="settings preview sample (seed data)">
        <div className="fx-nav__section">
          {(seed.items ?? []).map((it) => (
            <button key={it.id} type="button" tabIndex={-1} data-axf-target={`button:chrome.preview.${it.id}`} className={`fx-nav__item${it.active ? ' is-active' : ''}`} aria-current={it.active ? 'page' : undefined} {...(it.id === seed.demo ? demo : {})}>
              <Icon name={it.icon ?? 'box'} size={17} />
              <span className="fx-nav__text">{it.label}</span>
              {it.badge && <span className="fx-nav__badge">{it.badge}</span>}
            </button>
          ))}
        </div>
      </nav>
    );
  }
  if (type === 'app-menu') {
    return (
      <div className="fx-chrome-preview__menubar">
        <div className="fx-menubar" role="menubar" aria-label="Application menu preview">
          <div className="fx-menubar__menus">
            {(seed.menus ?? []).map((m) => (
              <div key={m.id} className="fx-menubar__item">
                <button type="button" tabIndex={-1} data-axf-target={`button:chrome.preview.${m.id}`} className={`fx-menubar__btn${m.open ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={!!m.open} {...(m.id === seed.demo ? demo : {})}>{m.label}</button>
              </div>
            ))}
          </div>
        </div>
        <div className="fx-chrome-preview__menu fx-popover" role="menu" aria-label="File menu preview">
          <MenuList items={seedItems(seed.items ?? [])} onDone={() => undefined} />
        </div>
      </div>
    );
  }
  if (type === 'context-menu') {
    return (
      <div className="fx-ctx fx-popover fx-chrome-preview__menu" role="menu" aria-label="Context menu preview">
        <MenuList items={seedItems(seed.items ?? [])} onDone={() => undefined} showIcons={data.showIcons !== false} showShortcuts={data.showShortcuts !== false} />
      </div>
    );
  }
  return null;
}

/** The sample colours for a light / dark pane: the first colour theme of that scheme (the app's own when it matches). */
function schemeVars(rt: ReturnType<typeof useRuntime>, scheme: ChromePreviewScheme): { vars: Record<string, string>; scheme?: string; missing?: boolean } {
  if (scheme === 'app') return { vars: {} };
  const active = rt.assetOrNull('color-theme')?.data as ColorThemeData | undefined;
  if (active?.scheme === scheme) return { vars: {}, scheme };
  const pick = rt.registry.list('color-theme').find((a) => (a.data as ColorThemeData).scheme === scheme);
  if (!pick) return { vars: {}, missing: true };
  return { vars: colorThemeVars(pick.data as ColorThemeData) as Record<string, string>, scheme };
}

/**
 * The pane: a bar (title, light / dark, hover / press demo, collapse) over the stage. `data` = the instance's effective
 * data (asset + overrides), passed in by the settings dialog so it follows every change.
 */
export function ChromePreview({ type, instance, data }: { type: ChromeType; instance: string; data: Record<string, unknown> | null }) {
  const rt = useRuntime();
  useAxfState();
  usePreviewTick([CHROME_PREVIEW_OPEN_KEY, CHROME_PREVIEW_SCHEME_KEY, CHROME_PREVIEW_DEMO_KEY]);
  const stageRef = useRef<HTMLDivElement>(null);
  const st = chromePreviewState((k) => rt.settings.get(k));
  // the TabGroup draws its own tabs: mark the seed's demo tab after it renders
  useEffect(() => {
    const el = stageRef.current;
    if (!el || type !== 'tab-group') return;
    el.querySelectorAll('[data-axf-tab]').forEach((t) => { if (t.getAttribute('data-axf-tab') === CHROME_PREVIEW_SEED['tab-group']!.demo) t.setAttribute('data-fx-demo', 'tab'); else t.removeAttribute('data-fx-demo'); });
  });
  if (!CHROME_PREVIEW_KINDS.includes(type)) return null;
  const change = (words: string) => rt.dispatch(`chrome.preview:${words}`);
  const out = styleOf(type, data ?? {});
  const colours = schemeVars(rt, st.scheme);
  const style = { ...out.vars, ...colours.vars } as CSSProperties;
  return (
    <section className="fx-chrome-preview" data-axf-chrome-preview={`${type}:${instance}`} data-demo={st.demo} data-open={st.open ? 'on' : 'off'} aria-label={`${chromeLabel(type)} preview`}>
      <div className="fx-chrome-preview__bar" role="toolbar" aria-label="Preview">
        <Icon name="eye" size={14} />
        <strong className="fx-small">Preview</strong>
        {st.open && (
          <>
            <Segmented<ChromePreviewScheme> size="sm" label="Preview colours" value={st.scheme} options={CHROME_PREVIEW_SCHEMES.map((s) => ({ value: s, label: CHROME_PREVIEW_LABELS[s] ?? s }))} onChange={(s) => change(`scheme:${s}`)} />
            <Segmented<ChromePreviewDemo> size="sm" label="Hover or press demo" value={st.demo} options={CHROME_PREVIEW_DEMOS.map((d) => ({ value: d, label: CHROME_PREVIEW_LABELS[d] ?? d }))} onChange={(d) => change(`demo:${d}`)} />
          </>
        )}
        <span className="fx-chrome-preview__spacer" />
        <Button size="sm" tone="neutral" icon={st.open ? 'chevron-up' : 'chevron-down'} aria-expanded={st.open} onClick={() => change('toggle')}>{st.open ? 'Hide' : 'Show'}</Button>
      </div>
      {st.open && (
        <div ref={stageRef} className="fx-chrome-preview__stage" style={style} data-fx-scheme={colours.scheme} {...out.attrs}>
          <Stage type={type} instance={instance} data={data ?? {}} />
        </div>
      )}
      {st.open && colours.missing && <p className="fx-small fx-muted fx-chrome-preview__note">No {st.scheme} colour theme is installed; showing the app's colours.</p>}
    </section>
  );
}
