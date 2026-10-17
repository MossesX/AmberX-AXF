import { useState } from 'react';
import { Button, Container, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template (web port of {{MODULE_ID}}). */

export function {{CLASS}}View() {
  const rt = useRuntime();
  const [opened, setOpened] = useState(0);
  const [result, setResult] = useState('not checked');
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{{MODULE_NAME}} · {{TEMPLATE}}</p><h1>{{LABEL}}</h1><p className="fx-muted">{{DESCRIPTION}}</p></div></header>
      <Container title="Connection" icon="cloud"><p className="fx-mono" style={{ marginTop: 0 }}>{{P_BASE_URL}}</p><p>{result}</p><Button tone="primary" icon="refresh" onClick={() => fetch('{{P_BASE_URL}}').then((r) => setResult(`HTTP ${r.status}`), () => setResult('unreachable'))}>Check connection</Button></Container>
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
    rt.actions.register('{{ROUTE}}.sync', () => rt.toast('Sync for {{LABEL}} is not implemented yet.'), { label: 'Sync {{LABEL}}' });
  },
  views: { '{{ROUTE}}': { title: '{{LABEL}}', icon: 'box', render: () => <{{CLASS}}View /> } },
};
