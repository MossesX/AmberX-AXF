/* AI assistant — web API layer: typed calls to the plugin's server part and the streamed-turn reader. */
import { pluginFetch } from '@console/plugins';

export const FOLDER = 'ai-assistant';
export const ID = 'ai.amberx.axf.console.ai-assistant';

export interface ProviderKind { kind: string; label: string; protocol: string; baseUrl: string; keyEnv: string; auth: string; models: string[]; keyUrl: string; vision?: boolean; tools?: boolean; local?: boolean; note?: string; noModelList?: boolean }
export interface Profile { id: string; kind: string; label: string; baseUrl: string; auth: string; keyEnv: string; hasKey: boolean; envPresent: boolean; keyReady: boolean; defaultModel: string; models: string[]; embedModel: string; enabled: boolean; headers: Record<string, string>; lastTest?: { at: number; ok: boolean; ms?: number; reply?: string; error?: string; model?: string } | null }
export interface PromptItem { id: string; title: string; shortcut: string; text: string }
export interface Params { temperature: number | null; max_tokens: number | null; top_p: number | null; thinking: boolean; thinking_budget: number; reasoning_effort: string }
export interface Config {
  setupComplete: boolean; assistantName: string; persona: string; instructions: string; defaultProfile: string; fallback: string[];
  params: Params; contextMessages: number; tools: Record<string, boolean>; maxToolRounds: number; autoTitle: boolean; showUsage: boolean;
  showThinking: boolean; redactSecrets: boolean; dailyTokenBudget: number; agentIntegration: boolean; defaultAgent: string;
  suggestions: string[]; prompts: PromptItem[]; profiles: Profile[];
}
export interface AgentRef { id: string; name: string; icon?: string; description?: string; origin?: string }
export interface Status {
  assistantName: string; setupComplete: boolean; needsSetup: boolean; defaultProfile: Profile | null; profiles: number; ready: number; cliInstalled: boolean;
  integrations: { agents: boolean; agentCount: number }; agents: AgentRef[]; defaultAgent: string; tokensToday: number; budget: number;
  suggestions: string[]; prompts: PromptItem[]; showUsage: boolean;
}
export interface Catalog { providers: ProviderKind[]; personas: string[]; toolGroups: Record<string, string>; cliInstalled: boolean }
export interface ToolLog { id: string; name: string; input: string; ok: boolean; preview: string }
export interface Image { media_type: string; data: string; name?: string }
export interface Message {
  id: string; role: 'user' | 'assistant' | 'tool'; content: string; createdAt: number; images?: Image[];
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  meta?: { step?: boolean; profile?: string; model?: string; latencyMs?: number; usage?: { input: number; output: number }; tools?: ToolLog[]; agentId?: string; agentName?: string; stopped?: boolean; thinking?: string; context?: Ctx | null };
}
export interface ConvSettings { profileId?: string; model?: string; temperature?: number; max_tokens?: number; top_p?: number; systemPrompt?: string; agentId?: string; tools?: boolean; thinking?: boolean }
export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; pinned: boolean; archived: boolean; tags: string[]; settings: ConvSettings; messages: Message[] }
export interface ConvSummary { id: string; title: string; pinned: boolean; archived: boolean; tags: string[]; updatedAt: number; messages: number; agentId: string; preview: string }
export interface Ctx { view?: string; title?: string; selection?: string; note?: string }
export interface Usage { today: { calls: number; input: number; output: number }; days: { day: string; calls: number; input: number; output: number }[]; byProfileModel: { profile: string; model: string; calls: number; input: number; output: number }[] }

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await pluginFetch(FOLDER, path, init);
  const j = (await r.json().catch(() => ({}))) as T & { detail?: unknown };
  if (r.status === 401) throw new Error('Console token required (Settings → Account & security).');
  if (r.status === 404 && !j.detail) throw new Error('The AI assistant plugin is disabled or its server part is not running.');
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? r.statusText));
  return j;
}
export const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T,>(path: string) => call<T>(path, { method: 'DELETE' });

export type TurnEvent =
  | { event: 'start'; data: { turnId: string; agent: AgentRef | null } }
  | { event: 'text' | 'thinking' | 'status'; data: { text: string } }
  | { event: 'tool'; data: { phase: 'call' | 'result'; id: string; name: string; input?: string; ok?: boolean; preview?: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done'; data: { message: Message; title: string } };

/** POST a turn and read its server-sent events. */
export async function streamTurn(cid: string, body: Record<string, unknown>, onEvent: (e: TurnEvent) => void, signal: AbortSignal): Promise<void> {
  const r = await pluginFetch(FOLDER, `conversations/${cid}/messages`, { method: 'POST', body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { detail?: string };
    throw new Error(j.detail ?? `request failed (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try { onEvent({ event, data: JSON.parse(data) } as TurnEvent); } catch { /* malformed event */ }
    }
  }
}

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
export const statusStore = createStore(() => call<Status>('status'));
export const configStore = createStore(() => call<Config>('config'));
export const catalogStore = createStore(() => call<Catalog>('catalog'));

export const fmtTime = (ms?: number) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtNum = (n?: number) => (n ?? 0).toLocaleString();

export function fileToImage(f: File): Promise<Image> {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => { const s = String(rd.result); res({ media_type: f.type || 'image/png', data: s.slice(s.indexOf(',') + 1), name: f.name }); };
    rd.onerror = () => rej(rd.error);
    rd.readAsDataURL(f);
  });
}
