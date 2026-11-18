/**
 * Hub → Account (hub-console@1 screen `account`): Brett's hub account (hub-account@1): name and email, change the
 * password, the browsers signed in as him with Sign out the others, the linked phone (Phone Connect) and notification
 * preferences (Claude settings). Saving the profile is a command; the password and signing this browser out are his own
 * tap; signing the other browsers out confirms.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '@console/axf/react';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, useHubAction } from './controls';
import type { HubUser } from './users';

export interface AccountPage {
  user: HubUser; passwordMin: number; browsers: { id: string; label: string; lastSeenAt: string; current: boolean }[];
  phone: { available: boolean; paired?: boolean; device?: string; lastSeenAt?: string; note?: string; opens?: string };
  notifications: { opens: string };
}

export function AccountScreen(_props: { screen: HubScreen }) {
  const rt = useRuntime();
  const { data, stale, reload } = useHubRead<AccountPage>('account', {}, 60000);
  const g = data && data.ok ? data : null;
  const signout = useHubAction('account', 'signout', undefined, () => void reload());
  const others = useHubAction('account', 'signout-others', undefined, () => void reload());
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="account">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub account</p>
          <h1>{g ? g.user.name || g.user.username : 'Account'}</h1>
          {g && <p className="fx-muted">@{g.user.username} · {g.user.role}</p>}
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check</Button>
          {g && <Button icon="logout" disabled={signout.busy} onClick={() => void signout.run()}>Sign out</Button>}
        </div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && (
        <>
          {g.user.weakPassword && <Note tone="warning">Your password was flagged weak when it was set. Pick a stronger one below.</Note>}
          <Profile user={g.user} onDone={() => void reload()} />
          <Password min={g.passwordMin} onDone={() => void reload()} />
          <Container title="Signed-in browsers" icon="monitor">
            <div className="fx-stack">
              <table className="fx-table">
                <tbody>
                  {g.browsers.map((b) => (
                    <tr key={b.id}><th>{b.label}</th><td>{b.current ? <Chip tone="success">this browser</Chip> : `last seen ${relTime(b.lastSeenAt)}`}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="fx-row">
                <TapTwice label="Sign out the others" again="Tap again to sign the other browsers out" icon="logout" disabled={others.busy || g.browsers.length < 2} armed={others.armed} onArm={() => void others.run()} onRun={() => void others.run()} />
              </div>
            </div>
          </Container>
          <Container title="Linked phone" icon="smartphone" actions={<Chip tone={g.phone.paired ? 'success' : g.phone.available ? 'warning' : undefined}>{g.phone.paired ? 'paired' : g.phone.available ? 'not paired' : 'Phone Connect not installed'}</Chip>}>
            <div className="fx-stack">
              <p className="fx-muted">{g.phone.paired ? `${g.phone.device ?? 'Your phone'}${g.phone.lastSeenAt ? `, last seen ${relTime(g.phone.lastSeenAt)}` : ''}. Hub notices open the console's Approvals screen on it.` : g.phone.note ?? 'Pair your phone in Phone Connect so hub notices open the console there.'}</p>
              <div className="fx-row"><Button icon="smartphone" onClick={() => rt.dispatch('hub.account.phone')}>Phone Connect</Button></div>
            </div>
          </Container>
          <Container title="Notification preferences" icon="bell">
            <div className="fx-stack">
              <p className="fx-muted">What reaches your phone and when (approvals, veto notices, quiet hours) is set in Claude settings → Notifications; the hub reads the same values.</p>
              <div className="fx-row"><Button icon="bell" onClick={() => rt.dispatch('hub.account.notifications')}>Notification settings</Button></div>
            </div>
          </Container>
        </>
      )}
    </div>
  );
}

function Profile({ user, onDone }: { user: HubUser; onDone: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const profile = useHubAction('account', 'profile', undefined, onDone);
  return (
    <Container title="Name and email" icon="user">
      <div className="fx-stack">
        <TextField label="Name" value={name} onChange={setName} autoComplete="name" />
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <div className="fx-row"><Button icon="save" disabled={profile.busy || (name === user.name && email === user.email)} onClick={() => void profile.run({ name, email })}>Save</Button></div>
      </div>
    </Container>
  );
}

function Password({ min, onDone }: { min: number; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;
  const change = useHubAction('account', 'password', undefined, () => { setCurrent(''); setPassword(''); setConfirm(''); onDone(); });
  return (
    <Container title="Change your password" icon="key">
      <div className="fx-stack">
        <TextField label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <TextField label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={`At least ${min} characters. Your own tap only; the console never stores it.`} />
        <TextField label="New password again" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? 'They do not match.' : undefined} />
        <div className="fx-row">
          <Button tone="primary" icon="key" disabled={change.busy || !current || !password || mismatch} onClick={() => void change.run({ current, password, confirm })}>Change password</Button>
        </div>
      </div>
    </Container>
  );
}
