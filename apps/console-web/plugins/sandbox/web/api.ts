/** Sandbox API client (the console's pluginApi: token, standard messages) and the shapes the server sends. */
import { pluginApi } from '@console/plugins';

export const FOLDER = 'sandbox';
export const api = pluginApi(FOLDER, 'The Sandbox plugin');

export interface Me {
  user: string; admin: boolean; allowed: boolean; reason: string; readOnly: true;
  github: { ready: boolean; reason: string; repos: string[] };
  limits: { maxFiles: number; maxFileKb: number; maxTotalMb: number };
  usage: { files: number; bytes: number };
}

export interface SbFile { path: string; size: number; modifiedAt: number }
export interface FileText { path: string; text: string; size: number; modifiedAt: number }
export interface GhFile { path: string; sha?: string; size?: number; text: string; isText: boolean; htmlUrl?: string | null }

export interface SandboxConfig { enabled: boolean; openTo: 'everyone' | 'permission' | 'admins'; repos: string[]; maxFiles: number; maxFileKb: number; maxTotalMb: number }
export interface WorkspaceRow { id: string; user: string; files: number; bytes: number; createdAt?: number; lastUsedAt?: number }
export interface LogRow { at: number; user: string; action: string; detail: string }
export interface AdminState { config: SandboxConfig; workspaces: WorkspaceRow[]; hub: { ready: boolean; reason: string }; log: LogRow[]; readTools: string[]; ops: string[] }

export interface PilotCatalog {
  templates: Record<string, { label: string; kind?: string; targets?: string[] }>;
  boilerplates: { categories: { id: string; label: string }[]; items: { id: string; name: string; category?: string; description?: string; status?: string }[] };
  libraries: { id: string; name: string; description: string; dependsOn: string[] }[];
  buildOptions: Record<string, { label?: string; description?: string; default?: unknown; type?: string }>;
  defaults: Record<string, string>;
  assets: Record<string, { id: string; name?: string; description?: string; tags?: string[] }[]>;
}

/** GitHub ops the server knows (shield.GITHUB_OPS); anything else is refused there too. */
export type GhOp = 'repo' | 'contents' | 'branches' | 'commits' | 'commit' | 'pulls' | 'pull' | 'pull-files' | 'issues' | 'issue' | 'runs' | 'run-jobs' | 'releases' | 'tags';

export const gh = <T,>(op: GhOp, repo: string, args: Record<string, unknown> = {}) =>
  api.post<{ op: string; data: T }>('github', { op, repo, args }).then((r) => r.data);

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const fmtAgo = (t?: number | string | null) => {
  if (!t) return '—';
  const ms = typeof t === 'number' ? t * 1000 : Date.parse(t);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
