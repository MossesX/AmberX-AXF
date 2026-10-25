/**
 * The hub areas this app doesn't manage yet (services, jobs, audit, vault names, users, projects,
 * devices). Each is a real route with a plain note and a link to the hub's own page where one
 * exists, so the navigation matches the AmberX phone app and the screens land one at a time.
 *
 * They wait on the hub's admin API (its roadmap step 4) reaching this browser: a signed-in session
 * plus per-area permissions. Nothing here guesses at an API that isn't there.
 */
import { Button, Container, Note } from '../axf/react';
import { HUB } from '../hub/useHub';

export interface PlannedArea {
  id: string;
  title: string;
  icon: string;
  what: string;
  /** A hub page that already does this, when there is one. */
  hubPath?: string;
  /** What it waits on. */
  waits: string;
}

export const PLANNED: PlannedArea[] = [
  {
    id: 'services',
    title: 'Services',
    icon: 'layers',
    what: 'Every connected service, its tools and their input schemas, and a way to run one with arguments.',
    waits: "the hub's admin API (step 4)",
  },
  {
    id: 'jobs',
    title: 'Jobs',
    icon: 'clock',
    what: 'Long-running calls with their progress, and a way to cancel one.',
    waits: "the hub's admin API (step 4)",
  },
  {
    id: 'audit',
    title: 'Audit log',
    icon: 'list',
    what: 'Who called what, where it went and how it ended. Never arguments or secrets.',
    waits: "the hub's admin API (step 4)",
  },
  {
    id: 'vault',
    title: 'Vault',
    icon: 'lock',
    what: 'The names of stored secrets, and setting or rotating one. Values are write-only by design and never shown.',
    waits: "the hub's admin API (step 4)",
  },
  {
    id: 'users',
    title: 'Users',
    icon: 'user',
    what: 'Accounts, roles and per-user permissions.',
    hubPath: '/auth/admin/users',
    waits: "the hub's admin API (step 4); the hub's own page does this today",
  },
  {
    id: 'projects',
    title: 'Projects',
    icon: 'folder',
    what: "The projects tree the hub serves: each project's Claude files and shared data.",
    waits: "the hub's admin API (step 4)",
  },
  {
    id: 'devices',
    title: 'Devices',
    icon: 'smartphone',
    what: 'Phones and computers connected over the hub protocol, and what each may do.',
    waits: 'the device agent (hub step 6, AXPP)',
  },
];

export function Planned({ area }: { area: PlannedArea }) {
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">Not built yet</p>
          <h1>{area.title}</h1>
          <p className="fx-muted">{area.what}</p>
        </div>
      </header>
      <Container title="What this is waiting on" icon={area.icon}>
        <div className="fx-stack">
          <p className="fx-muted">This screen lands once {area.waits} is ready.</p>
          {area.hubPath && (
            <div className="fx-row fx-row--wrap">
              <Button icon="external" onClick={() => window.open(`${HUB}${area.hubPath}`, '_blank', 'noopener,noreferrer')}>
                Open it on the hub
              </Button>
              <span className="fx-muted">The hub's own page, under its sign-in.</span>
            </div>
          )}
          <Note tone="info" icon="info">
            Approvals and app downloads work now. The rest of the hub is reachable on its own pages meanwhile.
          </Note>
        </div>
      </Container>
    </div>
  );
}
