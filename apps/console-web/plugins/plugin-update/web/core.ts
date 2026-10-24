/**
 * Plugin Update, the pure part (no React, no fetch): what to show for each installed plugin.
 *
 * Inputs: the console's plugins (`GET /api/plugins`: folder, id, name, version, builtWith, enabled) and the plugin
 * catalog on axHub (`GET /api/plugin-catalog?kind=console`: newest version, every version, the model of each).
 * Output, per installed plugin: its model + build date + version, and what can be done:
 *   update   a newer version built by the same model → Update (one click)
 *   replace  a version built by another model → Replace (confirmed swap: the old build removed, the new one installed
 *            in the same folder; never both, Brett Oct 23 2026)
 *   rebuild  park a from-scratch rebuild with another model on the pending list (the Build manager runs it), unless one
 *            is already parked
 */

export const MODELS = ['fable', 'opus', 'sonnet'] as const;
export type Model = (typeof MODELS)[number];
export const MODEL_LABEL: Record<string, string> = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
export const label = (m?: string | null) => (m ? MODEL_LABEL[m] ?? m : 'Unknown');

export interface Installed {
  folder: string; id?: string; name?: string; version?: string; enabled: boolean; error?: string | null;
  builtWith?: { model?: string; builtAt?: string; rebuildOf?: string; replacedBy?: string };
}
export interface CatalogItem {
  kind: string; folder: string; id: string; name: string; version: string; versions?: string[];
  models?: Record<string, string>; builtWith?: { model?: string; builtAt?: string }; publishedAt?: string;
}
export interface Pending { id: string; title?: string; model?: string; status?: string }

export interface Row {
  folder: string; id: string; name: string; version: string; model: string | null; builtAt: string | null; enabled: boolean;
  /** newest same-model version newer than the installed one */
  update: string | null;
  /** newest version built by another model (any version number: a rebuild replaces, it doesn't have to be newer) */
  replace: { version: string; model: string } | null;
  /** models a rebuild can be asked for, and which are already parked */
  rebuildWith: Model[];
  parked: { model: string; id: string; status: string }[];
  inCatalog: boolean;
  error: string | null;
}

/** 1.2.10 > 1.2.9; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => { const [core = '', pre = ''] = v.split(/[-+]/, 2); return { n: core.split('.').map((x) => Number(x) || 0), pre }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < Math.max(x.n.length, y.n.length); i++) { const d = (x.n[i] ?? 0) - (y.n[i] ?? 0); if (d) return d; }
  if (x.pre === y.pre) return 0;
  return x.pre ? (y.pre ? x.pre.localeCompare(y.pre) : -1) : 1;
}

/** Pending id of a rebuild Plugin Update parks for one plugin + model. */
export const rebuildId = (folder: string, model: string) => `rebuild-${folder}-${model}`.slice(0, 64);

export function rows(installed: Installed[], catalog: CatalogItem[], pending: Pending[] = []): Row[] {
  return installed.filter((p) => !p.folder.startsWith('_')).map((p) => {
    const model = p.builtWith?.model ?? null;
    const version = p.version ?? '0.0.0';
    const c = catalog.find((x) => x.kind === 'console' && x.folder === p.folder && (!p.id || x.id === p.id));
    const versions = c ? [...new Set([...(c.versions ?? []), c.version])].sort(compareVersions) : [];
    const modelOf = (v: string) => c?.models?.[v] ?? (v === c?.version ? c?.builtWith?.model : undefined) ?? null;
    const same = versions.filter((v) => compareVersions(v, version) > 0 && (!model || !modelOf(v) || modelOf(v) === model));
    const other = versions.filter((v) => model && modelOf(v) && modelOf(v) !== model);
    const newestOther = other.at(-1);
    const parked = pending
      .filter((x) => MODELS.some((m) => x.id === rebuildId(p.folder, m)))
      .map((x) => ({ model: x.id.slice(rebuildId(p.folder, '').length), id: x.id, status: x.status ?? 'pending' }));
    return {
      folder: p.folder, id: p.id ?? p.folder, name: p.name ?? p.folder, version, model, builtAt: p.builtWith?.builtAt ?? null, enabled: p.enabled,
      update: same.at(-1) ?? null,
      replace: newestOther ? { version: newestOther, model: modelOf(newestOther)! } : null,
      rebuildWith: MODELS.filter((m) => m !== model),
      parked,
      inCatalog: !!c,
      error: p.error ?? null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The pending item that asks for a from-scratch rebuild of `r` with `model` (pending@1 add). */
export function rebuildRequest(r: Row, model: Model): Record<string, unknown> {
  const from = label(r.model);
  const to = label(model);
  return {
    action: 'add',
    id: rebuildId(r.folder, model),
    title: `${r.name} plugin: rebuild on ${to}`,
    model: to,
    source: 'console',
    estimate: '2 h',
    detail: [
      `Rebuild the console plugin ${r.name} (apps/console-web/plugins/${r.folder}, ${r.id}, v${r.version}, built with ${from}) from scratch on ${to}. Asked from Plugin Update.`,
      `Same folder and same id: the new build replaces the old one, never next to it (one instance per plugin). Write it fresh (read the old build only to keep its features, routes, data format and settings working), set plugin.json "builtWith": {"model": "${model}", "builtAt": "<today>", "rebuildOf": "${from} build v${r.version}"} and raise its version.`,
      `Then publish it to the plugin catalog (node framework/cli/plugin-catalog.mjs publish apps/console-web/plugins/${r.folder} --kind console). Plugin Update shows "${to} build available: Replace"; replacing it is confirmed there (the old build's hooks and data are removed, backed up, and the new build installed in the same folder).`,
      'Write the differences report (_claude/memory/docs/rebuilds/<id>.md) and the rebuild log line, like every rebuild.',
    ].join('\n\n'),
    subPrompts: [
      { text: `Read the ${from} build: features, routes, settings, data format, tests`, estimate: '20 min' },
      { text: `Write the ${to} build from scratch in the same folder (server part)`, estimate: '30 min' },
      { text: `Write the ${to} build (web part, settings, menu)`, estimate: '30 min' },
      { text: 'Tests (self-test + the old ones that still apply), builtWith + version bump', estimate: '20 min' },
      { text: 'Publish to the plugin catalog, differences report, rebuild log', estimate: '20 min' },
    ],
  };
}

/** One-line summary for the page head. */
export function summary(list: Row[]): string {
  const ups = list.filter((r) => r.update).length;
  const reps = list.filter((r) => r.replace).length;
  const byModel: Record<string, number> = {};
  for (const r of list) byModel[label(r.model)] = (byModel[label(r.model)] ?? 0) + 1;
  const models = Object.entries(byModel).map(([m, n]) => `${n} ${m}`).join(', ');
  return `${list.length} plugin${list.length === 1 ? '' : 's'} (${models})${ups ? ` · ${ups} update${ups === 1 ? '' : 's'}` : ''}${reps ? ` · ${reps} other-model build${reps === 1 ? '' : 's'}` : ''}`;
}
