import { useEffect, useState } from 'react';
import { FRAMEWORK_VERSION } from '../axf/core';
import { Button, Chip, Container, useAxfState, useRuntime } from '../axf/react';
import { api, saveToken, savedToken, type Me } from '../api';

/** Starter view of a web app + FastAPI server behind axHub's sign-in wall. Replace it with your app. */
export function Home({ me, reload }: { me: Me | null; reload: () => void }) {
  const rt = useRuntime();
  useAxfState();
  const [health, setHealth] = useState<string>('…');
  const [hello, setHello] = useState<string>('');
  const [token, setToken] = useState(savedToken());

  useEffect(() => {
    void api<{ ok: boolean; app: string }>('/health').then((r) => setHealth(r.ok ? `ok (${r.data?.app})` : r.error ?? 'unreachable'));
  }, []);

  const callHello = async () => {
    const r = await api<{ message: string }>('/hello');
    setHello(r.ok ? r.data?.message ?? '' : `${r.status}: ${r.error}`);
  };

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AmberX AXF {FRAMEWORK_VERSION} · web + FastAPI behind axHub</p>
          <h1>{rt.manifest.app.name} is ready</h1>
          <p className="fx-muted">
            The web app and its API run in one container on Coolify. Behind axHub's sign-in wall the hub decides who gets in;
            this server checks the hub's signature before trusting who you are.
          </p>
        </div>
      </header>

      <div className="fx-grid">
        <Container title="Who you are" icon="shield">
          {!me && <p className="fx-muted">Asking the server…</p>}
          {me && me.wall && me.user && (
            <div className="fx-row fx-row--wrap">
              <strong>{me.user.name}</strong>
              <Chip tone={me.role === 'admin' ? 'accent' : undefined}>{me.role}</Chip>
              <a className="fx-btn fx-btn--neutral" style={{ textDecoration: 'none' }} href={`${me.hub}/auth/logout`}>Sign out</a>
            </div>
          )}
          {me && !(me.wall && me.user) && (
            <p className="fx-muted">No hub sign-in here (local dev, or the wall is off): the API needs the app token.</p>
          )}
        </Container>

        <Container title="API" icon="terminal">
          <p className="fx-small">Health: <span className="fx-mono">{health}</span></p>
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="play" onClick={() => void callHello()}>Call /api/hello</Button>
            {hello && <span className="fx-mono fx-small">{hello}</span>}
          </div>
          <label className="fx-field">
            App token (only without the wall; stays in this browser)
            <input className="fx-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <Button icon="check" onClick={() => { saveToken(token); reload(); }}>Save token</Button>
        </Container>

        <Container title="Next steps" icon="list">
          <ol className="fx-small" style={{ margin: 0, paddingLeft: 'var(--fx-dens-gap-3xl)' }}>
            <li>Add routes in <code>server/main.py</code> (every /api route goes through <code>auth</code>).</li>
            <li>Add views in <code>src/App.tsx</code>; call them with <code>api()</code> from <code>src/api.ts</code>.</li>
            <li>Deploy: <code>sudo bash deploy/install.sh</code> on the VPS (see README).</li>
          </ol>
        </Container>
      </div>
    </div>
  );
}
