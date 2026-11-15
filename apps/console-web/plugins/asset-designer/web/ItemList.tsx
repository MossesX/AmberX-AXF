import { useMemo } from 'react';
import { Button, Chip, IconButton, Note, SelectField, Switch, TextField, useRuntime } from '@console/axf/react';
import { itemColumns, moveItem, nestedKeys, newItem, type Item } from './model';

/*
 * Item list editor: the menu / toolbar / section lists of an asset (an array of objects). One row per item with its
 * id, label, icon and target (action picked from the runtime's actions, or a view), reorder, remove, add; nested lists
 * (children, a section's items) open as an item list of their own. Anything else on an item stays in the JSON view.
 */
export function ItemList({ label, value, onChange, depth = 0, error }: { label: string; value: Item[]; onChange: (v: Item[]) => void; depth?: number; error?: string }) {
  const rt = useRuntime();
  const actions = useMemo(() => rt.actions.list().filter(({ meta }) => !meta.stub).map(({ id }) => id).sort(), [rt]);
  const cols = itemColumns(value);
  const set = (i: number, key: string, v: unknown) => onChange(value.map((it, j) => { if (j !== i) return it; const n = { ...it }; if (v === undefined || v === '') delete n[key]; else n[key] = v; return n; }));
  return (
    <div className="axp-asset-designer__items" data-depth={depth}>
      <div className="axp-asset-designer__itemshead">
        <p className="fx-eyebrow">{label}</p>
        <Chip>{value.length} item{value.length === 1 ? '' : 's'}</Chip>
        <Button size="sm" icon="plus" onClick={() => onChange([...value, newItem(value)])}>Add</Button>
      </div>
      {error ? <Note tone="danger">{error}</Note> : null}
      {value.map((it, i) => (
        <div key={i} className="axp-asset-designer__item">
          <div className="axp-asset-designer__itemrow">
            {it.divider === true ? <Chip>Divider</Chip> : <>
              {cols.includes('id') ? <TextField label="Id" mono value={String(it.id ?? '')} onChange={(v) => set(i, 'id', v)} /> : null}
              <TextField label="Label" value={String(it.label ?? '')} onChange={(v) => set(i, 'label', v)} />
              {cols.includes('icon') ? <TextField label="Icon" mono value={String(it.icon ?? '')} onChange={(v) => set(i, 'icon', v)} /> : null}
              {cols.includes('action') ? <SelectField label="Action" value={String(it.action ?? '')} options={[{ value: '', label: 'None' }, ...(typeof it.action === 'string' && it.action && !actions.includes(it.action) ? [it.action] : []).concat(actions).map((a) => ({ value: a, label: a }))]} onChange={(v) => set(i, 'action', v)} /> : null}
              {cols.includes('view') ? <TextField label="View" mono value={String(it.view ?? '')} onChange={(v) => set(i, 'view', v)} /> : null}
            </>}
            {cols.includes('divider') ? <Switch label="Divider" checked={it.divider === true} onChange={(v) => set(i, 'divider', v || undefined)} /> : null}
            <div className="axp-asset-designer__itemtools" role="toolbar" aria-label={`Item ${i + 1}`}>
              <IconButton icon="chevron-up" label={`Move ${String(it.label ?? it.id ?? i + 1)} up`} disabled={i === 0} onClick={() => onChange(moveItem(value, i, i - 1))} />
              <IconButton icon="chevron-down" label={`Move ${String(it.label ?? it.id ?? i + 1)} down`} disabled={i === value.length - 1} onClick={() => onChange(moveItem(value, i, i + 1))} />
              <IconButton icon="trash" label={`Remove ${String(it.label ?? it.id ?? i + 1)}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </div>
          </div>
          {depth < 3 ? nestedKeys(it).map((k) => <ItemList key={k} label={`${String(it.label ?? it.id ?? `Item ${i + 1}`)} · ${k}`} value={it[k] as Item[]} onChange={(v) => set(i, k, v)} depth={depth + 1} />) : null}
        </div>
      ))}
    </div>
  );
}
