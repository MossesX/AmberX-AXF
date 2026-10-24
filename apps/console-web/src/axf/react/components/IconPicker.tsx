/**
 * Icon picker: a dialog with two tabs, **Static** (the 50 themeable icons of STATIC_ICONS, with a filter) and **Animated** (the
 * 50 animated icons of core/engines/iconpick.ts). Each animated icon has a **Static** switch that draws it without its
 * animation; the switches are kept in the setting `axf.icons.still`, shared by every picker in the app. The pick is a
 * string (`name`, `name@anim`, `name@anim:still`) that any icon field takes, because Icon reads picks.
 *
 *   <IconPickerField label="Badge icon" value={v} onChange={setV} />   // preview + Choose…, opens the dialog
 *   pickIcon(rt, { value, title, onPick })                              // or open it yourself
 *
 * The dialog (`axf.icon-picker`) is registered by the settings library, so it exists in every app.
 */
import { useMemo, useState } from 'react';
import { useAxfState, useRuntime } from '../AxfProvider';
import type { AxfRuntime } from '../../core/runtime';
import {
  ANIMATED_ICONS, ICON_ANIM_LABEL, STATE_TONES, STATE_TONE_LABEL, STATIC_ICONS, STILL_ICONS_KEY, animatedIconOf, animatedPick, normalizeStateLook,
  parseIconPick, setStill, stillIcons, type StateLook, type StateTone,
} from '../../core/engines/iconpick';
import { Button, Chip, Segmented } from './Controls';
import { SelectField, Switch, TextField } from './Forms';
import { Icon } from './Icon';
import type { DialogMap } from './Overlays';

export const ICON_PICKER_DIALOG = 'axf.icon-picker';

export interface IconPickerProps { value?: string; title?: string; onPick?: (pick: string) => void }

/** Open the icon picker dialog. */
export function pickIcon(rt: AxfRuntime, p: IconPickerProps): void {
  rt.openDialog(ICON_PICKER_DIALOG, p as Record<string, unknown>);
}

function IconPicker({ value = '', onPick, close }: IconPickerProps & { close: () => void }) {
  const rt = useRuntime();
  useAxfState();
  const cur = parseIconPick(value);
  const [tab, setTab] = useState<'static' | 'animated'>(cur.anim ? 'animated' : 'static');
  const [q, setQ] = useState('');
  const still = stillIcons(rt.settings.get(STILL_ICONS_KEY));
  const names = useMemo(() => STATIC_ICONS.filter((n) => !q.trim() || n.includes(q.trim().toLowerCase())), [q]);
  const pick = (v: string) => { onPick?.(v); close(); };
  const curAnim = animatedIconOf(value);
  const toggleStill = (id: string, on: boolean) => {
    rt.settings.set(STILL_ICONS_KEY, setStill(still, id, on));
    // the icon in use follows its switch at once
    if (curAnim?.id === id) onPick?.(animatedPick(curAnim, on));
  };
  return (
    <div className="fx-iconpick">
      <Segmented
        label="Icons"
        value={tab}
        onChange={setTab}
        options={[{ value: 'static', label: `Static (${STATIC_ICONS.length})` }, { value: 'animated', label: `Animated (${ANIMATED_ICONS.length})` }]}
      />
      {tab === 'static' ? (
        <>
          <TextField label="Filter" value={q} onChange={setQ} placeholder="cloud, check, bell…" />
          <div className="fx-iconpick__grid" role="listbox" aria-label="Static icons">
            {names.map((n) => (
              <button key={n} type="button" data-fx-row role="option" aria-selected={!cur.anim && cur.icon === n}
                className={`fx-iconpick__cell${!cur.anim && cur.icon === n ? ' is-on' : ''}`} title={n} onClick={() => pick(n)}>
                <Icon name={n} size={22} /><span>{n}</span>
              </button>
            ))}
            {!names.length && <span className="fx-muted fx-small">No icon matches.</span>}
          </div>
        </>
      ) : (
        <div className="fx-iconpick__grid" role="listbox" aria-label="Animated icons">
          {ANIMATED_ICONS.map((a) => {
            const isStill = still.includes(a.id);
            const on = curAnim?.id === a.id;
            return (
              <div key={a.id} className={`fx-iconpick__cell${on ? ' is-on' : ''}`}>
                <button type="button" data-fx-row role="option" aria-selected={on} className="fx-iconpick__tap" title={`${a.label} · ${ICON_ANIM_LABEL[a.anim]}`} onClick={() => pick(animatedPick(a, isStill))}>
                  <Icon name={animatedPick(a, isStill)} size={22} /><span>{a.label}</span>
                </button>
                <Switch label={`Show ${a.label} static`} hideLabel text="Static" checked={isStill} onChange={(v) => toggleStill(a.id, v)} />
              </div>
            );
          })}
        </div>
      )}
      <div className="fx-row fx-row--wrap">
        <Button size="sm" tone="quiet" onClick={() => pick('')}>No icon</Button>
        <Button size="sm" onClick={close}>Cancel</Button>
      </div>
    </div>
  );
}

export const iconPickerDialog: DialogMap = {
  [ICON_PICKER_DIALOG]: {
    title: 'Choose an icon',
    icon: 'palette',
    searchable: false,
    render: (props, close) => <IconPicker {...(props as IconPickerProps)} close={close} />,
  },
};

/** A settings row: the icon in use (animated as picked) + Choose…, which opens the picker. */
export function IconPickerField({ label, value, onChange, hint }: { label: string; value: string; onChange: (pick: string) => void; hint?: string }) {
  const rt = useRuntime();
  const p = parseIconPick(value);
  const a = animatedIconOf(value);
  const what = !value ? 'No icon' : a ? `${a.label}${p.still ? ' (static)' : ''}` : p.icon;
  return (
    <div className="fx-stack">
      <div className="fx-iconpick__field">
        <span>{label}</span>
        {value ? <Icon name={value} size={20} /> : null}
        <span className="fx-muted fx-small">{what}</span>
        <Button size="sm" icon="palette" onClick={() => pickIcon(rt, { value, title: label, onPick: onChange })}>Choose…</Button>
      </div>
      {hint && <span className="fx-small fx-muted">{hint}</span>}
    </div>
  );
}

/**
 * A two-state badge's look (connected / not): **Two icons** (one per state) or **One icon, two colours**. Every icon
 * slot opens the picker (static, animated, or animated marked static); colours are theme tones.
 *
 *   <StateLookField icon="hub" value={look} onChange={setLook} onLabel="Connected" offLabel="Not connected" />
 */
export function StateLookField({ icon, value, onChange, onLabel = 'Connected', offLabel = 'Not connected' }: {
  icon: string; value: unknown; onChange: (look: StateLook) => void; onLabel?: string; offLabel?: string;
}) {
  const look = normalizeStateLook(value, icon);
  const set = (patch: Partial<StateLook>) => onChange({ ...look, ...patch });
  const tones = STATE_TONES.map((t) => ({ value: t, label: STATE_TONE_LABEL[t] }));
  return (
    <div className="fx-stack">
      <Segmented
        label="States"
        value={look.mode}
        onChange={(m) => set({ mode: m })}
        options={[{ value: 'icons', label: 'Two icons' }, { value: 'colors', label: 'One icon, two colours' }]}
      />
      {look.mode === 'icons' ? (
        <>
          <IconPickerField label={onLabel} value={look.on} onChange={(p) => set({ on: p || icon })} />
          <IconPickerField label={offLabel} value={look.off} onChange={(p) => set({ off: p || icon })} />
        </>
      ) : (
        <>
          <IconPickerField label="Icon" value={look.icon} onChange={(p) => set({ icon: p || icon })} />
          <SelectField label={`${onLabel} colour`} value={look.onTone} options={tones} onChange={(t) => set({ onTone: t as StateTone })} />
          <SelectField label={`${offLabel} colour`} value={look.offTone} options={tones} onChange={(t) => set({ offTone: t as StateTone })} />
        </>
      )}
      <div className="fx-row fx-row--wrap fx-small">
        {([true, false] as const).map((on) => {
          const ic = look.mode === 'icons' ? (on ? look.on : look.off) : look.icon;
          const t = on ? look.onTone : look.offTone;
          return <Chip key={String(on)} tone={t === 'neutral' || t === 'muted' ? undefined : t}><Icon name={ic} size={14} /> {on ? onLabel : offLabel}</Chip>;
        })}
      </div>
    </div>
  );
}
