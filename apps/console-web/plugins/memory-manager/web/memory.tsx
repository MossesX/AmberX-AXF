/**
 * Memory Manager's memory panels (left column): Memory (every memory file with what reads and writes it, filters,
 * search inside, move / delete / history), Chunks (the chunked store's index, rebuild) and Session start (what a
 * session loads: builds started in the last 24 h that stopped unfinished + the chunk index). Settings come from the
 * server (GET/PUT settings) so REST, MCP, the CLI and voice change the same values the panel shows.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, IconButton, Note, SelectField, Switch, TextField } from '@console/axf/react';
import { api, openDoc, runtime } from './state';

const enc = encodeURIComponent;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Party { who: string; path?: string; how?: string; source: 'map' | 'scan' }
export interface MemFile { id: string; root: string; path: string; name: string; openable: boolean; location: string; label: string; category: string; kind: string; loadedAtStart: boolean; size: number; tokens: number; updatedAt: string; readers: Party[]; writers: Party[]; summary?: boolean; count?: number }
export interface MemList { files: MemFile[]; total: number; shown: number; categories: string[]; kinds: string[]; roots: string[]; scannedAt: string; settings: Record<string, unknown> }
export interface Filter { q: string; category: string; kind: string; root: string; writer: string; loaded: boolean }
export interface Hit { id: string; path: string; category: string; hits: number; snippet: string }
export interface SettingsDoc { settings: Record<string, unknown>; defaults: Record<string, unknown>; choices: Record<string, string[]>; categories: { category: string; keys: string[] }[] }

/* ------------------------------------------------------------------ memory state (actions + panels share it) */

export type Panel = 'memory' | 'files' | 'chunks' | 'start' | 'snippets' | 'wizards';
interface MemState { panel: Panel; list: MemList | null; error: string; busy: boolean; filter: Filter; search: string; hits: Hit[] | null; open: string; settings: SettingsDoc | null }
const EMPTY: Filter = { q: '', category: '', kind: '', root: '', writer: '', loaded: false };
let st: MemState = { panel: 'memory', list: null, error: '', busy: false, filter: EMPTY, search: '', hits: null, open: '', settings: null };
const subs = new Set<() => void>();
const put = (p: Partial<MemState>) => { st = { ...st, ...p }; subs.forEach((l) => l()); };
export const mem = () => st;
export const useMem = <T,>(pick: (s: MemState) => T): T => useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => pick(st), () => pick(st));

export const setPanel = (panel: Panel) => put({ panel });

const query = (f: Filter, refresh = false) => `memory?q=${enc(f.q)}&category=${enc(f.category)}&kind=${enc(f.kind)}&root=${enc(f.root)}&writer=${enc(f.writer)}${f.loaded ? '&loaded=true' : ''}${refresh ? '&refresh=true' : ''}`;

let seq = 0;
export async function loadMemory(refresh = false) {
  const n = ++seq;
  put({ busy: true });
  try {
    const l = refresh ? await api.post<MemList>('scan', {}) : await api.call<MemList>(query(st.filter));
    if (n === seq) put({ list: refresh ? null : l, error: '', busy: false });
    if (refresh && n === seq) await loadMemory(false);
  } catch (e) { if (n === seq) put({ error: errText(e), busy: false }); }
}

export function setFilter(p: Partial<Filter> | 'clear') {
  put({ filter: p === 'clear' ? EMPTY : { ...st.filter, ...p } });
  void loadMemory();
}

/** "category:Session logs", "kind:log", "root:hub", "writer:builds-live", "loaded", "clear", or plain words. */
export function applyFilterText(s: string) {
  const t = s.trim();
  if (!t || t === 'clear') return setFilter('clear');
  if (t === 'loaded') return setFilter({ loaded: true });
  const m = t.match(/^(category|kind|root|writer)\s*[:=]\s*(.+)$/i);
  if (m) return setFilter({ [m[1]!.toLowerCase()]: m[2]!.trim() } as Partial<Filter>);
  const cat = st.list?.categories.find((c) => c.toLowerCase() === t.toLowerCase());
  return setFilter(cat ? { category: cat } : { q: t });
}

export async function searchInside(q: string) {
  put({ search: q, hits: null, panel: 'memory' });
  if (!q.trim()) return;
  try { const r = await api.call<{ results: Hit[] }>(`search?q=${enc(q)}`); put({ hits: r.results }); } catch (e) { put({ error: errText(e) }); }
}

export const showDetails = (path: string) => { put({ panel: 'memory', open: path.includes(':') ? path : `repo:${path.replace(/^\.\//, '')}` }); if (!st.list) void loadMemory(); };

const confirmDelete = () => st.settings?.settings['safety.confirmDelete'] !== false;

export async function moveFile(id: string, to: string): Promise<boolean> {
  const rt = runtime();
  const dest = to.includes(':') ? to : `${id.split(':')[0]}:${to.replace(/^\.\//, '')}`;
  try { await api.post('move', { id, to: dest }); rt?.toast(`Moved to ${dest}`, 'success'); void loadMemory(); return true; } catch (e) { rt?.toast(errText(e), 'danger'); return false; }
}

export async function deleteFile(id: string, asked = false): Promise<boolean> {
  const rt = runtime();
  if (!asked && confirmDelete() && !window.confirm(`Delete ${id}? Its text is kept in the version history.`)) return false;
  try { await api.post('delete', { id }); rt?.toast(`Deleted ${id} (kept as a version)`, 'success'); put({ open: '' }); void loadMemory(); return true; } catch (e) { rt?.toast(errText(e), 'danger'); return false; }
}

export async function loadSettings() { try { put({ settings: await api.call<SettingsDoc>('settings') }); } catch (e) { put({ error: errText(e) }); } }
export async function saveSetting(key: string, value: unknown): Promise<boolean> {
  try { const r = await api.put<{ settings: Record<string, unknown> }>('settings', { [key]: value }); put({ settings: st.settings ? { ...st.settings, settings: r.settings } : null }); void loadMemory(); return true; } catch (e) { runtime()?.toast(errText(e), 'danger'); return false; }
}
/** Voice / CLI form: "scan.includeChunks on", "list.groupBy kind". */
export async function setSettingText(s: string) {
  const [key, ...rest] = s.trim().split(/\s+|=/).filter(Boolean);
  if (!key) { runtime()?.toast('Say which setting, e.g. scan.includeChunks on.', 'warning'); return; }
  if (!st.settings) await loadSettings();
  const d = st.settings?.defaults[key];
  const raw = rest.join(' ');
  const v = typeof d === 'boolean' ? /^(1|on|true|yes)$/i.test(raw) : raw;
  if (await saveSetting(key, v)) runtime()?.toast(`${key} = ${String(v)}`, 'success');
}

export async function buildChunks() {
  const rt = runtime();
  try { const r = await api.post<{ count?: number; added?: string[]; changed?: string[]; removed?: string[] }>('chunks/build', {}); rt?.toast(`Chunks rebuilt: ${r.count ?? '?'} (${r.added?.length ?? 0} added, ${r.changed?.length ?? 0} changed, ${r.removed?.length ?? 0} removed)`, 'success'); } catch (e) { rt?.toast(errText(e), 'danger'); }
}

/* ------------------------------------------------------------------ Memory panel */

const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

function Parties({ title, list }: { title: string; list: Party[] }) {
  return (
    <div className="axp-memory-manager__parties">
      <p className="fx-eyebrow">{title} ({list.length})</p>
      {list.length ? (
        <ul className="axp-memory-manager__plist">
          {list.map((p, i) => (
            <li key={i} className="fx-small">
              <strong>{p.who}</strong>{p.how ? <span className="fx-muted"> · {p.how}</span> : null}
              {p.path ? <div className="fx-muted axp-memory-manager__ppath">{p.path}{p.source === 'scan' ? ' (code scan)' : ''}</div> : null}
            </li>
          ))}
        </ul>
      ) : <p className="fx-small fx-muted">None found.</p>}
    </div>
  );
}

function Details({ f }: { f: MemFile }) {
  const [to, setTo] = useState(f.path);
  return (
    <div className="axp-memory-manager__detail" data-axf-memory-file={f.path}>
      <p className="fx-small fx-muted">{f.label} · {f.kind}{f.loadedAtStart ? ' · loaded at session start' : ''}{f.summary ? '' : ` · ${size(f.size)} · ~${f.tokens} tokens`}{f.updatedAt ? ` · ${f.updatedAt.slice(0, 16).replace('T', ' ')}` : ''}</p>
      <div className="axp-memory-manager__parties-row">
        <Parties title="Writes it" list={f.writers} />
        <Parties title="Reads it" list={f.readers} />
      </div>
      {f.openable && (
        <div className="fx-stack axp-memory-manager__manage">
          <div className="axp-memory-manager__acts" role="toolbar" aria-label="Memory file actions">
            <Button size="sm" icon="file" onClick={() => openDoc(f.id)}>View</Button>
            <Button size="sm" icon="edit" onClick={() => { void import('./state').then((s) => { s.setEditable(f.id, true); openDoc(f.id); }); }}>Edit</Button>
            <Button size="sm" icon="clock" onClick={() => openDoc(f.id)}>Versions</Button>
            <Button size="sm" tone="danger" icon="trash" onClick={() => void deleteFile(f.id)}>Delete</Button>
          </div>
          <div className="axp-memory-manager__move">
            <TextField label="Move or rename to" value={to} onChange={setTo} mono />
            <Button size="sm" icon="arrow-right" disabled={!to.trim() || to === f.path} onClick={() => void moveFile(f.id, to)}>Move</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryPanel() {
  const list = useMem((s) => s.list);
  const error = useMem((s) => s.error);
  const busy = useMem((s) => s.busy);
  const filter = useMem((s) => s.filter);
  const open = useMem((s) => s.open);
  const hits = useMem((s) => s.hits);
  const search = useMem((s) => s.search);
  const groupBy = String(list?.settings['list.groupBy'] ?? 'category');
  const [q, setQ] = useState(filter.q);
  const [inside, setInside] = useState(search);
  useEffect(() => { if (!list) void loadMemory(); }, []);
  useEffect(() => { const t = setTimeout(() => { if (q !== filter.q) setFilter({ q }); }, 300); return () => clearTimeout(t); }, [q]);

  const groups = new Map<string, MemFile[]>();
  for (const f of list?.files ?? []) {
    const k = groupBy === 'location' ? f.label : groupBy === 'root' ? f.root : groupBy === 'kind' ? f.kind : f.category;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const opt = (xs: string[] | undefined) => (xs ?? []).map((x) => ({ value: x, label: x }));

  return (
    <div className="axp-memory-manager__memory">
      <div className="axp-memory-manager__filters">
        <TextField label="Find memory files" type="search" value={q} onChange={setQ} placeholder="Name or path" />
        <SelectField label="Category" value={filter.category} empty="Every category" options={opt(list?.categories)} onChange={(v) => setFilter({ category: v })} />
        <SelectField label="Kind" value={filter.kind} empty="Every kind" options={opt(list?.kinds)} onChange={(v) => setFilter({ kind: v })} />
        <SelectField label="Where" value={filter.root} empty="Everywhere" options={opt(list?.roots)} onChange={(v) => setFilter({ root: v })} />
        <TextField label="Written by" value={filter.writer} onChange={(v) => setFilter({ writer: v })} placeholder="builds-live, Claude sessions…" />
        <Switch label="Loaded at session start only" checked={filter.loaded} onChange={(v) => setFilter({ loaded: v })} />
        <div className="axp-memory-manager__acts" role="toolbar" aria-label="Memory list">
          <Button size="sm" icon="refresh" disabled={busy} onClick={() => void loadMemory(true)}>{busy ? 'Scanning…' : 'Scan again'}</Button>
          <Button size="sm" tone="ghost" icon="x" onClick={() => { setQ(''); setFilter('clear'); }}>Clear filters</Button>
        </div>
      </div>
      <div className="axp-memory-manager__search">
        <TextField label="Search inside memory" type="search" value={inside} onChange={setInside} placeholder="Words to find in the text" />
        <Button size="sm" icon="search" onClick={() => void searchInside(inside)}>Search</Button>
      </div>
      {error && <Note tone="danger">{error}</Note>}
      {hits && (
        <div className="axp-memory-manager__hits">
          <p className="fx-eyebrow">{hits.length} file(s) mention "{search}"</p>
          <ul className="axp-memory-manager__plist">
            {hits.map((h) => <li key={h.id}><button type="button" className="fx-btn fx-btn--ghost fx-btn--sm axp-memory-manager__row" onClick={() => openDoc(h.id)}><span className="axp-memory-manager__fname">{h.path}</span> <span className="fx-muted fx-small">{h.hits}×</span></button><div className="fx-small fx-muted">{h.snippet}</div></li>)}
          </ul>
        </div>
      )}
      {list && <p className="fx-small fx-muted">{list.shown} of {list.total} · scanned {list.scannedAt ? list.scannedAt.slice(0, 16).replace('T', ' ') : 'never'}</p>}
      <nav className="axp-memory-manager__tree" aria-label="Memory files" data-axf-nav="memory-manager.memory">
        {[...groups].map(([g, fs]) => (
          <details key={g} open={groups.size <= 3 || !!filter.category || !!filter.q || fs.some((f) => (f.id || `${f.root}:${f.path}`) === open)} className="axp-memory-manager__group">
            <summary className="fx-small"><strong>{g}</strong> <span className="fx-muted">({fs.length})</span></summary>
            <ul className="axp-memory-manager__plist">
              {fs.map((f) => {
                const key = f.id || `${f.root}:${f.path}`;
                const isOpen = open === key;
                return (
                  <li key={key} data-fx-ctx-target="memory-manager-file" data-fx-ctx-payload={f.id || f.path}>
                    <button type="button" className="fx-btn fx-btn--ghost fx-btn--sm axp-memory-manager__row" aria-expanded={isOpen} onClick={() => put({ open: isOpen ? '' : key })}>
                      <span className="axp-memory-manager__fname">{f.summary ? `${f.path} (${f.name})` : f.path}</span>
                      <span className="fx-muted fx-small">{f.writers.length}w · {f.readers.length}r{f.loadedAtStart ? ' · start' : ''}</span>
                    </button>
                    {isOpen && <Details f={f} />}
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ Chunks panel */

interface Chunk { id: string; source: string; title: string; tokens: number; date: string; start: number; end: number }
export function ChunksPanel() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ built: boolean; count: number; shown: number; chunks: Chunk[] } | null>(null);
  const [err, setErr] = useState('');
  const load = async (x: string) => { try { setData(await api.call(`chunks?q=${enc(x)}`)); setErr(''); } catch (e) { setErr(errText(e)); } };
  useEffect(() => { const t = setTimeout(() => void load(q), q ? 300 : 0); return () => clearTimeout(t); }, [q]);
  return (
    <div className="axp-memory-manager__memory">
      <div className="axp-memory-manager__search">
        <TextField label="Find chunks" type="search" value={q} onChange={setQ} placeholder="Feature, build id, title" />
        <Button size="sm" icon="refresh" onClick={() => void buildChunks().then(() => load(q))}>Rebuild chunks</Button>
      </div>
      {err && <Note tone="danger">{err}</Note>}
      {data && !data.built && <Note tone="warning">The chunk store isn't built yet. Rebuild chunks makes it.</Note>}
      {data?.built && <p className="fx-small fx-muted">{data.shown} of {data.count} chunks</p>}
      <ul className="axp-memory-manager__plist">
        {data?.chunks.slice(0, 400).map((c) => (
          <li key={c.id}>
            <button type="button" className="fx-btn fx-btn--ghost fx-btn--sm axp-memory-manager__row" onClick={() => openDoc(`repo:_claude/chunks/${c.id}.md`)}>
              <span className="axp-memory-manager__fname">{c.title}</span>
              <span className="fx-muted fx-small">{c.tokens}t{c.date ? ` · ${c.date}` : ''}</span>
            </button>
            <div className="fx-small fx-muted axp-memory-manager__ppath">{c.source}:{c.start}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ Session start panel */

interface LoadBuild { id: string; title: string; status: string; done: number; total: number; next: { id: string; model: string; text: string } | null; branch: string; pr: string; chunks: string[] }
export function StartPanel() {
  const [hours, setHours] = useState('24');
  const [data, setData] = useState<{ builds: LoadBuild[]; index: { file: string; count: number; sources: number } | null; current: boolean | null } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { void api.call<typeof data>(`load?hours=${enc(hours)}`).then((d) => { setData(d); setErr(''); }, (e) => setErr(errText(e))); }, [hours]);
  return (
    <div className="axp-memory-manager__memory">
      <p className="fx-small fx-muted">What a session loads at start: CLAUDE.md (small), then the orchestrator's list of builds started recently that stopped unfinished, then only the chunks it needs.</p>
      <SelectField label="Builds started in the last" value={hours} options={[{ value: '24', label: '24 hours' }, { value: '48', label: '48 hours' }, { value: '72', label: '3 days' }, { value: '168', label: '7 days' }]} onChange={setHours} />
      {err && <Note tone="danger">{err}</Note>}
      {data && (data.builds.length ? (
        <ul className="axp-memory-manager__plist">
          {data.builds.map((b) => (
            <li key={b.id} className="fx-small">
              <strong>{b.title}</strong> <span className="fx-muted">({b.id}) · {b.status} · {b.done}/{b.total} steps{b.branch ? ` · ${b.branch}` : ''}{b.pr ? ` · PR ${b.pr}` : ''}</span>
              {b.next && <div className="fx-muted">Next {b.next.id} [{b.next.model}]: {b.next.text}</div>}
              {b.chunks.map((c) => <div key={c}><button type="button" className="fx-btn fx-btn--ghost fx-btn--sm" onClick={() => openDoc(`repo:_claude/chunks/${c}.md`)}>{c}</button></div>)}
            </li>
          ))}
        </ul>
      ) : <Note tone="info">No build started in that window stopped unfinished.</Note>)}
      {data?.index && <p className="fx-small">Chunk index: {data.index.count} chunks from {data.index.sources} files (<code>{data.index.file}</code>){data.current === false ? ' · behind its sources, rebuild it' : ''}.</p>}
      <div className="axp-memory-manager__acts" role="toolbar" aria-label="Session start">
        <IconButton icon="file" label="Open CLAUDE.md" onClick={() => openDoc('repo:CLAUDE.md')} />
        <IconButton icon="list" label="Open the chunk index" onClick={() => openDoc('repo:_claude/chunks/INDEX.md')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ settings panel: categorized collapsible sections */

const LABELS: Record<string, [string, string]> = {
  'scan.includeChunks': ['List each memory chunk', 'Off: the generated chunks show as one row.'],
  'scan.includeLogs': ['List each change-log entry and session record', 'Off: changes/ and sessions/ show as one row each.'],
  'scan.includeHub': ['Include the hub copy', 'The /projects copy of the Claude files, when the hub is mounted here.'],
  'scan.includeUser': ['Include ~/.claude/CLAUDE.md', 'The user CLAUDE.md of the machine the console runs on (read-only).'],
  'scan.includeBuilds': ['Include builds data', 'Build reports and the builds store, shown for reference (they belong to the orchestrator).'],
  'scan.codeScan': ['Find readers and writers in the code', 'Off: only the audit map says who reads and writes.'],
  'list.groupBy': ['Group the list by', 'Category, location, root or kind.'],
  'list.sort': ['Sort files by', 'Path, size, last change or tokens.'],
  'safety.confirmDelete': ['Ask before deleting', 'The text is always kept as a version either way.'],
  'chunks.rebuildOnSave': ['Rebuild chunks after a save', 'Regenerates _claude/chunks when you save a file they are made from.'],
};

export function MemorySettings() {
  const doc = useMem((s) => s.settings);
  useEffect(() => { void loadSettings(); }, []);
  if (!doc) return <p className="fx-small fx-muted">Loading settings…</p>;
  return (
    <div className="fx-stack axp-memory-manager__settings">
      {doc.categories.map((c, i) => (
        <details key={c.category} open={i === 0} className="axp-memory-manager__group" data-axf-settings-section={c.category}>
          <summary><strong>{c.category}</strong></summary>
          <div className="fx-stack">
            {c.keys.map((k) => {
              const [label, hint] = LABELS[k] ?? [k, ''];
              const v = doc.settings[k];
              return doc.choices[k]
                ? <SelectField key={k} label={label} hint={hint} value={String(v)} options={doc.choices[k]!.map((x) => ({ value: x, label: x }))} onChange={(x) => void saveSetting(k, x)} />
                : <Switch key={k} label={label} hint={hint} checked={v === true} onChange={(x) => void saveSetting(k, x)} />;
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
