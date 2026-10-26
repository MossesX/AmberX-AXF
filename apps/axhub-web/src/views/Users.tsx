/**
 * Users (admins): every hub account with its role, permissions and state; add one with a temporary password (they
 * pick their own at first sign-in, decision #81), set a temporary password, change name / email / role, pick the
 * permissions apps behind the wall see (`X-Auth-Perms`, decision #79), disable or enable, sign out everywhere, delete.
 * The hub keeps the last admin and your own account safe; its words come back as the toast.
 */
import { useState } from 'react';
import { Button, Checkbox, Chip, Container, Note, SelectField, TextField, useRuntime } from '../axf/react';
import { hubPost, type HubUser } from '../hub/api';
import { relTime } from '../hub/core';
import { HubGate, TapTwice, useHubJson } from './hubPage';

type ListedUser = HubUser & { tempExpired?: boolean };
interface UsersPage { you: string; roles: string[]; passwordMin: number; tempPasswordMin: number; hints: { id: string; label: string }[]; users: ListedUser[] }

export function Users() {
  return <HubGate admin what="users">{() => <UsersList />}</HubGate>;
}

function UsersList() {
  const res = useHubJson<UsersPage>('/auth/api/users');
  const d = res.data;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub</p>
          <h1>Users</h1>
          <p className="fx-muted">Who can sign in to the hub and what each account may open behind its wall.</p>
        </div>
        <div className="fx-row"><Button icon="refresh" onClick={() => void res.reload()}>Check</Button></div>
      </header>
      {res.error && <Note tone="danger" icon="alert">{res.error}</Note>}
      {d && <AddUser page={d} onDone={() => void res.reload()} />}
      {d && d.users.map((u) => <UserCard key={u.id} user={u} page={d} onDone={() => void res.reload()} />)}
    </div>
  );
}

function useSend(onDone: () => void) {
  const rt = useRuntime();
  const [busy, setBusy] = useState(false);
  const send = async (path: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    try { const r = await hubPost<{ message?: string }>(path, body); rt.toast(r.message || 'Saved.', 'success'); onDone(); return true; }
    catch (e) { rt.toast(e instanceof Error ? e.message : String(e), 'danger'); return false; }
    finally { setBusy(false); }
  };
  return { busy, send };
}

function AddUser({ page, onDone }: { page: UsersPage; onDone: () => void }) {
  const { busy, send } = useSend(onDone);
  const [f, setF] = useState({ username: '', name: '', email: '', password: '', role: 'user' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Container title="Add an account" icon="plus" collapsible defaultOpen={false}>
      <div className="fx-stack">
        <TextField label="Username" value={f.username} onChange={set('username')} autoComplete="off" />
        <TextField label="Name" value={f.name} onChange={set('name')} />
        <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        <TextField label="Temporary password" type="password" value={f.password} onChange={set('password')} autoComplete="new-password"
          hint={`At least ${page.tempPasswordMin} characters. They pick their own at first sign-in; it stops working after 3 days.`} />
        <SelectField label="Role" value={f.role} onChange={set('role')} options={page.roles.map((r) => ({ value: r, label: r }))} />
        <div className="fx-row">
          <Button tone="primary" icon="plus" disabled={busy || !f.username || !f.password} onClick={async () => {
            if (await send('/auth/api/users', f)) setF({ username: '', name: '', email: '', password: '', role: 'user' });
          }}>Add</Button>
        </div>
      </div>
    </Container>
  );
}

function UserCard({ user, page, onDone }: { user: ListedUser; page: UsersPage; onDone: () => void }) {
  const { busy, send } = useSend(onDone);
  const you = user.id === page.you;
  const at = (action: string, extra: Record<string, unknown> = {}) => send(`/auth/api/users/${encodeURIComponent(user.id)}`, { action, ...extra });
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<string>(user.role);
  const [pw, setPw] = useState('');
  const [perms, setPerms] = useState<string[]>(user.permissions);
  const [extra, setExtra] = useState('');
  const known = new Set(page.hints.map((h) => h.id));
  const others = perms.filter((p) => !known.has(p));
  const toggle = (id: string, on: boolean) => setPerms(on ? [...perms, id] : perms.filter((p) => p !== id));

  return (
    <Container
      title={`${user.name || user.username}${you ? ' (you)' : ''}`}
      icon="user"
      collapsible
      defaultOpen={false}
      actions={
        <span className="fx-row">
          <Chip tone={user.role === 'admin' ? 'accent' : undefined}>{user.role}</Chip>
          {user.disabled && <Chip tone="danger">disabled</Chip>}
          {user.mustChangePassword && <Chip tone={user.tempExpired ? 'danger' : 'warning'}>{user.tempExpired ? 'temporary password expired' : 'temporary password'}</Chip>}
        </span>
      }
    >
      <div className="fx-stack">
        <p className="fx-muted">
          @{user.username}{user.email ? ` · ${user.email}` : ''} · added {relTime(user.createdAt)} · password changed {relTime(user.passwordChangedAt)}
          {user.weakPassword ? ' · weak password' : ''}
        </p>

        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <div className="fx-row"><Button size="sm" icon="save" disabled={busy} onClick={() => void at('profile', { name, email })}>Save name and email</Button></div>

        {!you && (
          <>
            <SelectField label="Role" value={role} onChange={setRole} options={page.roles.map((r) => ({ value: r, label: r }))} />
            <div className="fx-row"><Button size="sm" icon="save" disabled={busy || role === user.role} onClick={() => void at('role', { role })}>Change role</Button></div>
          </>
        )}

        {user.role !== 'admin' && (
          <>
            <p className="fx-eyebrow">Permissions</p>
            {page.hints.map((h) => (
              <Checkbox key={h.id} checked={perms.includes(h.id)} onChange={(on) => toggle(h.id, on)} label={h.label ? `${h.label} (${h.id})` : h.id} />
            ))}
            {others.map((p) => <Checkbox key={p} checked onChange={() => toggle(p, false)} label={p} />)}
            <div className="fx-row fx-row--wrap">
              <TextField label="Another permission" value={extra} onChange={setExtra} placeholder="console.plugin.theme-manager" mono />
              <Button size="sm" icon="plus" disabled={!extra.trim()} onClick={() => { toggle(extra.trim(), true); setExtra(''); }}>Add</Button>
            </div>
            <div className="fx-row"><Button size="sm" icon="save" disabled={busy} onClick={() => void at('permissions', { permissions: perms })}>Save permissions</Button></div>
          </>
        )}

        {!you && (
          <>
            <TextField label="Set a temporary password" type="password" value={pw} onChange={setPw} autoComplete="new-password"
              hint={`At least ${user.role === 'admin' ? page.passwordMin : page.tempPasswordMin} characters. They pick their own at next sign-in.`} />
            <div className="fx-row"><Button size="sm" icon="key" disabled={busy || !pw} onClick={async () => { if (await at('password', { password: pw })) setPw(''); }}>Set password</Button></div>
          </>
        )}

        <div className="fx-row fx-row--wrap">
          {!you && (user.disabled
            ? <Button size="sm" icon="check" disabled={busy} onClick={() => void at('enable')}>Enable</Button>
            : <TapTwice size="sm" icon="lock" label="Disable" again="Tap again to disable" onConfirm={() => void at('disable')} disabled={busy} />)}
          <Button size="sm" icon="logout" disabled={busy} onClick={() => void at('signout')}>{you ? 'Sign out my other browsers' : 'Sign out everywhere'}</Button>
          {!you && <TapTwice size="sm" tone="danger" icon="trash" label="Delete" again="Tap again to delete" onConfirm={() => void at('delete', { sure: true })} disabled={busy} />}
        </div>
      </div>
    </Container>
  );
}
