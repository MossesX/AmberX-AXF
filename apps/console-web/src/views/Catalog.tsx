import { useState } from 'react';
import { Button, Chip, Container, useRuntime } from '../axf/react';
import { useStore } from '../store';
import { statusTone } from '../api';

/** The feature catalog: checking a feature opens the suggestions dialog listing related features to bundle into a library. */
export function Catalog() {
  const rt = useRuntime();
  const s = useStore();
  const [tab, setTab] = useState('kernel');
  const [q, setQ] = useState('');
  const tabs = s.catalog.tabs;
  const cur = tabs.find((t) => t.id === tab) ?? tabs[0];
  const needle = q.trim().toLowerCase();
  const total = tabs.flatMap((t) => t.groups.flatMap((g) => g.items)).length;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">{s.checked.size} checked of {total}</p><h1>Feature catalog</h1><p className="fx-muted">Check a feature to plan it; the dialog suggests related features to build into the same library. Checked + not built = the build plan.</p></div>
        <div className="fx-row fx-row--wrap"><Button tone="primary" icon="copy" onClick={() => rt.dispatch('console.exportPlan')}>Export plan</Button><Button icon="box" onClick={() => rt.navigate('libraries')}>Libraries</Button></div>
      </header>
      <div className="fx-row fx-row--wrap">
        {tabs.map((t) => <button key={t.id} className={`fx-chip ${t.id === tab ? 'is-selected' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
        <span className="fx-grow" /><input className="fx-input" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      {cur?.groups.map((g) => {
        const rows = g.items.filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.id.includes(needle));
        if (!rows.length) return null;
        return (
          <Container key={g.id} title={g.label} icon="layers" actions={<Chip>{rows.filter((i) => s.isChecked(i.id)).length}/{rows.length}</Chip>}>
            <ul className="cx-list">{rows.map((i) => { const st = s.status(i.id); return (
              <li key={i.id} className="cx-item">
                <label className="cx-check"><input type="checkbox" checked={s.isChecked(i.id)} onChange={(e) => { s.setChecked(i.id, e.target.checked); if (e.target.checked && i.suggests.length) rt.openDialog('suggest', { item: i.id }); }} /></label>
                <div className="fx-grow"><div>{i.title} {i.recommended && <span className="fx-badge">recommended</span>}</div><div className="fx-muted fx-small fx-mono">{i.id} · {i.tag}{i.note ? ` · ${i.note}` : ''}</div></div>
                <Chip tone={statusTone(st)}>{st}</Chip>
                {i.suggests.length > 0 && <Button icon="sparkles" onClick={() => rt.openDialog('suggest', { item: i.id })}>{i.suggests.filter((x) => s.isChecked(x.id)).length}/{i.suggests.length}</Button>}
              </li>); })}</ul>
          </Container>
        );
      })}
    </div>
  );
}

/** Dialog `suggest`: related features to bundle into a library with the checked one. */
export function SuggestionsDialog({ itemId, close }: { itemId: string; close: () => void }) {
  const s = useStore();
  const rt = useRuntime();
  const item = s.catalog.tabs.flatMap((t) => t.groups.flatMap((g) => g.items)).find((i) => i.id === itemId);
  if (!item) return <p>Unknown feature {itemId}.</p>;
  return (
    <div className="fx-stack">
      <p style={{ margin: 0 }}><strong>{item.title}</strong><br /><span className="fx-muted fx-small">These features usually ship in the same library. Check the ones to build together.</span></p>
      <ul className="cx-list">{item.suggests.map((x) => <li key={x.id} className="cx-item"><label className="cx-check"><input type="checkbox" checked={s.isChecked(x.id)} onChange={(e) => s.setChecked(x.id, e.target.checked)} /></label><div className="fx-grow">{x.title}<div className="fx-muted fx-small fx-mono">{x.id}</div></div><Chip tone={statusTone(s.status(x.id))}>{s.status(x.id)}</Chip></li>)}</ul>
      <div className="fx-row fx-row--end"><Button onClick={() => { item.suggests.forEach((x) => s.setChecked(x.id, true)); }}>Check all</Button><Button tone="primary" icon="check" onClick={() => { close(); rt.toast(`${item.suggests.filter((x) => s.isChecked(x.id)).length} related features planned.`, 'success'); }}>Done</Button></div>
    </div>
  );
}
