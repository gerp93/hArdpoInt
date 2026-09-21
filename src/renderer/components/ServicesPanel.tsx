import { useEffect, useState } from 'react';
import type {
  DashboardService,
  ScanHit,
  ServicePresetInfo,
} from '../../shared/types';
import { hardpointClient } from '../utils/api';

function formatMiB(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GiB`;
  return `${Math.round(value)} MiB`;
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? 'status-ok' : 'status-down'}`}>{label}</span>;
}

export function ServicesPanel({
  services,
  busy,
  embedded,
  onBusy,
  onChanged,
}: {
  services: DashboardService[];
  busy: string | null;
  embedded: boolean;
  onBusy: (key: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [presets, setPresets] = useState<ServicePresetInfo[]>([]);
  const [scanHits, setScanHits] = useState<ScanHit[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    void hardpointClient.listPresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  async function run(key: string, fn: () => Promise<unknown>) {
    onBusy(key);
    setPanelError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(null);
    }
  }

  async function handleScan() {
    setScanning(true);
    setPanelError(null);
    try {
      setScanHits(await hardpointClient.scanServices());
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function addHit(hit: ScanHit) {
    const presetId = hit.suggestedPresetId ?? 'custom';
    await run(`add-${hit.port}`, async () => {
      const result = await hardpointClient.addFromPreset(presetId, {
        name: hit.suggestedName,
        hostUrl: hit.hostUrl,
      });
      if (result.status === 'error') throw new Error(result.message);
    });
  }

  async function addPreset(preset: ServicePresetInfo) {
    await run(`preset-${preset.id}`, async () => {
      const result = await hardpointClient.addFromPreset(preset.id);
      if (result.status === 'error') throw new Error(result.message);
      setShowAdd(false);
    });
  }

  async function removeService(id: string) {
    await run(`del-${id}`, async () => {
      const result = await hardpointClient.deleteService(id);
      if (result.status === 'error') throw new Error(result.message);
    });
  }

  async function pickDir(service: DashboardService) {
    await run(`dir-${service.id}`, async () => {
      const pick =
        service.kind === 'ollama'
          ? await hardpointClient.chooseOllamaDir()
          : service.kind === 'chatterbox'
            ? await hardpointClient.chooseChatterboxDir()
            : await hardpointClient.chooseServiceDir();
      if (pick.status === 'cancelled') return;
      if (pick.status === 'error') throw new Error(pick.message);
      const result = await hardpointClient.saveService({
        ...service,
        workingDir: pick.dir,
      });
      if (result.status === 'error') throw new Error(result.message);
    });
  }

  const addedUrls = new Set(
    services.map((s) => s.hostUrl?.replace(/\/+$/, '').toLowerCase()).filter(Boolean) as string[]
  );

  return (
    <section className="card">
      <div className="card-header">
        <h2>Services</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={scanning || !!busy}
            onClick={() => void handleScan()}
          >
            {scanning ? 'Scanning…' : 'Scan localhost'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy}
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? 'Hide presets' : 'Add from preset'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Nothing is baked in — scan for what’s listening, or add a preset. Start/Stop stay on each
        card you choose to keep.
      </p>
      {panelError && <p className="banner banner-error">{panelError}</p>}

      {showAdd && (
        <div className="preset-grid">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              disabled={!!busy}
              onClick={() => void addPreset(preset)}
            >
              <strong>{preset.name}</strong>
              <span className="muted">{preset.description}</span>
              <code>{preset.defaultHostUrl}</code>
            </button>
          ))}
        </div>
      )}

      {scanHits && (
        <div className="scan-results">
          <h3 className="scan-heading">Scan results</h3>
          {scanHits.length === 0 ? (
            <p className="muted">No known ports open on 127.0.0.1.</p>
          ) : (
            <ul className="scan-list">
              {scanHits.map((hit) => {
                const already = addedUrls.has(hit.hostUrl.replace(/\/+$/, '').toLowerCase());
                return (
                  <li key={hit.port}>
                    <div>
                      <strong>{hit.suggestedName}</strong>{' '}
                      <code>{hit.hostUrl}</code>
                      <span className="muted">
                        {' '}
                        · {hit.detail} · {hit.confidence} confidence
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={already || !!busy}
                      onClick={() => void addHit(hit)}
                    >
                      {already ? 'Added' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {services.length === 0 ? (
        <p className="muted">No services on the dashboard yet. Scan or add a preset.</p>
      ) : (
        services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            busy={busy}
            embedded={embedded}
            onAction={(actionId) =>
              void run(`${service.id}-${actionId}`, () =>
                hardpointClient.runServiceAction(service.id, actionId)
              )
            }
            onUnload={(model) =>
              void run(`unload-${model}`, () => hardpointClient.ollamaUnload(model))
            }
            onUnloadAll={() => void run('unload-all', () => hardpointClient.ollamaUnload())}
            onChooseDir={() => void pickDir(service)}
            onRemove={() => void removeService(service.id)}
          />
        ))
      )}
    </section>
  );
}

function ServiceCard({
  service,
  busy,
  embedded,
  onAction,
  onUnload,
  onUnloadAll,
  onChooseDir,
  onRemove,
}: {
  service: DashboardService;
  busy: string | null;
  embedded: boolean;
  onAction: (actionId: string) => void;
  onUnload: (model: string) => void;
  onUnloadAll: () => void;
  onChooseDir: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="service-card">
      <div className="card-header">
        <h3>{service.name}</h3>
        {service.reachable != null && (
          <StatusPill ok={service.reachable} label={service.reachable ? 'Reachable' : 'Down'} />
        )}
      </div>
      {service.hostUrl && <p className="card-meta">{service.hostUrl}</p>}
      {service.kind === 'chatterbox' && service.deviceHint && (
        <p className="card-meta">Device (config.yaml): {service.deviceHint}</p>
      )}
      <p className="card-meta folder-line">
        Install: {service.workingDir ?? 'Not set'}
        <button
          type="button"
          className="btn btn-sm"
          disabled={!!busy || embedded}
          title={embedded ? 'Use the Hardpoint desktop window to choose folders' : undefined}
          onClick={onChooseDir}
        >
          Choose folder
        </button>
      </p>
      <div className="btn-row">
        {service.actions.map((action) => (
          <div key={action.id} className="action-with-cmd">
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </button>
            <code className="cmd-preview">{action.commandPreview}</code>
          </div>
        ))}
        {service.kind === 'ollama' && (
          <button
            type="button"
            className="btn"
            disabled={!!busy || !(service.loadedModels?.length)}
            onClick={onUnloadAll}
          >
            Unload all
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={onRemove}>
          Remove
        </button>
      </div>

      {service.kind === 'ollama' && (
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
            {(service.loadedModels ?? []).map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td>{m.processor ?? '—'}</td>
                <td>{formatMiB(m.sizeVram)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!!busy}
                    onClick={() => onUnload(m.name)}
                  >
                    Unload
                  </button>
                </td>
              </tr>
            ))}
            {!(service.loadedModels?.length) && (
              <tr>
                <td colSpan={4} className="muted">
                  No models loaded in Ollama
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
