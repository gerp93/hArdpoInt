import { useCallback, useEffect, useState } from 'react';
import type { DashboardStatus } from '../../shared/types';

const POLL_MS = 3000;

function formatMiB(value: number | null): string {
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

  const refresh = useCallback(async () => {
    try {
      const next = await window.hardpoint.getStatus();
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
  const vramPct =
    gpu?.memoryUsedMiB != null && gpu?.memoryTotalMiB != null && gpu.memoryTotalMiB > 0
      ? Math.min(100, Math.round((gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100))
      : null;

  return (
    <div className="dashboard">
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
                <span className="stat-value">{gpu.utilizationGpu != null ? `${gpu.utilizationGpu}%` : '—'}</span>
              </div>
              <div>
                <span className="stat-label">Temperature</span>
                <span className="stat-value">{gpu.temperatureC != null ? `${gpu.temperatureC}°C` : '—'}</span>
              </div>
            </div>
            {gpu.processes.length > 0 && (
              <ul className="proc-list">
                {gpu.processes.map((p) => (
                  <li key={p.pid}>
                    {p.name} (PID {p.pid}
                    {p.memoryMiB != null ? `, ${formatMiB(p.memoryMiB)}` : ''})
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Ollama</h2>
          <StatusPill ok={!!status?.ollama.reachable} label={status?.ollama.reachable ? 'Reachable' : 'Down'} />
        </div>
        <p className="card-meta">{status?.ollama.host ?? '…'}</p>
        <p className="card-meta folder-line">
          Install: {status?.ollama.launchDir ?? 'Not set'}
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void runAction('ollama-dir', () => window.hardpoint.chooseOllamaDir())}>
            Choose folder
          </button>
        </p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void runAction('ollama-start', () => window.hardpoint.ollamaStart())}>
            Start
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void runAction('ollama-stop', () => window.hardpoint.ollamaStop())}>
            Stop
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy || !status?.ollama.loadedModels.length}
            onClick={() => void runAction('ollama-unload-all', () => window.hardpoint.ollamaUnload())}
          >
            Unload all
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Processor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(status?.ollama.loadedModels ?? []).map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>{m.processor ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!!busy}
                    onClick={() => void runAction(`unload-${m.name}`, () => window.hardpoint.ollamaUnload(m.name))}
                  >
                    Unload
                  </button>
                </td>
              </tr>
            ))}
            {!status?.ollama.loadedModels.length && (
              <tr>
                <td colSpan={3} className="muted">
                  No models loaded in VRAM
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <h2>Chatterbox</h2>
          <StatusPill ok={!!status?.chatterbox.reachable} label={status?.chatterbox.reachable ? 'Reachable' : 'Down'} />
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
            disabled={!!busy}
            onClick={() => void runAction('chatterbox-dir', () => window.hardpoint.chooseChatterboxDir())}
          >
            Choose folder
          </button>
        </p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void runAction('chatterbox-start', () => window.hardpoint.chatterboxStart())}>
            Start
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void runAction('chatterbox-stop', () => window.hardpoint.chatterboxStop())}>
            Stop
          </button>
        </div>
      </section>
    </div>
  );
}
