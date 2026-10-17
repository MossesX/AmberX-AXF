import { useState } from 'react';
import { Button, Container, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template (web port of {{MODULE_ID}}). */
export interface {{CLASS}}Item { id: string; title: string; done: boolean }

export function {{CLASS}}View() {
  const rt = useRuntime();
  const [opened, setOpened] = useState(0);
  const [items, setItems] = useState<{{CLASS}}Item[]>([]);
  const [draft, setDraft] = useState('');
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{{MODULE_NAME}} · {{TEMPLATE}}</p><h1>{{LABEL}}</h1><p className="fx-muted">{{DESCRIPTION}}</p></div></header>
      <Container title="{{P_ITEM}}s" icon="list">
        <form className="fx-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setItems([...items, { id: Date.now().toString(36), title: draft.trim(), done: false }]); setDraft(''); } }}>
          <input className="fx-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New {{P_ITEM}}" /><Button tone="primary" icon="plus" type="submit">Add</Button>
        </form>
        {items.length === 0 ? <p className="fx-muted">No {{P_ITEM}}s yet.</p> : <ul>{items.map((it) => <li key={it.id}><label><input type="checkbox" checked={it.done} onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} /> {it.title}</label> <button className="fx-iconbtn" onClick={() => setItems(items.filter((x) => x.id !== it.id))}>×</button></li>)}</ul>}
      </Container>
      <Container title="Library" icon="box">
        <p className="fx-muted" style={{ marginTop: 0 }}>Opened {opened} time(s) this session.</p>
        <Button icon="terminal" onClick={() => { setOpened(opened + 1); rt.terminal.log('{{ROUTE}}', 'opened from the library view'); }}>Log to terminal</Button>
      </Container>
    </div>
  );
}

export const library: AxfWebLibrary = {
  id: '{{MODULE_ID}}',
  label: '{{LABEL}}',
  version: '{{VERSION}}',
  template: '{{TEMPLATE}}',
  dependsOn: [],
  register(rt) {
    rt.actions.register('{{ROUTE}}.open', () => rt.navigate('{{ROUTE}}'), { label: 'Open {{LABEL}}' });
  },
  views: { '{{ROUTE}}': { title: '{{LABEL}}', icon: 'box', render: () => <{{CLASS}}View /> } },
};
