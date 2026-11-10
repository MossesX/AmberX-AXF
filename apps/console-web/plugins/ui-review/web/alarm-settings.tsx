import { useEffect, useState } from 'react';
import { Button, Note, SelectField, Slider, Switch, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import { FOLDER } from './keys';

/*
 * Settings → Plugins → UI Review → Review timeout (ui-review-alarm@1). Kept by the server (alarm-settings.json in the
 * data folder) because the timer runs there: an item unreviewed for the timeout goes ahead with its recommended
 * (first) option, marked "auto-approved after timeout", and the phone is told. Changing the pick later files a
 * follow-up build. MCP / CLI / voice change the same document (PUT alarm/settings, `review.mjs timeout set …`).
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
export interface AlarmSettings { enabled: boolean; timeoutMin: number; notify: boolean; followUp: boolean; openOnNew: boolean; scope: 'all' | 'blocking' }
interface LogLine { at: string; event: string; item?: string; title?: string; label?: string; build?: string }
interface AlarmView { settings: AlarmSettings; log: LogLine[]; items: Record<string, { phase: string; followUp?: string }> }

const hours = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`);

export function AlarmPanel() {
  const rt = useRuntime();
  const [s, setS] = useState<AlarmSettings | null>(null);
  const [v, setV] = useState<AlarmView | null>(null);
  const [error, setError] = useState('');
  const load = () => api.call<AlarmView>('alarm').then((x) => { setV(x); setS(x.settings); }, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const set = async (patch: Partial<AlarmSettings>) => {
    setS((x) => (x ? { ...x, ...patch } : x));
    try { setS(await api.put<AlarmSettings>('alarm/settings', patch)); rt.terminal.log('ui-review', `timeout: ${Object.entries(patch).map(([k, x]) => `${k}=${String(x)}`).join(', ')}`, 'ok'); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  const undo = async (id: string) => {
    try { await api.post('alarm/undo', { id }); rt.toast('Re-opened: it waits for you again', 'success'); void load(); }
    catch (e) { rt.toast((e as Error).message, 'danger'); }
  };
  if (error) return <Note tone="warning">{error}</Note>;
  if (!s) return <Note>Loading the timeout settings…</Note>;
  const went = (v?.log ?? []).filter((l) => l.event === 'go' && l.item).slice(-5).reverse();
  return (
    <div className="fx-stack">
      <Switch label="Go ahead when UI Review waits too long" checked={s.enabled} onChange={(x) => void set({ enabled: x })}
        hint={s.enabled ? `After ${hours(s.timeoutMin)} unanswered, an item goes ahead with the build's recommended option (or is approved), marked "auto-approved after timeout". Builds never sit blocked.` : 'Off: items wait for you, and so do their builds.'} />
      <Slider label="Timeout" value={s.timeoutMin} min={15} max={480} step={15} unit=" min" onChange={(x) => void set({ timeoutMin: x })} />
      <Switch label="Tell my phone when it goes ahead" checked={s.notify} onChange={(x) => void set({ notify: x })}
        hint={'AmberX: "UI Review: <build> waited 1 h, going ahead with <option>". A tap opens the item.'} />
      <Switch label="File a follow-up build when I change it afterwards" checked={s.followUp} onChange={(x) => void set({ followUp: x })}
        hint="Pick another option, Ask changes or Reject on an auto-approved item and a build is filed to match." />
      <SelectField label="Applies to" value={s.scope} onChange={(x) => void set({ scope: x as AlarmSettings['scope'] })}
        options={[{ value: 'all', label: 'Every item' }, { value: 'blocking', label: 'Only items blocking a merge (with a PR or branch)' }]} />
      <Switch label="Open UI Review on each new item" checked={s.openOnNew} onChange={(x) => void set({ openOnNew: x })} hint="Follow Amber opens it on the console." />
      {went.length > 0 && <div className="fx-stack" role="list" aria-label="Recent auto-approvals">
        {went.map((l) => {
          const id = l.item ?? ''; const it = v?.items[id];
          return (
            <div key={`${id}-${l.at}`} role="listitem" className="fx-row">
              <span className="fx-grow">{l.title || id} · went ahead with {l.label || 'it'} · {new Date(l.at).toLocaleString()}{it?.followUp ? ` · follow-up ${it.followUp}` : ''}</span>
              {it?.phase === 'approved' && <Button size="sm" onClick={() => void undo(id)}>Undo</Button>}
            </div>
          );
        })}
      </div>}
    </div>
  );
}
