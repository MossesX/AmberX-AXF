/**
 * The gate screen's shared layout pieces. Display only: they draw what the server answered and hand taps back.
 *   RowList   a short list you tap into: one row per record (title, a line under it, chips, an optional control at the
 *             end); the open row shows its detail under it. console-control@1: the list is `grid:<id>`, a row
 *             `grid:<id>/row:<row id>`. The look follows the plugin's `gate.view` choice (rows.ts).
 *   Fold      a titled, collapsible block (the framework Container).
 *   Stats     a strip of label / value tiles; a tile with `onOpen` is tappable.
 *   Bar       a toolbar row (role="toolbar", aria-label, its settings id).
 */
import type { ReactNode } from 'react';
import { Chip, Container, Icon, Note } from '@console/axf/react';
import { useGateLayout } from './rows';

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;

/** A date and time as the lists show it; '' for none. */
export const when = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export interface RowListProps<R> {
  id: string; label: string; rows: R[];
  rowId: (r: R) => string;
  title: (r: R) => ReactNode;
  sub?: (r: R) => ReactNode;
  chips?: (r: R) => ReactNode;
  /** a control at the end of the row that works without opening it (a Switch, say) */
  end?: (r: R) => ReactNode;
  tone?: (r: R) => string | undefined;
  open: string | null;
  onOpen: (id: string | null) => void;
  detail?: (r: R) => ReactNode;
  empty: ReactNode;
}

export function RowList<R>(p: RowListProps<R>) {
  const { view } = useGateLayout();
  if (!p.rows.length) return <p className="axp-gate__sub">{p.empty}</p>;
  return (
    <ul className="axp-gate__rows" aria-label={p.label} data-view={view} data-axf-scope={`grid:${p.id}`}>
      {p.rows.map((r) => {
        const id = p.rowId(r);
        const isOpen = p.open === id;
        const sub = p.sub?.(r);
        return (
          <li key={id} className="axp-gate__row" data-tone={p.tone?.(r) ?? ''} data-open={isOpen ? 'yes' : 'no'} data-axf-target={`row:${id}`}>
            <div className="axp-gate__row-head">
              <button type="button" data-fx-row className="axp-gate__row-main" aria-expanded={p.detail ? isOpen : undefined} onClick={() => p.onOpen(isOpen ? null : id)}>
                <span className="axp-gate__row-text">
                  <strong>{p.title(r)}</strong>
                  {sub && <span className="axp-gate__sub axp-gate__row-sub">{sub}</span>}
                </span>
                {p.chips && <span className="axp-gate__row-chips">{p.chips(r)}</span>}
                {p.detail && <Icon name="chevron-down" size={14} className={isOpen ? '' : 'fx-rot--90'} />}
              </button>
              {p.end && <span className="axp-gate__row-end">{p.end(r)}</span>}
            </div>
            {isOpen && p.detail && <div className="axp-gate__row-detail">{p.detail(r)}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** A titled block that folds. */
export function Fold({ title, icon, count, open = true, actions, children }: { title: string; icon?: string; count?: number | string; open?: boolean; actions?: ReactNode; children: ReactNode }) {
  return (
    <Container title={count === undefined ? title : `${title} (${count})`} icon={icon} collapsible defaultOpen={open} actions={actions} className="axp-gate__fold">
      {children}
    </Container>
  );
}

export interface StatDef { id: string; label: string; value: ReactNode; sub?: ReactNode; chip?: { text: string; tone?: Tone }; onOpen?: () => void; hint?: string }

/** Label / value tiles. A tile with `onOpen` is one tappable row. */
export function Stats({ items, label }: { items: StatDef[]; label: string }) {
  return (
    <div className="axp-gate__stats" role="group" aria-label={label}>
      {items.map((s) => {
        const body = (
          <>
            <span className="axp-gate__label">{s.label}</span>
            <span className="axp-gate__stat-value">{s.chip ? <Chip tone={s.chip.tone}>{s.chip.text}</Chip> : null}{s.value}</span>
            {s.sub && <span className="axp-gate__sub">{s.sub}</span>}
          </>
        );
        return s.onOpen
          ? <button key={s.id} type="button" data-fx-row className="axp-gate__stat" title={s.hint} data-axf-target={`button:gate-stat-${s.id}`} onClick={s.onOpen}>{body}</button>
          : <div key={s.id} className="axp-gate__stat" title={s.hint}>{body}</div>;
      })}
    </div>
  );
}

/** A toolbar row: fields and buttons side by side, wrapping on a phone. */
export function Bar({ id, label, children, end }: { id: string; label: string; children?: ReactNode; end?: ReactNode }) {
  return (
    <div className="axp-gate__bar" role="toolbar" aria-label={label} data-axf-toolbar={id}>
      {children}
      {end && <span className="axp-gate__bar-end">{end}</span>}
    </div>
  );
}

/** A read that failed. */
export function Err({ text }: { text?: string }) {
  return text ? <Note tone="danger">{text}</Note> : null;
}

/** Label / value pairs for a row's detail. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false);
  if (!shown.length) return null;
  return (
    <dl className="axp-gate__facts">
      {shown.map(([k, v]) => <div key={k} className="axp-gate__fact"><dt className="axp-gate__label">{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
