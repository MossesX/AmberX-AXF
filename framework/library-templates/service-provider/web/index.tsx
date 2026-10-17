import { useState } from 'react';
import { Button, Container, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template (web port of {{MODULE_ID}}). */
export interface {{CLASS}}Provider { name: string; status(): Promise<string> }
export const mock{{CLASS}}Provider: {{CLASS}}Provider = { name: 'mock', status: async () => 'Mock {{LABEL}} provider ready' };
export const {{CLASS_LOWER}}Service = { provider: mock{{CLASS}}Provider as {{CLASS}}Provider };

export function {{CLASS}}View() {
  const rt = useRuntime();
  const [opened, setOpened] = useState(0);
  const [status, setStatus] = useState('not checked');
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{{MODULE_NAME}} · {{TEMPLATE}}</p><h1>{{LABEL}}</h1><p className="fx-muted">{{DESCRIPTION}}</p></div></header>
      <Container title="Provider" icon="package"><p style={{ marginTop: 0 }}>Active provider: {{{CLASS_LOWER}}Service.provider.name} — {status}</p><Button icon="refresh" onClick={() => {{CLASS_LOWER}}Service.provider.status().then(setStatus)}>Check status</Button></Container>
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
