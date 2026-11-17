/**
 * The Look section of a tab group's / grid's settings dialog (instance-look@1, build own-look-per-grid-and-tab-group).
 *
 * One picker per look key (rowBg … selectedFg, INSTANCE_LOOK_KEYS order). A picker only offers what the rules accept:
 * the colour-theme token names (plus `transparent` on backgrounds) or the key's scaled steps; "Skin" drops the key so it
 * follows the skin again. Each row says where its value comes from (skin / every <kind> in this app / this one). A live
 * preview in the dialog draws a sample with the resolved look, and the instance on screen restyles as you pick (the
 * component re-resolves on the setting); Show it scrolls to it and flashes it. Reset to skin asks first, drops the
 * record, and offers one Undo. Every picker has a level (settings-ui@1 `levelOf`: `look.<key>`; the section is
 * `instanceLook`), so the level toolbar decides what shows.
 *
 * The same moves without the UI: runtime.setInstanceLook / resetInstanceLook / undoInstanceLookReset, which the
 * chrome.look* actions, control@1 and the theme-manager routes call.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { BORDER_STEPS, INSTANCE_LOOK_KEYS, INSTANCE_LOOK_KIND_LABELS, RADIUS_STEPS, SPACE_STEPS, TEXT_STEPS, instanceLookSettingsKey, kindLookSettingsKey, type InstanceLookKeySpec, type InstanceLookKind } from '../../core/engines/instance-look';
import { useAxfState, useRuntime } from '../AxfProvider';
import { controlRegistry } from '../controlTargets';
import { instanceLookProps } from '../instanceLook';
import { Button } from './Controls';
import { Note, Section, SelectField } from './Forms';

/** The level each look key shows from when the settings asset's levelOf says nothing (`look.<key>`). */
export const INSTANCE_LOOK_LEVELS: Record<string, 'simple' | 'basic' | 'developer'> = {
  rowBg: 'simple', selectedBg: 'simple', textSize: 'simple', spacing: 'simple',
  rowAltBg: 'basic', hoverBg: 'basic', selectedFg: 'basic', borderColor: 'basic', borderW: 'basic', radius: 'basic',
};
/** The level of the whole section (settings-ui@1 levelOf id). */
export const INSTANCE_LOOK_SECTION = 'instanceLook';

const SOURCE_LABEL = { skin: 'from the skin', app: 'every one in this app', instance: 'this one' } as const;

/** What a key's picker offers (the rules' grammar, nothing else). */
export function instanceLookOptions(spec: InstanceLookKeySpec, colourTokens: readonly string[]): string[] {
  switch (spec.kind) {
    case 'colour': return [...(spec.transparent ? ['transparent'] : []), ...colourTokens];
    case 'text': return [...TEXT_STEPS];
    case 'space': return [...SPACE_STEPS];
    case 'border': return [...BORDER_STEPS];
    case 'radius': return [...RADIUS_STEPS];
    default: return [];
  }
}

/** The element of an instance on screen (the tab row / the grid root), or null. */
export function instanceLookElement(kind: InstanceLookKind, id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const attr = kind === 'grid' ? 'data-axf-grid' : 'data-axf-tab-group';
  return Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find((el) => el.getAttribute(attr) === id) ?? null;
}

export function InstanceLookPanel({ kind, instance, levelOk, descriptions = true }: { kind: InstanceLookKind; instance: string; levelOk: (id: string, own: string) => boolean; descriptions?: boolean }) {
  const rt = useRuntime();
  useAxfState();
  const [, setTick] = useState(0);
  useEffect(() => {
    const offs = [instanceLookSettingsKey(kind, instance), kindLookSettingsKey(kind)].map((k) => rt.settings.onChange(k, () => setTick((n) => n + 1)));
    return () => offs.forEach((f) => f());
  }, [rt, kind, instance]);
  const [error, setError] = useState<string | undefined>(undefined);
  const colours = rt.instanceLookColourTokens();
  const resolved = rt.instanceLook(kind, instance);
  const own = rt.instanceLookRecord(kind, instance);
  const nOwn = Object.keys(own).length;
  const canUndo = rt.canUndoInstanceLook(kind, instance);
  const onScreen = instanceLookElement(kind, instance);
  const preview = instanceLookProps(resolved);
  const label = INSTANCE_LOOK_KIND_LABELS[kind] ?? kind;
  const set = (key: string, value: string) => {
    try { rt.setInstanceLook(kind, instance, key, value || null); setError(undefined); }
    catch (e) { setError((e as Error).message); }
  };
  const keys = INSTANCE_LOOK_KEYS.filter((k) => levelOk(`look.${k.key}`, INSTANCE_LOOK_LEVELS[k.key] ?? 'basic'));
  return (
    <Section title={`This ${label.toLowerCase()}'s look`} aside={<span className="fx-small fx-muted">{nOwn ? `${nOwn} of ${INSTANCE_LOOK_KEYS.length} set for this one` : 'Follows the skin'}</span>}>
      <div className="fx-stack fx-stack--xs" data-axf-instance-look={`${kind}:${instance}`}>
        <div className="axf-look-preview" aria-hidden="true">
          {kind === 'grid' ? (
            <div className="axf-grid" style={{ ...preview.style, '--axf-grid-cols': 'repeat(3, minmax(0, 1fr))' } as CSSProperties} {...preview.attrs}>
              <div className="axf-grid-row"><span className="axf-grid-cell">Row</span><span className="axf-grid-cell">One</span><span className="axf-grid-cell">12</span></div>
              <div className="axf-grid-row"><span className="axf-grid-cell">Row</span><span className="axf-grid-cell">Two</span><span className="axf-grid-cell">7</span></div>
              <div className="axf-grid-row is-active"><span className="axf-grid-cell">Row</span><span className="axf-grid-cell">Selected</span><span className="axf-grid-cell">3</span></div>
            </div>
          ) : (
            // a drawn sample, not a working row: it carries the hand-drawn strip marks (check-chrome-assets) and does nothing on press
            <div className="fx-tabs fx-tabs--group" data-fx-tabs="underline" data-axf-tab-group="chrome.look-preview" data-fx-ctx-target="tab-group" style={preview.style} {...preview.attrs}>{['Active', 'Idle', 'Another'].map((t, i) => <span key={t} className={i ? 'fx-tab' : 'fx-tab is-active'} data-axf-tab-group="chrome.look-preview" data-fx-ctx-target="tab-group">{t}</span>)}</div>
          )}
        </div>
        {keys.map((k) => {
          const from = resolved.source[k.key];
          const mine = k.key in own;
          const skinValue = from === 'skin' || from === 'app' ? resolved.look[k.key] : undefined;
          const options = [
            { value: '', label: skinValue ? `Skin (${skinValue}${from === 'app' ? ', app-wide' : ''})` : 'Skin' },
            ...instanceLookOptions(k, colours).map((v) => ({ value: v, label: v })),
          ];
          return (
            <SelectField key={k.key} label={k.label} value={mine ? own[k.key]! : ''} options={options} onChange={(v) => set(k.key, v)}
              hint={descriptions ? `${k.description}${from ? ` Now ${SOURCE_LABEL[from]}.` : ''}` : undefined} />
          );
        })}
        {!keys.length && <p className="fx-muted">Nothing at this level.</p>}
        {error && <Note tone="warning">{error}</Note>}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone="neutral" icon="eye" disabled={!onScreen} onClick={() => { const el = instanceLookElement(kind, instance); if (el) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); controlRegistry(rt).highlight(el, 1600); } }}>Show it</Button>
          <Button size="sm" tone="danger" icon="refresh" disabled={!nOwn} confirm={`Reset this ${label.toLowerCase()}'s look to the skin? Its ${nOwn} own value(s) are dropped (one Undo).`} onClick={() => rt.resetInstanceLook(kind, instance)}>Reset to skin</Button>
          {canUndo && <Button size="sm" tone="neutral" icon="undo" onClick={() => rt.undoInstanceLookReset(kind, instance)}>Undo reset</Button>}
        </div>
      </div>
    </Section>
  );
}
