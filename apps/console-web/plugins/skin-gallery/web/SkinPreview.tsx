/**
 * Live preview: the picked skin drawn in a desktop frame and a phone-width frame side by side. The skin shows through
 * rt.previewSkin, which saves nothing and reaches no other tab; it ends when the screen closes or Use skin saves.
 * A role=toolbar picks Both / Desktop / Phone.
 */
import { Button, Chip, Container, Segmented, TextField } from '@console/axf/react';
import type { SkinRow } from './api';

export type Frame = 'both' | 'desktop' | 'phone';

function Sample({ skin, fallback }: { skin: SkinRow | undefined; fallback: string }) {
  return (
    <div className="fx-stack">
      <p className="fx-eyebrow">Sample</p>
      <h2>{skin?.name ?? fallback}</h2>
      <p className="fx-muted">{skin?.description || 'Tap a skin in the gallery to see it here.'}</p>
      <div className="fx-row"><Button tone="primary" size="sm">Primary</Button><Button size="sm">Neutral</Button><Chip tone="success">Chip</Chip></div>
      <TextField label="Field" value="" onChange={() => undefined} placeholder="Type here" />
    </div>
  );
}

export function SkinPreview({ skin, fallback, frame, onFrame }: { skin: SkinRow | undefined; fallback: string; frame: Frame; onFrame: (f: Frame) => void }) {
  return (
    <Container title={skin ? `Preview: ${skin.name}` : 'Preview'} icon="eye" className="axp-skin-gallery__preview">
      <div role="toolbar" aria-label="Preview size" className="axp-skin-gallery__frames">
        <Segmented label="Preview size" value={frame} onChange={onFrame} options={[
          { value: 'both', label: 'Both', icon: 'columns' },
          { value: 'desktop', label: 'Desktop', icon: 'monitor' },
          { value: 'phone', label: 'Phone', icon: 'smartphone' },
        ]} />
      </div>
      <div className={`axp-skin-gallery__frameset is-${frame}`} data-help="skin-gallery.view">
        {frame !== 'phone' && <div className="axp-skin-gallery__frame is-desktop" aria-label="Desktop preview" data-axf-skin-frame="desktop"><Sample skin={skin} fallback={fallback} /></div>}
        {frame !== 'desktop' && <div className="axp-skin-gallery__frame is-phone" aria-label="Phone preview" data-axf-skin-frame="phone"><Sample skin={skin} fallback={fallback} /></div>}
      </div>
      <p className="fx-muted axp-skin-gallery__msg">Nothing is saved until Use skin.</p>
    </Container>
  );
}
