/**
 * Helper badge — on any build or step that a helper session holds (session-link@1, spec/HANDOFF.md § assignments):
 * the agent's avatar + an animated working icon + "Paulie (helper) · step 3/5" while it works, a static
 * "In Paulie's queue (#2)" while it waits, the matching status icon when held / blocked / rejected. The tooltip names
 * the account and session, how long it has had it and the last update. Reads the assignment directory
 * (core/assignments.ts), which the Session sync plugin feeds live; draws nothing when nobody else has the build.
 * Tokens only; the pulse respects prefers-reduced-motion (axf.css .fx-helper-badge).
 */
import { useSyncExternalStore } from 'react';
import { assignmentRev, findAssignment, subscribeAssignments, type AssignmentBadge } from '../../core/assignments';
import { AgentAvatar } from './AgentAvatar';
import { Icon } from './Icon';

const ICONS: Record<string, string> = { working: 'activity', queued: 'clock', held: 'pause', blocked: 'alert-triangle', rejected: 'x-circle', done: 'check', released: 'rotate-ccw', 'taken-back': 'rotate-ccw' };

/** The assignment badge of a build / step, live. */
export function useAssignment(build: string, step = ''): AssignmentBadge | null {
  useSyncExternalStore(subscribeAssignments, assignmentRev, assignmentRev);
  return build ? findAssignment(build, step) : null;
}

const when = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; if (!Number.isFinite(t)) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

export function HelperBadge({ build, step = '', size = 'small', className = '' }: { build: string; step?: string; size?: 'small' | 'regular'; className?: string }) {
  const a = useAssignment(build, step);
  if (!a) return null;
  const title = `${a.text}\n${a.account ? `account ${a.account} · ` : ''}session ${a.session}${a.since ? ` · since ${when(a.since)}` : ''}${a.updatedAt ? ` · updated ${when(a.updatedAt)}` : ''}`;
  return (
    <span className={`fx-helper-badge is-${a.kind} ${a.animated ? 'is-animated' : ''} ${className}`.trim()} title={title} data-fx-ctx-target="axf-build" data-fx-ctx-payload={step ? `${build}.${step}` : build} data-helper-status={a.status} data-helper-session={a.session}>
      <AgentAvatar agent={a.agent} size={size} />
      <Icon name={ICONS[a.kind] ?? 'user'} size={13} className="fx-helper-badge__icon" />
      <span className="fx-helper-badge__text">{a.text}</span>
    </span>
  );
}
