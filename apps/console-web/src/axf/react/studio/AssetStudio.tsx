import { useEffect, useState } from 'react';
import { ASSET_TYPES, assetTypeSpecs, type AssetType } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Button, Chip } from '../components/Controls';
import { Icon } from '../components/Icon';
import { AssetPreview } from './AssetPreview';

const GROUPS = [...new Set(ASSET_TYPES.map((t) => assetTypeSpecs[t].group))];

/** The hot-swap studio: every slot, every registered asset, one tap to swap. */
export function AssetStudio() {
  const rt = useRuntime();
  const state = useAxfState();
  const [auto, setAuto] = useState(false);
  const [filter, setFilter] = useState<string>('all');

  // Stress test: keep hot-swapping random slots.
  useEffect(() => {
    if (!auto) return;
    const swappable = ASSET_TYPES.filter((t) => t !== 'uac-policy');
    const id = setInterval(() => {
      const t = swappable[Math.floor(Math.random() * swappable.length)]!;
      if (!rt.swap(t, 'random')) setAuto(false);
    }, 1300);
    return () => clearInterval(id);
  }, [auto, rt]);

  const types = ASSET_TYPES.filter((t) => filter === 'all' || assetTypeSpecs[t].group === filter);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Hot-swap studio</p>
          <h1>Assets</h1>
          <p className="fx-muted">
            {rt.registry.count()} assets across {ASSET_TYPES.length} slots. Tap a card to swap it in live — no reload, no re-render of
            the theme layer. Right-click or long-press a card for more.
          </p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon={auto ? 'pause' : 'play'} tone={auto ? 'primary' : 'neutral'} requires="assets.swap" onClick={() => setAuto((a) => !a)}>
            {auto ? 'Stop cycling' : 'Auto-cycle'}
          </Button>
          <Button icon="shuffle" requires="assets.swap" onClick={() => rt.randomize()}>Randomize</Button>
          <Button icon="refresh" onClick={() => rt.reset()}>Reset</Button>
          <Button icon="upload" tone="primary" requires="assets.import" onClick={() => rt.openDialog('import-asset')}>Import</Button>
        </div>
      </header>

      <div className="fx-tabs" role="tablist">
        {['all', ...GROUPS].map((g) => (
          <button key={g} type="button" role="tab" aria-selected={filter === g} className={`fx-tab ${filter === g ? 'is-active' : ''}`} onClick={() => setFilter(g)}>
            {g === 'all' ? 'All slots' : g}
          </button>
        ))}
      </div>

      {types.map((t) => (
        <Slot key={t} type={t} activeId={state.active[t] ?? ''} />
      ))}
    </div>
  );
}

function Slot({ type, activeId }: { type: AssetType; activeId: string }) {
  const rt = useRuntime();
  const spec = assetTypeSpecs[type];
  const assets = rt.registry.list(type);
  const need = type === 'uac-policy' ? 'uac.manage' : 'assets.swap';
  const locked = !rt.can(need);
  return (
    <section className="fx-slot" aria-labelledby={`slot-${type}`}>
      <div className="fx-slot__head">
        <Icon name={spec.icon} size={16} />
        <h2 id={`slot-${type}`}>{spec.label}</h2>
        <span className="fx-mono fx-muted">{type}</span>
        {locked && (
          <Chip tone="warning">
            <Icon name="lock" size={11} /> needs {need}
          </Chip>
        )}
        <span className="fx-grow" />
        <button type="button" className="fx-iconbtn" aria-label={`Previous ${spec.label}`} onClick={() => rt.swap(type, 'prev')}>
          <Icon name="chevron-left" size={15} />
        </button>
        <button type="button" className="fx-iconbtn" aria-label={`Next ${spec.label}`} onClick={() => rt.swap(type, 'next')}>
          <Icon name="chevron-right" size={15} />
        </button>
      </div>
      <div className="fx-slot__grid">
        {assets.map((a) => {
          const active = a.id === activeId;
          const source = rt.registry.sourceOf(type, a.id);
          return (
            <div
              key={a.id}
              role="button"
              tabIndex={0}
              className={`fx-assetcard ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              data-fx-ctx-target="asset-card"
              data-fx-ctx-payload={`${type}:${a.id}`}
              onClick={() => !active && rt.swap(type, a.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), rt.swap(type, a.id))}
            >
              <AssetPreview asset={a} />
              <div className="fx-assetcard__meta">
                <div className="fx-assetcard__title">
                  <strong>{a.name}</strong>
                  {active && <Icon name="check" size={14} className="fx-assetcard__check" />}
                </div>
                <p>{a.description}</p>
                <div className="fx-row fx-row--tight">
                  <span className="fx-mono fx-muted">{a.id}</span>
                  {source === 'imported' && <Chip tone="accent">imported</Chip>}
                  <span className="fx-grow" />
                  <button
                    type="button"
                    className="fx-iconbtn"
                    aria-label={`View ${a.name} JSON`}
                    onClick={(e) => {
                      e.stopPropagation();
                      rt.openDialog('asset-json', { type, id: a.id });
                    }}
                  >
                    <Icon name="code" size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
