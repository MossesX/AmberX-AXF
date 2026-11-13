/**
 * The New project wizard's optional steps: starter code, framework and libraries, skin, Claude account and models, and
 * the first plan. A step starts on the current project's value, shown grayed out; its checkbox unlocks it for a new
 * choice (Brett: "you'll see the current things entered and grayed out with a checkbox"). Long lists open as a grid in
 * a dialog next to their dropdown.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Checkbox, ChoiceGrid, Note, SelectField, TextField, useRuntime, type Choice } from '@console/axf/react';

export const P = 'axp-project-wizard';
export const PICK_DIALOG = 'project-wizard.pick';

/* ---------------- types (mirror wizard.mjs) ---------------- */

export type Lockable = 'starter' | 'framework' | 'skin' | 'accounts';
export const LOCKABLE: Lockable[] = ['starter', 'framework', 'skin', 'accounts'];
export interface Starter { id: string; template: string; boilerplate: string }
export interface Framework { mode: 'axf' | 'own' | 'import'; libraries: string[]; privateLibraries: string[]; name: string; import: { repo: string; path: string; boilerplate: string } }
export interface Skin { id: string; color: string }
export interface Claude { account: string; ownAccount: boolean; models: Record<string, string> }
export interface FirstPlan { text: string; builds: string[]; spoken: boolean }
export interface Setup { starter: Starter; framework: Framework; skin: Skin; claude: Claude }
export interface Options {
  steps: { id: string; title: string; optional: boolean }[];
  starters: { id: string; label: string; description: string; features: string[]; plugins: string[]; template?: string }[];
  frameworks: { id: Framework['mode']; label: string; description: string }[];
  models: string[];
  modelRoles: { id: string; label: string }[];
  templates: { id: string; label: string }[];
  boilerplates: { id: string; name: string; category: string; status: string }[];
  skins: { id: string; name: string; kind: string; description: string }[];
  libraries: { id: string; name: string; description: string }[];
  accounts: { name: string; kind: string; plan: string; email: string; active: boolean }[];
  current: { project: { id: string; name: string; description: string; base: boolean; repo: string }; values: Setup };
  startFrom?: { kinds: StartFrom['kind'][]; boilerplates: BoilerplateInfo[] };
}

/* ---------------- start from: blank, the current project, or a saved boilerplate ---------------- */

export type Items = 'structure' | 'all' | 'none';
export interface StartFrom { kind: 'blank' | 'current' | 'boilerplate'; id: string; carry: { items: Items; builds: boolean } }
export interface BoilerplateInfo { id: string; name: string; description: string; from: { id: string; name: string }; holds: string }
/** What a start choice fills in (POST start): the optional steps' values, a name suggestion, what it carries. */
export interface StartInfo { kind: StartFrom['kind']; id: string; label: string; holds: string; values: Setup; suggest: { display: string; description: string }; boilerplates: BoilerplateInfo[] }

const ITEM_CHOICES: { value: Items; label: string }[] = [
  { value: 'structure', label: 'Structure only: lists, folders and categories, no items' },
  { value: 'all', label: 'Everything: with their items' },
  { value: 'none', label: 'Leave them out' },
];

/** The first question: start blank, as a copy of the current project, or from a saved boilerplate. */
export function StartFromField({ o, v, info, onChange }: { o: Options | null; v: StartFrom; info: StartInfo | null; onChange: (v: StartFrom) => void }) {
  const boilerplates = info?.boilerplates ?? o?.startFrom?.boilerplates ?? [];
  const curName = o?.current.project.name ?? 'the current project';
  const choices: Choice[] = [
    { id: 'blank', title: 'Blank', text: `A new project. Its settings start on ${curName}'s; nothing else comes along.`, icon: 'file' },
    { id: 'current', title: `Copy of ${curName}`, text: 'Its settings, rules, instructions, skin, Claude accounts and plugin setup, and its lists.', icon: 'copy' },
    { id: 'boilerplate', title: 'A boilerplate', text: boilerplates.length ? `${boilerplates.length} saved` : 'none saved yet (Projects → Save as boilerplate)', icon: 'package', disabled: !boilerplates.length },
  ];
  return (
    <fieldset className={`${P}__fieldset`}>
      <legend>Start from</legend>
      <ChoiceGrid label="Start from" choices={choices} selected={[v.kind]} onToggle={(k) => onChange({ ...v, kind: k as StartFrom['kind'], id: k === 'boilerplate' ? v.id || boilerplates[0]?.id || '' : '' })} />
      {v.kind === 'boilerplate' && (
        <SelectField label="Boilerplate" value={v.id} options={boilerplates.map((b) => ({ value: b.id, label: b.from.name ? `${b.name} (from ${b.from.name})` : b.name }))} onChange={(id) => onChange({ ...v, id })} />
      )}
      {v.kind === 'current' && (
        <>
          <SelectField label="Lists, to-dos, notes and plans" value={v.carry.items} options={ITEM_CHOICES} onChange={(items) => onChange({ ...v, carry: { ...v.carry, items: items as Items } })} />
          <Checkbox label="Bring the builds history (read-only; the builds stay with the original)" checked={v.carry.builds} onChange={(builds) => onChange({ ...v, carry: { ...v.carry, builds } })} />
        </>
      )}
      {info && info.kind !== 'blank' && <p className={`fx-small fx-muted ${P}__flat`}>Comes along: {info.holds}. The optional steps start on its values.</p>}
    </fieldset>
  );
}

/* ---------------- the lock: current value grayed out until unlocked ---------------- */

export function Locked({ locked, onLock, current, summary, children }: { locked: boolean; onLock: (v: boolean) => void; current: string; summary: string; children: ReactNode }) {
  return (
    <div className={`${P}__lockable ${locked ? 'is-locked' : ''}`}>
      <Checkbox label={locked ? `Choose something else (now the same as ${current}: ${summary})` : `Choose something else (unticked: the same as ${current})`} checked={!locked} onChange={(v) => onLock(!v)} />
      <fieldset className={`${P}__fieldset`} disabled={locked} aria-disabled={locked}>{children}</fieldset>
    </div>
  );
}

/* ---------------- grid in a dialog, next to a dropdown ---------------- */

/** Props of the pick dialog (registered by the plugin as project-wizard.pick). */
export interface PickProps { title: string; choices: Choice[]; selected: string[]; multiple?: boolean; onPick: (ids: string[]) => void }

export function PickDialog({ props, close }: { props: Record<string, unknown>; close: () => void }) {
  const p = props as unknown as PickProps;
  const [sel, setSel] = useState<string[]>(p.selected ?? []);
  const [filter, setFilter] = useState('');
  const choices = (p.choices ?? []).filter((c) => !filter || `${c.title} ${c.text ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string) => {
    if (!p.multiple) { p.onPick?.([id]); close(); return; }
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  return (
    <div className="fx-stack">
      {(p.choices ?? []).length > 8 && <TextField label="Filter" value={filter} onChange={setFilter} type="search" autoFocus />}
      {!choices.length && <Note>Nothing to pick here.</Note>}
      <ChoiceGrid choices={choices} selected={sel} onToggle={toggle} multiple={p.multiple} label={p.title} className={`${P}__pickgrid`} />
      {p.multiple && <div className="fx-row"><Button tone="primary" icon="check" onClick={() => { p.onPick?.(sel); close(); }}>Use {sel.length} selected</Button></div>}
    </div>
  );
}

function useGrid() {
  const rt = useRuntime();
  return (props: PickProps) => rt.openDialog(PICK_DIALOG, props as unknown as Record<string, unknown>);
}

/* ---------------- starter ---------------- */

export function StarterStep({ o, v, set, newRepo }: { o: Options; v: Starter; set: (s: Starter) => void; newRepo: boolean }) {
  const s = o.starters.find((x) => x.id === v.id) ?? o.starters[0];
  return (
    <>
      {!newRepo && <Note>The linked repo already has code: it is the starter. The choice here is only recorded on the project.</Note>}
      <ChoiceGrid label="Starter code" choices={o.starters.map((x) => ({ id: x.id, title: x.label, text: x.description, icon: x.id === 'console-app' ? 'layout' : x.id === 'template' ? 'package' : x.id === 'framework' ? 'layers' : 'file' }))} selected={[v.id]} onToggle={(id) => set({ ...v, id })} />
      {v.id === 'template' && (
        <div className={`${P}__grid`}>
          <SelectField label="Template" value={v.template} options={o.templates.map((t) => ({ value: t.id, label: t.label }))} onChange={(template) => set({ ...v, template })} />
          <SelectField label="Boilerplate" value={v.boilerplate} empty="none" options={o.boilerplates.map((b) => ({ value: b.id, label: `${b.name}${b.status && b.status !== 'built' ? ` (${b.status})` : ''}` }))} onChange={(boilerplate) => set({ ...v, boilerplate })} />
        </div>
      )}
      {s && s.plugins.length > 0 && <p className={`fx-small fx-muted ${P}__flat`}>Preinstalled in its Settings: {s.plugins.join(', ')}. Wired in: {s.features.join(', ')}.</p>}
    </>
  );
}

/* ---------------- framework and libraries ---------------- */

export function FrameworkStep({ o, v, set }: { o: Options; v: Framework; set: (f: Framework) => void }) {
  const grid = useGrid();
  const libs = o.libraries;
  const name = (id: string) => libs.find((l) => l.id === id)?.name ?? id;
  return (
    <>
      <ChoiceGrid label="Framework" choices={o.frameworks.map((f) => ({ id: f.id, title: f.label, text: f.description, icon: f.id === 'axf' ? 'sparkles' : f.id === 'own' ? 'hammer' : 'download' }))} selected={[v.mode]} onToggle={(mode) => set({ ...v, mode: mode as Framework['mode'] })} />
      {v.mode === 'own' && <TextField label="Your framework's name" value={v.name} onChange={(n) => set({ ...v, name: n })} placeholder="Leaf" hint="A framework/ folder is started in the repo for it." />}
      {v.mode === 'import' && (
        <div className={`${P}__grid`}>
          <TextField label="Framework repo (GitHub owner/name)" mono value={v.import.repo} onChange={(repo) => set({ ...v, import: { ...v.import, repo } })} placeholder="owner/framework" />
          <TextField label="…or a folder on the server" mono value={v.import.path} onChange={(path) => set({ ...v, import: { ...v.import, path } })} placeholder="/root/projects/framework" />
          <TextField label="Its boilerplate to start from (folder inside it)" mono value={v.import.boilerplate} onChange={(boilerplate) => set({ ...v, import: { ...v.import, boilerplate } })} placeholder="boilerplates/basic" hint="Used when the starter is “The framework's boilerplate”." />
        </div>
      )}
      {v.mode === 'axf' && (
        <div className="fx-stack">
          <div className="fx-row fx-row--wrap">
            <span className="fx-small">Shared libraries: {v.libraries.length ? v.libraries.map(name).join(', ') : 'the defaults'}</span>
            <Button icon="list" disabled={!libs.length} onClick={() => grid({ title: 'Shared libraries', multiple: true, selected: v.libraries, choices: libs.map((l) => ({ id: l.id, title: l.name, text: l.description })), onPick: (libraries) => set({ ...v, libraries }) })}>Pick libraries…</Button>
          </div>
        </div>
      )}
      <TextField label="Private libraries on top (one per line: GitHub owner/name or a server folder)" mono rows={2} value={v.privateLibraries.join('\n')} onChange={(t) => set({ ...v, privateLibraries: t.split('\n').map((x) => x.trim()).filter(Boolean) })} placeholder="MossesX/my-private-lib" />
    </>
  );
}

/* ---------------- skin ---------------- */

export function SkinStep({ o, v, set }: { o: Options; v: Skin; set: (s: Skin) => void }) {
  const grid = useGrid();
  return (
    <div className={`${P}__pickrow`}>
      <SelectField label="Skin" value={v.id} empty="The console's default look" options={o.skins.map((s) => ({ value: s.id, label: `${s.name}${s.kind === 'design-package' ? ' (design package)' : ''}` }))} onChange={(id) => set({ ...v, id })} />
      <Button icon="grid" disabled={!o.skins.length} onClick={() => grid({ title: 'Skins', selected: [v.id], choices: [{ id: '', title: 'Default look', text: "The console's own look" }, ...o.skins.map((s) => ({ id: s.id, title: s.name, text: s.description, tag: s.kind === 'design-package' ? 'design package' : undefined }))], onPick: ([id]) => set({ ...v, id: id ?? '' }) })}>Browse skins…</Button>
    </div>
  );
}

/* ---------------- Claude account and models ---------------- */

export function AccountsStep({ o, v, set }: { o: Options; v: Claude; set: (c: Claude) => void }) {
  const grid = useGrid();
  return (
    <>
      <div className={`${P}__pickrow`}>
        <SelectField label="Claude account for its builds" value={v.account} empty={o.accounts.length ? 'Pick later' : 'No accounts listed (Claude accounts plugin off)'} options={o.accounts.map((a) => ({ value: a.name, label: `${a.name}${a.plan ? ` · ${a.plan}` : ''}${a.kind === 'api' ? ' · API' : ''}` }))} onChange={(account) => set({ ...v, account })} />
        <Button icon="grid" disabled={!o.accounts.length} onClick={() => grid({ title: 'Claude accounts', selected: [v.account], choices: o.accounts.map((a) => ({ id: a.name, title: a.name, text: [a.email, a.plan, a.kind === 'api' ? 'API key' : 'subscription'].filter(Boolean).join(' · '), tag: a.active ? 'active' : undefined })), onPick: ([account]) => set({ ...v, account: account ?? '' }) })}>Browse accounts…</Button>
      </div>
      <Checkbox label="The project gets its own Claude account (its builds never borrow another project's)" checked={v.ownAccount} onChange={(ownAccount) => set({ ...v, ownAccount })} />
      <div className={`${P}__grid`}>
        {o.modelRoles.map((r) => (
          <SelectField key={r.id} label={`${r.label} model`} value={v.models[r.id] ?? 'opus'} options={o.models.map((m) => ({ value: m, label: m === 'fable' ? 'Fable' : 'Opus' }))} onChange={(m) => set({ ...v, models: { ...v.models, [r.id]: m } })} />
        ))}
      </div>
    </>
  );
}

/* ---------------- first plan, typed or spoken ---------------- */

interface Recognition { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null }
type RecognitionCtor = new () => Recognition;

/** Browser speech to text, appended to the plan (where the browser has it). */
function useSpeech(onText: (t: string) => void) {
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  const ref = useRef<Recognition | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => ref.current?.stop(), []);
  const toggle = () => {
    if (!Ctor) return;
    if (on) { ref.current?.stop(); return; }
    const r = new Ctor();
    r.lang = navigator.language || 'en-US'; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { const last = e.results[e.results.length - 1]; const t = last?.[0]?.transcript?.trim(); if (t) onText(t); };
    r.onend = () => setOn(false); r.onerror = () => setOn(false);
    ref.current = r; r.start(); setOn(true);
  };
  return { can: !!Ctor, on, toggle };
}

export function FirstPlanStep({ v, set }: { v: FirstPlan; set: (f: FirstPlan) => void }) {
  const speech = useSpeech((t) => set({ ...v, text: v.text ? `${v.text} ${t}` : t, spoken: true }));
  return (
    <div className={`${P}__fieldset`}>
      <TextField label="What should it do first? (optional)" rows={4} value={v.text} onChange={(text) => set({ ...v, text })} placeholder="A garden planner: plants, a watering timer, reminders." hint="Saved as docs/FIRST_PLAN.md in the repo; the first Claude session starts from it." />
      <div className="fx-row fx-row--wrap">
        <Button icon={speech.on ? 'pause' : 'mic'} tone={speech.on ? 'primary' : undefined} disabled={!speech.can} title={speech.can ? 'Speak the plan; the words are added to the text' : "This browser can't turn speech into text: use AmberX ('new project plan …') or type it"} onClick={speech.toggle}>{speech.on ? 'Stop listening' : 'Speak it'}</Button>
      </div>
      <TextField label="First builds (one per line, optional)" rows={3} value={v.builds.join('\n')} onChange={(t) => set({ ...v, builds: t.split('\n').map((x) => x.trimStart()).filter((x, i, a) => x || i === a.length - 1) })} placeholder={'Seed list\nWatering timer'} />
    </div>
  );
}

/** One line for a step's value (the locked summary and the review). */
export function summary(k: Lockable, s: Setup, o: Options | null): string {
  if (k === 'starter') return o?.starters.find((x) => x.id === s.starter.id)?.label ?? s.starter.id;
  if (k === 'framework') return `${o?.frameworks.find((x) => x.id === s.framework.mode)?.label ?? s.framework.mode}${s.framework.libraries.length ? ` + ${s.framework.libraries.length} libraries` : ''}${s.framework.privateLibraries.length ? ` + ${s.framework.privateLibraries.length} private` : ''}`;
  if (k === 'skin') return o?.skins.find((x) => x.id === s.skin.id)?.name ?? (s.skin.id || 'default look');
  return `${s.claude.account || 'account later'} · ${Object.entries(s.claude.models).map(([r, m]) => `${r} ${m}`).join(', ')}`;
}
