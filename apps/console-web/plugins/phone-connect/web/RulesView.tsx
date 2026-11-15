/**
 * Auto-approval rules for the Monitor watch: list, add, turn on, remove. A rule never covers destructive tools,
 * personOnly actions, recorder_start or vps.run. A rule a command proposed waits here until you turn it on.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Container, Note, TextField } from '@console/axf/react';
import { api, errText, when, type Rule } from './api';

export function RulesPanel() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState('');
  const [what, setWhat] = useState('');
  const [scope, setScope] = useState('any');
  const [expires, setExpires] = useState('');
  const load = useCallback(() => api.call<{ rules: Rule[] }>('rules').then((r) => { setRules(r.rules); setError(''); }, (e) => setError(errText(e))), []);
  useEffect(() => { void load(); }, [load]);
  const run = (fn: () => Promise<unknown>) => fn().then(() => load(), (e) => setError(errText(e)));
  const add = () => run(() => api.post('rules', { what: what.trim(), scope: scope.trim() || 'any', expiresAt: expires ? new Date(expires).toISOString() : '' }).then(() => { setWhat(''); setExpires(''); }));
  return (
    <div className="axp-phone-stack" data-axf-target="phone-connect.rules">
      {error && <Note tone="danger">{error}</Note>}
      <Container title="Rules" icon="check">
        <ul className="axp-phone-list" data-axf-target="phone-connect.rules.list">
          {rules?.length ? rules.map((r) => (
            <li key={r.id} className="axp-phone-item" data-axf-target={`phone-connect.rules.${r.id}`}>
              <div className="axp-phone-stack">
                <span>{r.what} <span className="axp-phone-muted">· {r.scope}</span></span>
                <span className="axp-phone-muted">{r.expiresAt ? `until ${when(r.expiresAt)}` : 'no expiry'} · by {r.createdBy}{r.note ? ` · ${r.note}` : ''}</span>
              </div>
              <div className="axp-phone-row">
                <Chip tone={r.active ? 'success' : 'warning'}>{r.active ? 'On' : r.state === 'proposed' ? 'Proposed' : 'Expired'}</Chip>
                {r.state === 'proposed' && <Button size="sm" icon="check" onClick={() => run(() => api.post(`rules/${r.id}/enable`, { on: true }))} data-axf-target={`phone-connect.rules.${r.id}.enable`}>Turn on</Button>}
                {r.state === 'on' && <Button size="sm" icon="pause" onClick={() => run(() => api.post(`rules/${r.id}/enable`, { on: false }))} data-axf-target={`phone-connect.rules.${r.id}.disable`}>Turn off</Button>}
                <Button size="sm" icon="trash" tone="danger" onClick={() => run(() => api.del(`rules/${r.id}`))} data-axf-target={`phone-connect.rules.${r.id}.remove`}>Remove</Button>
              </div>
            </li>
          )) : <li className="axp-phone-item axp-phone-muted">{rules ? 'No rules: every approval waits for you.' : '…'}</li>}
        </ul>
      </Container>
      <Container title="Add a rule" icon="plus">
        <div className="axp-phone-stack" data-axf-target="phone-connect.rules.add">
          <TextField label="What" value={what} onChange={setWhat} placeholder="build.status or build.*" hint="A tool or a family. Never everything." />
          <TextField label="Scope" value={scope} onChange={setScope} placeholder="any, project:<id>, agent:<id>, build:<id>" />
          <TextField label="Until" type="datetime-local" value={expires} onChange={setExpires} hint="Leave empty for no expiry." />
          <Note>Never covered: destructive tools, personOnly actions, starting the recorder and vps.run.</Note>
          <Button icon="plus" tone="primary" disabled={!what.trim()} onClick={add} data-axf-target="phone-connect.rules.add-button">Add rule</Button>
        </div>
      </Container>
    </div>
  );
}
