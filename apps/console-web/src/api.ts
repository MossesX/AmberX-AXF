/**
 * Console data + build-engine client. Everything reads `/api/*` from the Python backend (server/) and falls
 * back to the static copies in `public/data` (synced from the repo at build time) when no backend answers,
 * so the console also works as a plain static site. Engine *operations* (init, install, import-ui…) need the
 * backend; without it the console records the command for Claude Code and says so on the output terminal.
 */

/* ---------------- models: the framework's typed catalog contract (framework/core/catalog.ts = Kotlin kernel.catalog) ---------------- */

import { createTokenStore } from './axf/libs/apiclient';
import { parseBoilerplate, parseBoilerplateIndex, parseCatalog, parseLibrary, parseTracker, type Boilerplate, type FeatureStatus, type LibraryDescriptor, type LibraryParam } from './axf/core/catalog';
export type { BoilerplateIndex, BoilerplateScreen, Boilerplate, Catalog, CatalogGroup, CatalogItem, CatalogTab, LibraryParam, Tracker, TrackerItem } from './axf/core/catalog';
export type { CatalogSuggestion as Suggestion, FeatureStatus as Status } from './axf/core/catalog';
export { FEATURE_STATUSES as STATUSES, paramDefaultText, paramError, paramToJson } from './axf/core/catalog';
/** An installable library (library@1). */
export type InstallableLibrary = LibraryDescriptor;
export interface ModuleInfo { name: string; kind: string; description: string }
export interface EngineResult { ok: boolean; log?: string[]; error?: string; [k: string]: unknown }

/* ---------------- transport ---------------- */

/** Static preview build (VITE_AXF_STATIC=1): no backend, data read from ./data next to the page. */
const STATIC = import.meta.env.VITE_AXF_STATIC === '1';
const DATA = STATIC ? 'data/' : '/data/';
let backendUp: boolean | null = STATIC ? false : null;
export async function health(): Promise<boolean> {
  if (STATIC) return (backendUp = false);
  try { const r = await fetch('/api/health', { cache: 'no-store' }); backendUp = r.ok && (r.headers.get('content-type') ?? '').includes('json'); } catch { backendUp = false; }
  return backendUp;
}
export const isBackendUp = () => backendUp === true;

async function getJson<T>(api: string, fallback: string): Promise<T> {
  if (backendUp !== false) {
    try { const r = await fetch(`/api/${api}`, { cache: 'no-store' }); if (r.ok) { backendUp = true; return (await r.json()) as T; } } catch { /* fall through */ }
    backendUp = false;
  }
  const r = await fetch(`${DATA}${fallback}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`No ${fallback} (run npm run sync)`);
  return (await r.json()) as T;
}

/** The console token (AXF_TOKEN) kept in this browser; sent with every write (store: the framework's API client library). */
export const consoleTokens = createTokenStore({ key: 'axf-console:token', event: 'axf:token-changed' });
export const getToken = () => consoleTokens.get();
export const setToken = (t: string) => consoleTokens.set(t);
/** Fired on window when the console token saved in this browser changes (the systems check re-runs). */
export const TOKEN_CHANGED = consoleTokens.event;
const authHeader = (): Record<string, string> => { const t = getToken(); return t ? { authorization: `Bearer ${t}` } : {}; };

export async function post(api: string, body: unknown): Promise<EngineResult> {
  if (STATIC) return { ok: false, error: 'Preview copy: the build engine runs on the VPS. Install it with deploy/install-console.sh, then use https://console.amberxai.com — the command is recorded below.' };
  try {
    const r = await fetch(`/api/${api}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as EngineResult & { detail?: string };
    if (r.status === 401) return { ...j, ok: false, unauthorized: true, error: 'Unauthorized — set the console token (Home → Console token; it is the AXF_TOKEN printed by install-console.sh)' };
    return r.ok ? { ...j, ok: true } : { ...j, ok: false, error: j.error ?? j.detail ?? r.statusText };
  } catch (e) { backendUp = false; return { ok: false, error: `Build engine not reachable (${(e as Error).message}). Start server/ (python -m uvicorn main:app --port 7090) or deploy it next to the console.` }; }
}

/* ---------------- data ---------------- */

export const loadCatalog = async () => parseCatalog(await getJson<unknown>('catalog', 'catalog.json'));
export const loadTracker = async () => parseTracker(await getJson<unknown>('tracker', 'tracker.json'));
export const loadLibraries = async (): Promise<InstallableLibrary[]> => { const x = await getJson<{ items?: unknown[] }>('libraries', 'libraries.json'); return (Array.isArray(x.items) ? x.items : []).map(parseLibrary); };
export const loadBoilerplateIndex = async () => parseBoilerplateIndex(await getJson<unknown>('boilerplates', 'boilerplates.json'));
export const loadBoilerplates = async (): Promise<Boilerplate[]> => { const x = await getJson<{ items?: unknown[] } | unknown[]>('boilerplates/items', 'boilerplate-items.json'); return (Array.isArray(x) ? x : Array.isArray(x.items) ? x.items : []).map(parseBoilerplate); };
export interface PlannedPlugin { id: string; name: string; target: string; description?: string; plan?: string; pending?: string; model?: string }
export const loadPluginIndex = async () => (await getJson<{ items: PlannedPlugin[] }>('plugin-index', 'plugin-index.json')).items ?? [];
export const loadModules = async () => (await getJson<{ modules: ModuleInfo[] }>('modules', 'modules.json')).modules ?? [];

/* ---------------- local state (checked features, project, records) ---------------- */

const LS = 'axf-console:';
export function readLocal<T>(key: string, fallback: T): T { try { const v = localStorage.getItem(LS + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } }
export function writeLocal(key: string, value: unknown) { try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch { /* ignore */ } }

/** A library install or UI-library import the console ran (or recorded for Claude Code). */
export interface PortRecord { id: string; kind: 'install' | 'ui-import' | 'build' | 'init'; name: string; source: string; project: string; status: string; createdAt: string; log: string }
export interface DemoApp { id: string; library: string; name: string; template: string; status: string; createdAt: string }

/* ---------------- helpers ---------------- */

export const statusTone = (s: FeatureStatus): 'success' | 'accent' | 'warning' | 'danger' | undefined => (s === 'built' ? 'success' : s === 'partial' ? 'accent' : s === 'placeholder' ? 'warning' : undefined);

/* ---------------- plan (framework/plan/plan.json) ---------------- */

export type PlanStatus = 'built' | 'partial' | 'in-progress' | 'placeholder' | 'planned' | 'blocked' | 'dropped';
export const PLAN_STATUSES: PlanStatus[] = ['built', 'partial', 'in-progress', 'placeholder', 'planned', 'blocked', 'dropped'];
export type PortId = 'android' | 'web' | 'python';
export const PORTS: PortId[] = ['android', 'web', 'python'];
export interface PlanFeature {
  id: string; title: string; area: string; group?: string; kind: 'epic' | 'feature' | 'task'; parent?: string; epic?: string;
  status: PlanStatus; priority: string; wave: number; effort: string; summary: string;
  ports: Partial<Record<PortId, { status: string; where: string }>>;
  capabilities: string[]; dependsOn: string[]; catalog: string[]; modules: string[]; files: string[];
  acceptance: { text: string; done: boolean }[]; warnings: { level: 'info' | 'warn' | 'error'; text: string }[]; recommendations: string[];
  previews: { kind: 'element' | 'boilerplate' | 'route' | 'url' | 'image'; ref: string; label: string }[];
  screenshots: { src: string; caption: string }[]; links: { label: string; url: string }[]; tags: string[]; notes: string;
  source: 'seed' | 'catalog' | 'user'; edited?: boolean; history: { at: string; text: string }[];
  /** Suggested model to build it (top three only) + why; modelEdited when picked by hand. */
  model?: ModelId; modelReason?: string; modelEdited?: boolean;
}
export type ModelId = 'fable' | 'opus' | 'sonnet';
export const MODELS: { id: ModelId; label: string; api: string; when: string }[] = [
  { id: 'fable', label: 'Fable 5.1', api: 'claude-fable-5-1', when: 'Strongest reasoning: kernel internals, porting, cross-port contracts, heavy refactors' },
  { id: 'opus', label: 'Opus 5.5', api: 'claude-opus-5-5', when: 'Default for build work, and anything security-adjacent (servers, shells, auth, deploy)' },
  { id: 'sonnet', label: 'Sonnet 5.5', api: 'claude-sonnet-5-5', when: 'Only where Opus is clearly not needed: content packs, simple self-contained UI' },
];
export const modelLabel = (m?: string) => MODELS.find((x) => x.id === m)?.label ?? 'Opus 5.5';

/* ---------------- build queue (framework/plan/build-queue.json) ---------------- */
import type { QueueState, QueueView } from './axf/plan/build-queue-core.mjs';
export const loadBuildQueueState = async (): Promise<QueueState | null> => {
  try { return (await getJson<{ state: QueueState } | QueueState>('build-queue', 'build-queue.json').then((x) => ('state' in x && x.state ? x.state : (x as QueueState)))); } catch { return null; }
};
export type BuildResult = EngineResult & { state?: QueueState; view?: QueueView; proposal?: import('./axf/plan/build-queue-core.mjs').Proposal; log?: string[] };
export const buildPost = (path: 'sync' | 'order' | 'reprocess' | 'step', body: unknown) => post(`build-queue/${path}`, body) as Promise<BuildResult>;
export interface Plan { generatedAt: string; features: PlanFeature[] }
export const loadPlan = () => getJson<Plan>('plan', 'plan.json');

/* ---------------- pending build list (framework/plan/pending.json) ---------------- */
import type { PendingAction, PendingItem, PendingState } from './axf/plan/pending-core.mjs';
export const loadPending = () => getJson<PendingState>('pending', 'pending.json');
export const pendingPost = (change: PendingAction) => post('pending', change) as Promise<EngineResult & { state?: PendingState; item?: PendingItem }>;
export const savePlanFeature = (feature: PlanFeature, note?: string) => post('plan/feature', { feature, note });
export const deletePlanFeature = (id: string) => post('plan/delete', { id });
export const uploadPlanMedia = (id: string, dataUrl: string) => post('plan/media', { id, dataUrl });
/** `media/x.jpg` (plan.json) → URL served by the API, or the static copy next to the page. */
export const planMediaUrl = (src: string) => (/^(https?:|data:)/.test(src) ? src : backendUp ? `/plan-${src}` : `${DATA}plan-${src}`);

/* ---------------- library templates (framework/library-templates) ---------------- */

export interface LibraryTemplate { id: string; name: string; category: string; icon: string; description: string; produces: string[]; params: LibraryParam[]; deps: string[]; ports: string[]; files: Record<string, string[]> }
export const loadLibraryTemplates = async () => (await getJson<{ items: LibraryTemplate[] }>('library-templates', 'library-templates.json')).items ?? [];

/* ---------------- Standards: project manifests (project.manifest.json) + their rules ---------------- */
import type { ProjectManifest, ProjectRules, ProjectValidation } from './axf/core/project';
export interface ProjectRow { dir: string; exists: boolean; manifest: ProjectManifest | null; validation: ProjectValidation }
export const loadProjects = () => getJson<{ rulesFile: string; items: ProjectRow[] }>('standards/projects', 'projects.json');
export const loadProjectRules = () => getJson<{ rules: ProjectRules; base: ProjectRules; file: string }>('standards/rules', 'project-rules.json');
export const saveProjectRules = (rules: ProjectRules) => post('standards/rules', { rules }) as Promise<EngineResult & { rules?: ProjectRules }>;
