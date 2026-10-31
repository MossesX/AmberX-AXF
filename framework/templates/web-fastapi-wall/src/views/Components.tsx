import { useState } from 'react';
import { Button, Chip, Container, Icon, Slider, useAsset, useRuntime } from '../axf/react';

/** Gallery of every asset-driven component. Swap assets and watch them change. */
export function Components() {
  const rt = useRuntime();
  const button = useAsset('button');
  const slider = useAsset('slider');
  const container = useAsset('container');
  const dialog = useAsset('dialog');
  const popup = useAsset('popup');
  const ctx = useAsset('context-menu');
  const [vol, setVol] = useState(64);
  const [blur, setBlur] = useState(12);
  const [temp, setTemp] = useState(21);

  const swapBtn = (type: Parameters<typeof rt.swap>[0], label: string) => (
    <Button tone="ghost" icon="refresh" onClick={() => rt.swap(type, 'next')} aria-label={`Next ${label}`} title={`Next ${label}`} />
  );

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Component gallery</p>
          <h1>Components</h1>
          <p className="fx-muted">Each section is rendered by a swappable asset. Use the ↻ buttons, the inspector, or right-click anywhere.</p>
        </div>
      </header>

      <Container title={<>Buttons <Chip>{button.name}</Chip></>} icon="zap" actions={swapBtn('button', 'button')}>
        <div className="fx-stack">
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="rocket">Primary</Button>
            <Button icon="save">Neutral</Button>
            <Button tone="danger" icon="trash">Danger</Button>
            <Button tone="ghost" icon="eye">Ghost</Button>
            <Button tone="primary" disabled>Disabled</Button>
          </div>
          <div className="fx-row fx-row--wrap">
            <Button tone="primary" icon="rocket" requires="dev.deploy" onClick={() => rt.dispatch('run.deploy')}>Deploy (dev.deploy)</Button>
            <Button icon="terminal" requires="dev.tools" onClick={() => rt.dispatch('run.build')}>Build (dev.tools)</Button>
            <span className="fx-muted fx-small">← gated by the active UAC policy</span>
          </div>
        </div>
      </Container>

      <Container title={<>Sliders <Chip>{slider.name}</Chip></>} icon="sliders" actions={swapBtn('slider', 'slider')}>
        <div className="fx-grid">
          <Slider label="Volume" value={vol} onChange={setVol} unit="%" />
          <Slider label="Backdrop blur" value={blur} min={0} max={40} onChange={setBlur} unit="px" />
          <Slider label="Temperature" value={temp} min={10} max={30} step={0.5} onChange={setTemp} unit="°C" />
        </div>
      </Container>

      <div className="gallery-stage">
        <div className="fx-row" style={{ marginBottom: 12 }}>
          <Chip tone="accent">{container.name}</Chip>
          <span className="fx-muted fx-small">Containers over a busy background (shows off glass)</span>
          <span className="fx-grow" />
          {swapBtn('container', 'container')}
        </div>
        <div className="fx-grid">
          <Container title="Storage" icon="cloud">
            <div className="gallery-stat"><strong>68%</strong><span className="fx-muted">of 20 GB used</span></div>
            <div className="gallery-bar"><span style={{ width: '68%' }} /></div>
          </Container>
          <Container title="Builds" icon="package" actions={<Chip tone="success">passing</Chip>}>
            <ul className="gallery-list">
              <li><Icon name="check-circle" size={14} className="fx-ok" /> web — 41s</li>
              <li><Icon name="check-circle" size={14} className="fx-ok" /> desktop — 1m 12s</li>
              <li><Icon name="alert" size={14} /> android — queued</li>
            </ul>
          </Container>
          <Container title="Team" icon="user">
            <div className="fx-row fx-row--wrap">
              {['Ana', 'Bo', 'Cy', 'Dee'].map((n) => (
                <span key={n} className="gallery-avatar">{n[0]}</span>
              ))}
              <span className="fx-muted fx-small">4 collaborators</span>
            </div>
          </Container>
        </div>
      </div>

      <div className="fx-grid">
        <Container title={<>Dialogs <Chip>{dialog.name}</Chip></>} icon="box" actions={swapBtn('dialog', 'dialog')}>
          <div className="fx-row fx-row--wrap">
            <Button icon="plus" onClick={() => rt.openDialog('new-file')}>New file</Button>
            <Button icon="info" onClick={() => rt.openDialog('about')}>About</Button>
            <Button tone="danger" icon="trash" onClick={() => rt.dispatch('edit.delete')}>Confirm</Button>
          </div>
        </Container>

        <Container title={<>Popups <Chip>{popup.name}</Chip></>} icon="bell" actions={swapBtn('popup', 'popup')}>
          <div className="fx-row fx-row--wrap">
            <Button icon="info" onClick={() => rt.toast('Background sync is running.', 'info', 'Info')}>Info</Button>
            <Button icon="check" onClick={() => rt.toast('Your changes were saved.', 'success', 'Success')}>Success</Button>
            <Button icon="alert" onClick={() => rt.toast('Storage is almost full.', 'warning', 'Warning')}>Warning</Button>
            <Button icon="x-circle" onClick={() => rt.toast('Deploy failed: token expired.', 'danger', 'Error')}>Error</Button>
          </div>
        </Container>
      </div>

      <Container title={<>Context menu <Chip>{ctx.name}</Chip></>} icon="menu" actions={swapBtn('context-menu', 'context menu')}>
        <div className="gallery-ctx">
          <Icon name="sparkles" size={20} />
          <strong>Right-click (or long-press) anywhere in the app</strong>
          <span className="fx-muted fx-small">Menus are resolved per target — try the nav items and the asset cards too.</span>
        </div>
      </Container>

      <style>{`
        .gallery-stage { position: relative; padding: var(--fx-dens-gap-3xl); border-radius: var(--fx-radius-lg); overflow: hidden;
          background:
            radial-gradient(circle at 15% 20%, color-mix(in srgb, var(--fx-accent) calc(var(--fx-opacity-muted) * 90%), transparent), transparent 45%),
            radial-gradient(circle at 85% 30%, color-mix(in srgb, var(--fx-info) calc(var(--fx-opacity-muted) * 80%), transparent), transparent 45%),
            radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--fx-success) calc(var(--fx-opacity-muted) * 65%), transparent), transparent 50%),
            var(--fx-surface2);
          border: var(--fx-border-w) solid var(--fx-border); }
        .gallery-stat { display: flex; align-items: baseline; gap: var(--fx-dens-gap-xl); }
        .gallery-stat strong { font-family: var(--fx-font-display); font-size: var(--fx-type-scale-2xl); }
        .gallery-bar { height: 6px; border-radius: 99px; background: var(--fx-surface3); overflow: hidden; margin-top: var(--fx-dens-gap-2xl); }
        .gallery-bar span { display: block; height: 100%; background: var(--fx-accent); }
        .gallery-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--fx-dens-gap-lg); font-size: var(--fx-type-scale-md); }
        .gallery-list li { display: flex; align-items: center; gap: var(--fx-dens-gap-xl); }
        .gallery-avatar { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: var(--fx-type-scale-sm);
          background: var(--fx-accent-soft); color: var(--fx-accent); border: 2px solid var(--fx-surface); }
        .gallery-ctx { display: flex; flex-direction: column; align-items: center; gap: var(--fx-dens-gap-lg); text-align: center; padding: var(--fx-dens-gap-4xl) var(--fx-dens-gap-3xl);
          border: 1.5px dashed var(--fx-border); border-radius: var(--fx-radius-md); color: var(--fx-text); }
        .gallery-ctx svg { color: var(--fx-accent); }
      `}</style>
    </div>
  );
}
