/**
 * Agent ID card drawn from an agent-card@1 asset (rules core/engines/agent-card-rules.mjs → cardModel). The active
 * `agent-card` asset is the default design; `design` draws another one (per-agent override, previews, the designer).
 * Colours and sizes come only from the colour, style and scale themes (axf.css .fx-idcard): swap the theme and every
 * card rebrands. The logo is the branding package's mark (slot `banner`), else the app's name.
 */
import { useState, type ReactNode } from 'react';
import { cardModel, type AgentCardData, type CardIdentity, type CardStats } from '../../core/engines/agent-card-rules.mjs';
import { useAxfState, useRuntime } from '../AxfProvider';
import { BrandMark, useBrandPlace } from './Brand';

export interface AgentCardProps {
  identity: CardIdentity;
  stats?: CardStats;
  /** draw this design instead of the active agent-card asset */
  design?: Partial<AgentCardData> | null;
  /** the photo / avatar (fills the photo frame); none = the initials */
  photo?: ReactNode;
  /** a big status badge or anything else the app wants on the face (backstage passes show it large) */
  badge?: ReactNode;
  /** which side to start on; tapping the flip button turns it (only when the design has a back) */
  side?: 'front' | 'back';
  className?: string;
}

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function AgentCard({ identity, stats, design, photo, badge, side = 'front', className = '' }: AgentCardProps) {
  const rt = useRuntime();
  useAxfState();
  const m = cardModel(design ?? rt.assetOrNull('agent-card')?.data, identity, stats);
  const [shown, setShown] = useState<'front' | 'back'>(side);
  const face = shown === 'back' && m.back.length ? 'back' : 'front';
  const lines = face === 'back' ? m.back : m.front;
  const brand = useBrandPlace('banner');
  const logo = m.logo === 'none' ? null : brand?.svg ? <BrandMark slot="banner" height={18} className="fx-idcard__mark" /> : <span className="fx-idcard__appname">{rt.manifest.app.name}</span>;
  const name = lines.find((l) => l.id === 'name');
  return (
    <article
      className={`fx-idcard fx-idcard--${m.design} is-${m.orientation} is-surface-${m.surface} is-accent-${m.accent} is-finish-${m.finish} is-logo-${m.logo} is-photo-${m.photo} is-${face} ${className}`.trim()}
      aria-label={`${identity.name ?? 'Agent'} ID card, ${face}`}
    >
      {m.logo === 'banner' && <header className="fx-idcard__banner">{logo}</header>}
      {m.logo === 'watermark' && <span className="fx-idcard__watermark" aria-hidden="true">{logo}</span>}
      {m.logo === 'corner' && <span className="fx-idcard__corner">{logo}</span>}
      <div className="fx-idcard__body">
        {face === 'front' && m.photo !== 'none' && <div className="fx-idcard__photo">{photo ?? <span className="fx-idcard__initials">{initials(identity.name)}</span>}</div>}
        <div className="fx-idcard__fields">
          {face === 'front' && badge && <div className="fx-idcard__badge">{badge}</div>}
          {name && face === 'front' && <h3 className="fx-idcard__name">{name.value}</h3>}
          <dl className="fx-idcard__list">
            {lines.filter((l) => !(face === 'front' && l.id === 'name')).map((l) => (
              <div key={l.id} className={`fx-idcard__line is-${l.id}`}><dt>{l.label}</dt><dd>{l.value}</dd></div>
            ))}
          </dl>
        </div>
      </div>
      {face === 'front' && m.code.kind === 'barcode' && (
        <svg className="fx-idcard__barcode" viewBox={`0 0 ${m.code.bars.reduce((a, b) => a + b, 0)} 10`} preserveAspectRatio="none" role="img" aria-label={`Code ${m.code.value}`}>
          {m.code.bars.reduce<{ x: number; rects: ReactNode[] }>((acc, w, i) => { if (i % 2 === 0) acc.rects.push(<rect key={i} x={acc.x} y={0} width={w} height={10} />); acc.x += w; return acc; }, { x: 0, rects: [] }).rects}
        </svg>
      )}
      {face === 'front' && m.code.kind === 'qr' && m.code.value && <p className="fx-idcard__page">{m.code.value}</p>}
      {m.back.length > 0 && (
        <button type="button" className="fx-btn fx-btn--sm fx-btn--quiet fx-idcard__flip" onClick={() => setShown(face === 'back' ? 'front' : 'back')} aria-label={face === 'back' ? 'Show the front' : 'Show the back'}>
          {face === 'back' ? 'Front' : 'Back'}
        </button>
      )}
    </article>
  );
}
