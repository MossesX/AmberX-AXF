import { useEffect, useState } from 'react';
import { pluginApi } from '@console/plugins';
import * as core from './swarm-core.mjs';

/* Types, the API client and small shared pieces of the agent swarm's web part. */

export const FOLDER = 'agent-swarm';
export const api = pluginApi(FOLDER, 'Agent swarm', { unavailable: 'The agent swarm is switched off or its server part is not running.' });

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type Agent = { id: string; name: string; role: string; skill: string; specialty: string; models: string[]; tools: string[]; maxTurns: number; tokenBudget: number; salary: number; hiredAt: string; avatar: { face: string; hair: number; gear: string; hue: number }; catchphrase: string; bio: string };
export type Run = { jobId: string; buildId: string; stepId: string; agent: string; model: string; startedAt: string; endedAt: string; status: string; reason: string; usage: Usage | null; reportedCost: number | null; turns: number; budget: { tokens: number; maxTurns: number }; report: { summary: string } | null };
export type Slot = { runs: number; tokens: number; usd: number; done: number; failed: number };
export type Meter = { total: Slot; byAgent: Record<string, Slot>; byJob: Record<string, Slot>; byBuild: Record<string, Slot>; byModel: Record<string, Slot> };
export type Spend = { all: { usd: number; tokens: number; runs: number }; week: { usd: number; tokens: number; runs: number }; today: { usd: number; tokens: number; runs: number }; avgPerJob: number; jobs: number };
export type AgentState = { cap: number; benched: string; status: string; note: string; until: string; custom: { name: string; works: boolean }; history: { at: string; from: string; to: string; note: string; by: string }[] };
export type ChatMsg = { id: string; at: string; from: string; kind: string; text: string; jobId: string; vibe: number | null; toned: boolean };
export type Swarm = { chat: { enabled: boolean; agents: Record<string, boolean> }; messages: ChatMsg[]; agents: Record<string, AgentState>; notices: { at: string; agent: string; text: string }[] };
export type StatusDef = { label: string; works: boolean | 'small'; tone: string; about: string };
export type SwarmState = { spend: Record<string, Spend>; swarm: Swarm; statuses: Record<string, StatusDef>; roster: { agents: Agent[] }; skills: Record<string, { id: string; title: string; body: string }>; problems: string[]; runs: Run[]; meter: Meter; prices: Record<string, unknown>; builds: { id: string; title: string; status: string; open: number }[]; tracker: string };
export type Job = { id: string; buildId: string; stepId: string; text: string; estimate: string; agent: string; skill: string; tier: string; model: string; leases: string[]; leaseKind: string; shared: string[]; budget: { tokens: number; maxTurns: number }; wave: number; after: string[] };
export type Res<T> = { ok: boolean; error?: string } & T;

export const fmtTime = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
export const ModelChip = ({ m }: { m: string }) => <span className={`sw-model is-${m}`}>{core.MODEL_LABEL[m] ?? m}</span>;

export function useSwarm() {
  const [state, setState] = useState<SwarmState | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try { const r = await api.call<Res<{ state: SwarmState }>>('state'); if (!r.ok) throw new Error(r.error); setState(r.state); setError(''); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  /** One change through swarm.mjs act; the answer carries the fresh state. */
  const act = async (change: Record<string, unknown>) => {
    try { const r = await api.post<Res<{ state: SwarmState; log: string[] }>>('act', change); if (!r.ok) throw new Error(r.error); setState(r.state); return r.log; }
    catch (e) { setError((e as Error).message); return null; }
  };
  return { state, error, load, setState, act };
}
export type Act = (change: Record<string, unknown>) => Promise<string[] | null>;
export const statusText = (as: AgentState, defs: Record<string, StatusDef>) => (as.status === 'custom' ? as.custom.name || 'Custom' : defs[as.status]?.label ?? as.status);

