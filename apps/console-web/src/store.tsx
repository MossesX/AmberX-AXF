import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRuntime } from './axf/react';
import * as api from './api';
import { initBuildSync } from './views/BuildManager';
import { libraryCards, type LibraryCard } from './axf/core/catalog';
import type { Boilerplate, BoilerplateIndex, Catalog, DemoApp, InstallableLibrary, ModuleInfo, PortRecord, Status, Tracker } from './api';

/** Everything the console tracks: repo data (catalog, tracker, libraries, boilerplates, modules) + local state (checked features, status overrides, open project, records). */
export interface ConsoleStore {
  ready: boolean; backend: boolean;
  catalog: Catalog; tracker: Tracker; libraries: InstallableLibrary[]; boilerplateIndex: BoilerplateIndex; boilerplates: Boilerplate[]; modules: ModuleInfo[];
  /** Framework libraries for the pickers, from the catalog + library.json + tracker (framework/core/catalog.ts libraryCards). */
  libraryCards: LibraryCard[];
  checked: Set<string>; setChecked: (id: string, on: boolean) => void; isChecked: (id: string) => boolean;
  overrides: Record<string, Status>; setStatus: (id: string, s: Status) => void; status: (id: string) => Status;
  project: string; openProject: (dir: string) => void;
  ports: PortRecord[]; addPort: (r: PortRecord) => void;
  demos: DemoApp[]; addDemo: (d: DemoApp) => void;
  saveBoilerplate: (b: Boilerplate) => void;
  coverage: (tab: string) => Record<Status, number>;
  refresh: () => Promise<void>;
  exportStatusJson: () => string; exportPlan: () => string;
}

const EMPTY_CATALOG: Catalog = { frameworkVersion: '0.2.0', tabs: [] };
const EMPTY_TRACKER: Tracker = { generatedAt: '', summary: {}, items: [] };
const Ctx = createContext<ConsoleStore | null>(null);
export const useStore = () => { const s = useContext(Ctx); if (!s) throw new Error('ConsoleStoreProvider missing'); return s; };

export function ConsoleStoreProvider({ children }: { children: ReactNode }) {
  const rt = useRuntime();
  const [ready, setReady] = useState(false);
  const [backend, setBackend] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [tracker, setTracker] = useState<Tracker>(EMPTY_TRACKER);
  const [libraries, setLibraries] = useState<InstallableLibrary[]>([]);
  const [boilerplateIndex, setBoilerplateIndex] = useState<BoilerplateIndex>({ categories: [], items: [] });
  const [boilerplates, setBoilerplates] = useState<Boilerplate[]>([]);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [checked, setCheckedState] = useState<Set<string>>(() => new Set(api.readLocal<string[]>('checked', [])));
  const [overrides, setOverrides] = useState<Record<string, Status>>(() => api.readLocal('overrides', {}));
  const [project, setProject] = useState<string>(() => api.readLocal('project', ''));
  const [ports, setPorts] = useState<PortRecord[]>(() => api.readLocal('ports', []));
  const [demos, setDemos] = useState<DemoApp[]>(() => api.readLocal('demos', []));
  const [custom, setCustom] = useState<Boilerplate[]>(() => api.readLocal('boilerplates', []));

  const refresh = async () => {
    const up = await api.health(); setBackend(up);
    const [c, t, l, bi, b, m] = await Promise.all([api.loadCatalog(), api.loadTracker(), api.loadLibraries(), api.loadBoilerplateIndex(), api.loadBoilerplates(), api.loadModules()]);
    setCatalog(c); setTracker(t); setLibraries(l); setBoilerplateIndex(bi); setBoilerplates(b); setModules(m);
    if (!api.readLocal<string[] | null>('checked', null)) { const rec = new Set(c.tabs.flatMap((tb) => tb.groups.flatMap((g) => g.items.filter((i) => i.recommended).map((i) => i.id)))); setCheckedState(rec); }
    rt.terminal.log('console', `loaded ${t.items.length} tracker items · ${l.length} installable libraries · ${b.length} boilerplates · backend ${up ? 'online' : 'offline (static data)'}`, up ? 'ok' : 'warn');
    setReady(true);
    // feature tracker ⇄ build queue: two-way status sync every time the console starts
    initBuildSync((m, l) => rt.terminal.log('build', m, l)).catch((e) => rt.terminal.error('build', String(e)));
  };
  useEffect(() => { refresh().catch((e) => { rt.terminal.error('console', String(e)); setReady(true); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the backend's output terminal live (server-sent events) so engine log lines land in the pane as they happen.
  useEffect(() => {
    if (!backend || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.onmessage = (ev) => { try { const l = JSON.parse(ev.data) as { channel: string; level: 'info' | 'ok' | 'warn' | 'error' | 'note'; text: string }; rt.terminal.log(`api:${l.channel}`, l.text, l.level); } catch { /* ignore */ } };
    return () => es.close();
  }, [backend, rt]);

  const store = useMemo<ConsoleStore>(() => {
    const status = (id: string): Status => overrides[id] ?? tracker.items.find((i) => i.id === id)?.status ?? 'planned';
    const allBoilerplates = [...boilerplates.filter((b) => !custom.some((c) => c.id === b.id)), ...custom];
    return {
      ready, backend, catalog, tracker, libraries, boilerplateIndex, boilerplates: allBoilerplates, modules, libraryCards: libraryCards(catalog, libraries, tracker),
      checked, isChecked: (id) => checked.has(id),
      setChecked: (id, on) => { const n = new Set(checked); if (on) n.add(id); else n.delete(id); setCheckedState(n); api.writeLocal('checked', [...n]); },
      overrides, status,
      setStatus: (id, s) => { const n = { ...overrides, [id]: s }; setOverrides(n); api.writeLocal('overrides', n); if (backend) api.post('status', { id, status: s }).then((r) => { if (r.ok) rt.terminal.ok('tracker', `${id} → ${s} (status.json updated, tracker regenerated)`); }); },
      project, openProject: (dir) => { setProject(dir); api.writeLocal('project', dir); if (backend) api.post('project', { dir }); },
      ports, addPort: (r) => { const n = [...ports.filter((p) => p.id !== r.id), r]; setPorts(n); api.writeLocal('ports', n); },
      demos, addDemo: (d) => { const n = [...demos.filter((x) => x.id !== d.id), d]; setDemos(n); api.writeLocal('demos', n); },
      saveBoilerplate: (b) => { const n = [...custom.filter((x) => x.id !== b.id), b]; setCustom(n); api.writeLocal('boilerplates', n); if (backend) api.post('boilerplates/save', b); },
      coverage: (tab) => { const out: Record<Status, number> = { built: 0, partial: 0, placeholder: 0, planned: 0 }; for (const i of tracker.items) if (i.tab === tab && !i.parent) out[status(i.id)]++; return out; },
      refresh,
      exportStatusJson: () => JSON.stringify(Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, { status: v }])), null, 2),
      exportPlan: () => {
        const lines = ['# AXF build plan (exported from the Dev Console)', ''];
        for (const tab of catalog.tabs) {
          const todo = tab.groups.flatMap((g) => g.items).filter((i) => checked.has(i.id) && status(i.id) !== 'built');
          if (!todo.length) continue;
          lines.push(`## ${tab.label}`);
          for (const i of todo) { lines.push(`- [${status(i.id)}] ${i.id} — ${i.title}${i.note ? ` (${i.note})` : ''}`); for (const s of i.suggests) if (checked.has(s.id)) lines.push(`    - ${s.id} — ${s.title}`); }
          lines.push('');
        }
        return lines.join('\n');
      },
    };
  }, [ready, backend, catalog, tracker, libraries, boilerplateIndex, boilerplates, modules, checked, overrides, project, ports, demos, custom, rt]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
