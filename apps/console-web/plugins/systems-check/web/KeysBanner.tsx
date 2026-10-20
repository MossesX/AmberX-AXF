import { useMemo, useState } from 'react';
import { Button, Icon, useRuntime } from '@console/axf/react';
import { FixPanel, StatusDot, guidedOrder, isKeyIssue, issues, loadSystemCheck, useSys } from './SystemCheck';

/*
 * Keys banner: when the console loads and a key or password it needs is missing (or the service refuses it), a banner
 * names them. Tapping it opens the `keys-needed` dialog, which asks for exactly those keys, one form each, and tests
 * each one as it's saved. Values go to the console server only (owner-only file) and never come back to the browser.
 */

export function KeysBanner() {
  const s = useSys();
  const rt = useRuntime();
  const [hidden, setHidden] = useState(false);
  const need = useMemo(() => issues(s.report).filter(isKeyIssue), [s.report]);
  if (hidden || s.unauthorized || need.length === 0) return null;
  const names = need.map((c) => c.title).join(', ');
  return (
    <div className="axp-systems-check-banner is-warn" role="alert">
      <div className="axp-systems-check-banner__row">
        <Icon name="key" />
        <button type="button" className="axp-systems-check-banner__text" onClick={() => rt.openDialog('keys-needed', {})}>
          <span aria-hidden>🔑 </span>{need.length === 1 ? 'A key is needed' : `${need.length} keys are needed`}: {names}
        </button>
        <Button tone="primary" icon="key" onClick={() => rt.openDialog('keys-needed', {})}>Add {need.length === 1 ? 'it' : 'them'}</Button>
        <button type="button" className="fx-iconbtn" aria-label="Hide until the console reloads" title="Hide until the console reloads" onClick={() => setHidden(true)}><Icon name="x" size={16} /></button>
      </div>
    </div>
  );
}

export function KeysDialog() {
  const s = useSys();
  const rt = useRuntime();
  // Remember which keys were missing when the dialog opened, so a fixed one stays on screen showing "saved".
  const [ids] = useState(() => new Set(issues(s.report).filter(isKeyIssue).map((c) => c.id)));
  const list = guidedOrder((s.report?.checks ?? []).filter((c) => ids.has(c.id)));
  const left = list.filter((c) => c.status === 'error' || c.status === 'warn').length;
  if (!s.report) return <p className="fx-muted">Checking what the console needs…</p>;
  return (
    <div className="fx-stack axp-systems-check-keys">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        {left ? `Paste ${left === 1 ? 'this key' : `these ${left} keys`}. Each one is tested as soon as you save it.` : 'All set: every key works.'} Keys stay on the console server and are never shown again.
      </p>
      {list.map((c) => (
        <section key={c.id} className="fx-card axp-systems-check-keys__item">
          <h3 className="axp-systems-check-h" style={{ marginTop: 0 }}><StatusDot s={c.status} /> <span aria-hidden>🔑</span> {c.title}</h3>
          <p className="fx-small" style={{ margin: 0 }}>{c.summary}</p>
          {c.links.length > 0 && <p className="fx-small" style={{ margin: 0 }}>{c.links.map((l, i) => <span key={l.url}>{i ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label} <Icon name="external" size={12} /></a></span>)}</p>}
          <FixPanel c={c} />
        </section>
      ))}
      <div className="fx-row fx-row--wrap">
        <Button icon="refresh" onClick={() => void loadSystemCheck(true)}>Check all again</Button>
        <Button tone={left ? 'ghost' : 'primary'} onClick={() => rt.closeDialog()}>{left ? 'Later' : 'Done'}</Button>
      </div>
    </div>
  );
}
