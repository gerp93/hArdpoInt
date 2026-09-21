import type { DashboardMount, MountPanel } from '../../shared/mountSchema';
import { canStartMount, getByPath, resolveHelpText } from '../../shared/mountSchema';

function formatMiB(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}

function formatCell(value: unknown, format?: 'bytes' | 'text'): string {
  if (value == null || value === '') return '—';
  if (format === 'bytes' && typeof value === 'number') {
    return formatMiB(value / (1024 * 1024));
  }
  return String(value);
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? 'status-ok' : 'status-down'}`}>{label}</span>;
}

export function MountCard({
  mount,
  busy,
  embedded,
  onStart,
  onStop,
  onPanelAction,
  onChooseDir,
  onUsePath,
  onEdit,
  onRemove,
}: {
  mount: DashboardMount;
  busy: string | null;
  embedded: boolean;
  onStart: () => void;
  onStop: () => void;
  onPanelAction: (panelId: string, actionId: string, row?: Record<string, unknown>) => void;
  onChooseDir: () => void;
  onUsePath: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const up = mount.reachable === true;
  const startOk = canStartMount(mount);
  const help = resolveHelpText(mount);

  const showStart = Boolean(mount.start) && startOk && !up;
  const showStop = Boolean(mount.stop) && up;

  const launchLabel =
    mount.launch.mode === 'path'
      ? 'PATH'
      : mount.launch.mode === 'folder' && mount.launch.cwd
        ? mount.launch.cwd
        : 'Not set';

  return (
    <div className="service-card">
      <div className="card-header">
        <h3>{mount.name}</h3>
        {mount.reachable != null && (
          <StatusPill ok={mount.reachable} label={mount.reachable ? 'Reachable' : 'Down'} />
        )}
      </div>
      {mount.hostUrl && <p className="card-meta">{mount.hostUrl}</p>}

      <p className="card-meta folder-line">
        Launch from:{' '}
        {mount.launch.mode === 'folder' && mount.launch.cwd ? (
          <code className="install-path">{launchLabel}</code>
        ) : mount.launch.mode === 'path' ? (
          <strong>{launchLabel}</strong>
        ) : (
          <span className="muted">{launchLabel}</span>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={!!busy || embedded}
          title={embedded ? 'Use the Hardpoint desktop window to choose folders' : undefined}
          onClick={onChooseDir}
        >
          {mount.launch.mode === 'folder' ? 'Change folder' : 'Choose folder'}
        </button>
        {mount.launch.mode !== 'path' && (
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onUsePath}>
            Use PATH
          </button>
        )}
      </p>

      {help && (
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {help}
        </p>
      )}

      <div className="btn-row">
        {showStart && (
          <div className="action-with-cmd">
            <button type="button" className="btn" disabled={!!busy} onClick={onStart}>
              Start
            </button>
            <code className="cmd-preview">{mount.start?.preview ?? mount.start?.command}</code>
          </div>
        )}
        {showStop && up && (
          <div className="action-with-cmd">
            <button type="button" className="btn" disabled={!!busy} onClick={onStop}>
              Stop
            </button>
            <code className="cmd-preview">{mount.stop?.preview ?? `port ${mount.stop?.port}`}</code>
          </div>
        )}
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onRemove}>
          Remove
        </button>
      </div>

      {mount.panels.map((panel) => (
        <MountPanelView
          key={panel.id}
          panel={panel}
          mount={mount}
          busy={busy}
          onPanelAction={onPanelAction}
        />
      ))}
    </div>
  );
}

function MountPanelView({
  panel,
  mount,
  busy,
  onPanelAction,
}: {
  panel: MountPanel;
  mount: DashboardMount;
  busy: string | null;
  onPanelAction: (panelId: string, actionId: string, row?: Record<string, unknown>) => void;
}) {
  const data = mount.panelData[panel.id] ?? { rows: [] };
  const rows = data.rows;
  const panelActions = panel.actions.filter((a) => a.scope === 'panel');
  const rowActions = panel.actions.filter((a) => a.scope === 'row');

  return (
    <div className="mount-panel">
      {panelActions.length > 0 && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          {panelActions.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn"
              disabled={
                !!busy || (a.enabledWhen === 'panelHasRows' && rows.length === 0)
              }
              onClick={() => onPanelAction(panel.id, a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <table className="data-table">
        <thead>
          <tr>
            {panel.list.columns.map((c) => (
              <th key={c.header}>{c.header}</th>
            ))}
            {rowActions.length > 0 && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {panel.list.columns.map((c) => (
                <td key={c.header}>{formatCell(getByPath(row, c.from), c.format)}</td>
              ))}
              {rowActions.length > 0 && (
                <td>
                  {rowActions.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="btn btn-sm"
                      disabled={!!busy}
                      onClick={() => onPanelAction(panel.id, a.id, row)}
                    >
                      {a.label}
                    </button>
                  ))}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={panel.list.columns.length + (rowActions.length > 0 ? 1 : 0)}
                className="muted"
              >
                {data.error ?? panel.list.emptyText ?? 'No rows'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
