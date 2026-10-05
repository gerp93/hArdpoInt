import type { McpScanResult, McpServerInfo } from '../../shared/types';

function runningFor(iso: string | null): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function origin(server: McpServerInfo): string {
  if (server.source === 'configured') return `from ${server.declaredIn}`;
  return server.detectedVia === 'launcher'
    ? `started by ${server.client ?? 'an MCP app'}, not in its config`
    : 'detected by its command line';
}

function Row({ server, busy, onStop }: { server: McpServerInfo; busy: boolean; onStop: () => void }) {
  const details = [
    origin(server),
    server.client && server.source === 'configured' ? `started by ${server.client}` : null,
    server.orphaned ? 'its app has closed' : null,
    runningFor(server.startedAt) ? `running ${runningFor(server.startedAt)}` : null,
    server.ports.length > 0 ? server.ports.map((p) => `:${p}`).join(' ') : null,
    server.processCount > 1 ? `${server.processCount} processes` : null,
    `PID ${server.pid}`,
  ].filter(Boolean);

  return (
    <li className="mcp-row" title={server.commandLine}>
      <div className="mcp-main">
        <strong>{server.name}</strong>
        <div className="muted mcp-sub">{details.join(' · ')}</div>
      </div>
      <span className={`status-pill ${server.orphaned ? 'status-down' : 'status-ok'}`}>
        {server.orphaned ? 'Orphaned' : 'In use'}
      </span>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={onStop}>
        Stop
      </button>
    </li>
  );
}

export function McpPanel({
  result,
  busy,
  error,
  onRefresh,
  onStop,
  onStopOrphans,
  onAddConfig,
  onRemoveConfig,
}: {
  result: McpScanResult | null;
  busy: string | null;
  error: string | null;
  onRefresh: () => void;
  onStop: (server: McpServerInfo) => void;
  onStopOrphans: (servers: McpServerInfo[]) => void;
  onAddConfig: () => void;
  onRemoveConfig: (file: string) => void;
}) {
  const running = result?.running ?? [];
  const orphans = running.filter((s) => s.orphaned);
  const idle = (result?.configured ?? []).filter((c) => !c.running);
  const sources = result?.sources ?? [];

  return (
    <section className="card mcp-card">
      <div className="card-header">
        <h2>
          MCP servers
          {running.length > 0 && <span className="muted"> ({running.length})</span>}
        </h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onRefresh}>
            Refresh
          </button>
          {orphans.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => onStopOrphans(orphans)}>
              Stop all orphaned ({orphans.length})
            </button>
          )}
        </div>
      </div>
      <p className="muted mcp-intro">
        Local servers started by apps like Claude Desktop, Claude Code and Cursor. <strong>Orphaned</strong>{' '}
        means the app that started it has exited, so nothing is using it.
      </p>
      {error && <p className="banner banner-error">{error}</p>}

      {result === null ? (
        <p className="muted">Looking…</p>
      ) : running.length === 0 ? (
        <p className="muted">No MCP servers are running.</p>
      ) : (
        <ul className="mcp-list">
          {running.map((server) => (
            <Row key={server.id} server={server} busy={!!busy} onStop={() => onStop(server)} />
          ))}
        </ul>
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

      <details className="mcp-idle">
        <summary className="muted">Where it looks for servers ({sources.filter((s) => s.exists).length} found)</summary>
        <ul>
          {sources.map((s) => (
            <li key={s.path}>
              <strong>{s.label}</strong>{' '}
              <span className="muted">
                {s.exists ? `${s.servers} server${s.servers === 1 ? '' : 's'}` : 'not found on this PC'}
              </span>
              {!s.builtIn && (
                <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => onRemoveConfig(s.path)}>
                  Remove
                </button>
              )}
              <code className="cmd-preview">{s.path}</code>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onAddConfig}>
          Add config file…
        </button>
      </details>
    </section>
  );
}
