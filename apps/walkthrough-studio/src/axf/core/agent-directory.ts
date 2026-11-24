/**
 * Agent directory — who an agent id or name is, for every place that shows an agent's avatar (AgentAvatar).
 *
 * Plugins that know the crew (the agent swarm's roster, the Crew) publish it here with `setAgentDirectory(source, list)`;
 * anything that only has an id or a name from a build, a run or a chat line looks it up with `findAgent`. Pure and
 * framework-agnostic (no React). Several sources may publish; the newest entry for an id wins. Kotlin twin deferred
 * (Android on hold, spec/PORTING.md).
 */

/** The drawn face of an agent (agent@1 `avatar`; drawn by agent-card-rules.mjs `avatarModel`). */
export interface AgentFace { face: string; hair: number; gear: string; hue: number }
export interface AgentInfo {
  id: string; name: string; role?: string; avatar?: AgentFace | null;
  /** other keys that mean this agent: the runs and builds they are on (session `axf-…`, run name, build id) */
  aliases?: string[];
}

/** The context-menu target every agent avatar and row carries (payload = the agent id). */
export const AGENT_CONTEXT_TARGET = 'agent';

const sources = new Map<string, AgentInfo[]>();
const listeners = new Set<() => void>();
let rev = 0;
let byKey = new Map<string, AgentInfo>();

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

function rebuild() {
  const next = new Map<string, AgentInfo>();
  for (const list of sources.values()) {
    for (const a of list) {
      next.set(norm(a.id), a);
      if (a.name && !next.has(norm(a.name))) next.set(norm(a.name), a);
      for (const k of a.aliases ?? []) if (k && !next.has(norm(k))) next.set(norm(k), a);
    }
  }
  byKey = next;
  rev += 1;
  for (const l of listeners) l();
}

/** Publish (or replace) one source's agents. Entries without an id are dropped. */
export function setAgentDirectory(source: string, list: readonly AgentInfo[]): void {
  const clean = list.filter((a) => a && typeof a.id === 'string' && a.id).map((a) => ({ id: a.id, name: a.name || a.id, ...(a.role ? { role: a.role } : {}), avatar: a.avatar ?? null, ...(a.aliases?.length ? { aliases: [...new Set(a.aliases.filter(Boolean))] } : {}) }));
  const before = JSON.stringify(sources.get(source) ?? []);
  if (before === JSON.stringify(clean)) return;
  sources.set(source, clean);
  rebuild();
}

export function clearAgentDirectory(source: string): void {
  if (sources.delete(source)) rebuild();
}

/** An agent by id, full name or alias (a run or build they are on; case-insensitive), else null. */
export function findAgent(idOrName: unknown): AgentInfo | null {
  const k = norm(idOrName);
  return k ? byKey.get(k) ?? null : null;
}

export const agentsRevision = () => rev;
export function subscribeAgents(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const listAgents = (): AgentInfo[] => [...new Map([...byKey.values()].map((a) => [a.id, a])).values()];

/** Up to two initials from a name ("Ping Paulie" → "PP", "crew-live" → "CL"); "?" when empty. */
export function agentInitials(name: unknown): string {
  const ws = String(name ?? '').split(/[\s_-]+/).filter(Boolean);
  return ws.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/** A hue (0–359) from a name, so an unknown agent's initials badge keeps one colour wherever it shows. */
export function agentHue(name: unknown): number {
  let h = 0;
  for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * The agent a free text names: "Agent: Ping Paulie", "Assigned agent: **Earl the Ear**" (build details, briefs), or
 * an id / name / alias on its own or as the first line ("<build id>\n<detail>"). Null when no known agent is named.
 */
export function agentInText(text: unknown): AgentInfo | null {
  const s = String(text ?? '');
  const direct = findAgent(s) ?? findAgent(s.split('\n')[0]);
  if (direct) return direct;
  const re = /(?:assigned\s+)?agent\s*[:=]\s*\**\s*([A-Za-z][\w' -]{1,40}?)\s*\**\s*(?:[.,;(\n]|$)/gi;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const hit = findAgent(m[1]);
    if (hit) return hit;
  }
  return null;
}
