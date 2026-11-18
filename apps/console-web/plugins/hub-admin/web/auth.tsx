/**
 * Hub → Auth admin (hub-console@1 screen `auth`): how people and clients sign in to axHub (hub-auth@1). Sign-in rules
 * come from the hub's users page; OAuth clients and API tokens have no admin route on today's hub, so those blocks say
 * so with the route the hub should grow. Creating a token is Brett's own tap and the secret is shown once, never kept by
 * the console; revoking a token and adding or removing an OAuth client confirm.
 */
import { useState } from 'react';
import { Button, Chip, Container, Note, TextField, useRuntime } from '@console/axf/react';
import type { HubScreen } from '@console/axf/core/hub-console.mjs';
import { relTime, useHubRead, UNAVAILABLE_WORDS, type Unavailable } from './data';
import { UnavailableNote } from './approvals';
import { TapTwice, useHubAction } from './controls';

export interface AuthPage {
  signIn: { method: string; roles: string[]; passwordMin: number; tempPasswordMin: number; accounts: number; admins: number; weakPasswords: number };
  clients: { id: string; name: string; redirectUris?: string[]; createdAt?: string; lastUsedAt?: string }[];
  tokens: { id: string; label: string; scopes?: string[]; createdAt?: string; expiresAt?: string; lastUsedAt?: string }[];
  missing: { clients?: Unavailable & { proposed?: string; cli?: string }; tokens?: Unavailable & { proposed?: string; cli?: string } };
}

export function AuthScreen(_props: { screen: HubScreen }) {
  const rt = useRuntime();
  const { data, stale, reload } = useHubRead<AuthPage>('auth', {}, 120000);
  const g = data && data.ok ? data : null;
  const [shown, setShown] = useState<{ label: string; secret: string } | null>(null);
  return (
    <div className="fx-stack fx-stack--lg" data-axf-hub-screen="auth">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">axHub · sign-in</p>
          <h1>Auth admin</h1>
          <p className="fx-muted">How people and clients sign in to the hub. A token is shown once when created and never stored in the console.</p>
        </div>
        <div className="fx-row fx-row--wrap">
          <Button icon="refresh" onClick={() => void reload()}>Check</Button>
          <Button icon="user" onClick={() => rt.dispatch('hub.open:users')}>Users</Button>
        </div>
      </header>
      {data && !data.ok && <UnavailableNote r={data} />}
      {stale && <Note tone="warning">The last read failed ({UNAVAILABLE_WORDS[stale.code] ?? stale.message}); showing the previous answer.</Note>}
      {shown && (
        <Note tone="warning">
          Token <strong>{shown.label}</strong>, shown once: <span className="fx-mono">{shown.secret}</span>. Copy it now; the console does not keep it.
          <span className="fx-row"><Button size="sm" icon="x" onClick={() => setShown(null)}>I have copied it</Button></span>
        </Note>
      )}
      {!data && <p className="fx-muted">Reading the hub…</p>}
      {g && (
        <>
          <Container title="Sign-in methods" icon="lock">
            <table className="fx-table"><tbody>
              <tr><th>Method</th><td>{g.signIn.method}</td></tr>
              <tr><th>Accounts</th><td>{g.signIn.accounts} ({g.signIn.admins} admin{g.signIn.admins === 1 ? '' : 's'}){g.signIn.weakPasswords ? <> · <Chip tone="warning">{g.signIn.weakPasswords} weak password{g.signIn.weakPasswords === 1 ? '' : 's'}</Chip></> : null}</td></tr>
              <tr><th>Password rules</th><td>at least {g.signIn.passwordMin} characters; temporary passwords at least {g.signIn.tempPasswordMin}, replaced at first sign-in</td></tr>
              <tr><th>Roles</th><td>{g.signIn.roles.join(', ')}</td></tr>
            </tbody></table>
          </Container>
          <Tokens g={g} onShown={setShown} onDone={() => void reload()} />
          <Clients g={g} onDone={() => void reload()} />
        </>
      )}
    </div>
  );
}

function MissingNote({ m, what }: { m: Unavailable & { proposed?: string; cli?: string }; what: string }) {
  return (
    <Note tone={m.code === 'hub_missing' ? 'info' : 'warning'}>
      {m.code === 'hub_missing' ? `This hub has no admin route for ${what} yet.` : UNAVAILABLE_WORDS[m.code] ?? m.message}
      {m.proposed ? <> Route to grow on axHub: <span className="fx-mono">{m.proposed}</span>.</> : null}
      {m.cli ? <> Today: <span className="fx-mono">{m.cli}</span></> : null}
    </Note>
  );
}

function Tokens({ g, onShown, onDone }: { g: AuthPage; onShown: (t: { label: string; secret: string }) => void; onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState('');
  const [days, setDays] = useState('90');
  const create = useHubAction('auth', 'token-create', undefined, onDone);
  return (
    <Container title={`API tokens · ${g.tokens.length}`} icon="key" collapsible defaultOpen>
      <div className="fx-stack">
        {g.missing.tokens && <MissingNote m={g.missing.tokens} what="API tokens" />}
        {g.tokens.length > 0 && (
          <table className="fx-table"><tbody>
            {g.tokens.map((t) => <TokenRow key={t.id} t={t} onDone={onDone} />)}
          </tbody></table>
        )}
        <div className="fx-row fx-row--wrap">
          <TextField label="Label" value={label} onChange={setLabel} placeholder="Phone, build runner…" />
          <TextField label="Scopes (comma-separated)" value={scopes} onChange={setScopes} placeholder="read, approvals" />
          <TextField label="Expires in (days)" type="number" value={days} onChange={setDays} />
          <Button tone="primary" icon="plus" disabled={create.busy || !label.trim()} onClick={() => void create.run({ label: label.trim(), scopes: scopes.split(',').map((s) => s.trim()).filter(Boolean), expiresInDays: Number(days) || 90 }).then((r) => { if (r.ok && typeof r.secret === 'string') onShown({ label: label.trim(), secret: r.secret }); })}>Create a token</Button>
        </div>
        <p className="fx-muted fx-small">Creating a token is your own tap; the secret is shown once here and never stored in the console.</p>
      </div>
    </Container>
  );
}

function TokenRow({ t, onDone }: { t: AuthPage['tokens'][number]; onDone: () => void }) {
  const revoke = useHubAction('auth', 'token-revoke', t.id, onDone);
  return (
    <tr>
      <th>{t.label}</th>
      <td>
        <span className="fx-row fx-row--wrap">
          {t.scopes?.length ? <Chip>{t.scopes.join(', ')}</Chip> : null}
          <span className="fx-muted">{t.createdAt ? `made ${relTime(t.createdAt)}` : ''}{t.expiresAt ? ` · expires ${relTime(t.expiresAt)}` : ''}{t.lastUsedAt ? ` · used ${relTime(t.lastUsedAt)}` : ''}</span>
          <TapTwice size="sm" tone="danger" icon="trash" label="Revoke" again="Tap again to revoke" disabled={revoke.busy} armed={revoke.armed} onArm={() => void revoke.run({}, 'DELETE')} onRun={() => void revoke.run({}, 'DELETE')} />
        </span>
      </td>
    </tr>
  );
}

function Clients({ g, onDone }: { g: AuthPage; onDone: () => void }) {
  const [name, setName] = useState('');
  const [uris, setUris] = useState('');
  const add = useHubAction('auth', 'client-add', undefined, onDone);
  return (
    <Container title={`OAuth clients · ${g.clients.length}`} icon="layers" collapsible defaultOpen>
      <div className="fx-stack">
        {g.missing.clients && <MissingNote m={g.missing.clients} what="OAuth clients" />}
        {g.clients.length > 0 && (
          <table className="fx-table"><tbody>
            {g.clients.map((c) => <ClientRow key={c.id} c={c} onDone={onDone} />)}
          </tbody></table>
        )}
        <div className="fx-row fx-row--wrap">
          <TextField label="Client name" value={name} onChange={setName} placeholder="Claude.ai, AmberX…" />
          <TextField label="Redirect URIs (comma-separated)" value={uris} onChange={setUris} placeholder="https://…/callback" />
          <TapTwice tone="primary" icon="plus" label="Add a client" again="Tap again to add the client" disabled={add.busy || !name.trim()} armed={add.armed} onArm={() => void add.run({ name: name.trim(), redirectUris: uris.split(',').map((s) => s.trim()).filter(Boolean) })} onRun={() => void add.run({ name: name.trim(), redirectUris: uris.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
      </div>
    </Container>
  );
}

function ClientRow({ c, onDone }: { c: AuthPage['clients'][number]; onDone: () => void }) {
  const remove = useHubAction('auth', 'client-remove', undefined, onDone);
  return (
    <tr>
      <th>{c.name}</th>
      <td>
        <span className="fx-row fx-row--wrap">
          <span className="fx-mono fx-muted">{c.id}</span>
          {c.redirectUris?.length ? <span className="fx-muted">{c.redirectUris.join(', ')}</span> : null}
          <TapTwice size="sm" tone="danger" icon="trash" label="Remove" again="Tap again to remove" disabled={remove.busy} armed={remove.armed} onArm={() => void remove.run({ id: c.id })} onRun={() => void remove.run({ id: c.id })} />
        </span>
      </td>
    </tr>
  );
}
