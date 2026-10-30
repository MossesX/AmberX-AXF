/**
 * Installer look dialog (Tools → Installer look, or Look in the installer): switches for style, colour and layout
 * (plus gauge and progress-meter styles), Roll (changes only what is marked in the tree), Undo, Back to the app's look,
 * a live preview, and on the left a collapsible tree (open by default) of every token and parameter: Style, Color,
 * Layout. Each row has a roll switch; a parent's switch turns all its children on or off. Leaves can be edited in place.
 * Everything is saved on axHub's data server (look.ts).
 */
import { useMemo, useState } from 'react';
import { assetTypeSpecs } from '@console/axf/core';
import { Button, Icon, IconButton, Note, Segmented, SelectField, Switch, TextField, useAxfState, useEditorSync, useRuntime } from '@console/axf/react';
import { buildCategories } from './installer-core';
import { InstallerView, type Run } from './installer';
import {
  LAYOUT_VARIANTS, type LookType, type TreeNode, type TypeSpec,
  buildTree, customId, leafValue, markState, roll, setLeaf, toggleMark,
} from './look-core';
import { applyRoll, lookWhere, reloadLook, pickAsset, resetLook, setLayout, setMarks, setTreeOpen, treeInput, undoLast, useLook } from './look';
import { DEMO_PLAN } from './demoPlan';

type Json = Record<string, unknown>;
const LABEL: Record<LookType, string> = { 'style-theme': 'Style', 'color-theme': 'Color', gauge: 'Gauges', meter: 'Progress meters', 'installer-layout': 'Layout' };

export function LookDialog() {
  const rt = useRuntime();
  useAxfState();
  const look = useLook();
  useEditorSync({ onRefresh: () => { void reloadLook(); } }); // UI-editor rule: current values whenever it opens or regains focus
  const [open, setOpen] = useState<Record<string, boolean>>({ style: true, color: true, layout: true });
  const spec = assetTypeSpecs as unknown as Record<string, TypeSpec>;
  const inp = treeInput(spec);
  const tree = buildTree(inp);
  const marks = look.doc.marks;
  const active = rt.getState().active as Record<string, string>;

  const doRoll = () => {
    const r = roll(tree, marks, inp);
    if (!r.changed) { rt.toast('Nothing to roll: switch on at least one row in the tree.', 'warning', 'Installer look'); return; }
    applyRoll(r, inp.ids);
    rt.toast(`Rolled ${r.changed} setting${r.changed === 1 ? '' : 's'}`, 'success', 'Installer look');
  };
  const editLeaf = (n: TreeNode, value: unknown) => {
    const t = n.type!;
    const data = setLeaf((inp.current[t] ?? {}) as Json, n.path!, value);
    applyRoll({ data: { [t]: data }, whole: {}, changed: 1 }, inp.ids);
  };
  const options = (t: LookType) => (rt.registry.list(t as never) ?? []).map((a) => ({ id: a.id, name: a.name, scheme: (a.data as Json)?.scheme as string | undefined }));
  const pickRow = (t: LookType) => {
    const opts = options(t);
    const cur = active[t] ?? '';
    const items = opts.map((o) => ({ value: o.id, label: o.id === customId(t) ? 'Rolled' : o.name }));
    if (t === 'color-theme') {
      const light = opts.filter((o) => o.scheme !== 'dark' && o.id !== customId(t)), dark = opts.filter((o) => o.scheme === 'dark' && o.id !== customId(t));
      return (
        <div className="axp-claude-handoff-look__pick" key={t}>
          <span className="axp-claude-handoff-look__picklabel">Color</span>
          {/* one dropdown (light / dark groups) instead of a wall of theme chips (screens-compact) */}
          <select className="fx-input" value={cur} aria-label="Color theme" onChange={(e) => pickAsset(t, e.target.value)}>
            {cur === customId(t) && <option value={cur}>Rolled colours in use</option>}
            <optgroup label="Light">{light.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>
            <optgroup label="Dark">{dark.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>
          </select>
        </div>
      );
    }
    return (
      <div className="axp-claude-handoff-look__pick" key={t}>
        <span className="axp-claude-handoff-look__picklabel">{LABEL[t]}</span>
        {items.length <= 6
          ? <Segmented size="sm" label={LABEL[t]} value={cur} options={items} onChange={(v) => pickAsset(t, v)} />
          : <SelectField label="" value={cur} options={items} onChange={(v) => pickAsset(t, v)} />}
      </div>
    );
  };

  const defaults = rt.manifest.defaults as unknown as Partial<Record<LookType, string>>;

  return (
    <div className="axp-claude-handoff-lookwrap">
    <div className={`axp-claude-handoff-look${look.doc.treeOpen ? ' is-tree-open' : ''}`}>
      <aside className="axp-claude-handoff-look__tree" aria-label="Tokens and parameters">
        <div className="axp-claude-handoff-look__treehead">
          <strong>Tokens</strong>
          <span className="axp-claude-handoff-look__hint">Switched on = changes on Roll</span>
          <IconButton icon="chevron-left" label="Hide the tree" onClick={() => setTreeOpen(false)} />
        </div>
        <ul className="axp-claude-handoff-look__nodes">
          {tree.map((n) => <Node key={n.id} n={n} depth={0} marks={marks} open={open} setOpen={setOpen} inp={inp} onEdit={editLeaf} />)}
        </ul>
      </aside>
      <section className="axp-claude-handoff-look__main">
        <div className="axp-claude-handoff-look__bar">
          {!look.doc.treeOpen && <Button tone="ghost" icon="list" size="sm" onClick={() => setTreeOpen(true)}>Tokens</Button>}
          <Button tone="primary" icon="shuffle" onClick={doRoll}>Roll</Button>
          <Button icon="undo" size="sm" disabled={!look.undo} onClick={undoLast}>Undo</Button>
          <Button tone="quiet" icon="refresh" size="sm" onClick={() => resetLook(defaults)}>Back to the app's look</Button>
        </div>
        <div className="axp-claude-handoff-look__picks">
          {pickRow('style-theme')}
          {pickRow('color-theme')}
          <div className="axp-claude-handoff-look__pick">
            <span className="axp-claude-handoff-look__picklabel">Layout</span>
            <Segmented size="sm" label="Installer layout" value={look.doc.layout.variant} options={LAYOUT_VARIANTS.map((v) => ({ value: v.id, label: v.label, title: v.hint }))} onChange={(v) => setLayout({ variant: v })} />
          </div>
          {pickRow('gauge')}
          {pickRow('meter')}
          <div className="axp-claude-handoff-look__toggles">
            <Switch label="Gauges" checked={look.doc.layout.gauges} onChange={(v) => setLayout({ gauges: v })} />
            <Switch label="Groups on the right" checked={look.doc.layout.groupsSide === 'right'} onChange={(v) => setLayout({ groupsSide: v ? 'right' : 'left' })} />
            <SelectField label="Log lines" value={String(look.doc.layout.logLines)} options={[0, 3, 5, 7, 10, 12].map((n) => ({ value: String(n), label: n ? String(n) : 'Hidden' }))} onChange={(v) => setLayout({ logLines: Number(v) })} />
          </div>
        </div>
        <div className="axp-claude-handoff-look__preview" aria-label="Preview">
          <LookPreview />
        </div>
        {look.error && <Note tone="warning">{look.error}</Note>}
        <p className="axp-claude-handoff-look__where">Saved in {lookWhere()}. Theme picks change the whole console (colours and controls always come from the app).</p>
      </section>
    </div>
    </div>
  );
}

function Node({ n, depth, marks, open, setOpen, inp, onEdit }: {
  n: TreeNode; depth: number; marks: Record<string, boolean>; open: Record<string, boolean>; setOpen: (o: Record<string, boolean>) => void;
  inp: ReturnType<typeof treeInput>; onEdit: (n: TreeNode, v: unknown) => void;
}) {
  const state = markState(n, marks);
  const isOpen = open[n.id] ?? depth < 1;
  const sw = <Switch label={`Roll ${n.label}`} hideLabel text={state === 'some' ? 'some' : undefined} checked={state !== 'none'} onChange={() => setMarks(toggleMark(n, marks))} className={state === 'some' ? 'is-some' : ''} />;
  if (n.children) {
    return (
      <li className={`axp-claude-handoff-look__node is-branch depth-${Math.min(depth, 3)}`}>
        <div className="axp-claude-handoff-look__row">
          <button type="button" data-fx-row className="axp-claude-handoff-look__toggle" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [n.id]: !isOpen })}>
            <span className="axp-claude-handoff-look__chev" aria-hidden><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} /></span>
            <span className="axp-claude-handoff-look__label">{n.label}</span>
            <span className="axp-claude-handoff-look__count">{countLeaves(n)}</span>
          </button>
          {sw}
        </div>
        {isOpen && <ul className="axp-claude-handoff-look__nodes">{n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} marks={marks} open={open} setOpen={setOpen} inp={inp} onEdit={onEdit} />)}</ul>}
      </li>
    );
  }
  const value = leafValue((inp.current[n.type!] ?? {}) as Json, n.path!);
  return (
    <li className={`axp-claude-handoff-look__node is-leaf depth-${Math.min(depth, 3)}`}>
      <div className="axp-claude-handoff-look__row">
        <span className="axp-claude-handoff-look__label">{n.label}</span>
        <LeafEditor n={n} value={value} onEdit={(v) => (n.type === 'installer-layout' ? setLayout({ [n.path![0]!]: v }) : onEdit(n, v))} />
        {sw}
      </div>
    </li>
  );
}

const countLeaves = (n: TreeNode): number => (n.children ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1);

function LeafEditor({ n, value, onEdit }: { n: TreeNode; value: unknown; onEdit: (v: unknown) => void }) {
  const f = n.field!;
  if (f.kind === 'color') {
    const hex = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
    return hex
      ? <input className="axp-claude-handoff-look__color" type="color" aria-label={n.label} value={hex} onChange={(e) => onEdit(e.target.value)} />
      : <span className="axp-claude-handoff-look__value" title={String(value)}>{String(value)}</span>;
  }
  if (f.kind === 'enum') return <SelectField label="" value={String(value)} options={f.values.map((x) => ({ value: String(x), label: String(x) }))} onChange={(v) => onEdit(typeof f.values[0] === 'number' ? Number(v) : v)} />;
  if (f.kind === 'bool') return <Segmented size="sm" label={n.label} value={value ? 'on' : 'off'} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} onChange={(v) => onEdit(v === 'on')} />;
  if (f.kind === 'number') return <TextField label="" type="number" value={String(value ?? '')} onChange={(v) => { const x = Number(v); if (Number.isFinite(x)) onEdit(Math.min(f.max, Math.max(f.min, x))); }} />;
  return <span className="axp-claude-handoff-look__value" title={String(value)}>{String(value ?? '')}</span>;
}

/** A still installer mid-run in the chosen layout, gauges and meters (no network, no timers). */
function LookPreview() {
  const look = useLook();
  const cats = useMemo(() => buildCategories(DEMO_PLAN), []);
  const run: Run = { ci: 3, si: 21, p: 0.45, elapsed: 31_000, read: 280_000, written: 64_000, filesDone: 41, readSpeed: 118_000, writeSpeed: 36_000, done: false, failed: '',
    log: ['[0:29] ✓ banner-status-bell.md (6.1 KB)', '[0:30] ✓ build-manager.md (9.8 KB)', '[0:30] ✓ build-reporting.md (5.2 KB)', '[0:31] ✓ build-steps.md (4.4 KB)', '[0:31] ✓ codebase-changes.md (7.3 KB)', '[0:31] ✓ console-menu.md (5.0 KB)', '[0:31] ✓ harvest-plan.md (3.1 KB)'] };
  return <InstallerView cats={cats} run={run} project="AmberX AXF" layout={look.doc.layout} compactPreview />;
}

