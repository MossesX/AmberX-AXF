/*
 * Look editor (look@1, core/engines/looktokens.ts): the controls for a set of look tokens, in collapsible categories.
 * Every control shows the theme's value until someone changes it; a changed one gets a "changed" chip and its own
 * reset, and only changed tokens are stored (they override the inherited theme). Used by Banner settings → Apply to
 * all and by Settings → Appearance → Sliders. Framework controls only, theme tokens only.
 */
import type { ReactNode } from 'react';
import {
  LOOK_CATEGORIES, LOOK_LEVEL_HINT, LOOK_LEVEL_LABEL, LOOK_LEVELS, lookCategory, lookChanged, lookTokensAt, lookValue, setLookValue,
  type LookLevel, type LookScope, type LookToken, type LookValue, type LookValues,
} from '../../core/engines/looktokens';
import { Chip, Container, IconButton, Segmented, Slider } from './Controls';
import { SelectField, Switch } from './Forms';

/** One token's control. */
export function LookTokenRow({ token, values, onSet }: { token: LookToken; values: LookValues; onSet: (v: LookValue | null) => void }) {
  const changed = token.id in values;
  const v = lookValue(values, token.id);
  let control: ReactNode;
  if (token.kind === 'slider') control = <Slider label={token.label} value={Number(v)} min={token.min} max={token.max} step={token.step} unit={token.unit} onChange={(x) => onSet(x)} />;
  else if (token.kind === 'switch') control = <Switch label={token.label} checked={v === true} onChange={(x) => onSet(x)} />;
  else control = <SelectField label={token.label} value={String(v)} options={token.options ?? []} onChange={(x) => onSet(x)} />;
  return (
    <div className="fx-look__row" data-fx-look-changed={changed ? '' : undefined}>
      <div className="fx-look__control">{control}</div>
      <div className="fx-look__state">
        {changed ? <><Chip tone="accent">changed</Chip><IconButton icon="x" label={`${token.label}: back to the theme`} onClick={() => onSet(null)} /></> : <span className="fx-muted fx-look__inherit">theme</span>}
      </div>
      {token.hint && <p className="fx-muted fx-look__hint">{token.hint}</p>}
    </div>
  );
}

/** A level switch: Simple / Basic / Pro / Advanced. */
export function LookLevelSwitch({ value, onChange, label = 'Detail' }: { value: LookLevel; onChange: (l: LookLevel) => void; label?: string }) {
  return (
    <div className="fx-look__levels">
      <Segmented label={label} value={value} onChange={onChange} options={LOOK_LEVELS.map((l) => ({ value: l, label: LOOK_LEVEL_LABEL[l], title: LOOK_LEVEL_HINT[l] }))} />
      <span className="fx-muted fx-look__levelhint">{LOOK_LEVEL_HINT[value]}</span>
    </div>
  );
}

/**
 * Every token for a scope at a level, one collapsible card per category (open when something in it is changed, or
 * when `open`). `only` narrows to one kind (the Sliders section passes 'slider').
 */
export function LookEditor({ values, onChange, scope, level, only, open = false }: {
  values: LookValues; onChange: (next: LookValues) => void; scope: LookScope; level: LookLevel; only?: LookToken['kind']; open?: boolean;
}) {
  const tokens = lookTokensAt(level, scope).filter((t) => !only || t.kind === only);
  const cats = [...LOOK_CATEGORIES.map((c) => c.id), ...tokens.map((t) => t.category)].filter((c, i, a) => a.indexOf(c) === i);
  return (
    <div className="fx-look">
      {cats.map((cid) => {
        const list = tokens.filter((t) => t.category === cid);
        if (!list.length) return null;
        const c = lookCategory(cid);
        const n = list.filter((t) => t.id in values).length;
        return (
          <Container key={cid} className="fx-look__cat" title={c.label} icon={c.icon} collapsible defaultOpen={open || n > 0}
            actions={n > 0 ? <Chip tone="accent">{n} changed</Chip> : undefined}>
            <div className="fx-look__rows">
              {list.map((t) => <LookTokenRow key={t.id} token={t} values={values} onSet={(v) => onChange(setLookValue(values, t.id, v))} />)}
            </div>
          </Container>
        );
      })}
      {!tokens.length && <p className="fx-muted">Nothing at this level.</p>}
    </div>
  );
}

export { lookChanged };
