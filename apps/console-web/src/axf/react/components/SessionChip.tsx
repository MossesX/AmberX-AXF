/**
 * Session chip — sits directly under a model badge wherever a build or step shows its model (Brett, Nov 4 2026): **Main** for
 * the primary session, **Helper 2**, **Helper 3**… for helper sessions, with a stable number per helper. Queued work nobody
 * has taken shows nothing; pass `running` so a running build with no helper reads Main. The tooltip names the crew agent, the
 * account, since when, its models and usage and the helper desk; right-click has Take back through the build's context target.
 * Reads the assignment directory (core/assignments.ts), so every grid flips live. Tokens only.
 */
import { useAssignment } from './HelperBadge';

export function SessionChip({ build, step = '', running = false }: { build: string; step?: string; running?: boolean }) {
  const a = useAssignment(build, step);
  if (!a && !running) return null;
  const chip = a?.chip ?? null;
  const label = chip?.label ?? (a ? 'Helper' : 'Main');
  const kind = chip?.kind ?? (a ? 'helper' : 'main');
  const problem = chip?.problem === true;
  return (
    <span className={`fx-session-chip is-${kind}${problem ? ' is-problem' : ''}`} title={chip?.tooltip ?? 'Main session'} data-fx-ctx-target="axf-build" data-fx-ctx-payload={step ? `${build}.${step}` : build} data-session-chip={kind}>
      {label}
    </span>
  );
}
