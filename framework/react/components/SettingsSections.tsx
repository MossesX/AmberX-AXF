/*
 * Collapsible settings sections (settings-sections; Brett, Nov 16 2026: "Why don't these settings interfaces have
 * collapsible sections?"). The framework default for every settings interface: Settings tabs and sub-tabs, plugin
 * settings, chrome settings (tab groups, toolbars, banners, nav, menus) and any later one.
 *
 * - every group and panel is a section with a header and a chevron (engine core/engines/settingsui.ts: the settings
 *   asset's `sections` collapsible | flat and `sectionsOpen` all | first | none; a section may opt out with
 *   `collapsible: false`)
 * - the open / closed state is remembered per user in the setting `axf.settings.sections` (SETTINGS_SECTIONS_KEY)
 * - SectionsBar = Expand all / Collapse all for the sections on screen
 * - inside a <SectionsScope force> (a search) every section shows open, so the match is visible
 * - the same moves without the UI: action `settings.sections:<expand-all|collapse-all|open|close|toggle|reveal>:<id>`
 *   (console actions → REST /api/console-control, MCP console_control_*, `axf console`, AmberX voice), state in the
 *   setting itself (`settings.get axf.settings.sections`)
 * CI: framework/cli/check-settings-sections.mjs.
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { normalizeSectionState, normalizeSettingsUi, sectionCollapsible, sectionOpen, setSectionsOpen, SETTINGS_SECTIONS_KEY, type AxfRuntime, type SettingsSectionState, type SettingsUi } from '../../core';
import { useRuntime } from '../AxfProvider';
import { Button } from './Controls';
import { Icon } from './Icon';

/** The section state saved for this user. */
export function sectionState(rt: AxfRuntime): SettingsSectionState {
  return normalizeSectionState(rt.settings.get(SETTINGS_SECTIONS_KEY));
}
/** Opens or closes sections (`'*'` = every section everywhere) and saves it for this user. */
export function setSections(rt: AxfRuntime, ids: readonly string[] | '*', open: boolean): void {
  rt.settings.set(SETTINGS_SECTIONS_KEY, JSON.stringify(setSectionsOpen(sectionState(rt), ids, open)));
}

interface ScopeValue { ui?: SettingsUi; force?: boolean; prefix?: string }
const SectionsCtx = createContext<ScopeValue>({});
/** Gives the sections below the interface they belong to (`ui`) and, while searching, opens them all (`force`). */
/** `prefix`: the enclosing panel's id, so a framework <Section> inside it gets a stable saved id (`<prefix>/<title slug>`). */
export function SectionsScope({ ui, force, prefix, children }: ScopeValue & { children: ReactNode }) {
  const outer = useContext(SectionsCtx);
  const value = useMemo(() => ({ ui: ui ?? outer.ui, force: force ?? outer.force, prefix: prefix ?? outer.prefix }), [ui, force, prefix, outer.ui, outer.force, outer.prefix]);
  return <SectionsCtx.Provider value={value}>{children}</SectionsCtx.Provider>;
}

/** The settings interface around this component (empty outside one). */
export function useSectionsScope(): ScopeValue { return useContext(SectionsCtx); }

export interface SectionOwn { collapsible?: boolean; collapsed?: boolean; index?: number }
/** [open, collapsible, toggle] for one section, live with the saved state. */
export function useSettingsSection(id: string, own: SectionOwn = {}): [boolean, boolean, () => void] {
  const rt = useRuntime();
  const scope = useContext(SectionsCtx);
  const sub = useMemo(() => (fn: () => void) => rt.settings.onChange(SETTINGS_SECTIONS_KEY, fn), [rt]);
  const raw = useSyncExternalStore(sub, () => rt.settings.get(SETTINGS_SECTIONS_KEY), () => rt.settings.get(SETTINGS_SECTIONS_KEY));
  const ui = scope.ui ?? normalizeSettingsUi(null);
  const collapsible = sectionCollapsible(ui, own);
  const open = scope.force || sectionOpen(ui, normalizeSectionState(raw), id, own);
  return [open, collapsible, () => setSections(rt, [id], !open)];
}

export interface SettingsSectionProps extends SectionOwn {
  /** stable id, saved per user (e.g. `settings-group:<group id>`, `axp-<plugin>:<section>`) */
  id: string;
  title: ReactNode;
  icon?: string;
  /** one line after the title */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}
/** One collapsible settings section: header with chevron, body kept in the page while closed (console-control still finds its settings). */
export function SettingsSection({ id, title, icon, aside, className, children, ...own }: SettingsSectionProps) {
  const [open, collapsible, toggle] = useSettingsSection(id, own);
  const shown = open || !collapsible;
  return (
    <section className={`fx-ssec ${className ?? ''}`} data-axf-section={id} data-open={shown ? 'true' : 'false'}>
      {collapsible ? (
        <button type="button" className="fx-ssec__head fx-ssec__toggle" aria-expanded={shown} data-axf-target={`section:${id}`} onClick={toggle}>
          {icon && <Icon name={icon} size={13} />}<span className="fx-ssec__title">{title}</span>{aside && <span className="fx-ssec__aside">{aside}</span>}<Icon name="chevron-down" size={13} className={shown ? 'fx-ssec__chev' : 'fx-ssec__chev fx-rot--90'} />
        </button>
      ) : (
        <div className="fx-ssec__head">{icon && <Icon name={icon} size={13} />}<span className="fx-ssec__title">{title}</span>{aside && <span className="fx-ssec__aside">{aside}</span>}</div>
      )}
      <div className="fx-ssec__body" hidden={!shown}>{children}</div>
    </section>
  );
}

/** Expand all / Collapse all for the given sections (shown when two or more of them fold). */
export function SectionsBar({ ids, label = 'Sections', className }: { ids: readonly string[]; label?: string; className?: string }) {
  const rt = useRuntime();
  const scope = useContext(SectionsCtx);
  const ui = scope.ui ?? normalizeSettingsUi(null);
  if (ids.length < 2 || ui.sections !== 'collapsible' || scope.force) return null;
  return (
    <div className={`fx-ssec-bar ${className ?? ''}`} role="toolbar" aria-label={label}>
      <Button size="sm" tone="ghost" icon="chevron-down" onClick={() => setSections(rt, ids, true)}>Expand all</Button>
      <Button size="sm" tone="ghost" icon="chevron-up" onClick={() => setSections(rt, ids, false)}>Collapse all</Button>
    </div>
  );
}
