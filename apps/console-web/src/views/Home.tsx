import { FRAMEWORK_VERSION } from '../axf/core';
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, IconButton, useAxfState, useRuntime } from '../axf/react';
import { useStore } from '../store';
import { EmptyState } from '../emptyState';
import { HomeCardView, SuggestedCards, dropOnHome, homeLayout, startersOf, useHomeCardMenu, useHomeLayout } from './HomeCards';

/** Home's ⋯ menu (context-menu target): the less-used page actions. */
const HOME_MORE = 'cx-home.more';

export function Home() {
  const rt = useRuntime();
  useEffect(() => {
    rt.contextExtras.set(HOME_MORE, () => ([
      { id: 'home-terminal', label: 'Output terminal', icon: 'terminal', action: 'terminal.open' },
      { id: 'home-export', label: 'Export plan', icon: 'copy', action: 'console.exportPlan' },
      { id: 'home-token', label: 'Console token', icon: 'lock', action: 'dialog:token' },
    ]));
    return () => { rt.contextExtras.delete(HOME_MORE); };
  }, [rt]);
  const s = useStore();
  useAxfState();
  useHomeCardMenu(rt);
  useMemo(() => homeLayout.setStarters(startersOf(rt)), [rt]);
  useEffect(() => { void homeLayout.load(); }, []);
  const { where, loaded } = useHomeLayout();
  const cards = homeLayout.cards();
  const shown = cards.filter((c) => !c.hidden);
  const hidden = cards.filter((c) => c.hidden);
  const [suggest, setSuggest] = useState(false);
  // the app's own name (GizmoX AI Studio): the branding package is shared by every app through the axHub look
  const brand = rt.manifest.app.name || rt.branding()?.name;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Development console · AmberX AXF {FRAMEWORK_VERSION} · tracker {s.tracker.generatedAt.slice(0, 10) || '—'}</p>
          <h1>{brand}</h1>
          <p className="fx-muted">What the framework has, its libraries, UI kits and boilerplates, on every port.</p>
        </div>
        <div className="fx-row fx-row--wrap cx-home__actions">
          <Chip tone={s.backend ? 'success' : 'warning'}>{s.backend ? 'Engine online' : 'Engine offline'}</Chip>
          <Button icon="folder" onClick={() => rt.openDialog('project')}>{s.project || 'Open project'}</Button>
          <Button tone="primary" icon="layers" onClick={() => rt.navigate('tracker')}>Tracker</Button>
          <IconButton icon="more" label="More: terminal, export plan, token" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); rt.openContext(r.left, r.bottom, HOME_MORE); }} />
        </div>
      </header>

      <div className="fx-row fx-row--wrap cx-home__cardbar" role="toolbar" aria-label="Home cards">
        <Button icon="plus" tone="primary" onClick={() => rt.openDialog('home-card')}>Add card</Button>
        <Button icon="sparkles" onClick={() => setSuggest(!suggest)}>Suggested cards</Button>
        <Button icon="eye" onClick={() => homeLayout.apply({ op: 'showAll' })} disabled={!hidden.length}>Show all{hidden.length ? ` (${hidden.length} hidden)` : ''}</Button>
        <Button icon="minus" onClick={() => homeLayout.apply({ op: 'hideAll' })} disabled={!shown.length}>Hide all</Button>
        <span className="fx-muted fx-small cx-home__where">{where === 'hub' ? 'Layout saved on axHub' : where === 'local' ? 'Layout saved on this console' : loaded ? 'Layout kept in this browser (server away)' : ''}</span>
      </div>
      {suggest && <SuggestedCards onDone={() => setSuggest(false)} />}

      <div className="fx-grid cx-home__cards" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.target === e.currentTarget) dropOnHome(rt, e, homeLayout.get().layout.order.length); }}>
        {shown.map((c, i) => <HomeCardView key={c.id} entry={c} index={i} onDropAt={(e, at) => dropOnHome(rt, e, homeLayout.get().layout.order.indexOf(shown[at]?.id ?? ''))} />)}
        {!shown.length && <EmptyState icon="grid" action={{ label: 'Show all', icon: 'eye', onClick: () => homeLayout.apply({ op: 'showAll' }) }}>Every card is hidden. Add a card, or drop a plugin read here.</EmptyState>}
      </div>
    </div>
  );
}
