/**
 * Your hub account (`#/account`; the hub's old `/auth/account` lands here): name and email, change your password,
 * the browsers signed in as you, sign the others out, and sign this one out. Every write goes through the hub's
 * `/auth/api/account/*` with this browser's session and CSRF value.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '../axf/react';
import { hubPost, signOut, type HubUser } from '../hub/api';
import { relTime } from '../hub/core';
import { HUB } from '../hub/useHub';
import { HubGate, useHubJson } from './hubPage';

interface AccountPage { user: HubUser; passwordMin: number; browsers: { id: string; label: string; lastSeenAt: string; current: boolean }[] }

export function HubAccount() {
  return <HubGate what="your account">{() => <Account />}</HubGate>;
}

function Account() {
  const rt = useRuntime();
  const res = useHubJson<AccountPage>('/auth/api/account');
  const d = res.data;
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown = {}): Promise<boolean> => {
    setBusy(true);
    try { const r = await hubPost<{ message?: string }>(path, body); rt.toast(r.message || 'Saved.', 'success'); void res.reload(); return true; }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); return false; }
    finally { setBusy(false); }
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub account</p>
          <h1>{d ? d.user.name || d.user.username : 'Your account'}</h1>
          {d && <p className="fx-muted">@{d.user.username} · {d.user.role}</p>}
        </div>
        <div className="fx-row">
          <Button icon="logout" disabled={busy} onClick={async () => {
            try { rt.toast(await signOut(), 'info'); location.href = `${HUB}/auth/login`; }
            catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); }
          }}>Sign out</Button>
        </div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && (
        <>
          {d.user.weakPassword && <Note tone="warning">Your password was flagged weak when it was set. Pick a stronger one below.</Note>}
          <Profile user={d.user} busy={busy} onSave={(b) => send('/auth/api/account/profile', b)} />
          <Password min={d.passwordMin} busy={busy} onSave={(b) => send('/auth/api/account/password', b)} />
          <Container title="Signed-in browsers" icon="monitor">
            <div className="fx-stack">
              <table className="fx-table">
                <tbody>
                  {d.browsers.map((b) => (
                    <tr key={b.id}><th>{b.label}</th><td>{b.current ? <Chip tone="success">this browser</Chip> : `last seen ${relTime(b.lastSeenAt)}`}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="fx-row">
                <Button icon="logout" disabled={busy || d.browsers.length < 2} onClick={() => void send('/auth/api/account/signout-others')}>Sign out the others</Button>
              </div>
            </div>
          </Container>
        </>
      )}
    </div>
  );
}

function Profile({ user, busy, onSave }: { user: HubUser; busy: boolean; onSave: (b: { name: string; email: string }) => Promise<boolean> }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  return (
    <Container title="Name and email" icon="user">
      <div className="fx-stack">
        <TextField label="Name" value={name} onChange={setName} autoComplete="name" />
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <div className="fx-row"><Button icon="save" disabled={busy || (name === user.name && email === user.email)} onClick={() => void onSave({ name, email })}>Save</Button></div>
      </div>
    </Container>
  );
}

function Password({ min, busy, onSave }: { min: number; busy: boolean; onSave: (b: { current: string; password: string; confirm: string }) => Promise<boolean> }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <Container title="Change your password" icon="key">
      <div className="fx-stack">
        <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <TextField label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={`At least ${min} characters.`} />
        <TextField label="New password again" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? "They don't match." : undefined} />
        <div className="fx-row">
          <Button tone="primary" icon="key" disabled={busy || !current || !password || mismatch} onClick={async () => {
            if (await onSave({ current, password, confirm })) { setCurrent(''); setPassword(''); setConfirm(''); }
          }}>Change password</Button>
        </div>
      </div>
    </Container>
  );
}
