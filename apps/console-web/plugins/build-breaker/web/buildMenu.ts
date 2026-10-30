/**
 * The permanent "Build" item on every context menu: a submenu of every build page and tool the console has. Pure
 * data + a filter: an entry shows only while what it opens exists (a view some library registered, or an action
 * someone registered), so a plugin that is off or removed just drops out. Other plugins are reached through their
 * views and action ids, never their folders.
 */
/** A runtime context-menu entry (engines/windows MenuEntry). */
export interface MenuEntry { id: string; label?: string; icon?: string; action?: string; separator?: boolean; items?: MenuEntry[] }

export interface BuildEntry { id: string; label: string; icon: string; action: string }

/** Views the console itself draws (always there). */
export const CORE_VIEWS = ['pending', 'build', 'plan', 'tracker'];

export const BUILD_ENTRIES: BuildEntry[] = [
  { id: 'breaker', label: 'Build Breaker', icon: 'hammer', action: 'nav:build-breaker' },
  { id: 'matrix', label: 'Feature matrix', icon: 'check-circle', action: 'nav:feature-matrix' },
  { id: 'orchestrator', label: 'Build orchestrator', icon: 'layers', action: 'nav:build-orchestrator' },
  { id: 'manager', label: 'Build manager', icon: 'play', action: 'build-manager.open' },
  { id: 'pending', label: 'Pending builds', icon: 'clock', action: 'nav:pending' },
  { id: 'queue', label: 'Build queue', icon: 'play', action: 'nav:build' },
  { id: 'plan', label: 'Plan', icon: 'layers', action: 'nav:plan' },
  { id: 'tracker', label: 'Tracker', icon: 'check-circle', action: 'nav:tracker' },
  { id: 'changes', label: 'Codebase changes', icon: 'branch', action: 'codebase-changes.open' },
  { id: 'grid', label: 'Changes & features grid', icon: 'list', action: 'changes-grid.open' },
  { id: 'fable', label: 'Fable rebuilds', icon: 'sparkles', action: 'fable-rebuilds.open' },
  { id: 'profiles', label: 'Build profiles', icon: 'layers', action: 'build-profiles.open' },
  { id: 'branches', label: 'Branches not on main', icon: 'branch', action: 'push-banner.check' },
  { id: 'main', label: 'Main build status', icon: 'github', action: 'main-build-status.open' },
];

/** The entries whose view or action exists now, as one "Build" submenu. */
export function buildMenu(has: { view: (id: string) => boolean; action: (id: string) => boolean }): MenuEntry[] {
  const items = BUILD_ENTRIES.filter((e) => (e.action.startsWith('nav:') ? has.view(e.action.slice(4)) : has.action(e.action.split(':')[0]!)))
    .map((e) => ({ id: `build-breaker.build.${e.id}`, label: e.label, icon: e.icon, action: e.action }));
  return items.length ? [{ id: 'build-breaker.build', label: 'Build', icon: 'hammer', items }] : [];
}
