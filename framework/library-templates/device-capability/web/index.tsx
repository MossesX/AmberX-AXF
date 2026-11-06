import { useState } from 'react';
import { Button, Container, LayoutToolbar, useRuntime, useScreenLayout } from '../../react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template (web port of {{MODULE_ID}}). */
/** Three layouts per screen (screen-layouts@1): rename to what fits this screen; the page branches on `screen.layout`. */
const LAYOUTS = [
  { id: 'compact', label: 'Compact', icon: 'list', description: 'Tight rows, more on one screen.' },
  { id: 'standard', label: 'Standard', icon: 'layout', description: 'The everyday arrangement.' },
  { id: 'spacious', label: 'Spacious', icon: 'grid', description: 'Room around every block, big targets.' },
];

export function {{CLASS}}View() {
  const rt = useRuntime();
  const screen = useScreenLayout('{{ROUTE}}');
  const [opened, setOpened] = useState(0);
  const [state, setState] = useState('unknown');
  return (
    <div className="fx-stack fx-stack--lg" {...screen.rootProps}>
      <header className="fx-pagehead"><div {...screen.headProps}><p className="fx-eyebrow">{{MODULE_NAME}} · {{TEMPLATE}}</p><h1>{{LABEL}}</h1><p className="fx-muted">{{DESCRIPTION}}</p></div></header>
      <LayoutToolbar view="{{ROUTE}}" plugin="{{MODULE_ID}}" />
      <Container title="Permission" icon="shield"><p style={{ marginTop: 0 }}>Browser permission state: {state}</p><Button icon="refresh" onClick={() => { const n = navigator as Navigator & { permissions?: Permissions }; n.permissions?.query({ name: 'camera' as PermissionName }).then((r) => setState(r.state), () => setState('not supported')); }}>Check</Button></Container>
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
  views: { '{{ROUTE}}': { title: '{{LABEL}}', icon: 'box', render: () => <{{CLASS}}View />, layouts: LAYOUTS, defaultLayout: 'standard' } },
};
