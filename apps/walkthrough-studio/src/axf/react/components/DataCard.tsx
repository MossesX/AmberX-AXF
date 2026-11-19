/**
 * DataCard: draws one card@1 view model (core/engines/card-rules.mjs `cardModel`) inside the framework Container.
 * Pure presentation: the host reads the data (a plugin read through control@1, or its own read) and hands the result
 * in; the engine picks out the value and the view. Every colour and size comes from theme tokens (`.fx-dcard*` in
 * ui/axf.css); tones map to the theme's success / warning / danger / accent colours. A host view (the open view
 * registry) or the `panel` view is drawn by `renderView`.
 */
import type { ReactNode } from 'react';
import type { CardModel } from '../../core/engines/card-rules.mjs';
import { Chip, Container } from './Controls';
import { Meter } from './Meters';

export interface DataCardProps {
  title: ReactNode;
  icon?: string;
  model: CardModel | null;
  /** still loading the first result */
  loading?: boolean;
  /** the read failed (shown in place of the view) */
  error?: string;
  /** drawn for views the framework doesn't draw itself (`panel`, host-registered views) */
  renderView?: (model: CardModel) => ReactNode;
  actions?: ReactNode;
  size?: 's' | 'm' | 'l' | 'wide';
  /** context-menu target (Edit card, Change view, Size, Open plugin, Remove) */
  ctx?: string;
  ctxPayload?: string;
  className?: string;
}

type Tone = 'accent' | 'success' | 'warning' | 'danger' | undefined;
const tone = (t?: string): Tone => (t === 'success' || t === 'warning' || t === 'danger' || t === 'accent' ? t : undefined);

export function DataCard({ title, icon, model, loading, error, renderView, actions, size = 'm', ctx, ctxPayload, className }: DataCardProps) {
  return (
    <Container title={title} icon={icon} actions={actions} ctx={ctx} ctxPayload={ctxPayload} className={`fx-dcard fx-dcard--${size} ${className ?? ''}`.trim()}>
      <CardBody model={model} loading={loading} error={error} renderView={renderView} />
    </Container>
  );
}

export function CardBody({ model, loading, error, renderView }: Pick<DataCardProps, 'model' | 'loading' | 'error' | 'renderView'>) {
  if (error) return <p className="fx-dcard__note is-error">{error}</p>;
  if (!model) return <p className="fx-dcard__note">{loading ? 'Loading…' : 'No data yet.'}</p>;
  if (!model.ok) return <p className="fx-dcard__note is-error">{model.message}</p>;
  if (model.empty && model.view !== 'panel') return <p className="fx-dcard__note">Nothing right now.</p>;
  switch (model.view) {
    case 'number':
      return (
        <div className="fx-dcard__number">
          <span className="fx-dcard__big">{String(model.value ?? '')}</span>
          {model.unit && <span className="fx-dcard__unit">{model.unit}</span>}
          {model.label && <span className="fx-dcard__sub">{model.label}</span>}
        </div>
      );
    case 'status':
      return (
        <div className="fx-dcard__status">
          <span className={`fx-dcard__dot${model.tone ? ` is-${model.tone}` : ''}`} aria-hidden="true" />
          <span className="fx-dcard__state">{model.state || '—'}</span>
          {model.label && <span className="fx-dcard__sub">{model.label}</span>}
        </div>
      );
    case 'list':
    case 'feed':
      return (
        <>
          <ul className={`fx-dcard__list${model.view === 'feed' ? ' is-feed' : ''}`}>
            {(model.items ?? []).map((it, i) => (
              <li key={`${it.title}-${i}`} className="fx-dcard__item">
                <span className="fx-dcard__title">{it.title || '—'}</span>
                {it.badge && <Chip tone={tone(it.tone)}>{it.badge}</Chip>}
                {(it.subtitle || it.at) && <span className="fx-dcard__sub">{[it.subtitle, it.at ? when(it.at) : ''].filter(Boolean).join(' · ')}</span>}
              </li>
            ))}
          </ul>
          {!!model.more && <p className="fx-dcard__note">+{model.more} more</p>}
        </>
      );
    case 'meter':
      return (
        <ul className="fx-dcard__meters">
          {((model.rows ?? []) as Array<{ label: string; pct: number; text: string }>).map((r, i) => (
            <li key={`${r.label}-${i}`} className="fx-dcard__meter">
              {r.label && <span className="fx-dcard__label">{r.label}</span>}
              <Meter value={r.pct} done={r.pct >= 100} label={r.label || 'Value'} small />
              <span className="fx-dcard__num">{r.text}</span>
            </li>
          ))}
        </ul>
      );
    case 'chart':
      return <Chart model={model} />;
    case 'table':
      return (
        <>
          <table className="fx-table fx-dcard__table">
            {model.columns && model.columns.join() !== 'key,value' && <thead><tr>{model.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>}
            <tbody>
              {((model.rows ?? []) as string[][]).map((r, i) => (
                <tr key={i}>{r.map((x, j) => (j === 0 && model.columns?.join() === 'key,value' ? <th key={j}>{x}</th> : <td key={j}>{x}</td>))}</tr>
              ))}
            </tbody>
          </table>
          {!!model.more && <p className="fx-dcard__note">+{model.more} more</p>}
        </>
      );
    default:
      return <>{renderView ? renderView(model) : <p className="fx-dcard__note">No renderer for the {model.view} view here.</p>}</>;
  }
}

function Chart({ model }: { model: CardModel }) {
  const pts = model.points ?? [];
  if (!pts.length) return <p className="fx-dcard__note">Nothing right now.</p>;
  if (model.kind === 'bar') {
    return (
      <div className="fx-dcard__chart">
        <div className="fx-dcard__bars" role="img" aria-label={`Bar chart, last ${model.last}`}>
          {pts.map((p, i) => <span key={i} className="fx-dcard__bar" style={{ height: `${Math.max(1, p.h)}%` }} title={`${p.x}: ${p.y}`} />)}
        </div>
        <span className="fx-dcard__num">{model.last}</span>
      </div>
    );
  }
  const step = pts.length > 1 ? 100 / (pts.length - 1) : 100;
  const line = pts.map((p, i) => `${(i * step).toFixed(2)},${(100 - p.h).toFixed(2)}`).join(' ');
  return (
    <div className={`fx-dcard__chart${model.kind === 'spark' ? ' is-spark' : ''}`}>
      <svg className="fx-dcard__svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`Line chart, last ${model.last}`}>
        {model.kind !== 'spark' && <polygon className="fx-dcard__area" points={`0,100 ${line} 100,100`} />}
        <polyline className="fx-dcard__line" points={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="fx-dcard__num">{model.last}</span>
    </div>
  );
}

/** A short "how long ago" for ISO times; anything else is shown as it is. */
function when(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
