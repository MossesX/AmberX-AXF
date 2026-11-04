import { useState } from 'react';
import { Button, Chip, Container, Icon, IconButton, Section, Switch } from '@console/axf/react';
import { EmptyState } from '@console/emptyState';
import * as P from '../../../../../framework/core/ui-predict.mjs';
import type { MockupBlock, MockupScreen, MockupSpec } from '../../../../../framework/core/ui-predict.mjs';

/*
 * The predicted look of a build (ui-mockup@1, framework/core/ui-predict.mjs): one screen of the spec, drawn with the
 * framework's own controls under the current theme and demo data. framework/cli/ui-predict.mjs opens it in a headless
 * browser (?ui-mockup=<spec>) and the pictures go to UI Review as the "Predicted" after-shots.
 */

const ICONS: Record<string, string> = { settings: 'settings', toolbar: 'menu', chips: 'tag', actions: 'check', list: 'list', card: 'layout', dialog: 'message' };

function Block({ b, demo }: { b: MockupBlock; demo: MockupSpec['demo'] }) {
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries((b.rows ?? []).map((r) => [r.label, !!r.on])));
  switch (b.type) {
    case 'settings':
      return (
        <Section title={b.title || 'Settings'}>
          <div className="fx-stack axp-ui-mock__rows">
            {(b.rows ?? []).map((r) => <Switch key={r.label} label={r.label} hint={r.hint || undefined} checked={!!on[r.label]} onChange={(v) => setOn((o) => ({ ...o, [r.label]: v }))} />)}
          </div>
        </Section>
      );
    case 'toolbar':
      return (
        <div className="axp-ui-mock__toolbar" role="toolbar" aria-label={b.title}>
          {(b.items ?? []).map((x, i) => <Button key={x} size="sm" tone={i === 0 ? 'primary' : 'ghost'}>{x}</Button>)}
          <span className="axp-ui-mock__grow" />
          <IconButton icon="more" label="More" />
        </div>
      );
    case 'chips':
      return <div className="axp-ui-mock__chips"><span className="fx-small fx-muted">{b.title}</span>{(b.items ?? []).map((x, i) => <Chip key={x} tone={i === 0 ? 'accent' : undefined}>{x}</Chip>)}</div>;
    case 'actions':
      return (
        <Container title={b.title} icon={ICONS.actions}>
          <div className="axp-ui-mock__acts">{(b.items ?? []).map((x, i) => <Button key={x} size="sm" tone={i === 0 ? 'primary' : /reject|delete|remove/i.test(x) ? 'danger' : 'neutral'}>{x}</Button>)}</div>
        </Container>
      );
    case 'list':
      return (
        <Container title={b.title} icon={ICONS.list}>
          <table className="axp-ui-mock__table">
            <thead><tr>{(b.columns ?? ['Name', 'Status', 'Updated']).map((c) => <th key={c} className="fx-small fx-muted">{c}</th>)}</tr></thead>
            <tbody>{demo.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td><Chip tone={r.status === 'done' ? 'success' : r.status === 'running' ? 'accent' : undefined}>{r.status}</Chip></td><td className="fx-small fx-muted">{r.updated}</td></tr>)}</tbody>
          </table>
        </Container>
      );
    case 'dialog':
      return (
        <div className="axp-ui-mock__dialog" role="dialog" aria-label={b.title}>
          <header className="axp-ui-mock__dhead"><Icon name="message" size={14} /><b>{b.title}</b><span className="axp-ui-mock__grow" /><IconButton icon="x" label="Close" /></header>
          {b.text && <p className="fx-small">{b.text}</p>}
          <div className="axp-ui-mock__acts">{(b.actions ?? ['OK', 'Cancel']).map((x, i) => <Button key={x} size="sm" tone={i === 0 ? 'primary' : 'ghost'}>{x}</Button>)}</div>
        </div>
      );
    default:
      return (
        <Container title={b.title} icon={ICONS.card}>
          {b.text && <p className="fx-small fx-muted">{b.text}</p>}
          {(b.items ?? []).length > 0 && <div className="axp-ui-mock__chips">{(b.items ?? []).map((x) => <Chip key={x}>{x}</Chip>)}</div>}
        </Container>
      );
  }
}

export function MockupScreenView({ spec, screen }: { spec: MockupSpec; screen: MockupScreen }) {
  return (
    <div className="fx-stack axp-ui-mock" data-axf-mockup={spec.build}>
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow"><Chip tone="warning">Predicted</Chip> {spec.title}</p>
          <h1>{screen.title}</h1>
          <p className="fx-muted">What this build will probably look like. Nothing is built yet.</p>
        </div>
      </header>
      {screen.blocks.map((b, i) => <Block key={`${b.type}-${i}`} b={b} demo={spec.demo} />)}
    </div>
  );
}

/** The ui-mockup view: reads ?ui-mockup=<spec> from the address bar. */
export function MockupPage() {
  const spec = P.decodeScreen(new URLSearchParams(globalThis.location?.search ?? '').get(P.MOCKUP_PARAM)) as MockupSpec | null;
  const screen = spec?.screens[0];
  if (!spec || !screen) return <EmptyState icon="eye">No predicted look to show. UI Review opens this page with a build's mockup.</EmptyState>;
  return <MockupScreenView spec={spec} screen={screen} />;
}
