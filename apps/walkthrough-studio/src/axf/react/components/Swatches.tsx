/**
 * Animated colour swatches (build skin-animations-swatches-skin-switch, Nov 13 2026; Brett: "where can I put some cool
 * animations, like color swatches").
 *
 *  - Swatches   a row of colour chips that waves, ripples or pops on hover, focus or tap (skin cards, theme lists).
 *               Put `data-fx-swatch-host` on a parent (a card button) and hovering the parent plays the row too.
 *  - SwatchFan  the colour picker swatch: picking a colour pops it, fans its shades out and morphs to the new colour.
 *
 * Which animation plays, how fast and how far is the behaviour theme's (motion.swatches / motion.picker /
 * motion.animSpeed / motion.animIntensity, engines/behavior.ts), compiled to the --fx-anim-* tokens and the
 * data-fx-anim-* attributes; framework/ui/axf.css draws it. Nothing moves under reduced motion. The colours are data
 * (a skin's palette, the value being edited), never styling.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { shadesOf } from '../../core/engines/swatches';

type Vars = CSSProperties & Record<`--${string}`, string | number>;

/** Mark an element as playing for one animation run (tap on touch screens, a fresh pick in the picker). */
function usePlay(): [boolean, () => void, () => void] {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => { setPlaying(false); if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const play = useCallback(() => {
    setPlaying(false);
    // restart on the next frame so a second tap replays the animation
    requestAnimationFrame(() => setPlaying(true));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlaying(false), 4000); // safety stop if animationend never fires (animations off)
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [playing, play, stop];
}

export interface SwatchesProps {
  /** the colours, in order (CSS colour values from a palette) */
  colors: string[];
  /** chips touch, one bar with rounded ends (the skin card look) */
  joined?: boolean;
  /** accessible name; the row is decorative (aria-hidden) when absent */
  label?: string;
  className?: string;
}

/** A row of colour chips that ripples or waves on hover or tap. */
export function Swatches({ colors, joined, label, className }: SwatchesProps) {
  const [playing, play, stop] = usePlay();
  return (
    <span
      className={`fx-swatches${joined ? ' fx-swatches--joined' : ''}${className ? ` ${className}` : ''}`}
      data-fx-swatches=""
      data-fx-playing={playing ? '' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onPointerDown={play}
      onAnimationEnd={(e) => { if ((e.target as HTMLElement).dataset.fxLast !== undefined) stop(); }}
    >
      {colors.map((c, i) => (
        <span key={i} className="fx-swatches__chip" data-fx-last={i === colors.length - 1 ? '' : undefined} style={{ background: c, '--axf-swatch-i': i } as Vars} />
      ))}
    </span>
  );
}

export interface SwatchFanProps {
  /** #rrggbb the picker shows */
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** accessible name of the colour input */
  label?: string;
  className?: string;
}

/** The colour picker swatch: a tap opens the system picker; a pick pops the swatch and fans out its shades. */
export function SwatchFan({ value, onChange, disabled, label, className }: SwatchFanProps) {
  const [playing, play, stop] = usePlay();
  const shades = shadesOf(value, 5);
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; play(); } }, [value, play]);
  return (
    <span className={`fx-swatch-fan${className ? ` ${className}` : ''}`} data-fx-swatch-fan="" data-fx-playing={playing ? '' : undefined}>
      <span className="fx-swatch-fan__shades" aria-hidden="true">
        {shades.map((c, i) => (
          <span
            key={i}
            className="fx-swatch-fan__shade"
            data-fx-last={i === shades.length - 1 ? '' : undefined}
            onAnimationEnd={i === shades.length - 1 ? stop : undefined}
            style={{ background: c, '--axf-swatch-i': i, '--axf-swatch-spread': i - (shades.length - 1) / 2 } as Vars}
          />
        ))}
      </span>
      <span className="fx-swatch-fan__main" style={{ background: value }}>
        <input type="color" className="fx-input" aria-label={label ?? 'Pick a colour'} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      </span>
    </span>
  );
}
