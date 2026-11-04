/**
 * AgentAvatar — one agent's face, the same everywhere in an app (builds grids, steps, banners, runs, reviews, chat).
 *
 * Who: `agent` (an id or a name, looked up in the agent directory, core/agent-directory.ts) or `info` given directly.
 * A known agent with a drawn face (agent@1 `avatar`) is drawn from the card rules' avatar model
 * (core/engines/agent-card-rules.mjs); anyone else gets initials on a colour their name picks. Size and shape come from
 * the `agent-avatar` asset (avatar@1: size small / regular / large, shape circle / rounded), colours from the theme
 * (axf.css .fx-agent-avatar): swap either and every avatar follows. The avatar carries the `agent` context target
 * (payload = the agent id), so right-click / long-press gives the agent's menu wherever it shows.
 */
import { createElement, useSyncExternalStore } from 'react';
import { avatarModel } from '../../core/engines/agent-card-rules.mjs';
import { avatarSize } from '../../core/engines/widgets';
import { AGENT_CONTEXT_TARGET, agentHue, agentInText, agentInitials, agentsRevision, findAgent, subscribeAgents, type AgentInfo } from '../../core/agent-directory';
import { useAxfState, useRuntime } from '../AxfProvider';

export const AGENT_AVATAR_ASSET = 'agent-avatar';
/** Token pairs an initials badge may take (the same theme roles the drawn faces use). */
const INITIALS_TONES = ['accent', 'brand-1', 'brand-2', 'brand-3', 'success', 'warning', 'info', 'danger'] as const;

export interface AgentAvatarProps {
  /** an agent id or name (looked up in the agent directory) */
  agent?: string | null;
  /** the agent itself, when the caller already has it */
  info?: AgentInfo | null;
  /** a free text that may name the agent ("Agent: Ping Paulie" in a build's detail): nothing is drawn when it names nobody known */
  inText?: string | null;
  /** override the asset's size (token sizes only) */
  size?: 'small' | 'regular' | 'large';
  /** the name shown beside the face */
  label?: boolean;
  /** no agent context menu (e.g. inside the agent's own menu) */
  noMenu?: boolean;
  className?: string;
}

const PAINT: Record<string, string> = { bg: 'fx-agent-avatar__bg', skin: 'fx-agent-avatar__skin', ink: 'fx-agent-avatar__ink', line: 'fx-agent-avatar__line', 'line-thick': 'fx-agent-avatar__line fx-agent-avatar__thick' };

/** Re-render when the agent directory changes (a roster loads after the first paint). */
export function useAgentDirectory(): number {
  return useSyncExternalStore(subscribeAgents, agentsRevision, agentsRevision);
}

export function AgentAvatar({ agent, info, inText, size, label = false, noMenu = false, className = '' }: AgentAvatarProps) {
  const rt = useRuntime();
  useAxfState();
  useAgentDirectory();
  const a = info ?? findAgent(agent) ?? (inText ? agentInText(inText) : null) ?? null;
  if (!a && inText !== undefined && !agent) return null;
  const name = a?.name || String(agent ?? '') || '?';
  const id = a?.id || String(agent ?? '');
  const data = (rt.registry.get('avatar', AGENT_AVATAR_ASSET) as { data?: { size?: string; shape?: string } } | undefined)?.data ?? {};
  const px = avatarSize(size ?? data.size ?? 'regular');
  const shape = data.shape === 'rounded' ? 'rounded' : 'circle';
  const ctx = noMenu || !id ? {} : { 'data-fx-ctx-target': AGENT_CONTEXT_TARGET, 'data-fx-ctx-payload': id };
  let face;
  if (a?.avatar) {
    const m = avatarModel(a.avatar);
    face = (
      <svg className="fx-agent-avatar__face" width={px} height={px} viewBox={`0 0 ${m.box} ${m.box}`} aria-hidden="true">
        {m.parts.map((p) => createElement(p.tag, { key: p.id, ...p.attrs, className: PAINT[p.paint], style: p.paint === 'hair' || p.paint === 'shirt' ? { fill: `var(${m.tokens[p.paint as 'hair' | 'shirt']})` } : undefined }))}
      </svg>
    );
  } else {
    const tone = INITIALS_TONES[agentHue(name) % INITIALS_TONES.length];
    face = <span className={`fx-agent-avatar__initials is-${tone}`} style={{ width: px, height: px, fontSize: `${Math.max(0.55, px / 34)}em` }} aria-hidden="true">{agentInitials(name)}</span>;
  }
  return (
    <span className={`fx-agent-avatar is-${shape} ${a ? '' : 'is-unknown'} ${className}`.trim()} title={a?.role ? `${name} · ${a.role}` : name} role="img" aria-label={`${name}'s avatar`} {...ctx}>
      {face}
      {label ? <span className="fx-agent-avatar__name">{name}</span> : null}
    </span>
  );
}
