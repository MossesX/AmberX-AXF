import { hasPermission, resolvePermissions } from '../../core';
import { useAsset, useAxfState, useRuntime } from '../AxfProvider';
import { Button, Chip, Container } from '../components/Controls';
import { Icon } from '../components/Icon';

/** User account control: simulate roles and inspect the active policy. */
export function AccountView() {
  const rt = useRuntime();
  const state = useAxfState();
  const policy = useAsset('uac-policy');
  const p = policy.data;
  const perms = Object.keys(p.permissions);
  const current = p.roles.find((r) => r.id === state.role);

  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">User account control</p>
          <h1>Account</h1>
          <p className="fx-muted">
            Policy <strong>{policy.name}</strong> — {policy.description} Denied UI is <strong>{p.gating === 'hide' ? 'hidden' : 'shown locked'}</strong>.
          </p>
        </div>
      </header>

      <Container title="Act as role" icon="user">
        <p className="fx-muted" style={{ marginTop: 0 }}>
          Role switching is a demo affordance so you can watch menus, toolbars and buttons re-gate live.
        </p>
        <div className="fx-rolegrid">
          {p.roles.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`fx-rolecard ${r.id === state.role ? 'is-active' : ''}`}
              aria-pressed={r.id === state.role}
              onClick={() => rt.setRole(r.id)}
            >
              <span className="fx-rolecard__top">
                <Icon name={r.id === state.role ? 'check-circle' : 'user'} size={16} />
                <strong>{r.label}</strong>
                {r.id === p.defaultRole && <Chip>default</Chip>}
              </span>
              <span className="fx-muted">{r.description}</span>
            </button>
          ))}
        </div>
      </Container>

      <Container title="Permission matrix" icon="shield">
        <div className="fx-tablewrap">
          <table className="fx-table fx-table--matrix">
            <thead>
              <tr>
                <th>Permission</th>
                {p.roles.map((r) => (
                  <th key={r.id} className={r.id === state.role ? 'is-current' : ''}>{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map((perm) => (
                <tr key={perm}>
                  <td>
                    <span className="fx-mono">{perm}</span>
                    <div className="fx-muted fx-small">{p.permissions[perm]}</div>
                  </td>
                  {p.roles.map((r) => {
                    const ok = hasPermission(resolvePermissions(p, r.id), perm);
                    return (
                      <td key={r.id} className={`fx-cell ${r.id === state.role ? 'is-current' : ''}`}>
                        {ok ? <Icon name="check" size={15} className="fx-ok" /> : <span className="fx-no">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>

      <Container title={`Try it as ${current?.label ?? state.role}`} icon="zap">
        <div className="fx-row fx-row--wrap">
          <Button icon="save" requires="files.write" onClick={() => rt.dispatch('file.save')}>Save file</Button>
          <Button icon="terminal" requires="dev.tools" onClick={() => rt.dispatch('dev.console')}>Dev console</Button>
          <Button icon="rocket" tone="primary" requires="dev.deploy" onClick={() => rt.dispatch('run.deploy')}>Deploy</Button>
          <Button icon="upload" requires="assets.import" onClick={() => rt.openDialog('import-asset')}>Import asset</Button>
          <Button icon="shield" requires="uac.manage" onClick={() => rt.navigate('assets')}>Change policy</Button>
        </div>
      </Container>
    </div>
  );
}
