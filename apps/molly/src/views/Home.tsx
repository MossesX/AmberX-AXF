import { Button, Container, useAxfState, useRuntime } from '../axf/react';
import { MOLLY_APPS } from '../molly/apps';

/** Molly's start page: the apps it holds, each one a tap away (or open on its own, where it runs unchanged). */
export function Home() {
  const rt = useRuntime();
  useAxfState();
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">One interface</p>
          <h1>Molly</h1>
          <p className="fx-muted">AmberX, axHub and the Dev Console in one place. Each one is still its own app at its own address, and runs the same on its own.</p>
        </div>
      </header>
      <div className="fx-grid">
        {MOLLY_APPS.map((a) => (
          <Container key={a.id} title={a.label} icon={a.icon}>
            <div className="fx-stack">
              <p className="fx-muted">{a.description}</p>
              <div className="fx-row fx-row--wrap">
                <Button tone="primary" icon={a.icon} onClick={() => rt.navigate(a.id)}>Open in Molly</Button>
                <Button icon="external" onClick={() => window.open(a.url, '_blank', 'noopener')}>Open on its own</Button>
              </div>
            </div>
          </Container>
        ))}
      </div>
    </div>
  );
}
