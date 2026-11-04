import { ASSET_TYPES, assetTypeSpecs, attachable } from '../../core';
import { useAxfState, useRuntime } from '../AxfProvider';
import { Icon } from '../components/Icon';

/** Compact hot-swap panel for the layout's inspector region. */
export function Inspector() {
  const rt = useRuntime();
  useAxfState();
  return (
    <div className="fx-inspector">
      <div className="fx-inspector__head">
        <Icon name="layers" size={15} />
        <span>Active assets</span>
        <button type="button" className="fx-iconbtn" title="Randomize all" aria-label="Randomize all assets" onClick={() => rt.dispatch('assets.random')}>
          <Icon name="shuffle" size={14} />
        </button>
        <button type="button" className="fx-iconbtn" title="Close the pane (View → Active assets pane opens it again)" aria-label="Close the Active assets pane" onClick={() => rt.dispatch('inspector:off')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul className="fx-inspector__list">
        {ASSET_TYPES.filter((t) => !attachable(t) && rt.assetOrNull(t)).map((t) => {
          const a = rt.asset(t);
          return (
            <li key={t} className="fx-inspector__row">
              <span className="fx-inspector__type">
                <Icon name={assetTypeSpecs[t].icon} size={13} />
                {assetTypeSpecs[t].label}
              </span>
              <span className="fx-inspector__swap">
                <button type="button" className="fx-iconbtn" aria-label={`Previous ${t}`} onClick={() => rt.swap(t, 'prev')}>
                  <Icon name="chevron-left" size={13} />
                </button>
                <span className="fx-inspector__name" title={a.id}>{a.name}</span>
                <button type="button" className="fx-iconbtn" aria-label={`Next ${t}`} onClick={() => rt.swap(t, 'next')}>
                  <Icon name="chevron-right" size={13} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
