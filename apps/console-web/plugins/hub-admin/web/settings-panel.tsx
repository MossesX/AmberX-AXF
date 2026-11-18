/**
 * Settings → Plugins → Hub: the remembered values the screens keep (grid columns and sort, log filters, grant-pass
 * defaults, how often the hub is read) shown with Reset, next to the generated fields (settings.ts) and the lifecycle
 * panel. The level toolbar is the settings interface's own. Every value here is a registered axf.hub.* key of the route
 * table, so control@1 reads and sets it the same way (settings.set:<key>:<json>).
 */
import { useState } from 'react';
import { Button, Container, TextField, useRuntime } from '@console/axf/react';
import { settingsOf, type HubConsoleTable } from '@console/axf/core/hub-console.mjs';

export function HubRememberedPanel({ table }: { table: HubConsoleTable }) {
  const rt = useRuntime();
  const [tick, setTick] = useState(0);
  const json = settingsOf(table).filter((s) => s.kind === 'json');
  return (
    <Container title="Remembered by the screens" icon="save">
      <div className="fx-stack" data-tick={tick}>
        <p className="fx-muted">What the Hub screens remember between visits. Edit the JSON or reset a value to the route table's default.</p>
        {json.map((s) => <RememberedRow key={s.key} k={s.key} label={s.label} dflt={s.default} onChange={() => setTick((t) => t + 1)} />)}
        <div className="fx-row"><Button size="sm" tone="ghost" icon="refresh" onClick={() => { for (const s of json) rt.settings.set(s.key, s.default as never); setTick((t) => t + 1); rt.toast('Hub screens back to their defaults.', 'info', 'Hub'); }}>Reset every remembered value</Button></div>
      </div>
    </Container>
  );
}

function RememberedRow({ k, label, dflt, onChange }: { k: string; label: string; dflt: unknown; onChange: () => void }) {
  const rt = useRuntime();
  const current = rt.settings.get(k);
  const shown = JSON.stringify(current ?? dflt);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState('');
  const save = () => {
    try { const v = JSON.parse(draft); if (!v || typeof v !== 'object') throw new Error('an object'); rt.settings.set(k, v as never); setError(''); onChange(); rt.toast(`${label} saved.`, 'success', 'Hub'); }
    catch { setError('Not a JSON object.'); }
  };
  return (
    <div className="fx-row fx-row--wrap" data-axf-hub-setting={k}>
      <TextField label={label} value={draft} onChange={setDraft} mono hint={k} error={error || undefined} />
      <Button size="sm" icon="save" disabled={draft === shown} onClick={save}>Save</Button>
      <Button size="sm" tone="ghost" icon="refresh" disabled={JSON.stringify(current ?? dflt) === JSON.stringify(dflt)} onClick={() => { rt.settings.set(k, dflt as never); setDraft(JSON.stringify(dflt)); setError(''); onChange(); }}>Reset</Button>
    </div>
  );
}
