/**
 * Voice command center (Oct 28 2026, voice-command@1): every notes, tasks, developer and AI-snippet command AmberX
 * understands, in one tab group, and the runner that carries them out when they're said.
 *
 * - Outer tabs: Notes · Tasks · Developer · AI snippets. Each has trigger words ("note …", "task …", "dev …", "ask …")
 *   that aim a sentence at that tab; without one, every tab is tried and the page on screen wins ties.
 * - Inner tabs: Commands (single actions) · Chains & wizards. Each is a sortable, filterable, searchable grid in a
 *   scrolling pane; a row opens to its details, its own settings, its phrases (record one: say it twice, the two must
 *   match, or pick a predefined phrase) and, for chains and wizards, its steps (edit them, or by voice).
 * - Developer and AI snippets need the AI (and Molly for Developer). When it's off or not answering, the tab says why
 *   and offers the fix: switch it on, open the connection, run the setup wizard, check again.
 *
 * Library: lib-*.ts (code). Everything a person changes is an override or their own command (settings, per device
 * by default), so the library can grow without losing anyone's changes. Runs through voice's router hook first, so
 * the person's own simple commands still win.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Chip, Container, Icon, IconButton, Note, SelectField, Switch, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { DataGrid, type GridColumn, type GridGroup, type GridSort } from '../../../axf/libs/datagrid';
import { native } from '../../../native';
import { withMic } from '../../../miclease';
import { parseIntent, validateIntent } from '../../notes/web/core';
import { NOTES_ID, load as loadNotes, mutate, runIntent, snapshot as notesSnapshot } from '../../notes/web/store';
import { aiEnabled, aiReady, molly as askMolly, prompt as askPrompt, useAiEnabled, useAiStatus } from '../../ai/web/client';
import { askAloud, registerVoiceRouter, say as speak } from '../../voice/web/index';
import {
  CATEGORIES, categoryOf, describeStep, effective, filterCommands, findCommand, groupsOf, parseCustom, parseOverrides, phraseTaken, recordingsMatch,
  resetOverride, setOverride, sortCommands, cleanSteps, type CategoryId, type Command, type CommandOverride, type CommandSettings, type Effective, type GridFilter,
  type SortKey, type Step,
} from './core';
import { LIBRARY } from './library';
import { OP_NAMES, runOp } from './ops';
import { runCommand, type OpOutcome, type RunEnv } from './runner';
import { editChain, recordChain } from './voicewizard';
import './commands.css';

const ID = 'ai.amberx.amberx.commands';
const VIEW = 'commands';
const DIALOG = 'commands.center';
export const K = {
  overrides: 'amberx.commands.overrides',
  custom: 'amberx.commands.custom',
  listen: 'amberx.commands.listen',
  sure: 'amberx.commands.minScore',
} as const;

/* ---------------------------------------------------------------- data */

const useSetting = (rt: AxfRuntime, key: string) => useSyncExternalStore(rt.settings.subscribe, () => rt.settings.get(key));
const overridesOf = (rt: AxfRuntime) => parseOverrides(rt.settings.get(K.overrides));
const customOf = (rt: AxfRuntime) => parseCustom(rt.settings.get(K.custom));
export const allCommands = (rt: AxfRuntime): Effective[] => effective(LIBRARY, overridesOf(rt), customOf(rt));
const saveOverrides = (rt: AxfRuntime, o: ReturnType<typeof parseOverrides>) => rt.settings.set(K.overrides, JSON.stringify(o));
const saveCustom = (rt: AxfRuntime, list: Command[]) => rt.settings.set(K.custom, JSON.stringify(list));
const patchCommand = (rt: AxfRuntime, id: string, patch: CommandOverride) => saveOverrides(rt, setOverride(overridesOf(rt), id, { ...overridesOf(rt)[id], ...patch }));

/* ---------------------------------------------------------------- Molly status (developer tab) */

interface MollyState { known: boolean; ok: boolean; reason: string; fix: string; checking: boolean }
let mollyState: MollyState = { known: false, ok: false, reason: 'Not checked yet.', fix: '', checking: false };
const mollySubs = new Set<() => void>();
const setMolly = (p: Partial<MollyState>) => { mollyState = { ...mollyState, ...p }; mollySubs.forEach((f) => f()); };
const useMolly = () => useSyncExternalStore((f) => { mollySubs.add(f); return () => { mollySubs.delete(f); }; }, () => mollyState);
export async function checkMolly(): Promise<MollyState> {
  setMolly({ checking: true });
  try {
    const r = await fetch('/api/ai/molly/status', { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    if (r.status === 403) setMolly({ known: true, ok: false, reason: 'Developer commands are for hub admins.', fix: 'admin' });
    else if (!r.ok) setMolly({ known: true, ok: false, reason: r.status === 404 ? 'This AmberX has no server for Molly.' : `The AmberX server answered ${r.status}.`, fix: 'server' });
    else { const j = (await r.json()) as { ok?: boolean; reason?: string; fix?: string }; setMolly({ known: true, ok: !!j.ok, reason: j.reason ?? '', fix: j.fix ?? '' }); }
  } catch (e) { setMolly({ known: true, ok: false, reason: `The AmberX server can't be reached (${(e as Error).message}).`, fix: 'server' }); }
  setMolly({ checking: false });
  return mollyState;
}

/* ---------------------------------------------------------------- running (the real app) */

let running = false;
const pageCategory = (rt: AxfRuntime): CategoryId | null => {
  const v = rt.getState().view;
  return CATEGORIES.find((c) => c.view === v)?.id ?? null;
};

function makeEnv(rt: AxfRuntime): RunEnv {
  const ensureNotes = async () => { if (!notesSnapshot().loaded) await loadNotes(); };
  const outcome = (r: OpOutcome): OpOutcome => {
    if (r.copy) void globalThis.navigator?.clipboard?.writeText(r.copy).catch(() => undefined);
    return r;
  };
  const notesFor = () => Object.values(notesSnapshot().view.items).slice(0, 200).map((i) => ({ title: i.title, text: i.text, list: notesSnapshot().view.lists[i.list]?.name ?? '' }));
  return {
    action: (spec) => { rt.dispatch(spec); },
    intent: async (raw) => {
      await ensureNotes();
      const v = validateIntent(raw);
      if (!v.ok) return { ok: false, say: `That didn't make sense: ${v.errors[0] ?? 'bad step'}.` };
      const r = runIntent(v.intent, { source: 'voice' });
      return { ok: r.ok, say: r.say, ...(r.open?.list ? { open: `notes.open:${r.open.list}` } : {}) };
    },
    op: async (name, args) => { await ensureNotes(); return outcome(mutate((s) => runOp(s, name, args))); },
    say: (text) => speak(rt, text),
    listen: (question) => askAloud(rt, question),
    ai: async (p) => { await ensureNotes(); return askPrompt(p, /my notes|my tasks|notes only|tasks only/i.test(p) ? notesFor() : []); },
    molly: async (task) => {
      const r = await askMolly(task, { page: rt.getState().view, app: 'amberx' });
      if (!r) return null;
      return r.walkthrough ? `${r.answer} I've opened “${r.walkthrough}” in the console.` : r.answer;
    },
    command: (id) => allCommands(rt).find((c) => c.id === id),
    aiReady: () => aiReady(),
    mollyReady: () => aiEnabled() && mollyState.ok,
  };
}

export async function run(rt: AxfRuntime, cmd: Effective, slots: Record<string, string> = {}): Promise<{ did: string; ok: boolean }> {
  if (running) return { did: 'Another command is still running.', ok: false };
  running = true;
  try {
    if (cmd.developer && !mollyState.known) await checkMolly();
    const r = await runCommand({ command: cmd, slots }, makeEnv(rt));
    return { did: r.did, ok: r.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await speak(rt, 'That went wrong.');
    return { did: msg, ok: false };
  } finally { running = false; }
}

/** The voice router: a command center hit wins unless it's a weak match a notes sentence explains better. */
async function route(rt: AxfRuntime, heard: string) {
  if (rt.settings.get(K.listen) === false) return null;
  const cmds = allCommands(rt).filter((c) => c.on);
  const hit = findCommand(heard, cmds, { onPage: pageCategory(rt) });
  if (!hit) return null;
  const sure = Number(rt.settings.get(K.sure) ?? 20);
  if (hit.score < sure && parseIntent(heard)) return null;
  if (hit.command.settings?.onlyOnPage && pageCategory(rt) !== hit.command.category) return null;
  return run(rt, hit.command, hit.slots);
}

/* ---------------------------------------------------------------- recording a phrase */

type RecState = { stage: 'idle' | 'first' | 'second' | 'done'; a: string; b: string; error: string };

function RecordPhrase({ cmd, all, onSave, onClose }: { cmd: Effective; all: Effective[]; onSave: (phrase: string) => void; onClose: () => void }) {
  const rt = useRuntime();
  const [st, setSt] = useState<RecState>({ stage: 'idle', a: '', b: '', error: '' });
  const [pick, setPick] = useState('');
  const lang = String(rt.settings.get('amberx.voice.lang') ?? '') || 'en-US';
  const listen = async () => (await withMic('voice-command', () => native.listen({ lang, prompt: 'Say the phrase' }))).text.trim();
  const go = async () => {
    try {
      setSt({ stage: 'first', a: '', b: '', error: '' });
      const a = await listen();
      if (!a) { setSt({ stage: 'idle', a: '', b: '', error: 'Nothing was heard. Try again.' }); return; }
      setSt({ stage: 'second', a, b: '', error: '' });
      const b = await listen();
      if (!recordingsMatch(a, b)) { setSt({ stage: 'idle', a, b, error: `The two didn't match (“${a}” / “${b}”). Record again.` }); return; }
      const taken = phraseTaken(a, all, cmd.id);
      if (taken) { setSt({ stage: 'idle', a, b, error: `“${a}” already runs ${taken.label}.` }); return; }
      setSt({ stage: 'done', a, b, error: '' });
    } catch (e) { setSt({ stage: 'idle', a: '', b: '', error: (e as Error).message }); }
  };
  // predefined phrases: this command's own defaults plus the other phrasings in its tab nobody uses yet
  const options = useMemo(() => {
    const base = LIBRARY.find((c) => c.id === cmd.id)?.phrases ?? [];
    const free = base.filter((p) => !cmd.phrases.includes(p));
    return [{ value: '', label: 'Pick a predefined phrase…' }, ...free.map((p) => ({ value: p, label: p }))];
  }, [cmd]);
  return (
    <div className="fx-stack axp-cmd-record">
      <p className="fx-muted">Say the phrase twice: the two must match. Or pick one from the list.</p>
      <div className="fx-row fx-row--wrap axp-cmd-record__steps">
        <Chip tone={st.stage === 'first' ? 'accent' : st.a ? 'success' : undefined}>1 · {st.a || (st.stage === 'first' ? 'Listening…' : 'First take')}</Chip>
        <Chip tone={st.stage === 'second' ? 'accent' : st.stage === 'done' ? 'success' : undefined}>2 · {st.b || (st.stage === 'second' ? 'Listening…' : 'Second take')}</Chip>
      </div>
      {st.error && <Note tone="warning">{st.error}</Note>}
      <div className="fx-row fx-row--wrap">
        {st.stage !== 'done'
          ? <Button tone="primary" icon="mic" disabled={st.stage === 'first' || st.stage === 'second'} onClick={() => void go()}>{st.a ? 'Record again' : 'Record'}</Button>
          : <Button tone="primary" icon="check" onClick={() => { onSave(st.a); onClose(); }}>Use “{st.a}”</Button>}
        <Button tone="quiet" onClick={onClose}>Cancel</Button>
      </div>
      {options.length > 1 && (
        <div className="fx-row fx-row--wrap axp-cmd-record__pick">
          <SelectField label="Predefined phrase" value={pick} options={options} onChange={setPick} />
          <Button size="sm" disabled={!pick} onClick={() => { onSave(pick); onClose(); }}>Add it</Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- steps editor (chains + wizards) */

const STEP_KINDS: { value: Step['do']; label: string }[] = [
  { value: 'say', label: 'Say something' }, { value: 'ask', label: 'Ask a question' }, { value: 'confirm', label: 'Ask yes / no (no stops)' },
  { value: 'run', label: 'Run another command' }, { value: 'op', label: 'Notes / tasks operation' }, { value: 'action', label: 'App action' },
  { value: 'ai', label: 'Ask the AI' }, { value: 'molly', label: 'Task for Molly' }, { value: 'wait', label: 'Wait' },
];

function newStep(kind: Step['do'], a: string, b: string): Step | null {
  const raw: Record<string, unknown> = { do: kind };
  if (kind === 'say') raw.text = a;
  if (kind === 'ask') { raw.slot = (b || 'answer').toLowerCase().replace(/[^a-z0-9_]/g, '_'); raw.question = a; raw.kind = 'text'; }
  if (kind === 'confirm') raw.question = a;
  if (kind === 'run') raw.command = a;
  if (kind === 'action') raw.action = a;
  if (kind === 'ai') raw.prompt = a;
  if (kind === 'molly') raw.task = a;
  if (kind === 'wait') raw.ms = Math.round(Number(a || '1') * 1000);
  if (kind === 'op') raw.args = Object.fromEntries(b.split(';').map((kv) => kv.split('=').map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]));
  if (kind === 'op') raw.op = a;
  return cleanSteps([raw])[0] ?? null;
}

function StepsEditor({ steps, all, onChange }: { steps: Step[]; all: Effective[]; onChange: (steps: Step[]) => void }) {
  const [kind, setKind] = useState<Step['do']>('say');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const move = (i: number, d: number) => { const s = [...steps]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j]!, s[i]!]; onChange(s); };
  const add = () => { const s = newStep(kind, a.trim(), b.trim()); if (s) { onChange([...steps, s]); setA(''); setB(''); } };
  const aField = kind === 'run'
    ? <SelectField label="Command" value={a} onChange={setA} options={[{ value: '', label: 'Pick a command…' }, ...all.map((c) => ({ value: c.id, label: `${categoryOf(c.category)?.label} · ${c.label}` }))]} />
    : kind === 'op'
      ? <SelectField label="Operation" value={a} onChange={setA} options={[{ value: '', label: 'Pick an operation…' }, ...OP_NAMES.map((o) => ({ value: o, label: o }))]} />
      : <TextField label={kind === 'wait' ? 'Seconds' : kind === 'action' ? 'Action (e.g. tasks.open:today)' : kind === 'say' ? 'Words' : kind === 'ask' || kind === 'confirm' ? 'Question' : kind === 'ai' ? 'Prompt ({slot} fills in)' : 'Task'} value={a} onChange={setA} />;
  return (
    <div className="fx-stack">
      <ol className="axp-cmd-steps">
        {steps.map((s, i) => (
          <li key={i} className="axp-cmd-steps__row">
            <span className="axp-cmd-steps__text">{describeStep(s)}</span>
            <IconButton icon="chevron-up" label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="chevron-down" label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="trash" label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <div className="axp-cmd-addstep">
        <SelectField label="Add a step" value={kind} onChange={(v) => setKind(v as Step['do'])} options={STEP_KINDS} />
        {aField}
        {(kind === 'ask' || kind === 'op') && <TextField label={kind === 'ask' ? 'Keep the answer as (slot)' : 'Arguments (item=last; list={list})'} value={b} onChange={setB} />}
        <div><Button size="sm" icon="plus" disabled={!a.trim()} onClick={add}>Add step</Button></div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the opened row */

function Detail({ cmd, all }: { cmd: Effective; all: Effective[] }) {
  const rt = useRuntime();
  const [phrases, setPhrases] = useState(cmd.phrases.filter((p) => !cmd.recordings.some((r) => r.phrase === p)).join(', '));
  const [reply, setReply] = useState(cmd.settings?.reply ?? '');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  useEffect(() => { setReply(cmd.settings?.reply ?? ''); }, [cmd.settings?.reply]);
  const cat = categoryOf(cmd.category)!;
  const isMine = cmd.id.startsWith('mine.');
  const setting = (k: keyof CommandSettings, v: boolean | string) => patchCommand(rt, cmd.id, { settings: { ...overridesOf(rt)[cmd.id]?.settings, [k]: v } });
  const saveSteps = (steps: Step[]) => {
    if (isMine) saveCustom(rt, customOf(rt).map((c) => (c.id === cmd.id ? { ...c, steps } : c)));
    else patchCommand(rt, cmd.id, { steps });
  };
  const savePhrases = () => {
    const list = phrases.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    if (!list.length) return;
    if (isMine) saveCustom(rt, customOf(rt).map((c) => (c.id === cmd.id ? { ...c, phrases: list } : c)));
    else patchCommand(rt, cmd.id, { phrases: list });
  };
  const addRecording = (phrase: string) => {
    const cur = overridesOf(rt)[cmd.id]?.recordings ?? [];
    patchCommand(rt, cmd.id, { recordings: [...cur.filter((r) => r.phrase !== phrase), { phrase: phrase.toLowerCase(), at: new Date().toISOString() }].slice(-6) });
  };
  const voiceEdit = async () => {
    setBusy('Listening…');
    const r = await editChain({ ask: (q) => askAloud(rt, q), say: (t) => speak(rt, t) }, cmd, all);
    if (r) saveSteps(r.steps);
    setBusy('');
  };
  const duplicate = () => {
    const ids = new Set(all.map((c) => c.id));
    let id = `mine.${cmd.id.split('.').pop()}`; let n = 2;
    while (ids.has(id)) id = `mine.${cmd.id.split('.').pop()}-${n++}`;
    saveCustom(rt, [...customOf(rt), { id, category: cmd.category, kind: cmd.kind === 'action' ? 'chain' : cmd.kind, group: 'Yours', label: `${cmd.label} (mine)`, description: cmd.description, phrases: [`my ${cmd.phrases[0] ?? cmd.label.toLowerCase()}`], steps: cmd.steps, settings: cmd.settings }]);
    rt.toast(`Copied as “${cmd.label} (mine)”: find it under Yours.`, 'success', 'Commands');
  };
  return (
    <div className="fx-stack axp-cmd-detail">
      <p>{cmd.description}</p>
      <p className="fx-muted">Say <b>“{cmd.phrases[0]}”</b>{cmd.phrases.length > 1 ? ` (or ${cmd.phrases.length - 1} other way${cmd.phrases.length > 2 ? 's' : ''})` : ''}. Start with “{cat.triggers[0]}” to aim it at {cat.label} only.
        {Object.keys(cmd.slots ?? {}).length > 0 && <> Words in braces are what you fill in: {Object.keys(cmd.slots ?? {}).map((s) => `{${s}}`).join(', ')}.</>}</p>
      <div className="axp-cmd-detail__cols">
        <Container title="Phrases" icon="mic" actions={<Button size="sm" icon="mic" onClick={() => setRecording(!recording)}>{recording ? 'Close' : 'Record'}</Button>}>
          <div className="fx-stack">
            {recording && <RecordPhrase cmd={cmd} all={all} onSave={addRecording} onClose={() => setRecording(false)} />}
            <TextField label="Phrases" hint="Comma separated. {slot} = a word or words you fill in." value={phrases} onChange={setPhrases} />
            {cmd.recordings.length > 0 && (
              <div className="fx-row fx-row--wrap">
                {cmd.recordings.map((r) => (
                  <span key={r.phrase} className="axp-cmd-rec"><Chip tone="accent">🎙 {r.phrase}</Chip>
                    <IconButton icon="x" label={`Forget the recording “${r.phrase}”`} onClick={() => patchCommand(rt, cmd.id, { recordings: cmd.recordings.filter((x) => x.phrase !== r.phrase) })} /></span>
                ))}
              </div>
            )}
            <div><Button size="sm" tone="primary" onClick={savePhrases}>Save phrases</Button></div>
          </div>
        </Container>
        <Container title="Settings" icon="settings">
          <div className="fx-stack">
            <Switch label="Ask before running" checked={!!cmd.settings?.confirm} onChange={(v) => setting('confirm', v)} />
            <Switch label="Answer out loud" checked={cmd.settings?.speak !== false} onChange={(v) => setting('speak', v)} />
            <Switch label={`Only while ${cat.label} is on screen`} checked={!!cmd.settings?.onlyOnPage} onChange={(v) => setting('onlyOnPage', v)} />
            <TextField label="Say when done" hint="Empty = the command's own answer. {slot} fills in." value={reply} onChange={setReply} />
            <div><Button size="sm" onClick={() => setting('reply', reply)}>Save reply</Button></div>
          </div>
        </Container>
      </div>
      <Container title={cmd.kind === 'action' ? 'What it does' : `Steps (${cmd.steps.length})`} icon="list"
        actions={cmd.kind !== 'action' ? <Button size="sm" icon="mic" disabled={!!busy} onClick={() => void voiceEdit()}>{busy || 'Edit by voice'}</Button> : undefined}>
        {cmd.kind === 'action'
          ? <ol className="axp-cmd-steps">{cmd.steps.map((s, i) => <li key={i} className="axp-cmd-steps__row"><span className="axp-cmd-steps__text">{describeStep(s)}</span></li>)}</ol>
          : <StepsEditor steps={cmd.steps} all={all} onChange={saveSteps} />}
      </Container>
      <div className="fx-row fx-row--wrap">
        <Button icon="play" tone="primary" disabled={Object.keys(cmd.slots ?? {}).length > 0 && cmd.kind === 'action'} onClick={() => void run(rt, cmd)}>Run now</Button>
        <Button icon="copy" tone="quiet" onClick={duplicate}>Copy as mine</Button>
        {!isMine && <Button icon="undo" tone="quiet" disabled={!cmd.edited} confirm={`Put “${cmd.label}” back to how it shipped?`} undoable={false}
          onClick={() => saveOverrides(rt, resetOverride(overridesOf(rt), cmd.id))}>Back to default</Button>}
        {isMine && <Button icon="trash" tone="danger" confirm={`Delete “${cmd.label}”?`} onClick={() => { saveCustom(rt, customOf(rt).filter((c) => c.id !== cmd.id)); saveOverrides(rt, resetOverride(overridesOf(rt), cmd.id)); }}>Delete</Button>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the grid */

const W = { wide: 'minmax(calc(var(--fx-space) * 14), 3fr)', mid: 'minmax(calc(var(--fx-space) * 10), 2fr)', narrow: 'calc(var(--fx-space) * 6)', small: 'calc(var(--fx-space) * 9)' } as const;
const STATES = [{ value: '', label: 'All' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'edited', label: 'Changed' }, { value: 'custom', label: 'Yours' }];
const SORT_COL: Record<string, SortKey> = { label: 'label', say: 'phrase', group: 'group', kind: 'kind', on: 'on' };

const narrowQuery = '(max-width: 640px)';
const useNarrow = () => useSyncExternalStore(
  (f) => { const m = globalThis.matchMedia?.(narrowQuery); m?.addEventListener?.('change', f); return () => m?.removeEventListener?.('change', f); },
  () => !!globalThis.matchMedia?.(narrowQuery).matches,
);

function Grid({ list, all, gridId, chains }: { list: Effective[]; all: Effective[]; gridId: string; chains: boolean }) {
  const rt = useRuntime();
  const narrow = useNarrow();
  const [open, setOpen] = useState<string[]>([]);
  const [sort, setSort] = useState<GridSort>({ col: 'group', dir: 1 });
  const toggle = (id: string) => setOpen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const sorted = sort ? sortCommands(list, SORT_COL[sort.col] ?? 'label', sort.dir === 1 ? 'asc' : 'desc') : list;
  const columns: GridColumn<Effective>[] = [
    { id: 'on', label: 'On', width: W.narrow, fixed: true, sortable: true, render: (c) => <span onClick={(e) => e.stopPropagation()}><Switch label={`Listen for ${c.label}`} hideLabel checked={c.on} onChange={(on) => patchCommand(rt, c.id, { on })} /></span> },
    { id: 'label', label: 'Command', width: W.mid, fixed: true, sortable: true, render: (c) => <span className="axp-cmd-label">{c.label}{c.edited && <> <Chip>changed</Chip></>}{c.custom && <> <Chip tone="accent">yours</Chip></>}</span> },
    { id: 'say', label: 'Say', width: W.wide, sortable: true, render: (c) => <span className="fx-muted">“{c.phrases[0]}”{c.phrases.length > 1 ? ` +${c.phrases.length - 1}` : ''}</span> },
    { id: 'kind', label: 'Kind', width: W.small, sortable: true, render: (c) => <Chip tone={c.kind === 'wizard' ? 'warning' : c.kind === 'chain' ? 'accent' : undefined}>{c.kind}</Chip> },
    { id: 'group', label: 'Group', width: W.small, sortable: true, render: (c) => <span className="fx-muted">{c.group}</span> },
  ];
  const groups: GridGroup<Effective>[] = sort?.col === 'group'
    ? groupsOf(sorted).map((g) => { const rows = sorted.filter((c) => c.group === g); return { id: g, title: `${g} (${rows.filter((c) => c.on).length}/${rows.length} on)`, rows, groups: [] }; })
    : [{ id: 'all', title: `${sorted.length} command${sorted.length === 1 ? '' : 's'}`, rows: sorted, groups: [], fixed: true }];
  const hidden = [...(chains ? [] : ['kind']), ...(sort?.col === 'group' ? ['group'] : []), ...(narrow ? ['say'] : [])];
  if (!list.length) return <div className="fx-empty axp-cmd-empty"><Icon name="search" size={24} /><p className="fx-muted">Nothing matches. Clear the search or the filters.</p></div>;
  return (
    <DataGrid<Effective> id={gridId} label="Voice commands" groups={groups} columns={columns} rowId={(c) => c.id} rowLabel={(c) => c.label} hidden={hidden}
      sort={sort} onSort={(col) => setSort(col === null ? null : { col, dir: sort?.col === col ? (sort.dir === 1 ? -1 : 1) : 1 })}
      rowTone={(c) => (c.on ? (c.kind === 'action' ? 'accent' : 'info') : 'muted')} expanded={open} onToggleExpand={toggle} onRowClick={(c) => toggle(c.id)}
      renderDetail={(c) => <Detail key={c.id} cmd={c} all={all} />} />
  );
}

/* ---------------------------------------------------------------- AI not available */

function Unavailable({ cat }: { cat: CategoryId }) {
  const rt = useRuntime();
  const enabled = useAiEnabled();
  const s = useAiStatus();
  const m = useMolly();
  let why: string; let what: ReactNode;
  if (!enabled) {
    why = 'The AI is switched off in this app\'s settings, so nothing is sent to it and these commands can\'t run.';
    what = <><Button tone="primary" icon="zap" onClick={() => rt.dispatch('ai.enable')}>Switch the AI on</Button><Button tone="quiet" icon="settings" onClick={() => rt.dispatch('ai.status.open')}>AI settings</Button></>;
  } else if (!s.ok) {
    why = `The AI isn't answering: ${s.reason || 'not checked yet'}.`;
    what = <>
      <Button tone="primary" icon="sparkles" onClick={() => { const w = allCommands(rt).find((c) => c.id === 'ai.wiz-ai-setup'); if (w) void run(rt, w); else rt.dispatch('ai.status.open'); }}>Set up the AI (wizard)</Button>
      <Button icon="edit" onClick={() => rt.dispatch('ai.status.open')}>Edit the connection</Button>
      <Button tone="quiet" icon="refresh" onClick={() => rt.dispatch('ai.check')}>Check again</Button>
    </>;
  } else {
    why = m.fix === 'token' ? `${m.reason} The AmberX installer copies it from the console; re-running it (or the 5-minute update) connects her.`
      : m.fix === 'admin' ? 'Developer commands drive the console and the VPS, so only hub admins can use them.'
        : `Molly can't be reached: ${m.reason}`;
    what = <>
      <Button tone="primary" icon="refresh" disabled={m.checking} onClick={() => void checkMolly()}>{m.checking ? 'Checking…' : 'Check again'}</Button>
      <Button tone="quiet" icon="settings" onClick={() => rt.dispatch('ai.status.open')}>AI settings</Button>
    </>;
  }
  return (
    <div className="fx-empty axp-cmd-unavailable">
      <Icon name={cat === 'developer' ? 'code' : 'sparkles'} size={28} />
      <h2>{cat === 'developer' ? 'Developer commands need Molly' : 'AI snippets need the AI'}</h2>
      <p className="fx-muted">{why}</p>
      <p className="fx-muted">{allCommands(rt).filter((c) => c.category === cat).length} commands are waiting here; they show up as soon as it's fixed.</p>
      <div className="fx-row fx-row--wrap axp-cmd-unavailable__actions">{what}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- the command center */

type Inner = 'commands' | 'chains';

export function CommandCenter({ start }: { start?: string }) {
  const rt = useRuntime();
  useSetting(rt, K.overrides);
  useSetting(rt, K.custom);
  const enabled = useAiEnabled();
  const ai = useAiStatus();
  const m = useMolly();
  const [cat, setCat] = useState<CategoryId>(CATEGORIES.some((c) => c.id === start) ? (start as CategoryId) : 'notes');
  const [inner, setInner] = useState<Inner>('commands');
  const [f, setF] = useState<GridFilter>({ q: '', group: '', kind: '', state: '' });
  const [recording, setRecording] = useState('');
  useEffect(() => { if (cat === 'developer' && !m.known && !m.checking) void checkMolly(); }, [cat, m.known, m.checking]);
  const all = allCommands(rt);
  const inCat = all.filter((c) => c.category === cat);
  const inTab = inCat.filter((c) => (inner === 'commands' ? c.kind === 'action' : c.kind !== 'action'));
  const shown = filterCommands(inTab, f);
  const available = cat === 'notes' || cat === 'tasks' ? true : cat === 'snippets' ? enabled && ai.ok : enabled && ai.ok && m.ok;
  const info = categoryOf(cat)!;
  const record = async () => {
    setRecording('Listening…');
    const r = await recordChain({ ask: (q) => askAloud(rt, q), say: (t) => speak(rt, t) }, all, { category: cat });
    if (r.ok) { saveCustom(rt, [...customOf(rt), r.command]); setInner('chains'); setF({ ...f, state: 'custom' }); }
    setRecording('');
  };
  return (
    <div className="fx-stack fx-stack--lg axp-cmd">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Voice control</p>
          <h1>Command center</h1>
          <p className="fx-muted">{all.filter((c) => c.on).length} of {all.length} commands listening, in four tabs: start a sentence with a tab's word to aim at it.</p>
        </div>
        <Button icon="mic" onClick={() => rt.dispatch('voice.listen')}>Speak</Button>
      </header>
      <div className="fx-tabs" role="tablist" aria-label="Command tabs">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" role="tab" className={`fx-tab${cat === c.id ? ' is-active' : ''}`} aria-selected={cat === c.id} onClick={() => setCat(c.id)}>
            <Icon name={c.icon} size={14} /> {c.label} <span className="fx-muted">{all.filter((x) => x.category === c.id).length}</span>
          </button>
        ))}
      </div>
      <p className="fx-muted axp-cmd-trigger">{info.description} Trigger: <b>“{info.triggers.slice(0, 3).join('”, “')}”</b>.</p>
      {!available ? <Unavailable cat={cat} /> : (
        <>
          <div className="fx-tabs fx-tabs--sub" role="tablist" aria-label={`${info.label} lists`}>
            {(['commands', 'chains'] as Inner[]).map((t) => (
              <button key={t} type="button" role="tab" className={`fx-tab${inner === t ? ' is-active' : ''}`} aria-selected={inner === t} onClick={() => { setInner(t); setF({ ...f, kind: '', group: '' }); }}>
                {t === 'commands' ? 'Commands' : 'Chains & wizards'} <span className="fx-muted">{inCat.filter((c) => (t === 'commands' ? c.kind === 'action' : c.kind !== 'action')).length}</span>
              </button>
            ))}
          </div>
          <div className="axp-cmd-tools">
            <TextField label="Search" value={f.q ?? ''} onChange={(q) => setF({ ...f, q })} placeholder="what you'd say, or what it does" />
            <SelectField label="Group" value={f.group ?? ''} onChange={(group) => setF({ ...f, group })} options={[{ value: '', label: 'All groups' }, ...groupsOf(inTab).map((g) => ({ value: g, label: g }))]} />
            {inner === 'chains' && <SelectField label="Kind" value={f.kind ?? ''} onChange={(kind) => setF({ ...f, kind: kind as GridFilter['kind'] })} options={[{ value: '', label: 'Chains and wizards' }, { value: 'chain', label: 'Chains' }, { value: 'wizard', label: 'Wizards' }]} />}
            <SelectField label="Show" value={f.state ?? ''} onChange={(state) => setF({ ...f, state: state as GridFilter['state'] })} options={STATES} />
          </div>
          {inner === 'chains' && (
            <div className="fx-row fx-row--wrap">
              <Button tone="primary" icon="mic" disabled={!!recording} onClick={() => void record()}>{recording || 'Record a chain by voice'}</Button>
              <Button icon="plus" onClick={() => {
                const ids = new Set(all.map((c) => c.id)); let n = 1; while (ids.has(`mine.chain-${n}`)) n++;
                saveCustom(rt, [...customOf(rt), { id: `mine.chain-${n}`, category: cat, kind: 'chain', group: 'Yours', label: `My chain ${n}`, description: 'Made in the command center.', phrases: [`my chain ${n}`], steps: [{ do: 'say', text: 'Edit my steps in the command center.' }] }]);
                setF({ ...f, state: 'custom' });
              }}>New chain</Button>
            </div>
          )}
          <div className="axp-cmd-pane" role="region" aria-label={`${info.label} ${inner === 'commands' ? 'commands' : 'chains and wizards'}`} tabIndex={0}>
            <Grid list={shown} all={all} chains={inner === 'chains'} gridId={`amberx-commands-${cat}-${inner}`} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- library */

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const library: AxfWebLibrary = {
  id: ID,
  label: 'Voice command center',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-28' },
  provides: ['amberx.commands'],
  views: { [VIEW]: { title: 'Command center', icon: 'mic', keywords: ['voice', 'commands', 'chains', 'wizards', 'molly', 'snippets', 'developer'], render: () => <CommandCenter /> } },
  nav: { label: 'Voice', items: [{ id: VIEW, label: 'Command center', icon: 'mic', view: VIEW }] },
  dialogs: { [DIALOG]: { title: 'Voice command center', icon: 'mic', render: (p) => <CommandCenter start={str(p.tab)} /> } },
  settingsTabs: [{ id: 'commands', label: 'Command center', icon: 'mic', order: 22, parent: 'plugins', description: 'Notes, tasks, developer and AI-snippet voice commands, chains and wizards.' }],
  settings: [
    { id: 'amberx.commands', label: 'Listening', icon: 'mic', tab: 'commands', order: 10, settings: [
      { key: K.listen, label: 'Use the command center for what you say', kind: 'toggle', default: true },
      { key: K.sure, label: 'How sure before a command beats a note sentence (10 = one word, 20 = two)', kind: 'number', default: 20, min: 0, max: 60, step: 5 },
    ] },
  ],
  contextMenu: [{ id: 'amberx.commands', items: [{ id: 'commands.open', label: 'Voice command center', icon: 'mic', action: 'commands.open' }] }],
  register(rt) {
    rt.actions.register('commands.open', ([tab]) => { if (tab) rt.openDialog(DIALOG, { tab }); else rt.navigate(VIEW); }, { label: 'Open the voice command center' });
    rt.actions.register('commands.run', ([id]) => { const c = allCommands(rt).find((x) => x.id === id); if (c) void run(rt, c); }, { label: 'Run a voice command', params: true, searchable: false });
    registerVoiceRouter(ID, route);
    // the notes store is shared: make sure it's there before the first command
    if (rt.libraries.some((l) => l.id === NOTES_ID)) void loadNotes().catch(() => undefined);
    void checkMolly();
  },
};

export default library;
