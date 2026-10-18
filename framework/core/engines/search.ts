/**
 * Search engine — one index over everything an app can show: views, actions, settings (tabs, groups, single
 * settings, panels), dialogs, assets, open windows and words on pages. The toolbar's live search reads it;
 * any library or plugin can add a provider (open registry, no kernel change needed for new kinds).
 *
 * Framework-agnostic: entries say *what* to focus (`SearchFocus`); the UI layer decides *how* (navigate, open,
 * scroll into view, flash). Without a UI focuser the runtime still navigates / dispatches / opens / swaps.
 */
import type { AxfRuntime } from '../runtime';
import { ASSET_TYPES, type AssetType } from '../types';

/** Result kinds the framework knows. Providers may use any other string. */
export type SearchKind = 'view' | 'action' | 'setting' | 'settings-tab' | 'dialog' | 'asset' | 'window' | 'text' | (string & {});

/** What selecting a result brings into focus. `anchor` = a `data-axf-anchor` value in the UI. */
export type SearchFocus =
  | { kind: 'view'; view: string }
  | { kind: 'action'; spec: string }
  | { kind: 'setting'; tab: string; anchor?: string }
  | { kind: 'dialog'; id: string }
  | { kind: 'asset'; type: AssetType; id: string }
  | { kind: 'window'; id: string }
  | { kind: 'text'; view: string; tag: string; text: string }
  | { kind: string; [k: string]: unknown };

export interface SearchEntry {
  /** unique within the index, e.g. `view:home`, `setting:axf.display.fontScale` */
  id: string;
  kind: SearchKind;
  label: string;
  /** where it lives ("Settings › Appearance", "Action", "Home") */
  detail?: string;
  icon?: string;
  keywords?: string[];
  /** UAC permission; denied entries are dropped (hide) or kept marked (disable) per the policy */
  requires?: string;
  focus: SearchFocus;
}

export interface SearchHit extends SearchEntry {
  score: number;
  locked: boolean;
}

export type SearchProvider = () => SearchEntry[];
export type SearchFocuser = (entry: SearchEntry) => boolean | void;

/** Labels shown next to results, per kind. */
export const SEARCH_KIND_LABELS: Record<string, string> = {
  view: 'Page', action: 'Action', setting: 'Setting', 'settings-tab': 'Settings', dialog: 'Dialog', asset: 'Asset', window: 'Window', text: 'On page',
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Score one entry for a query. Every query word must match the label, detail, kind or keywords; label hits
 * rank highest (exact > prefix > word prefix > substring). 0 = no match. Pure, so ports can reproduce it.
 */
export function scoreEntry(e: Pick<SearchEntry, 'label' | 'detail' | 'keywords' | 'kind'>, query: string): number {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const label = norm(e.label);
  const rest = norm([e.detail ?? '', ...(e.keywords ?? []), SEARCH_KIND_LABELS[e.kind] ?? e.kind].join(' '));
  const full = norm(query).trim();
  let score = 0;
  for (const w of words) {
    let s = 0;
    if (label === w) s = 100;
    else if (label.startsWith(w)) s = 60;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) s = 40;
    else if (label.includes(w)) s = 25;
    else if (rest.includes(w)) s = 10;
    if (!s) return 0;
    score += s;
  }
  if (words.length > 1 && label.includes(full)) score += 30;
  // shorter labels first among equals
  return score - Math.min(label.length, 60) / 60;
}

export class SearchIndex {
  private readonly providers = new Map<string, SearchProvider>();
  private focuser: SearchFocuser | null = null;

  constructor(private readonly rt: AxfRuntime) {
    this.add('axf.actions', () => this.actionEntries());
    this.add('axf.settings', () => this.settingsEntries());
    this.add('axf.assets', () => this.assetEntries());
    this.add('axf.windows', () => this.windowEntries());
  }

  /** Add (or replace) a provider. Returns a remover. */
  add(id: string, provider: SearchProvider): () => void {
    this.providers.set(id, provider);
    return () => { if (this.providers.get(id) === provider) this.providers.delete(id); };
  }

  remove(id: string): void { this.providers.delete(id); }

  /** Every entry from every provider (deduplicated by id; the first provider wins). */
  entries(): SearchEntry[] {
    const seen = new Map<string, SearchEntry>();
    for (const [pid, p] of this.providers) {
      let list: SearchEntry[] = [];
      try { list = p(); } catch (err) { this.rt.terminal.warn('search', `provider ${pid} failed: ${String(err)}`); }
      for (const e of list) if (!seen.has(e.id)) seen.set(e.id, e);
    }
    return [...seen.values()];
  }

  /** Ranked hits for a query, gated by the active access policy. */
  query(q: string, opts: { limit?: number; kinds?: string[] } = {}): SearchHit[] {
    if (!q.trim()) return [];
    const hits: SearchHit[] = [];
    for (const e of this.entries()) {
      if (opts.kinds?.length && !opts.kinds.includes(e.kind)) continue;
      const gate = this.rt.gate(e.requires);
      if (gate === 'hide') continue;
      const score = scoreEntry(e, q);
      if (score > 0) hits.push({ ...e, score, locked: gate === 'disable' });
    }
    hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    // Words on a page that name something already listed (a panel title, a button that is an action) add nothing.
    const named = new Set(hits.filter((h) => h.kind !== 'text').map((h) => norm(h.label)));
    return hits.filter((h) => h.kind !== 'text' || !named.has(norm(h.label))).slice(0, opts.limit ?? 12);
  }

  /** The UI layer installs one to navigate, scroll and highlight. */
  setFocuser(fn: SearchFocuser | null): void { this.focuser = fn; }

  /** Bring an entry into focus. The UI focuser goes first; the runtime fallback handles the basic kinds. */
  focus(entry: SearchEntry): boolean {
    if (this.focuser && this.focuser(entry) !== false) return true;
    const f = entry.focus as { kind: string } & Record<string, string>;
    switch (f.kind) {
      case 'view': case 'text': this.rt.navigate(f.view!); return true;
      case 'action': return this.rt.dispatch(f.spec!);
      case 'setting': return this.rt.dispatch(`settings.open:${f.tab}`);
      case 'dialog': this.rt.openDialog(f.id!); return true;
      case 'asset': return this.rt.swap(f.type as AssetType, f.id!);
      case 'window': this.rt.windows.restore(f.id!); return true;
      default: return false;
    }
  }

  /* ---------------- built-in providers ---------------- */

  /** Actions that run without arguments (stubs and parameterised actions are left out). */
  private actionEntries(): SearchEntry[] {
    return this.rt.actions.list()
      .filter(({ meta }) => !meta.stub && !meta.params && meta.searchable !== false)
      .map(({ id, meta }) => ({
        id: `action:${id}`, kind: 'action', label: meta.label, detail: id, icon: 'zap',
        ...(meta.requires ? { requires: meta.requires } : {}),
        focus: { kind: 'action', spec: id },
      }));
  }

  /** Settings tabs, groups, single settings and panels. */
  private settingsEntries(): SearchEntry[] {
    const s = this.rt.settings;
    const out: SearchEntry[] = [];
    for (const tab of s.listTabs()) {
      const where = `Settings › ${tab.label}`;
      out.push({ id: `settings-tab:${tab.id}`, kind: 'settings-tab', label: `${tab.label} settings`, detail: 'Settings', icon: tab.icon, keywords: [tab.label, tab.description ?? ''], focus: { kind: 'setting', tab: tab.id } });
      for (const p of s.panelsIn(tab.id)) {
        out.push({ id: `settings-panel:${p.id}`, kind: 'setting', label: p.title, detail: where, icon: p.icon ?? tab.icon, focus: { kind: 'setting', tab: tab.id, anchor: `settings-panel:${p.id}` } });
      }
      for (const g of s.groupsIn(tab.id)) {
        out.push({ id: `settings-group:${g.id}`, kind: 'setting', label: g.label, detail: where, icon: g.icon ?? tab.icon, keywords: [g.description ?? ''], focus: { kind: 'setting', tab: tab.id, anchor: `settings-group:${g.id}` } });
        for (const spec of g.settings) {
          if (spec.kind === 'section') continue;
          out.push({
            id: `setting:${spec.key}`, kind: 'setting', label: spec.label, detail: `${where} › ${g.label}`, icon: spec.icon ?? g.icon ?? 'settings',
            keywords: [spec.description ?? '', spec.key], ...(spec.requires ? { requires: spec.requires } : {}),
            focus: { kind: 'setting', tab: tab.id, anchor: `setting:${spec.key}` },
          });
        }
      }
    }
    return out;
  }

  private assetEntries(): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const t of ASSET_TYPES) {
      for (const a of this.rt.registry.list(t)) {
        out.push({
          id: `asset:${t}:${a.id}`, kind: 'asset', label: a.name, detail: t, icon: 'palette',
          keywords: [a.id, a.description ?? '', ...(a.tags ?? [])],
          focus: { kind: 'asset', type: t, id: a.id },
        });
      }
    }
    return out;
  }

  private windowEntries(): SearchEntry[] {
    return this.rt.windows.state.windows
      .filter((w) => w.type !== 'main')
      .map((w) => ({ id: `window:${w.id}`, kind: 'window', label: w.title, detail: w.minimized ? 'Window (minimized)' : 'Window', icon: 'monitor', focus: { kind: 'window', id: w.id } }));
  }
}
