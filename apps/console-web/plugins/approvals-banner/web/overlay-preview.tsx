/**
 * Overlay toolbar preview: the AmberX phone overlay drawn in the console with the current skin, inside a phone frame,
 * so Brett sees it before the APK exists. Three design options (pill, rail, bubble) in three states (collapsed, an
 * approval waiting, expanded full screen with the toolbar docked top-left and the browser Amber drives). Nothing here
 * talks to axHub: Deny / Approve and the links only move the preview between its states.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Icon, IconButton, TabGroup } from '@console/axf/react';
import { clock, optionSpec, PREVIEW_OPTIONS, PREVIEW_STATES, SAMPLE_CALL, SAMPLE_PAGE, type PreviewOption, type PreviewState } from './overlay-preview-model';
import './overlay-preview.css';

const B = 'axp-overlay-preview';

/** The held call's countdown: runs while an approval is shown, starts again when it is shown anew. */
function useCountdown(running: boolean): number {
  const [left, setLeft] = useState<number>(SAMPLE_CALL.seconds);
  useEffect(() => {
    if (!running) { setLeft(SAMPLE_CALL.seconds); return; }
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return left;
}

/** The toolbar's buttons; `waiting` puts the count on the approvals button. */
function ToolbarButtons({ waiting, expanded, go }: { waiting: number; expanded: boolean; go: (s: PreviewState) => void }) {
  return (
    <>
      <span className={`${B}__grip`} aria-hidden="true"><Icon name="grip" size={14} /></span>
      <IconButton icon="mic" label="Talk to Amber (preview)" />
      <span className={`${B}__badged`}>
        <IconButton icon="shield" label="Approvals (preview)" onClick={() => go(waiting ? 'approval' : 'collapsed')} />
        {waiting > 0 && <span className={`${B}__badge`} aria-label={`${waiting} waiting`}>{waiting}</span>}
      </span>
      {expanded
        ? <IconButton icon="minimize" label="Back to the toolbar (preview)" onClick={() => go('collapsed')} />
        : <IconButton icon="maximize" label="Open the browser (preview)" onClick={() => go('expanded')} />}
    </>
  );
}

function Toolbar({ option, state, go }: { option: PreviewOption; state: PreviewState; go: (s: PreviewState) => void }) {
  const waiting = state === 'approval' ? 1 : 0;
  const expanded = state === 'expanded';
  const cls = `${B}__bar ${B}__bar--${option} is-${state}`;
  if (option === 'bubble') {
    return (
      <div className={cls} role="toolbar" aria-label="Overlay toolbar preview">
        <span className={`${B}__badged ${B}__bubble`}>
          <IconButton icon="sparkles" size={20} label="Amber (preview)" onClick={() => go(expanded ? 'collapsed' : 'expanded')} />
          {waiting > 0 && <span className={`${B}__badge`} aria-label={`${waiting} waiting`}>{waiting}</span>}
        </span>
        {expanded && (
          <span className={`${B}__fan`}>
            <IconButton icon="mic" label="Talk to Amber (preview)" />
            <IconButton icon="shield" label="Approvals (preview)" />
            <IconButton icon="minimize" label="Back to the toolbar (preview)" onClick={() => go('collapsed')} />
          </span>
        )}
      </div>
    );
  }
  return <div className={cls} role="toolbar" aria-label="Overlay toolbar preview"><ToolbarButtons waiting={waiting} expanded={expanded} go={go} /></div>;
}

/** The approval card / bar; where it sits and its shape come from the option. */
function ApprovalBar({ option, left, go }: { option: PreviewOption; left: number; go: (s: PreviewState) => void }) {
  const pct = Math.round((left / SAMPLE_CALL.seconds) * 100);
  const urgent = left <= 30;
  return (
    <section className={`${B}__approval ${B}__approval--${option}`} aria-label="Approval waiting (preview)">
      <div className={`${B}__approval-head`}>
        <Icon name="shield" size={16} />
        <strong className={`${B}__approval-title`}>{SAMPLE_CALL.title}</strong>
        <span className={`${B}__count${urgent ? ' is-urgent' : ''}`} aria-label={`Runs in ${clock(left)}`}>{clock(left)}</span>
      </div>
      {option !== 'bubble' && <p className={`${B}__why`}>{SAMPLE_CALL.why}</p>}
      <code className={`${B}__cmd`}>{SAMPLE_CALL.command}</code>
      <div className={`${B}__meter${urgent ? ' is-urgent' : ''}`} aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div className={`${B}__acts`}>
        <Button tone="danger" icon="x-circle" aria-label="Deny (preview)" onClick={() => go('collapsed')}>Deny</Button>
        <Button tone="success" icon="play" aria-label="Approve (preview)" onClick={() => go('collapsed')}>Approve</Button>
      </div>
      <Button tone="quiet" size="sm" icon="external" className={`${B}__link`} aria-label="Open approvals page (preview)" onClick={() => go('expanded')}>Open approvals page</Button>
    </section>
  );
}

/** The full-screen browser Amber drives (expanded state). */
function Browser({ option, toolbar }: { option: PreviewOption; toolbar: ReactNode }) {
  return (
    <div className={`${B}__browser ${B}__browser--${option}`}>
      {option === 'bubble' && <div className={`${B}__chrome-top`}>{toolbar}</div>}
      <div className={`${B}__chrome`}>
        {option !== 'bubble' && toolbar}
        <div className={`${B}__address`}><Icon name="lock" size={12} /><span>{SAMPLE_PAGE.url}</span></div>
      </div>
      <div className={`${B}__driving`}><Icon name="sparkles" size={12} /> {SAMPLE_PAGE.doing}</div>
      <div className={`${B}__page`} aria-hidden="true">
        <span className={`${B}__sk ${B}__sk--title`} />
        <span className={`${B}__sk`} /><span className={`${B}__sk ${B}__sk--short`} />
        {/* the card Amber is about to tap is ringed */}
        {[true, false, false, false, false].map((target, i) => <span key={i} className={`${B}__sk ${B}__sk--card${target ? ' is-target' : ''}`} />)}
      </div>
    </div>
  );
}

/** Whatever app is under the overlay: a neutral home screen. */
function HomeScreen() {
  return (
    <div className={`${B}__home`} aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => <span key={i} className={`${B}__app`} />)}
    </div>
  );
}

/** The phone: status bar, the screen under the overlay, the overlay in its state. */
export function OverlayPhone({ option, state, go }: { option: PreviewOption; state: PreviewState; go: (s: PreviewState) => void }) {
  const left = useCountdown(state === 'approval');
  const toolbar = <Toolbar option={option} state={state} go={go} />;
  return (
    <div className={`${B}__phone`} data-option={option} data-state={state}>
      <div className={`${B}__screen`}>
        <div className={`${B}__status`} aria-hidden="true"><span>9:41</span><span className={`${B}__status-icons`}><Icon name="zap" size={12} /><Icon name="cloud" size={12} /></span></div>
        {state === 'expanded' ? <Browser option={option} toolbar={toolbar} /> : (
          <>
            <HomeScreen />
            {toolbar}
            {state === 'approval' && <ApprovalBar option={option} left={left} go={go} />}
          </>
        )}
        <div className={`${B}__navbar`} aria-hidden="true"><span /></div>
      </div>
    </div>
  );
}

/** Settings → Plugins → Overlay → Preview: pick an option and a state, see it on the phone, read its spec. */
export function OverlayPreview() {
  const [option, setOption] = useState<PreviewOption>('pill');
  const [state, setState] = useState<PreviewState>('collapsed');
  const spec = optionSpec(option);
  return (
    <div className={B}>
      <div className={`${B}__controls`} role="toolbar" aria-label="Overlay preview">
        <div className={`${B}__pick`}>
          <span className="fx-eyebrow">Design option</span>
          <TabGroup id="approvals-overlay.preview.option" label="Design option" value={option} onChange={setOption} tabs={PREVIEW_OPTIONS.map((o) => ({ value: o.id, label: o.label }))} />
        </div>
        <div className={`${B}__pick`}>
          <span className="fx-eyebrow">State</span>
          <TabGroup id="approvals-overlay.preview.state" label="Overlay state" value={state} onChange={setState} tabs={PREVIEW_STATES.map((s) => ({ value: s.id, label: s.label }))} />
        </div>
      </div>
      <div className={`${B}__body`}>
        <OverlayPhone option={option} state={state} go={setState} />
        <div className={`${B}__spec`}>
          <h3>{spec.label}</h3>
          <p>{spec.summary}</p>
          <dl>
            {PREVIEW_STATES.map((s) => (
              <div key={s.id} className={s.id === state ? 'is-current' : ''}><dt>{s.label}</dt><dd>{spec.spec[s.id]}</dd></div>
            ))}
          </dl>
          <p className="fx-small">A preview in the console's current skin; the phone draws the same tokens. Nothing here is sent: Deny and Approve only move the preview.</p>
        </div>
      </div>
    </div>
  );
}
