import { useState } from 'react';
import { Container } from '../axf/react';
import { CATEGORIES, ELEMENTS, ElementPreview } from './Explorer';

/** Component gallery: every element kind rendered with the active assets (hot-swap any slot and watch). */
export function Components() {
  const [cat, setCat] = useState(CATEGORIES[0]!);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{ELEMENTS.length} element kinds</p><h1>Components</h1><p className="fx-muted">The abstract component vocabulary every kit implements, rendered with the web kit and the active assets.</p></div></header>
      <div className="fx-row fx-row--wrap">{CATEGORIES.map((c) => <button key={c} className={`fx-chip ${cat === c ? 'is-selected' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
      <div className="fx-grid">{ELEMENTS.filter((e) => e.category === cat).map((e) => <Container key={e.kind} title={e.label} icon="box"><p className="fx-muted fx-small" style={{ marginTop: 0 }}>{e.tooltip}</p><ElementPreview kind={e.kind} /></Container>)}</div>
    </div>
  );
}
