import { useCallback, useEffect, useState } from 'react';
import type {
  DashboardStatus,
  GpuProcess,
  McpScanResult,
  McpServerInfo,
  UpdateCheckResult,
} from '../../shared/types';
import { hardpointClient, isEmbeddedHttpMode } from '../utils/api';
import { McpPanel } from '../components/McpPanel';
import { ServicesPanel } from '../components/ServicesPanel';

const POLL_MS = 3000;

function formatMiB(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}

type GpuProcTab = 'active' | 'ui';

function formatProcessLine(p: GpuProcess): string {
  const bits = [`PID ${p.pid}`];
  if (p.type) bits.push(p.type);
  if (p.smPercent != null) bits.push(`SM ${p.smPercent}%`);
  if (p.memoryMiB != null) bits.push(formatMiB(p.memoryMiB));
  return `${p.name} (${bits.join(', ')})`;
}

function canKillGpuProcess(p: GpuProcess): boolean {
  return p.kind === 'active' && !/insufficient\s+permissions/i.test(p.name);
}

function GpuProcessTabs({
  processes,
  busy,
  onKill,
}: {
  processes: GpuProcess[];
  busy: string | null;
  onKill: (pid: number) => void;
}) {
  const [tab, setTab] = useState<GpuProcTab>('active');
  const active = processes.filter((p) => p.kind === 'active');
  const ui = processes.filter((p) => p.kind === 'ui');
  const list = tab === 'active' ? active : ui;
  const hint =
    tab === 'active'
      ? 'Real GPU work (models, encode, compute). Kill ends the whole process, not a clean unload. WDDM often hides per-process VRAM.'
      : 'Desktop, browser and overlay clients holding a GPU context for compositing — usually idle.';

  return (
    <div className="gpu-proc-panel">
      <div className="gpu-proc-tabs" role="tablist" aria-label="GPU processes">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={`gpu-proc-tab${tab === 'active' ? ' active' : ''}`}
          onClick={() => setTab('active')}
        >
          Active / compute ({active.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ui'}
          className={`gpu-proc-tab${tab === 'ui' ? ' active' : ''}`}
          onClick={() => setTab('ui')}
        >
          UI &amp; overlays ({ui.length})
        </button>
      </div>
      <p className="muted gpu-proc-hint" title={hint}>
        {hint}
      </p>
      <div className="proc-scroll">
        {list.length > 0 ? (
          <ul className="proc-list">
            {list.map((p) => (
              <li key={p.pid} className="proc-row" title={formatProcessLine(p)}>
                <span className="proc-label">{p.name}</span>
                <span className="proc-meta">
                  PID {p.pid}
                  {p.type ? ` · ${p.type}` : ''}
                  {p.smPercent != null ? ` · SM ${p.smPercent}%` : ''}
                  {p.memoryMiB != null ? ` · ${formatMiB(p.memoryMiB)}` : ''}
                </span>
                <span className="proc-action">
                  {tab === 'active' && canKillGpuProcess(p) && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!!busy}
                      title={`Force-kill PID ${p.pid} (${p.name})`}
                      onClick={() => onKill(p.pid)}
                    >
                      Kill
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted proc-empty">
            {tab === 'active'
              ? 'Nothing classified as active compute right now.'
              : 'No UI / overlay clients reported.'}
          </p>
        )}
      </div>
    </div>
  );
}

type DashTab = 'dashboard' | 'log' | 'mcp' | 'updates';

type UpdateUiStatus = 'idle' | 'checking' | UpdateCheckResult['status'];

export function Dashboard() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateUiStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<DashTab>('dashboard');
  const [mcp, setMcp] = useState<McpScanResult | null>(null);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const embedded = isEmbeddedHttpMode();

  const refresh = useCallback(async () => {
    try {
      const next = await hardpointClient.getStatus();
      setStatus(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const refreshMcp = useCallback(async () => {
    try {
      setMcp(await hardpointClient.listMcpServers());
      setMcpError(null);
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Each scan lists every process, so poll gently unless the MCP tab is open.
  useEffect(() => {
    if (embedded) return;
    void refreshMcp();
    const id = window.setInterval(() => void refreshMcp(), tab === 'mcp' ? 4000 : 20000);
    return () => window.clearInterval(id);
  }, [embedded, tab, refreshMcp]);

  async function stopMcp(servers: McpServerInfo[]) {
    setBusy('mcp-stop');
    try {
      for (const server of servers) {
        const result = await hardpointClient.stopMcpServer(server.pid);
        if (result.status === 'error') throw new Error(result.message);
      }
      setMcpError(null);
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e));
    } finally {
      await refreshMcp();
      setBusy(null);
    }
  }

  useEffect(() => {
    void hardpointClient.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  async function handleCheckForUpdates() {
    setUpdateStatus('checking');
    setUpdateMessage(null);
    try {
      const result = await hardpointClient.checkForUpdates();
      setUpdateStatus(result.status);
      if (result.status === 'available') {
        setUpdateMessage(
          `Version ${result.version} is available — it will download and install on restart.`
        );
      } else if (result.status === 'error' || result.status === 'unsupported') {
        setUpdateMessage(result.message ?? null);
      }
    } catch (e) {
      setUpdateStatus('error');
      setUpdateMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const gpu = status?.gpu;
  const cpu = status?.cpu;
  const vramPct =
    gpu?.memoryUsedMiB != null && gpu?.memoryTotalMiB != null && gpu.memoryTotalMiB > 0
      ? Math.min(100, Math.round((gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100))
      : null;
  const ramPct =
    cpu?.memoryUsedMiB != null && cpu?.memoryTotalMiB != null && cpu.memoryTotalMiB > 0
      ? Math.min(100, Math.round((cpu.memoryUsedMiB / cpu.memoryTotalMiB) * 100))
      : null;

  const mcpOrphans = (mcp?.running ?? []).filter((s) => s.orphaned).length;
  const logCount = status?.commandLog.length ?? 0;
  const logFailed = (status?.commandLog ?? []).some((e) => !e.ok);
  const updateAvailable = updateStatus === 'available';
  const tabs: { id: DashTab; label: string; badge?: string; alert?: boolean }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    {
      id: 'log',
      label: 'Command log',
      badge: logCount > 0 ? String(logCount) : undefined,
      alert: logFailed,
    },
    ...(embedded
      ? []
      : [
          {
            id: 'mcp' as const,
            label: 'MCP servers',
            badge: mcpOrphans > 0 ? String(mcpOrphans) : undefined,
            alert: mcpOrphans > 0,
          },
        ]),
    {
      id: 'updates',
      label: 'Updates',
      badge: updateAvailable ? 'New' : undefined,
      alert: updateAvailable,
    },
  ];

  return (
    <div className="dashboard">
      <nav className="view-tabs" role="tablist" aria-label="Views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`view-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge && <span className={`tab-badge${t.alert ? ' alert' : ''}`}>{t.badge}</span>}
          </button>
        ))}
      </nav>

      {(embedded || error) && (
        <div className="banners">
          {embedded && (
            <p className="banner banner-info">
              Embedded / browser mode — talking to Hardpoint over HTTP at 127.0.0.1:3921 (folder
              pickers need the desktop window).
            </p>
          )}
          {error && <p className="banner banner-error">{error}</p>}
        </div>
      )}

      {tab === 'dashboard' && (
        <div className="dashboard-columns">
          <div className="dashboard-col dashboard-col-system">
            <section className={`card card-gpu${gpu?.available ? '' : ' card-gpu-empty'}`}>
              <div className="card-header">
                <h2>GPU</h2>
                {gpu?.available && <span className="card-meta card-meta-inline">{gpu.name}</span>}
              </div>
              {!gpu?.available ? (
                <p className="muted">No NVIDIA GPU data (nvidia-smi not available).</p>
              ) : (
                <>
                  <div className="vram-row">
                    <span>VRAM</span>
                    <span>
                      {formatMiB(gpu.memoryUsedMiB)} / {formatMiB(gpu.memoryTotalMiB)}
                    </span>
                  </div>
                  <div className="progress-bar" aria-hidden={vramPct == null}>
                    <div
                      className={`progress-fill${vramPct != null && vramPct >= 90 ? ' hot' : ''}`}
                      style={{ width: vramPct != null ? `${vramPct}%` : '0%' }}
                    />
                  </div>
                  <div className="stat-grid stat-grid-3">
                    <div className="stat-tile">
                      <span className="stat-label">Utilization</span>
                      <span className="stat-value">
                        {gpu.utilizationGpu != null ? `${gpu.utilizationGpu}%` : '—'}
                      </span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">Temperature</span>
                      <span className="stat-value">
                        {gpu.temperatureC != null ? `${gpu.temperatureC}°C` : '—'}
                      </span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">VRAM used</span>
                      <span className="stat-value">{vramPct != null ? `${vramPct}%` : '—'}</span>
                    </div>
                  </div>
                  <GpuProcessTabs
                    processes={gpu.processes}
                    busy={busy}
                    onKill={(pid) =>
                      void runAction(`kill-gpu-${pid}`, async () => {
                        const result = await hardpointClient.killGpuProcess(pid);
                        if (result.status === 'error') throw new Error(result.message);
                      })
                    }
                  />
                </>
              )}
            </section>

            <section className="card card-cpu">
              <div className="card-header">
                <h2>CPU / System RAM</h2>
                {cpu?.available && (
                  <span className="card-meta card-meta-inline">{cpu.name ?? 'CPU'}</span>
                )}
              </div>
              {!cpu?.available ? (
                <p className="muted">CPU stats unavailable.</p>
              ) : (
                <>
                  <div className="vram-row">
                    <span>RAM</span>
                    <span>
                      {formatMiB(cpu.memoryUsedMiB)} / {formatMiB(cpu.memoryTotalMiB)}
                    </span>
                  </div>
                  <div className="progress-bar" aria-hidden={ramPct == null}>
                    <div
                      className={`progress-fill${ramPct != null && ramPct >= 90 ? ' hot' : ''}`}
                      style={{ width: ramPct != null ? `${ramPct}%` : '0%' }}
                    />
                  </div>
                  <div className="stat-grid">
                    <div className="stat-tile">
                      <span className="stat-label">CPU util</span>
                      <span className="stat-value">
                        {cpu.utilizationPercent != null ? `${cpu.utilizationPercent}%` : '—'}
                      </span>
                    </div>
                    <div className="stat-tile">
                      <span className="stat-label">RAM used</span>
                      <span className="stat-value">{ramPct != null ? `${ramPct}%` : '—'}</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="dashboard-col dashboard-col-services">
            <ServicesPanel
              mounts={status?.mounts ?? []}
              busy={busy}
              embedded={embedded}
              onBusy={setBusy}
              onChanged={refresh}
            />
          </div>
        </div>
      )}

      {tab === 'mcp' && !embedded && (
        <McpPanel
          result={mcp}
          busy={busy}
          error={mcpError}
          onRefresh={() => void refreshMcp()}
          onStop={(server) => {
            if (window.confirm(`Stop ${server.name} (PID ${server.pid})?`)) void stopMcp([server]);
          }}
          onStopOrphans={(servers) => {
            if (window.confirm(`Stop ${servers.length} orphaned MCP server(s)?`)) void stopMcp(servers);
          }}
        />
      )}

      {tab === 'log' && (
        <section className="card card-fill">
          <div className="card-header">
            <h2>Command log</h2>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy || logCount === 0}
              onClick={() => void runAction('clear-log', () => hardpointClient.clearCommandLog())}
            >
              Clear
            </button>
          </div>
          {logCount === 0 ? (
            <p className="muted">No commands run yet this session.</p>
          ) : (
            <ul className="cmd-log">
              {status!.commandLog.map((entry) => (
                <li key={entry.id} className={entry.ok ? 'cmd-ok' : 'cmd-fail'}>
                  <span className="cmd-time">{new Date(entry.at).toLocaleTimeString()}</span>
                  <code>{entry.command}</code>
                  {entry.detail && <span className="cmd-detail">{entry.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'updates' && (
        <section className="card card-updates">
          <h2>Updates</h2>
          <p className="card-meta">
            {appVersion ? `You're running version ${appVersion}.` : 'Loading version…'}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={updateStatus === 'checking' || updateStatus === 'unsupported'}
              onClick={() => void handleCheckForUpdates()}
            >
              {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
          {updateStatus === 'not-available' && <p className="muted">You're up to date.</p>}
          {updateStatus === 'available' && updateMessage && (
            <p className="update-note">{updateMessage}</p>
          )}
          {updateStatus === 'error' && updateMessage && (
            <p className="banner banner-error">Check failed: {updateMessage}</p>
          )}
          {updateStatus === 'unsupported' && (
            <p className="muted">
              {updateMessage ??
                'Update checks are only available in a packaged Hardpoint build, not in embeds or dev mode.'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
