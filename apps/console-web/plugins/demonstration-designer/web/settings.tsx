/**
 * Settings → Plugins → Demonstration Designer: every production setting in categorized collapsible sections (Script,
 * Narration, Stage, Music, Export, Advanced), kept on the server (pitch-settings@1) so the API, MCP and CLI see the same
 * values. How the sections are laid out is a `settings` asset (three ship in ../assets/settings, the UI Review options;
 * the pick is the setting axf.demonstration-designer.settings.view).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Button, Container, Note, SelectField, Slider, Switch, TextField, useRuntime } from '@console/axf/react';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import * as E from '../engine.mjs';
import type { Settings, SettingsPatch } from '../engine.mjs';
import sections from '../assets/settings/demonstration-designer-sections.json';
import wizard from '../assets/settings/demonstration-designer-wizard.json';
import twoColumn from '../assets/settings/demonstration-designer-two-column.json';
import { FOLDER, SETTINGS_VIEW_KEY, loadSettings, saveSettings, useModel } from './model';

export const SETTINGS_ASSETS = [sections, wizard, twoColumn] as const;
type ViewName = 'sections' | 'wizard' | 'two-column';
type SectionId = 'script' | 'narration' | 'stage' | 'music' | 'export' | 'advanced';
const TITLE: Record<SectionId, string> = { script: 'Script', narration: 'Narration', stage: 'Stage', music: 'Music', export: 'Export', advanced: 'Advanced' };
const ICON: Record<SectionId, string> = { script: 'edit', narration: 'mic', stage: 'monitor', music: 'music', export: 'download', advanced: 'settings' };
const ABOUT: Record<SectionId, string> = {
  script: 'What Generate writes: the default length, the product name the logo cards show, the closing call to action, the narrator’s pace the length is fitted to.',
  narration: 'The voice that reads the script and the captions under it.',
  stage: 'How the demo looks on the screen: zoom and pan, the spotlight on each control, the player controls, the logo intro and outro.',
  music: 'Soft synthesised music under the narration (no files; it ducks while the narrator speaks).',
  export: 'The video Export makes: the format asked of the browser, MP4 on the server when ffmpeg is there, how many recordings to keep.',
  advanced: 'The folded Advanced section on the page: the step timeline and record by doing.',
};

function useView(): { view: ViewName; order: SectionId[]; open: Set<SectionId> } {
  const rt = useRuntime();
  const id = useSyncExternalStore((fn) => rt.settings.subscribe(fn), () => String(rt.settings.get(SETTINGS_VIEW_KEY) ?? ''), () => '');
  const asset = SETTINGS_ASSETS.find((a) => a.id === id) ?? sections;
  return { view: asset.data.view as ViewName, order: asset.data.order as SectionId[], open: new Set(asset.data.open as SectionId[]) };
}

function useSave() {
  const [said, setSaid] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = (patch: SettingsPatch, text = 'Saved.') => { setBusy(true); setSaid(null); return saveSettings(patch).then(() => setSaid({ text, bad: false }), (e: Error) => setSaid({ text: e.message, bad: true })).finally(() => setBusy(false)); };
  return { save, busy, note: said ? <Note tone={said.bad ? 'danger' : 'success'}>{said.text}</Note> : null };
}

/* ---------------- sections ---------------- */

function ScriptSection({ s }: { s: Settings }) {
  const { save, busy, note } = useSave();
  const [product, setProduct] = useState(s.script.product);
  const [cta, setCta] = useState(s.script.cta);
  const [wpm, setWpm] = useState(String(s.script.wpm));
  useEffect(() => { setProduct(s.script.product); setCta(s.script.cta); setWpm(String(s.script.wpm)); }, [s.script.product, s.script.cta, s.script.wpm]);
  return (
    <div className="fx-stack">
      <SelectField label="Default length" value={String(s.script.minutes)} onChange={(v) => void save({ script: { minutes: Number(v) } })} options={E.LENGTHS.map((n) => ({ value: String(n), label: `${n} minute${n === 1 ? '' : 's'}` }))} hint="What the page starts on; any pitch can pick another." />
      <Switch label="Benefits first" hint="Sentences that sell (you, one place, never, without…) go before the ones that describe." checked={s.script.benefitsFirst} onChange={(v) => void save({ script: { benefitsFirst: v } })} />
      <TextField label="Product name" value={product} onChange={setProduct} hint="Shown on the logo intro and outro." />
      <TextField label="Call to action" value={cta} onChange={setCta} rows={2} hint="The closing line of every pitch." />
      <TextField label="Narrator pace (words per minute)" type="number" value={wpm} onChange={setWpm} hint="Used to fit the script to the minutes asked for. Default 150." />
      <div className="fx-row"><Button tone="primary" icon="save" busy={busy} onClick={() => void save({ script: { product, cta, wpm: Number(wpm) || s.script.wpm } })}>Save script settings</Button>{note}</div>
    </div>
  );
}

function NarrationSection({ s }: { s: Settings }) {
  const { save, note } = useSave();
  const [voice, setVoice] = useState(s.narration.voice);
  useEffect(() => setVoice(s.narration.voice), [s.narration.voice]);
  const voices = (() => { try { return (globalThis.speechSynthesis?.getVoices() ?? []).filter((v) => /^en/i.test(v.lang)).map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` })); } catch { return []; } })();
  const options = [...E.NARRATORS.map((n) => ({ value: n.value, label: n.label })), ...voices.filter((v) => !E.NARRATORS.some((n) => n.value === v.value))];
  if (voice && !options.some((o) => o.value === voice)) options.push({ value: voice, label: `${voice} (not on this device)` });
  return (
    <div className="fx-stack">
      <SelectField label="Default narrator" value={voice} onChange={(v) => { setVoice(v); void save({ narration: { voice: v } }); }} options={options} hint="A device voice, the default one, or captions only. Each pitch can pick another." />
      <SelectField label="Speed" value={String(s.narration.speed)} onChange={(v) => void save({ narration: { speed: Number(v) } })} options={[{ value: '0.9', label: 'Calm (0.9×)' }, { value: '1', label: 'Normal' }, { value: '1.15', label: 'Brisk (1.15×)' }, { value: '1.3', label: 'Fast (1.3×)' }]} />
      <Switch label="Captions" hint="The words at the bottom of the stage while they are spoken." checked={s.narration.captions} onChange={(v) => void save({ narration: { captions: v } })} />
      <SelectField label="Caption size" value={s.narration.captionSize} onChange={(v) => void save({ narration: { captionSize: v as Settings['narration']['captionSize'] } })} options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
      {note}
    </div>
  );
}

function StageSection({ s }: { s: Settings }) {
  const { save, note } = useSave();
  const [maxZoom, setMaxZoom] = useState(Math.round(s.stage.maxZoom * 100));
  const [logoSeconds, setLogoSeconds] = useState(s.stage.logoSeconds);
  useEffect(() => { setMaxZoom(Math.round(s.stage.maxZoom * 100)); setLogoSeconds(s.stage.logoSeconds); }, [s.stage.maxZoom, s.stage.logoSeconds]);
  useEffect(() => { const t = setTimeout(() => { if (maxZoom !== Math.round(s.stage.maxZoom * 100)) void save({ stage: { maxZoom: maxZoom / 100 } }); }, 500); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxZoom]);
  useEffect(() => { const t = setTimeout(() => { if (logoSeconds !== s.stage.logoSeconds) void save({ stage: { logoSeconds } }); }, 500); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoSeconds]);
  return (
    <div className="fx-stack">
      <Switch label="Zoom and pan" hint="The app zooms in on each highlighted control and glides back for whole screens." checked={s.stage.zoom} onChange={(v) => void save({ stage: { zoom: v } })} />
      <Slider label="Most zoom" value={maxZoom} onChange={setMaxZoom} min={100} max={250} step={5} unit="%" />
      <SelectField label="Highlight" value={s.stage.highlight} onChange={(v) => void save({ stage: { highlight: v as Settings['stage']['highlight'] } })} options={[{ value: 'spotlight', label: 'Spotlight (the rest dims)' }, { value: 'outline', label: 'Outline only' }]} />
      <Switch label="Player controls on the stage" hint="Pause, Back, Next and Stop at the bottom of the stage. Keyboard and voice work either way." checked={s.stage.controls} onChange={(v) => void save({ stage: { controls: v } })} />
      <Switch label="Logo intro" hint="The product mark and the pitch title before the first step." checked={s.stage.logoIntro} onChange={(v) => void save({ stage: { logoIntro: v } })} />
      <Switch label="Logo outro" hint="The product mark and the call to action after the last step." checked={s.stage.logoOutro} onChange={(v) => void save({ stage: { logoOutro: v } })} />
      <Slider label="Logo card seconds" value={logoSeconds} onChange={setLogoSeconds} min={0} max={10} step={0.5} unit=" s" />
      {note}
    </div>
  );
}

function MusicSection({ s }: { s: Settings }) {
  const { save, note } = useSave();
  const [volume, setVolume] = useState(s.music.volume);
  useEffect(() => setVolume(s.music.volume), [s.music.volume]);
  useEffect(() => { const t = setTimeout(() => { if (volume !== s.music.volume) void save({ music: { volume } }); }, 500); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);
  return (
    <div className="fx-stack">
      <Switch label="Background music" hint="Soft chords synthesised in the browser; nothing to download." checked={s.music.on} onChange={(v) => void save({ music: { on: v } })} />
      <Slider label="Music volume" value={volume} onChange={setVolume} min={0} max={100} step={1} unit="%" />
      <SelectField label="Mood" value={s.music.mood} onChange={(v) => void save({ music: { mood: v as Settings['music']['mood'] } })} options={[{ value: 'calm', label: 'Calm' }, { value: 'upbeat', label: 'Upbeat' }, { value: 'minimal', label: 'Minimal' }]} />
      {note}
    </div>
  );
}

function ExportSection({ s }: { s: Settings }) {
  const { save, note } = useSave();
  const [keep, setKeep] = useState(String(s.export.keep));
  useEffect(() => setKeep(String(s.export.keep)), [s.export.keep]);
  return (
    <div className="fx-stack">
      <SelectField label="Recording format" value={s.export.format} onChange={(v) => void save({ export: { format: v as Settings['export']['format'] } })} options={[{ value: 'auto', label: 'Auto (MP4 where the browser can, else WebM)' }, { value: 'mp4', label: 'MP4 when the browser can' }, { value: 'webm', label: 'WebM' }]} />
      <Switch label="Make an MP4 on the server" hint="After an upload, the server transcodes WebM to MP4 with ffmpeg when it has one (AXF_FFMPEG or ffmpeg on the path)." checked={s.export.transcode} onChange={(v) => void save({ export: { transcode: v } })} />
      <TextField label="Recordings to keep" type="number" value={keep} onChange={setKeep} hint="Older recordings and their clips are removed after each upload." />
      <div className="fx-row"><Button tone="primary" icon="save" onClick={() => void save({ export: { keep: Number(keep) || s.export.keep } })}>Save export settings</Button>{note}</div>
    </div>
  );
}

function AdvancedSection({ s }: { s: Settings }) {
  const { save, note } = useSave();
  return (
    <div className="fx-stack">
      <Switch label="Show the Advanced section on the page" hint="The step timeline and record by doing, folded at the bottom of the designer." checked={s.advanced.show} onChange={(v) => void save({ advanced: { show: v } })} />
      {note}
    </div>
  );
}

/* ---------------- the panel ---------------- */

export function SettingsPanel() {
  const m = useModel();
  const { view, order, open } = useView();
  useEffect(() => { void loadSettings(); }, []);
  const s = m.settings;
  const body: Record<SectionId, ReactNode> = { script: <ScriptSection s={s} />, narration: <NarrationSection s={s} />, stage: <StageSection s={s} />, music: <MusicSection s={s} />, export: <ExportSection s={s} />, advanced: <AdvancedSection s={s} /> };
  return (
    <div className={`fx-stack axp-demonstration-designer-settings axp-demonstration-designer-settings--${view}`} data-view={view}>
      {!m.settingsLoaded && <p className="fx-muted">Loading settings…</p>}
      {m.error && <Note tone="warning">{m.error}</Note>}
      <div className="axp-demonstration-designer-settings__grid">
        {order.map((k, i) => (
          <Container key={`${view}-${k}`} title={view === 'wizard' ? `${i + 1}. ${TITLE[k]}` : TITLE[k]} icon={ICON[k]} collapsible defaultOpen={open.has(k)} className="axp-demonstration-designer-settings__section">
            {view !== 'two-column' && <p className="fx-muted axp-demonstration-designer-settings__about">{ABOUT[k]}</p>}
            {body[k]}
          </Container>
        ))}
      </div>
    </div>
  );
}

export function LifecyclePanel() { return <PluginLifecyclePanel folder={FOLDER} />; }
