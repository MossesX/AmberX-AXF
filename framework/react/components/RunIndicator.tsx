/**
 * <RunIndicator> (run-indicator@1 + build-live@1): the animated icon a running job shows in any grid, the still warning
 * icon of a stale one, the red "Broke" of a broke one. It draws only from the --fx-run-* tokens and the root's
 * data-fx-run-* attributes (axf.css "run indicator"); the icon is the run-indicator asset's `icon`.
 *
 *   <RunIndicator build="skins" />                 reads the live builds store (react/liveBuilds.ts)
 *   <RunIndicator state="running" label />         a fixed state (previews, the settings tab)
 *
 * The element carries data-fx-run-state (the stylesheet's key) and data-axf-run (the selector tests and console-control
 * read); nothing is drawn for idle builds unless `always` is set.
 */
import { useOptionalRuntime } from '../AxfProvider';
import { useRowRunState, type RowRunState } from '../liveBuilds';
import { Icon } from './Icon';

const ICON_FOR: Record<Exclude<RowRunState, ''>, string | null> = { running: null, stale: 'clock', broke: 'alert', done: 'check' };
const LABEL: Record<Exclude<RowRunState, ''>, string> = { running: 'Running', stale: 'Stale', broke: 'Broke', done: 'Done' };

export interface RunIndicatorProps {
  /** build id: the state comes from the live builds store */
  build?: string | null;
  /** a fixed state instead of the store's */
  state?: RowRunState;
  /** show the short state word next to the icon (`true`) or a custom one */
  label?: boolean | string;
  size?: number;
  /** draw the idle state as an empty slot of the same width (keeps grid columns steady) */
  always?: boolean;
  className?: string;
}

/** The run-indicator asset's icon (the root compile also sets data-fx-run-icon). */
function useRunIcon(): string {
  const rt = useOptionalRuntime();
  const data = (rt?.assetOrNull?.('run-indicator' as never) as { data?: { icon?: string } } | null)?.data;
  return data?.icon || 'refresh';
}

export function RunIndicator({ build, state, label, size = 14, always, className }: RunIndicatorProps) {
  const fromStore = useRowRunState(state === undefined ? build : null);
  const s: RowRunState = state ?? fromStore.state;
  const runIcon = useRunIcon();
  if (!s) return always ? <span className={`fx-run-indicator ${className ?? ''}`} aria-hidden="true" /> : null;
  const text = typeof label === 'string' ? label : LABEL[s];
  const title = fromStore.live?.line || text;
  return (
    <span className={`fx-run-indicator ${className ?? ''}`} data-fx-run-state={s} data-axf-run={s} role="status" aria-label={title} title={title}>
      <span className="fx-run-icon"><Icon name={ICON_FOR[s] ?? runIcon} size={size} /></span>
      {label ? <span className="fx-run-indicator__label">{text}</span> : null}
    </span>
  );
}

/** Attributes a row element spreads to draw its live state (DataGrid does this through its `rowState` prop). */
export const runRowAttrs = (s: RowRunState | null | undefined): Record<string, string> => (s ? { 'data-fx-run-state': s, 'data-axf-run': s } : {});
