/**
 * Hub → Users (hub-console@1 screen `users`): every hub account with its role, permissions and state (hub-users@1).
 * Add an account (a temporary password they replace at first sign-in), save name and email, change the role, pick the
 * permissions apps behind the wall see, set a temporary password, disable / enable, sign out everywhere, delete. The hub
 * keeps the last admin and Brett's own account safe and its words come back as the toast. Who may run what follows the
 * route table: setting a password is Brett's own tap; invite, role, permissions, disable, sign-out and delete confirm
 * (two taps, the second carries the server's token); profile and enable are plain commands.
 */
import { useState } from 'react';
import { Button, Checkbox, Chip, Container, Note, SelectField, TextField } from '@console/axf/react';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, useHubAction } from './controls';

export interface HubUser {
  id: string; username: string; role: string; disabled: boolean; createdAt: string; passwordChangedAt: string; weakPassword: boolean;
  permissions: string[]; name: string; email: string; mustChangePassword: boolean; tempExpired?: boolean;
}
export interface UsersPage { you: string; roles: string[]; passwordMin: number; tempPasswordMin: number; hints: { id: string; label: string }[]; users: HubUser[] }

export function UsersScreen(_props: { screen: HubScreen }) {
  const { data, stale, reload } = useHubRead<UsersPage>('users', {}, 60000);
  const g = data && data.ok ? data : null;
  const [focus, setFocus] = useState('');
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="users">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub</p>
          <h1>Users</h1>
          <p className="fx-muted">Who can sign in to the hub and what each account may open behind its wall.{g ? ` ${g.users.length} account${g.users.length === 1 ? '' : 's'}.` : ''}</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check</Button>
        </div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {g && <AddUser page={g} onDone={(u) => { setFocus(u); void reload(); }} />}
      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && g.users.map((u) => <UserCard key={u.id} user={u} page={g} open={focus === u.username} onDone={() => void reload()} />)}
    </div>
  );
}

function AddUser({ page, onDone }: { page: UsersPage; onDone: (username: string) => void }) {
  const [f, setF] = useState({ username: '', name: '', email: '', password: '', role: 'user' });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const invite = useHubAction('users', 'invite', undefined, () => { onDone(f.username); setF({ username: '', name: '', email: '', password: '', role: 'user' }); });
  const ready = !!f.username && f.password.length >= (page.tempPasswordMin || 1);
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
          <TapTwice label="Add" again="Tap again to add the account" icon="plus" tone="primary" disabled={invite.busy || !ready} armed={invite.armed}
            onArm={() => void invite.run(f)} onRun={() => void invite.run(f)} />
        </div>
      </div>
    </Container>
  );
}

function UserCard({ user, page, open, onDone }: { user: HubUser; page: UsersPage; open: boolean; onDone: () => void }) {
  const you = user.id === page.you;
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [pw, setPw] = useState('');
  const [perms, setPerms] = useState<string[]>(user.permissions);
  const [extra, setExtra] = useState('');
  const known = new Set(page.hints.map((h) => h.id));
  const others = perms.filter((p) => !known.has(p));
  const toggle = (id: string, on: boolean) => setPerms(on ? [...perms, id] : perms.filter((p) => p !== id));
  const act = (action: string, after?: () => void) => useHubAction('users', action, user.id, () => { after?.(); onDone(); });
  const profile = act('profile');
  const roleAct = act('role');
  const permsAct = act('permissions');
  const password = act('password', () => setPw(''));
  const enable = act('enable');
  const disable = act('disable');
  const signout = act('signout');
  const del = act('delete');
  const busy = [profile, roleAct, permsAct, password, enable, disable, signout, del].some((a) => a.busy);
  return (
    <Container
      title={`${user.name || user.username}${you ? ' (you)' : ''}`}
      icon="user"
      collapsible
      defaultOpen={open}
      actions={
        <span className="fx-row">
          <Chip tone={user.role === 'admin' ? 'accent' : undefined}>{user.role}</Chip>
          {user.disabled && <Chip tone="danger">disabled</Chip>}
          {user.mustChangePassword && <Chip tone={user.tempExpired ? 'danger' : 'warning'}>{user.tempExpired ? 'temporary password expired' : 'temporary password'}</Chip>}
        </span>
      }
    >
      <div className="fx-stack" data-axf-hub-user={user.id}>
        <p className="fx-muted">
          @{user.username}{user.email ? ` · ${user.email}` : ''} · added {relTime(user.createdAt)} · password changed {relTime(user.passwordChangedAt)}
          {user.weakPassword ? ' · weak password' : ''}
        </p>

        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <div className="fx-row"><Button size="sm" icon="save" disabled={busy || (name === user.name && email === user.email)} onClick={() => void profile.run({ name, email })}>Save name and email</Button></div>

        {!you && (
          <>
            <SelectField label="Role" value={role} onChange={setRole} options={page.roles.map((r) => ({ value: r, label: r }))} />
            <div className="fx-row">
              <TapTwice label="Change role" again={`Tap again: make ${user.username} ${role}`} icon="save" size="sm" disabled={busy || role === user.role} armed={roleAct.armed} onArm={() => void roleAct.run({ role })} onRun={() => void roleAct.run({ role })} />
            </div>
          </>
        )}

        {user.role !== 'admin' && (
          <>
            <p className="fx-eyebrow">Permissions</p>
            {page.hints.map((h) => <Checkbox key={h.id} checked={perms.includes(h.id)} onChange={(on) => toggle(h.id, on)} label={h.label ? `${h.label} (${h.id})` : h.id} />)}
            {others.map((p) => <Checkbox key={p} checked onChange={() => toggle(p, false)} label={p} />)}
            <div className="fx-row fx-row--wrap">
              <TextField label="Another permission" value={extra} onChange={setExtra} placeholder="console.plugin.theme-manager" mono />
              <Button size="sm" icon="plus" disabled={!extra.trim()} onClick={() => { toggle(extra.trim(), true); setExtra(''); }}>Add</Button>
            </div>
            <div className="fx-row">
              <TapTwice label="Save permissions" again="Tap again to save the permissions" icon="save" size="sm" disabled={busy} armed={permsAct.armed} onArm={() => void permsAct.run({ permissions: perms })} onRun={() => void permsAct.run({ permissions: perms })} />
            </div>
          </>
        )}

        {!you && (
          <>
            <TextField label="Set a temporary password" type="password" value={pw} onChange={setPw} autoComplete="new-password"
              hint={`At least ${user.role === 'admin' ? page.passwordMin : page.tempPasswordMin} characters. They pick their own at next sign-in. Your own tap only.`} />
            <div className="fx-row"><Button size="sm" icon="key" disabled={busy || !pw} onClick={() => void password.run({ password: pw })}>Set password</Button></div>
          </>
        )}

        <div className="fx-row fx-row--wrap">
          {!you && (user.disabled
            ? <Button size="sm" icon="check" disabled={busy} onClick={() => void enable.run()}>Enable</Button>
            : <TapTwice size="sm" icon="lock" label="Disable" again="Tap again to disable" disabled={busy} armed={disable.armed} onArm={() => void disable.run()} onRun={() => void disable.run()} />)}
          <TapTwice size="sm" icon="logout" label={you ? 'Sign out my other browsers' : 'Sign out everywhere'} again="Tap again to sign out" disabled={busy} armed={signout.armed} onArm={() => void signout.run()} onRun={() => void signout.run()} />
          {!you && <TapTwice size="sm" tone="danger" icon="trash" label="Delete" again="Tap again to delete" disabled={busy} armed={del.armed} onArm={() => void del.run({ sure: true }, 'DELETE')} onRun={() => void del.run({ sure: true }, 'DELETE')} />}
        </div>
      </div>
    </Container>
  );
}
