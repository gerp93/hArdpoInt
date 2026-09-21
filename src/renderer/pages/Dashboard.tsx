import { useCallback, useEffect, useState } from 'react';
import type { DashboardStatus } from '../../shared/types';
import { hardpointClient, isEmbeddedHttpMode } from '../utils/api';

const POLL_MS = 3000;

function formatMiB(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? 'status-ok' : 'status-down'}`}>{label}</span>;
}

export function Dashboard() {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
              <div className="progress-fill" style={{ width: vramPct != null ? `${vramPct}%` : '0%' }} />
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
            {gpu.processes.length > 0 ? (
              <ul className="proc-list">
                {gpu.processes.map((p) => (
                  <li key={p.pid}>
                    {p.name} (PID {p.pid}
                    {p.memoryMiB != null ? `, ${formatMiB(p.memoryMiB)}` : ''})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No compute processes reported by nvidia-smi.</p>
            )}
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
              <div className="progress-fill" style={{ width: ramPct != null ? `${ramPct}%` : '0%' }} />
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

      <section className="card">
        <div className="card-header">
          <h2>Ollama</h2>
          <StatusPill
            ok={!!status?.ollama.reachable}
            label={status?.ollama.reachable ? 'Reachable' : 'Down'}
          />
        </div>
        <p className="card-meta">{status?.ollama.host ?? '…'}</p>
        <p className="card-meta folder-line">
          Install: {status?.ollama.launchDir ?? 'Not set'}
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy || embedded}
            title={embedded ? 'Use the Hardpoint desktop window to choose folders' : undefined}
            onClick={() => void runAction('ollama-dir', () => hardpointClient.chooseOllamaDir())}
          >
            Choose folder
          </button>
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void runAction('ollama-start', () => hardpointClient.ollamaStart())}
          >
            Start
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void runAction('ollama-stop', () => hardpointClient.ollamaStop())}
          >
            Stop
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy || !status?.ollama.loadedModels.length}
            onClick={() => void runAction('ollama-unload-all', () => hardpointClient.ollamaUnload())}
          >
            Unload all
          </button>
        </div>
        <p className="card-meta cmd-preview">
          Start: open ollama.exe / <code>ollama serve</code> · Stop: kill :11434 listeners + Ollama.exe
          tray
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Processor</th>
              <th>VRAM</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(status?.ollama.loadedModels ?? []).map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>{m.processor ?? '—'}</td>
                <td>{formatMiB(m.sizeVram)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!!busy}
                    onClick={() =>
                      void runAction(`unload-${m.name}`, () => hardpointClient.ollamaUnload(m.name))
                    }
                  >
                    Unload
                  </button>
                </td>
              </tr>
            ))}
            {!status?.ollama.loadedModels.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No Ollama models loaded (GPU processes above may still be ComfyUI / other apps)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Chatterbox</h2>
          <StatusPill
            ok={!!status?.chatterbox.reachable}
            label={status?.chatterbox.reachable ? 'Reachable' : 'Down'}
          />
        </div>
        <p className="card-meta">{status?.chatterbox.host ?? '…'}</p>
        {status?.chatterbox.deviceHint && (
          <p className="card-meta">Device (config.yaml): {status.chatterbox.deviceHint}</p>
        )}
        <p className="card-meta folder-line">
          Install: {status?.chatterbox.launchDir ?? 'Not set'}
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy || embedded}
            onClick={() =>
              void runAction('chatterbox-dir', () => hardpointClient.chooseChatterboxDir())
            }
          >
            Choose folder
          </button>
        </p>
        <div className="btn-row">
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void runAction('chatterbox-start', () => hardpointClient.chatterboxStart())}
          >
            Start
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => void runAction('chatterbox-stop', () => hardpointClient.chatterboxStop())}
          >
            Stop
          </button>
        </div>
      </section>

      {(status?.services ?? [])
        .filter((s) => s.kind === 'generic')
        .map((service) => (
          <section className="card" key={service.id}>
            <div className="card-header">
              <h2>{service.name}</h2>
              {service.reachable != null && (
                <StatusPill
                  ok={service.reachable}
                  label={service.reachable ? 'Reachable' : 'Down'}
                />
              )}
            </div>
            {service.hostUrl && <p className="card-meta">{service.hostUrl}</p>}
            {service.workingDir && (
              <p className="card-meta">Dir: {service.workingDir}</p>
            )}
            <div className="btn-row">
              {service.actions.map((action) => (
                <div key={action.id} className="action-with-cmd">
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busy}
                    onClick={() =>
                      void runAction(
                        `${service.id}-${action.id}`,
                        () => hardpointClient.runServiceAction(service.id, action.id)
                      )
                    }
                  >
                    {action.label}
                  </button>
                  <code className="cmd-preview">{action.commandPreview}</code>
                </div>
              ))}
            </div>
          </section>
        ))}

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
    </div>
  );
}
