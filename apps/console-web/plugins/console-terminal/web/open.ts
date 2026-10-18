/* Opening terminals: into the open terminal window when there is one, else a new floating window. */
import type { AxfRuntime } from '@console/axf/core';
import type { Open } from './api';

const TITLES: Record<string, string> = { console: 'Console', vps: 'VPS', claude: 'Claude Code' };

export function newTab(rt: AxfRuntime, o: Open, groupId?: string | null): string {
  const wm = rt.windows;
  const id = `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tab = { id, title: o.title || (o.kind === 'container' ? o.container ?? 'Container' : TITLES[o.kind] ?? 'Terminal'), kind: 'terminal', payload: JSON.stringify(o), icon: 'terminal' };
  const existing = groupId ?? Object.values(wm.state.groups).find((g) => g.tabs.some((t) => t.kind === 'terminal'))?.id ?? null;
  if (existing && wm.state.groups[existing]) wm.addTab(existing, tab);
  else wm.openFloating([tab], 'Terminal', 'floating', Math.min(820, innerWidth - 32), Math.min(480, innerHeight - 120));
  return id;
}

/**
 * The `terminal.open:<target>:<payload>` action. Targets the console marks with data-fx-ctx-target:
 *   axf-container        payload = container name            → root shell in that container (its working dir)
 *   axf-container-path   payload = "<container>|<abs path>"  → in that folder (a file opens in its folder)
 *   anything else                                            → the console's own container, at the repo
 */
export function openFromContext(rt: AxfRuntime, rawTarget = '', payload = '') {
  const target = decodeURIComponent(rawTarget || '');
  const p = decodeURIComponent(payload || '');
  if (target === 'axf-container' && p) return newTab(rt, { kind: 'container', container: p });
  if (target === 'axf-container-path' && p.includes('|')) {
    const [container, path] = [p.slice(0, p.indexOf('|')), p.slice(p.indexOf('|') + 1)];
    return newTab(rt, { kind: 'container', container, cwd: path });
  }
  return newTab(rt, { kind: 'console' });
}
