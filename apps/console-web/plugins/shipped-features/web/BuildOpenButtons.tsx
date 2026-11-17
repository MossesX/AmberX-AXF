/**
 * Fills the `feature.open` slot other plugins offer (the Gate's Pending features and lander rows): the features one
 * build added or changed, each with the shared Open button. Before the build lands: disabled, "not landed yet".
 */
import { useEffect, useState } from 'react';
import { FeatureOpenButton } from './FeatureOpenButton';
import { buildOpenTargets, type OpenTarget } from './open';

export const NOT_LANDED = 'not landed yet';

export function BuildOpenButtons({ build, landed }: { build: string; landed: boolean }) {
  const [features, setFeatures] = useState<OpenTarget[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let on = true;
    buildOpenTargets(build).then((r) => { if (on) setFeatures(r); }, (e: Error) => { if (on) setErr(e.message); });
    return () => { on = false; };
  }, [build, landed]);
  if (err) return <span className="fx-muted">{err}</span>;
  if (!features) return <span className="fx-muted">Loading its features…</span>;
  if (!features.length) return <span className="fx-muted">No features recorded for {build} yet.</span>;
  return (
    <ul className="axp-shipped__buildfeatures">
      {features.map((t) => (
        <li key={t.feature}>
          <span className="axp-shipped__name">{t.name}</span>
          <FeatureOpenButton featureId={t.feature ?? ''} name={t.name ?? ''} target={t} blockedBy={landed ? undefined : NOT_LANDED} />
        </li>
      ))}
    </ul>
  );
}
