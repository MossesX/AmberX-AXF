/*
 * <OriginFor build="<id>" />: "What Brett said" for any view that only knows a build's id (UI Review items, Crew rows,
 * What's New items, PR rows …). Reads the console's /api/builds/<id>/origin once per id and page (build-origin@1).
 * Views that already hold the build record use <BuildOrigin origin={b.origin} /> from the framework directly.
 */
import { useEffect, useState } from 'react';
import { BuildOrigin, originSubtitle } from './axf/react';
import { loadBuildOrigin } from './api';

const cache = new Map<string, Promise<unknown>>();
export function useBuildOrigin(id: string | undefined | null): unknown {
  const [o, setO] = useState<unknown>(null);
  useEffect(() => {
    if (!id) { setO(null); return; }
    let live = true;
    if (!cache.has(id)) cache.set(id, loadBuildOrigin(id));
    void cache.get(id)!.then((x) => { if (live) setO(x); });
    return () => { live = false; };
  }, [id]);
  return o;
}
/** The full block (nothing while loading or when nothing is recorded). */
export function OriginFor({ build }: { build?: string | null }) {
  const o = useBuildOrigin(build);
  return o ? <BuildOrigin origin={o} /> : null;
}
/** Just the first line of what he said, for a row subtitle. */
export function OriginLine({ build }: { build?: string | null }) {
  const s = originSubtitle(useBuildOrigin(build));
  return s ? <span className="axf-origin-sub" title={s}>“{s}”</span> : null;
}
