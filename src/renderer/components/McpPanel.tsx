import type { McpScanResult, McpServerInfo } from '../../shared/types';

function runningFor(iso: string | null): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function Row({
  server,
  busy,
  onStop,
}: {
  server: McpServerInfo;
  busy: boolean;
  onStop: () => void;
}) {
  return (
    <tr>
      <td title={server.commandLine}>
        <strong>{server.name}</strong>
        <div className="muted mcp-sub">
          {server.source === 'configured' ? `from ${server.declaredIn}` : 'detected (not in any app config)'}
          {server.processCount > 1 ? ` · ${server.processCount} processes` : ''} · PID {server.pid}
        </div>
      </td>
      <td>{server.client ?? <span className="muted">none (app closed)</span>}</td>
      <td>{runningFor(server.startedAt)}</td>
      <td>{server.ports.length > 0 ? server.ports.map((p) => `:${p}`).join(' ') : '—'}</td>
      <td>
        <span className={`status-pill ${server.orphaned ? 'status-down' : 'status-ok'}`}>
          {server.orphaned ? 'Orphaned' : 'In use'}
        </span>
      </td>
      <td>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onStop}>
          Stop
        </button>
      </td>
    </tr>
  );
}

export function McpPanel({
  result,
  busy,
  error,
  onRefresh,
  onStop,
  onStopOrphans,
}: {
  result: McpScanResult | null;
  busy: string | null;
  error: string | null;
  onRefresh: () => void;
  onStop: (server: McpServerInfo) => void;
  onStopOrphans: (servers: McpServerInfo[]) => void;
}) {
  const running = result?.running ?? [];
  const orphans = running.filter((s) => s.orphaned);
  const idle = (result?.configured ?? []).filter((c) => !c.running);

  return (
    <section className="card card-fill">
      <div className="card-header">
        <h2>MCP servers</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onRefresh}>
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy || orphans.length === 0}
            onClick={() => onStopOrphans(orphans)}
          >
            Stop all orphaned ({orphans.length})
          </button>
        </div>
      </div>
      <p className="muted">
        Local MCP servers started by apps like Claude Desktop, Claude Code and Cursor. <strong>Orphaned</strong>{' '}
        means the app that started it has exited, so nothing is using it. Stopping a server that is in
        use will show it as disconnected until that app restarts it.
      </p>
      {error && <p className="banner banner-error">{error}</p>}

      {result === null ? (
        <p className="muted">Looking…</p>
      ) : running.length === 0 ? (
        <p className="muted">No MCP servers are running.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Server</th>
              <th>Started by</th>
              <th>Running</th>
              <th>Ports</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {running.map((server) => (
              <Row
                key={server.id}
                server={server}
                busy={!!busy}
                onStop={() => onStop(server)}
              />
            ))}
          </tbody>
        </table>
      )}

      {idle.length > 0 && (
        <details className="mcp-idle">
          <summary className="muted">Set up in your apps but not running ({idle.length})</summary>
          <ul>
            {idle.map((c) => (
              <li key={`${c.declaredIn}-${c.name}`}>
                <strong>{c.name}</strong> <span className="muted">({c.declaredIn})</span>
                <code className="cmd-preview">{c.command}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
