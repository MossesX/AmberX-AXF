import { useEffect, useState } from 'react';
import { Workspace } from '../studio/Workspace';
import { studio } from '../studio/store';

/** The studio view: opens the project list (once), then the IDE workspace. */
export function Studio() {
  const [ready, setReady] = useState(!!studio().get().project);
  useEffect(() => { if (!ready) void studio().boot().then(() => setReady(true)); }, [ready]);
  if (!ready) return <p className="fx-muted">Opening your projects…</p>;
  return <Workspace />;
}
