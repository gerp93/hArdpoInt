import { useEffect, useState } from 'react';
import type {
  DashboardService,
  ScanHit,
  ServicePresetInfo,
} from '../../shared/types';
import { loopbackHostKey, loopbackPortFromUrl } from '../../shared/loopbackUrl';
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
        usePath: false,
      });
      if (result.status === 'error') throw new Error(result.message);
    });
  }

  async function usePath(service: DashboardService) {
    await run(`path-${service.id}`, async () => {
      const result = await hardpointClient.saveService({
        ...service,
        workingDir: null,
        usePath: true,
      });
      if (result.status === 'error') throw new Error(result.message);
    });
  }

  const addedUrls = new Set(
    services.map((s) => loopbackHostKey(s.hostUrl)).filter((k): k is string => Boolean(k))
  );
  const addedPorts = new Set(
    services.map((s) => loopbackPortFromUrl(s.hostUrl)).filter((p): p is number => p != null)
  );

  const newScanHits = (scanHits ?? []).filter((hit) => {
    const key = loopbackHostKey(hit.hostUrl);
    if (key && addedUrls.has(key)) return false;
    if (addedPorts.has(hit.port)) return false;
    return true;
  });

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
          {newScanHits.length === 0 ? (
            <p className="muted">
              {scanHits.length === 0
                ? 'No known ports open on 127.0.0.1.'
                : 'Everything found is already on the dashboard.'}
            </p>
          ) : (
            <ul className="scan-list">
              {newScanHits.map((hit) => (
                <li key={hit.port}>
                  <div>
                    <strong>{hit.suggestedName}</strong> <code>{hit.hostUrl}</code>
                    <span className="muted">
                      {' '}
                      · {hit.detail} · {hit.confidence} confidence
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!!busy}
                    onClick={() => void addHit(hit)}
                  >
                    Add
                  </button>
                </li>
              ))}
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
            onUsePath={() => void usePath(service)}
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
  onUsePath,
  onRemove,
}: {
  service: DashboardService;
  busy: string | null;
  embedded: boolean;
  onAction: (actionId: string) => void;
  onUnload: (model: string) => void;
  onUnloadAll: () => void;
  onChooseDir: () => void;
  onUsePath: () => void;
  onRemove: () => void;
}) {
  const up = service.reachable === true;
  const down = service.reachable === false;
  const hasInstall = Boolean(service.workingDir?.trim()) || Boolean(service.usePath);

  const visibleActions = service.actions.filter((action) => {
    const id = action.id.toLowerCase();
    const label = action.label.toLowerCase();
    const isStart = id === 'start' || label === 'start';
    const isStop = id === 'stop' || label === 'stop';
    if (isStart) {
      if (!hasInstall) return false;
      if (up) return false;
      return true;
    }
    if (isStop) {
      // Port kill does not need an install folder — only that the service is up.
      if (down) return false;
      if (up) return true;
      return hasInstall;
    }
    return hasInstall;
  });

  const installMode: 'path' | 'folder' | 'unset' = service.usePath
    ? 'path'
    : service.workingDir?.trim()
      ? 'folder'
      : 'unset';

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
        {installMode === 'path' && (
          <>
            Install: <strong>On PATH</strong>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy || embedded}
              title={
                embedded
                  ? 'Use the Hardpoint desktop window to choose folders'
                  : 'Switch to an install folder (clears PATH mode)'
              }
              onClick={onChooseDir}
            >
              Choose folder
            </button>
          </>
        )}
        {installMode === 'folder' && (
          <>
            Install: <code className="install-path">{service.workingDir}</code>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy || embedded}
              title={
                embedded
                  ? 'Use the Hardpoint desktop window to choose folders'
                  : 'Pick a different install folder'
              }
              onClick={onChooseDir}
            >
              Change folder
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy}
              title="Clear the install folder and start from PATH instead"
              onClick={onUsePath}
            >
              Use PATH
            </button>
          </>
        )}
        {installMode === 'unset' && (
          <>
            Install: <span className="muted">Not set</span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy || embedded}
              title={embedded ? 'Use the Hardpoint desktop window to choose folders' : undefined}
              onClick={onChooseDir}
            >
              Choose folder
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!!busy}
              title="Start without an install folder — use binaries / commands from your PATH"
              onClick={onUsePath}
            >
              Use PATH
            </button>
          </>
        )}
      </p>
      {installMode === 'unset' && (
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Choose an install folder, or Use PATH, before Start is available. Stop still appears when
          the service is reachable.
        </p>
      )}
      <div className="btn-row">
        {visibleActions.map((action) => (
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
        {service.kind === 'ollama' && hasInstall && up && (
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
