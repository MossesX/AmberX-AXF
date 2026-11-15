import { useEffect, useState } from 'react';
import { Button, Checkbox, Chip, IconButton, Note, SelectField, Switch, useRuntime } from '@console/axf/react';
import { pluginApi } from '@console/plugins';
import * as C from '../../../../../framework/core/ui-choices.mjs';
import type { Item } from './review-core.mjs';
import { FOLDER } from './keys';
import { ShotBrowser } from './shots';

/*
 * The Choices tab of a UI Review item (ui-choices@1): every option a build shipped, with its predicted pictures. Brett
 * picks one, or several in priority order where the asset type can hold several views (the first is the default view).
 * Options he doesn't pick stay in the asset library. Also the how-many-options question and its settings.
 */

const api = pluginApi(FOLDER, 'UI Review', { unavailable: 'The UI Review plugin is switched off or its server part is not running.' });
interface Option { id: string; label: string; notes?: string }
export interface ChoiceSet { set: string; assetType: string; owner: string; multi: boolean; options: Option[]; chosen: string[]; decidedAt?: string; decidedBy?: string }
export const choicesOf = (it: Item): ChoiceSet | null => (it.choices && typeof it.choices === 'object' ? (it.choices as ChoiceSet) : null);

export function ChoicesTab({ it, device, onDone }: { it: Item; device: string; onDone: () => Promise<void> }) {
  const rt = useRuntime();
  const c = choicesOf(it)!;
  const [order, setOrder] = useState<string[]>(c.chosen);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOrder(c.chosen), [it.id, c.chosen.join(',')]);
  const flip = (id: string) => setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : c.multi ? [...o, id] : [id]));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ default: string; chosen: string[] }>('choices/choose', { id: it.id, chosen: order });
      rt.toast(r.chosen.length > 1 ? `${r.chosen.length} views will be built, the first is the default` : 'Picked: the build goes on with it', 'success');
      await onDone();
    } catch (e) { rt.toast((e as Error).message, 'danger'); }
    setBusy(false);
  };
  const label = (id: string) => c.options.find((o) => o.id === id)?.label ?? id;
  const changed = order.join(',') !== c.chosen.join(',');
  return (
    <div className="fx-stack axp-ui-review__choices">
      <p className="fx-small fx-muted">
        {c.multi ? `A ${c.assetType} can hold several views: pick one, or several in order. The first is the default.` : `A ${c.assetType} has one view: pick one.`} Options you don't pick stay in the asset library.
      </p>
      <div className="axp-ui-review__options">
        {c.options.map((o) => {
          const shots = C.optionShots(it.shots, o.id) as Item['shots'];
          const onDevice = device ? shots.filter((s) => s.device === device) : shots;
          const rank = order.indexOf(o.id);
          return (
            <section key={o.id} className={`axp-ui-review__option${rank >= 0 ? ' is-sel' : ''}`} aria-label={o.label}>
              <div className="axp-ui-review__row">
                <Checkbox label={<b>{o.label}</b>} checked={rank >= 0} onChange={() => flip(o.id)} />
                {rank >= 0 && c.multi && <Chip tone={rank === 0 ? 'accent' : undefined}>{rank === 0 ? 'Default' : `${rank + 1}`}</Chip>}
              </div>
              {shots.length > 0 && <ShotBrowser shots={onDevice.length ? onDevice : shots} title={o.label} list={false} />}
              {o.notes && <p className="fx-small fx-muted">{o.notes}</p>}
            </section>
          );
        })}
      </div>
      {c.multi && order.length > 1 && (
        <ol className="axp-ui-review__rank" aria-label="Your order">
          {order.map((id, i) => (
            <li key={id} className="fx-row">
              <span className="fx-small">{i + 1}. {label(id)}</span>
              <IconButton icon="chevron-up" label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => setOrder((o) => C.movePick(o, id, -1))} />
              <IconButton icon="chevron-down" label={`Move ${label(id)} down`} disabled={i === order.length - 1} onClick={() => setOrder((o) => C.movePick(o, id, 1))} />
            </li>
          ))}
        </ol>
      )}
      <div className="axp-ui-review__acts">
        <Button size="sm" tone="primary" icon="check" busy={busy} disabled={!order.length || !changed} onClick={() => void save()}>{order.length > 1 ? `Build these ${order.length}` : 'Build this one'}</Button>
        {c.decidedAt && <span className="fx-small fx-muted">Decided: {c.chosen.map(label).join(', ')}</span>}
      </div>
    </div>
  );
}

interface ChoiceSettings { minOptions: number; askOptions: boolean; askTimeoutMin: number }

/** Settings → Plugins → UI Review: how many options a build ships, and whether to ask first (kept on the console server). */
export function ChoicesPanel() {
  const [s, setS] = useState<ChoiceSettings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.call<ChoiceSettings>('choices/settings').then(setS, (e: Error) => setErr(e.message)); }, []);
  const save = (p: Partial<ChoiceSettings>) => api.put<ChoiceSettings>('choices/settings', p).then(setS, (e: Error) => setErr(e.message));
  if (!s) return err ? <Note tone="warning">{err}</Note> : null;
  return (
    <div className="fx-stack">
      <SelectField label="Options every build ships" value={String(s.minOptions)} options={[3, 4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => void save({ minOptions: Number(v) })} hint="Never under 3. Each option is a predicted look and a saved asset." />
      <Switch label="Ask me how many options before a build makes them" checked={s.askOptions} onChange={(v) => void save({ askOptions: v })} />
      {s.askOptions && <SelectField label="Minutes to wait for my answer" value={String(s.askTimeoutMin)} options={[1, 2, 5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => void save({ askTimeoutMin: Number(v) })} hint="No answer by then: the number above." />}
    </div>
  );
}

interface Ask { id: string; build: string; title: string; default: number }
const ASK_MS = 15_000;
export const ASK_DIALOG = 'ui-review.ask-options';

/** Mounted once on the page: a build's how-many-options question pops up here. */
export function AskClient() {
  const rt = useRuntime();
  useEffect(() => {
    const seen = new Set<string>();
    const look = () => api.call<{ asks: Ask[] }>('choices/asks').then((r) => {
      const next = r.asks.find((a) => !seen.has(a.id));
      if (next) { seen.add(next.id); rt.openDialog(ASK_DIALOG, { ask: next }); }
    }, () => undefined);
    void look();
    const t = setInterval(() => void look(), ASK_MS);
    return () => clearInterval(t);
  }, [rt]);
  return null;
}

export function AskDialog({ ask }: { ask: Ask }) {
  const rt = useRuntime();
  const answer = (count: number) => api.post('choices/answer', { id: ask.id, count }).then(() => rt.closeDialog(), (e: Error) => rt.toast(e.message, 'danger'));
  return (
    <div className="fx-stack">
      <p>How many options should <b>{ask.build || ask.title || 'this build'}</b> make? No answer and it makes {ask.default}.</p>
      <div className="axp-ui-review__acts">
        {[3, 4, 5, 6].map((n) => <Button key={n} tone={n === ask.default ? 'primary' : 'neutral'} onClick={() => void answer(n)}>{n}</Button>)}
      </div>
    </div>
  );
}
