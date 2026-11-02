/**
 * Manage Claude accounts (AI keys plugin, Brett Nov 2 2026).
 *
 * A dialog listing every saved Claude subscription account in priority order. Each row expands to the account's
 * keys (access token and refresh token, each tested on its own), its email, plan, renewal and last tests, plus
 * Use this one / Rename / Remove. Rows are dragged by their handle (pointer events, so it works by touch on a phone;
 * the up / down buttons and arrow keys do the same) to set the priority the automatic switch follows when an account
 * hits its limit.
 *
 * Add account opens a step-by-step wizard: name it, pick how, follow the commands it shows, paste what it asks for.
 * Every key is checked by the server the moment it is entered (POST /validate) and the wizard won't go on until it
 * passes; the last step authorises the pair (which renews it) and saves it. Framework controls and tokens only.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button, Checkbox, Chip, IconButton, Markdown, Note, Segmented, TextField } from '@console/axf/react';
import { pluginApi } from '@console/plugins';

const api = pluginApi('ai-keys', 'AI keys');

interface Test { ok: boolean; at: number; ms: number; detail?: string; error?: string; steps?: { step: string; ok: boolean; note?: string }[] }
export interface Account {
  id: string; label: string; kind: 'anthropic' | 'claude-code'; hint: string; active: boolean; createdAt: number; lastTest: Test | null;
  pair?: boolean; needsRefresh?: boolean; refreshHint?: string; expiresAt?: number | null; refreshedAt?: number | null;
  refreshError?: { at: number; error: string } | null; subscriptionType?: string | null; email?: string; accountName?: string;
  org?: string; limitedAt?: number | null; accessTest?: Test | null; priority?: number;
}
interface Listing { keys: Account[] }
interface Check { ok: boolean; error: string; email?: string; name?: string; expired?: boolean; detail?: string }

const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleString() : '');
const testLine = (t?: Test | null) => (t ? (t.ok ? `works · ${when(t.at)}` : `failed ${when(t.at)}: ${t.error}`) : 'not tested yet');

/* ------------------------------------------------------------------ list */

function AccountRow({ a, open, onToggle, busy, run, handle, index, count, move }: {
  a: Account; open: boolean; onToggle: () => void; busy: boolean; run: (fn: () => Promise<Listing>) => void;
  handle: { onPointerDown: (e: PointerEvent<HTMLElement>) => void; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
  index: number; count: number; move: (to: number) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const tapped = !!a.limitedAt && !a.active;
  return (
    <li className="fx-card" data-account={a.id}>
      <div className="fx-card__head">
        <span role="button" tabIndex={0} aria-label={`Drag to change the priority of ${a.label} (arrow keys move it)`} title="Drag to set priority"
          className="fx-muted" style={{ touchAction: 'none', cursor: 'grab' }} {...handle}>⠿</span>
        <strong>{a.priority ?? index + 1}.</strong>
        <div className="fx-stack fx-stack--sm fx-grow">
          <span className="fx-row fx-row--wrap">
            <strong>{a.label}</strong>
            {a.active && <Chip tone="success">Active</Chip>}
            {tapped && <Chip tone="warning">Limit hit</Chip>}
            {a.needsRefresh && <Chip tone="danger">Needs refresh token</Chip>}
            {a.subscriptionType && <Chip>{a.subscriptionType}</Chip>}
          </span>
          <span className="fx-small fx-muted">{a.email || 'email not known yet'}</span>
        </div>
        <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label={open ? 'Collapse' : 'Expand'} onClick={onToggle} />
      </div>
      {open && (
        <div className="fx-card__body fx-stack fx-stack--sm">
          <div className="fx-stack fx-stack--sm">
            <span className="fx-row fx-row--wrap">
              <span>Access token <code className="fx-muted">{a.hint}</code></span>
              <Button size="sm" icon="refresh" disabled={busy} onClick={() => run(() => api.post(`keys/${a.id}/test`, { part: 'access' }))}>Test access token</Button>
            </span>
            <span className="fx-small fx-muted">{testLine(a.accessTest)}</span>
          </div>
          <div className="fx-stack fx-stack--sm">
            <span className="fx-row fx-row--wrap">
              <span>Refresh token <code className="fx-muted">{a.refreshHint || 'missing'}</code></span>
              {a.pair && <Button size="sm" icon="refresh" disabled={busy} onClick={() => run(() => api.post(`keys/${a.id}/test`, {}))}>Test the pair</Button>}
            </span>
            <span className="fx-small fx-muted" title="Testing the pair asks Anthropic for a new access token with the refresh token, so it renews both.">{testLine(a.lastTest)} · renews both tokens</span>
            {a.lastTest?.steps && <span className="fx-small fx-muted">{a.lastTest.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.step}`).join(' · ')}</span>}
          </div>
          <span className="fx-small fx-muted">
            {a.accountName ? `${a.accountName} · ` : ''}{a.org ? `${a.org} · ` : ''}added {when(a.createdAt)}
            {a.expiresAt ? ` · access renews ${when(a.expiresAt)}` : ''}{a.limitedAt ? ` · limit hit ${when(a.limitedAt)}` : ''}
          </span>
          {a.refreshError && <Note tone="warning">Couldn't renew it {when(a.refreshError.at)}: {a.refreshError.error}</Note>}
          {name !== null && <TextField label="Name" value={name} onChange={setName} autoFocus />}
          <div className="fx-row fx-row--wrap">
            {!a.active && !a.needsRefresh && <Button size="sm" tone="primary" icon="check" disabled={busy} onClick={() => run(() => api.post('active', { id: a.id }))}>Use this one</Button>}
            {name === null
              ? <Button size="sm" icon="edit" disabled={busy} onClick={() => setName(a.label)}>Rename</Button>
              : <Button size="sm" icon="save" disabled={busy || !name.trim()} onClick={() => { run(() => api.patch(`keys/${a.id}`, { label: name })); setName(null); }}>Save name</Button>}
            <IconButton icon="chevron-up" label="Higher priority" disabled={busy || index === 0} onClick={() => move(index - 1)} />
            <IconButton icon="chevron-down" label="Lower priority" disabled={busy || index === count - 1} onClick={() => move(index + 1)} />
            <Button size="sm" tone="danger" icon="trash" disabled={busy} confirm={`Remove ${a.label}? Its tokens are deleted from the console.`} onClick={() => run(() => api.del(`keys/${a.id}`))}>Remove</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AccountList({ onAdd }: { onAdd: () => void }) {
  const [rows, setRows] = useState<Account[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const order = useRef<string[]>([]);

  const take = (r: Listing) => { const cc = r.keys.filter((k) => k.kind === 'claude-code'); setRows(cc); order.current = cc.map((k) => k.id); };
  const run = (fn: () => Promise<Listing>) => {
    setBusy(true); setError('');
    fn().then(take, (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { run(() => api.call('keys')); }, []);

  const save = (ids: string[]) => run(() => api.post('order', { ids }));
  const reorder = (id: string, to: number) => {
    if (!rows) return null;
    const from = rows.findIndex((r) => r.id === id);
    if (from < 0 || to < 0 || to >= rows.length || from === to) return null;
    const next = rows.filter((r) => r.id !== id);
    next.splice(to, 0, rows[from]!);
    setRows(next.map((r, i) => ({ ...r, priority: i + 1 })));
    return next.map((r) => r.id);
  };
  const move = (id: string, to: number) => { const ids = reorder(id, to); if (ids) save(ids); };

  // Pointer drag on the handle: the row moves as the pointer passes a neighbour's middle; the order is saved on release.
  const startDrag = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (busy) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragId(id);
    let current = order.current.slice();
    const onMove = (ev: globalThis.PointerEvent) => {
      const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-account]') ?? []);
      let to = items.length - 1;
      for (let i = 0; i < items.length; i++) {
        const box = items[i]!.getBoundingClientRect();
        if (ev.clientY < box.top + box.height / 2) { to = i; break; }
      }
      const from = current.indexOf(id);
      if (to !== from) {
        current = current.filter((cid) => cid !== id); current.splice(to, 0, id);
        setRows((rs) => (rs ? current.map((cid, i) => ({ ...rs.find((r) => r.id === cid)!, priority: i + 1 })) : rs));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragId(null);
      if (current.join() !== order.current.join()) save(current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const keyMove = (id: string, index: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(id, index - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(id, index + 1); }
  };

  return (
    <div className="fx-stack">
      <p className="fx-small fx-muted" style={{ margin: 0 }}>
        One account is active at a time; it runs the assistant and every Claude Code session on the VPS. When it hits a usage or
        weekly limit, the next account down the list that still answers takes over. Drag the ⠿ handle to set the order.
      </p>
      {error && <Note tone="danger">{error}</Note>}
      {rows === null ? <p className="fx-muted">Loading…</p> : rows.length === 0
        ? <Note tone="info">No Claude accounts saved yet. Add one; the wizard walks you through it.</Note>
        : (
          <ul ref={listRef} className="fx-stack fx-stack--sm" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-busy={busy}>
            {rows.map((a, i) => (
              <AccountRow key={a.id} a={a} index={i} count={rows.length} busy={busy || (dragId !== null && dragId !== a.id)} run={run}
                open={!!open[a.id] && dragId === null} onToggle={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                handle={{ onPointerDown: startDrag(a.id), onKeyDown: keyMove(a.id, i) }} move={(to) => move(a.id, to)} />
            ))}
          </ul>
        )}
      <div className="fx-row"><Button tone="primary" icon="plus" disabled={busy} onClick={onAdd}>Add account</Button></div>
    </div>
  );
}

/* ---------------------------------------------------------------- wizard */

type How = 'login' | 'tokens';
const STEPS: Record<How, string[]> = {
  login: ['Name', 'How', 'Sign in', 'Paste', 'Save', 'Clean up'],
  tokens: ['Name', 'How', 'Access token', 'Refresh token', 'Clean up'],
};

const SIGN_IN = [
  'Open a terminal on the VPS (console → Terminal, or Moshi). Start a **separate** Claude Code sign-in so the VPS\'s current account isn\'t touched:',
  '```bash\nCLAUDE_CONFIG_DIR=~/.claude-add claude\n```',
  'In Claude Code type:',
  '```\n/login\n```',
  'Pick **Claude account with subscription**. Open the link it shows on your phone, sign in with the account you\'re adding, copy the code and paste it back into the terminal. Then leave Claude Code:',
  '```\n/exit\n```',
].join('\n\n');
const PRINT = [
  'Still on the VPS, print the new sign-in:',
  '```bash\ncat ~/.claude-add/.credentials.json\n```',
  'Copy everything it prints (it starts with `{"claudeAiOauth"`) and paste it below. If the file isn\'t there, run `ls -a ~/.claude-add` and make sure `/login` finished.',
].join('\n\n');
const CLEAN = 'Delete the extra sign-in from the VPS so its tokens don\'t sit around:\n\n```bash\nrm -rf ~/.claude-add\n```';
const TOKENS = 'Have the access token (`sk-ant-oat…`) and refresh token (`sk-ant-ort…`) of the account ready, e.g. from `~/.claude/.credentials.json` on a machine where it is signed in. The access token is checked first, on its own.';

function Wizard({ onClose }: { onClose: (added: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [how, setHow] = useState<How>('login');
  const [label, setLabel] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [creds, setCreds] = useState('');
  const [access, setAccess] = useState('');
  const [refresh, setRefresh] = useState('');
  const [activate, setActivate] = useState(false);
  const [top, setTop] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [saved, setSaved] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const steps = STEPS[how];
  const name = steps[step];

  const go = (n: number) => { setError(''); setStep(n); };
  const validate = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setCheck(null);
    try {
      const r = await api.post<Check>('validate', body);
      setCheck(r);
      if (!r.ok) setError(r.error || 'that didn\'t check out');
      return r.ok;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };
  const saveAccount = async (body: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      const r = await api.post<{ key: Account; keys: Account[] }>('keys', { label: label.trim(), activate, ...body });
      if (top) {
        const ids = r.keys.filter((k) => k.kind === 'claude-code').map((k) => k.id).filter((id) => id !== r.key.id);
        await api.post('order', { ids: [r.key.id, ...ids] });
      }
      const fresh = (await api.call<Listing>('keys')).keys.find((k) => k.id === r.key.id) ?? r.key;
      setSaved(fresh); setCreds(''); setAccess(''); setRefresh('');
      return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  };

  // What "Next" does on each step; nothing moves on until its check passes.
  const next = async () => {
    if (name === 'Name') { if (label.trim()) go(1); else setError('Give the account a name'); return; }
    if (name === 'How') { go(2); return; }
    if (name === 'Sign in') { if (signedIn) go(3); else setError('Tick the box once /login has finished'); return; }
    if (name === 'Paste') { if (await validate({ step: 'credentials', credentials: creds })) go(4); return; }
    if (name === 'Save') { if (await saveAccount({ credentials: creds })) go(5); return; }
    if (name === 'Access token') { if (await validate({ step: 'access', key: access })) go(3); return; }
    if (name === 'Refresh token') { if (await saveAccount({ key: access, refresh })) go(4); return; }
    if (name === 'Clean up') onClose(true);
  };
  const canNext = !busy && (
    name === 'Name' ? !!label.trim() : name === 'Sign in' ? signedIn : name === 'Paste' ? !!creds.trim()
      : name === 'Access token' ? !!access.trim() : name === 'Refresh token' ? !!refresh.trim() : true);
  const nextLabel = busy ? 'Checking…' : name === 'Paste' || name === 'Access token' ? 'Check and continue'
    : name === 'Save' || name === 'Refresh token' ? 'Authorise and save' : name === 'Clean up' ? 'Done' : 'Next';
  const saveOptions = (
    <div className="fx-stack fx-stack--sm">
      <Checkbox label="Make it the active account now" checked={activate} onChange={setActivate} />
      <Checkbox label="Put it at the top of the priority list" checked={top} onChange={setTop} />
    </div>
  );

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap" aria-label="Steps">
        {steps.map((s, i) => <Chip key={s} tone={i === step ? 'accent' : i < step ? 'success' : undefined}>{i < step ? '✓ ' : `${i + 1}. `}{s}</Chip>)}
      </div>

      {name === 'Name' && <TextField label="Account name" value={label} onChange={setLabel} autoFocus placeholder="e.g. Brett's second Max plan" hint="Just for you; the account's email is looked up when it's saved." />}

      {name === 'How' && (
        <div className="fx-stack fx-stack--sm">
          <Segmented<How> label="How do you want to add it?" value={how} onChange={(v) => { setHow(v); setCheck(null); }} options={[
            { value: 'login', label: 'Sign in on the VPS', icon: 'terminal' },
            { value: 'tokens', label: 'I have the tokens', icon: 'key' },
          ]} />
          <p className="fx-small fx-muted" style={{ margin: 0 }}>
            {how === 'login' ? 'Recommended: sign in once in a VPS terminal; the wizard shows every command.' : 'Paste an access token and its refresh token from a machine where the account is signed in.'}
          </p>
        </div>
      )}

      {name === 'Sign in' && <>
        <Markdown text={SIGN_IN} />
        <Checkbox label="/login finished and I'm back at the terminal" checked={signedIn} onChange={setSignedIn} />
      </>}

      {name === 'Paste' && <>
        <Markdown text={PRINT} />
        <TextField label="Contents of .credentials.json" mono rows={5} value={creds} onChange={(v) => { setCreds(v); setCheck(null); }} placeholder='{"claudeAiOauth": {"accessToken": "sk-ant-oat…", "refreshToken": "sk-ant-ort…", …}}' hint="Checked the moment you continue: the access token has to answer. Nothing is saved yet." />
      </>}

      {name === 'Save' && <>
        <Note tone="success">The sign-in checks out{check?.email ? ` for ${check.email}` : ''}{check?.expired ? ' (its access token has expired; the refresh token renews it now)' : ''}.</Note>
        <p className="fx-small fx-muted" style={{ margin: 0 }}>Saving authorises the pair: the refresh token gets a new access token and that one has to answer too. That renews both, so the copy on the VPS stops working, which is why the next step deletes it.</p>
        {saveOptions}
      </>}

      {name === 'Access token' && <>
        <Markdown text={TOKENS} />
        <TextField label="Access token" type="password" mono value={access} onChange={(v) => { setAccess(v); setCheck(null); }} placeholder="sk-ant-oat…" autoFocus hint="Checked on its own the moment you continue. Nothing is saved yet." />
      </>}

      {name === 'Refresh token' && <>
        <Note tone="success">Access token works{check?.email ? ` · ${check.email}` : ''}.</Note>
        <TextField label="Refresh token" type="password" mono value={refresh} onChange={setRefresh} placeholder="sk-ant-ort…" autoFocus hint="Checked by renewing the pair: it has to get a new access token that answers. Only then is the account saved." />
        {saveOptions}
      </>}

      {name === 'Clean up' && <>
        <Note tone="success">{saved ? `Saved ${saved.label}${saved.email ? ` (${saved.email})` : ''}${saved.active ? ' and made it the active account' : ''}.` : 'Saved.'}</Note>
        <Markdown text={how === 'login' ? CLEAN : 'Delete any copy of those tokens you pasted somewhere else; the console has them now.'} />
      </>}

      {error && <Note tone="danger">{error}</Note>}
      <div className="fx-row fx-row--wrap">
        {step > 0 && name !== 'Clean up' && <Button icon="arrow-left" disabled={busy} onClick={() => go(step - 1)}>Back</Button>}
        {name !== 'Clean up' && <Button icon="x" disabled={busy} onClick={() => onClose(false)}>Cancel</Button>}
        <Button tone="primary" icon={name === 'Clean up' ? 'check' : 'arrow-right'} disabled={!canNext} onClick={() => void next()}>{nextLabel}</Button>
      </div>
    </div>
  );
}

/** The Manage Claude accounts dialog: the list, or the add-account wizard in its place. */
export function AccountsDialog() {
  const [adding, setAdding] = useState(false);
  const [round, setRound] = useState(0);
  return adding
    ? <Wizard onClose={() => { setAdding(false); setRound((n) => n + 1); }} />
    : <AccountList key={round} onAdd={() => setAdding(true)} />;
}
