/* AI assistant — web API layer. Types and the client come from the framework's assistant contract (assistant@1,
 * framework/core/assistant.ts); this file binds them to the console (pluginFetch adds the console token) and adds the
 * plugin's extra routes (config, profiles, compare, usage, batches). Build Pilot and other apps use the same core. */
import { HttpAssistantClient, type AssistantStatus, type ProviderKind, type ProviderProfile } from '@console/axf/core';
import { pluginApi, pluginFetch } from '@console/plugins';

export const FOLDER = 'ai-assistant';
export const ID = 'ai.amberx.axf.console.ai-assistant';
/** Setting: show axHub approvals (lib-approvals badge) in the chat's title bar. */
export const APPROVALS_BADGE_KEY = 'ai-assistant.approvalsBadge';

/** The console's hub (`/api/me` → AXF_WALL_HUB on the server); lib-approvals falls back to its default hub. */
export async function consoleHub(): Promise<string> {
  const r = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
  const j = (await r.json()) as { hub?: string };
  if (typeof j.hub !== 'string' || !j.hub) throw new Error('no hub');
  return j.hub;
}

export type {
  AgentRef, ChatContext as Ctx, ChatImage as Image, Conversation, ConversationSettings as ConvSettings, ConversationSummary as ConvSummary,
  LiveReply, Message, ProviderKind, ProviderProfile as Profile, StreamEvent, ToolLogEntry as ToolLog, TurnEvent, WriteMode,
} from '@console/axf/core';
export { applyStreamEvent, contextExtra, emptyLiveReply, normalizeChatContext, watchReply } from '@console/axf/core';
export type { LiveSessionInfo } from '@console/axf/core';
export type Status = AssistantStatus;

export interface PromptItem { id: string; title: string; shortcut: string; text: string }
export interface Params { temperature: number | null; max_tokens: number | null; top_p: number | null; thinking: boolean; thinking_budget: number; reasoning_effort: string }
export interface Config {
  setupComplete: boolean; assistantName: string; persona: string; instructions: string; defaultProfile: string; fallback: string[];
  params: Params; contextMessages: number; tools: Record<string, boolean>; maxToolRounds: number; autoTitle: boolean; showUsage: boolean;
  showThinking: boolean; redactSecrets: boolean; dailyTokenBudget: number; agentIntegration: boolean; defaultAgent: string; userDailyTokens: number; keepInterrupted: boolean;
  suggestions: string[]; prompts: PromptItem[]; profiles: ProviderProfile[]; sessionHost?: string; schema?: number;
}
export interface Catalog { providers: ProviderKind[]; protocols: string[]; personas: string[]; toolGroups: Record<string, string>; cliInstalled: boolean }
export interface SessionHostInfo { id: string; label: string; available: boolean; note: string }
export interface Usage {
  today: { calls: number; input: number; output: number }; days: { day: string; calls: number; input: number; output: number }[];
  byProfileModel: { profile: string; model: string; calls: number; input: number; output: number }[]; users?: { user: string; today: number; month: number }[];
}
export interface ContractInfo { assistant: string; conversation: string; liveSession: string; turnEvents: string[]; settingKeys: string[]; hosts: SessionHostInfo[]; provides: string[]; actions: string[] }

/** The framework client bound to this plugin's routes (console token added by pluginFetch). */
export const client = new HttpAssistantClient({
  base: `/api/plugins/${FOLDER}`,
  fetch: (url, init) => pluginFetch(FOLDER, url.slice(`/api/plugins/${FOLDER}/`.length), init),
  messages: { unauthorized: 'Console token required (Settings → Account & security).', unavailable: 'The AI assistant plugin is disabled or its server part is not running.' },
});

/** JSON calls for the plugin's own routes (the console's pluginApi: same token, same messages as the client above). */
const api = pluginApi(FOLDER, 'The AI assistant plugin');
export const call = <T,>(path: string, init?: RequestInit) => api.call<T>(path, init);
export const post = <T,>(path: string, body: unknown) => api.post<T>(path, body);
export const put = <T,>(path: string, body: unknown) => api.put<T>(path, body);
export const patch = <T,>(path: string, body: unknown) => api.patch<T>(path, body);
export const del = <T,>(path: string) => api.del<T>(path);

/* A tiny shared store so the view, the dialog and the settings tab see the same status/config. */
type Listener = () => void;
export function createStore<T>(load: () => Promise<T>) {
  let value: T | undefined;
  let error = '';
  const subs = new Set<Listener>();
  const emit = () => subs.forEach((f) => f());
  return {
    get: () => value,
    error: () => error,
    subscribe: (f: Listener) => { subs.add(f); return () => { subs.delete(f); }; },
    reload: async () => { try { value = await load(); error = ''; } catch (e) { error = (e as Error).message; } emit(); return value; },
    set: (v: T) => { value = v; emit(); },
  };
}
export const statusStore = createStore(() => client.status());
export const configStore = createStore(() => call<Config>('config'));
export const catalogStore = createStore(() => call<Catalog>('catalog'));

export const fmtTime = (ms?: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtNum = (n?: number) => (n ?? 0).toLocaleString();

export function fileToImage(f: File): Promise<{ media_type: string; data: string; name?: string }> {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const s = String(rd.result); res({ media_type: f.type || 'image/png', data: s.slice(s.indexOf(',') + 1), name: f.name }); };
    rd.onerror = () => rej(rd.error);
    rd.readAsDataURL(f);
  });
}
