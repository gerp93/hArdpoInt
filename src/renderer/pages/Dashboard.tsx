import { useCallback, useEffect, useState } from 'react';
import type { DashboardStatus, GpuProcess, UpdateCheckResult } from '../../shared/types';
import { hardpointClient, isEmbeddedHttpMode } from '../utils/api';
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

function GpuProcessTabs({ processes }: { processes: GpuProcess[] }) {
  const [tab, setTab] = useState<GpuProcTab>('active');
  const active = processes.filter((p) => p.kind === 'active');
  const ui = processes.filter((p) => p.kind === 'ui');
  const list = tab === 'active' ? active : ui;

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
          UI & overlays ({ui.length})
        </button>
      </div>
      <p className="muted gpu-proc-hint">
        {tab === 'active'
          ? 'Processes that look like real GPU work (models, encode, compute). On Windows, WDDM often hides per-process VRAM — names and type are the signal.'
          : 'Desktop, browser, and overlay clients that hold a GPU context for compositing. They are “on” the GPU but usually idle (0% util).'}
      </p>
      {list.length > 0 ? (
        <ul className="proc-list">
          {list.map((p) => (
            <li key={p.pid}>{formatProcessLine(p)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {tab === 'active'
            ? 'Nothing classified as active compute right now.'
            : 'No UI / overlay clients reported.'}
        </p>
      )}
    </div>
  );
}

type UpdateUiStatus = 'idle' | 'checking' | UpdateCheckResult['status'];

export function Dashboard() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateUiStatus>('idle');
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
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

  return (
    <div className="dashboard">
      {embedded && (
        <p className="banner banner-info">
          Embedded / browser mode — talking to Hardpoint over HTTP at 127.0.0.1:3921 (folder pickers
          need the desktop window).
        </p>
      )}
      {error && <p className="banner banner-error">{error}</p>}

      <div className="dashboard-columns">
        <div className="dashboard-col dashboard-col-system">
          <section className="card">
            <h2>GPU</h2>
            {!gpu?.available ? (
              <p className="muted">No NVIDIA GPU data (nvidia-smi not available).</p>
            ) : (
              <>
                <p className="card-meta">{gpu.name}</p>
                <div className="vram-row">
                  <span>VRAM</span>
                  <span>
                    {formatMiB(gpu.memoryUsedMiB)} / {formatMiB(gpu.memoryTotalMiB)}
                  </span>
                </div>
                <div className="progress-bar" aria-hidden={vramPct == null}>
                  <div
                    className="progress-fill"
                    style={{ width: vramPct != null ? `${vramPct}%` : '0%' }}
                  />
                </div>
                <div className="stat-grid">
                  <div>
                    <span className="stat-label">Utilization</span>
                    <span className="stat-value">
                      {gpu.utilizationGpu != null ? `${gpu.utilizationGpu}%` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="stat-label">Temperature</span>
                    <span className="stat-value">
                      {gpu.temperatureC != null ? `${gpu.temperatureC}°C` : '—'}
                    </span>
                  </div>
                </div>
                <GpuProcessTabs processes={gpu.processes} />
              </>
            )}
          </section>

          <section className="card">
            <h2>CPU / System RAM</h2>
            {!cpu?.available ? (
              <p className="muted">CPU stats unavailable.</p>
            ) : (
              <>
                <p className="card-meta">{cpu.name ?? 'CPU'}</p>
                <div className="vram-row">
                  <span>RAM</span>
                  <span>
                    {formatMiB(cpu.memoryUsedMiB)} / {formatMiB(cpu.memoryTotalMiB)}
                  </span>
                </div>
                <div className="progress-bar" aria-hidden={ramPct == null}>
                  <div
                    className="progress-fill"
                    style={{ width: ramPct != null ? `${ramPct}%` : '0%' }}
                  />
                </div>
                <div className="stat-grid">
                  <div>
                    <span className="stat-label">CPU util</span>
                    <span className="stat-value">
                      {cpu.utilizationPercent != null ? `${cpu.utilizationPercent}%` : '—'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="dashboard-col dashboard-col-services">
          <ServicesPanel
            services={status?.services ?? []}
            busy={busy}
            embedded={embedded}
            onBusy={setBusy}
            onChanged={refresh}
          />
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Command log</h2>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy}
            onClick={() => void runAction('clear-log', () => hardpointClient.clearCommandLog())}
          >
            Clear
          </button>
        </div>
        {(status?.commandLog ?? []).length === 0 ? (
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

      <section className="card">
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
          <p className="status-ok">{updateMessage}</p>
        )}
        {updateStatus === 'error' && updateMessage && (
          <p className="banner banner-error" style={{ marginTop: 8 }}>
            Check failed: {updateMessage}
          </p>
        )}
        {updateStatus === 'unsupported' && (
          <p className="muted">
            {updateMessage ??
              'Update checks are only available in a packaged Hardpoint build, not in embeds or dev mode.'}
          </p>
        )}
      </section>
    </div>
  );
}
