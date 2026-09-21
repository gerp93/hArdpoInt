import { useEffect, useState } from 'react';
import type { DashboardMount, Mount, MountTemplateInfo, ScanHit } from '../../shared/types';
import { blankMount } from '../../shared/mountSchema';
import { loopbackHostKey, loopbackPortFromUrl } from '../../shared/loopbackUrl';
import { hardpointClient } from '../utils/api';
import { MountCard } from './MountCard';
import { MountStepper } from './MountStepper';

export function ServicesPanel({
  mounts,
  busy,
  embedded,
  onBusy,
  onChanged,
}: {
  mounts: DashboardMount[];
  busy: string | null;
  embedded: boolean;
  onBusy: (key: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState<MountTemplateInfo[]>([]);
  const [scanHits, setScanHits] = useState<ScanHit[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editing, setEditing] = useState<Mount | null>(null);

  useEffect(() => {
    void hardpointClient.listMountTemplates().then(setTemplates).catch(() => setTemplates([]));
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

  function openFromScan(hit: ScanHit) {
    const port = hit.port;
    setEditing(
      blankMount({
        id: `mount-${Date.now().toString(36)}`,
        name: hit.suggestedName,
        hostUrl: hit.hostUrl,
        stop: {
          type: 'port',
          port,
          preview: `taskkill listeners on TCP ${port}`,
        },
      })
    );
  }

  async function addTemplate(templateId: string) {
    await run(`tpl-${templateId}`, async () => {
      const result = await hardpointClient.addFromTemplate(templateId);
      if (result.status === 'error') throw new Error(result.message);
      setShowTemplates(false);
    });
  }

  const addedUrls = new Set(
    mounts.map((s) => loopbackHostKey(s.hostUrl)).filter((k): k is string => Boolean(k))
  );
  const addedPorts = new Set(
    mounts.map((s) => loopbackPortFromUrl(s.hostUrl)).filter((p): p is number => p != null)
  );
  const newScanHits = (scanHits ?? []).filter((hit) => {
    const key = loopbackHostKey(hit.hostUrl);
    if (key && addedUrls.has(key)) return false;
    if (addedPorts.has(hit.port)) return false;
    return true;
  });

  if (editing) {
    return (
      <section className="card">
        <MountStepper
          initial={editing}
          embedded={embedded}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>Mounts</h2>
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
            onClick={() => setShowTemplates((v) => !v)}
          >
            {showTemplates ? 'Hide templates' : 'Add from template'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!!busy}
            onClick={() =>
              setEditing(
                blankMount({
                  stop: {
                    type: 'port',
                    port: 8080,
                    preview: 'taskkill listeners on TCP 8080',
                  },
                })
              )
            }
          >
            Add mount
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Each mount is JSON in app data — Start/Stop/panels are defined on the mount, not baked into
        Hardpoint. Scan, use a template, or add from scratch (Visual or Mount JSON).
      </p>
      {panelError && <p className="banner banner-error">{panelError}</p>}

      {showTemplates && (
        <div className="preset-grid">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="preset-card"
              disabled={!!busy}
              onClick={() => void addTemplate(tpl.id)}
            >
              <strong>{tpl.name}</strong>
              <span className="muted">{tpl.description}</span>
              <code>{tpl.defaultHostUrl}</code>
            </button>
          ))}
          {templates.length === 0 && (
            <p className="muted">No seed templates found (assets/mount-seeds.json).</p>
          )}
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
                    onClick={() => openFromScan(hit)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mounts.length === 0 ? (
        <p className="muted">No mounts yet. Scan, add from a template, or Add mount.</p>
      ) : (
        mounts.map((mount) => (
          <MountCard
            key={mount.id}
            mount={mount}
            busy={busy}
            embedded={embedded}
            onStart={() =>
              void run(`${mount.id}-start`, async () => {
                const result = await hardpointClient.runMountAction(mount.id, 'start');
                if (result.status === 'error') throw new Error(result.message);
              })
            }
            onStop={() =>
              void run(`${mount.id}-stop`, async () => {
                const result = await hardpointClient.runMountAction(mount.id, 'stop');
                if (result.status === 'error') throw new Error(result.message);
              })
            }
            onPanelAction={(panelId, actionId, row) =>
              void run(`${mount.id}-${panelId}-${actionId}`, async () => {
                const result = await hardpointClient.runMountAction(mount.id, {
                  panelId,
                  actionId,
                  row,
                });
                if (result.status === 'error') throw new Error(result.message);
              })
            }
            onChooseDir={() =>
              void run(`dir-${mount.id}`, async () => {
                const pick = await hardpointClient.chooseMountDir();
                if (pick.status === 'cancelled') return;
                if (pick.status === 'error') throw new Error(pick.message);
                const next: Mount = {
                  ...mount,
                  launch: { mode: 'folder', cwd: pick.dir },
                };
                const result = await hardpointClient.saveMount(next);
                if (result.status === 'error') throw new Error(result.message);
              })
            }
            onUsePath={() =>
              void run(`path-${mount.id}`, async () => {
                const next: Mount = {
                  ...mount,
                  launch: { mode: 'path', cwd: null },
                };
                const result = await hardpointClient.saveMount(next);
                if (result.status === 'error') throw new Error(result.message);
              })
            }
            onEdit={() => setEditing(mount)}
            onRemove={() =>
              void run(`del-${mount.id}`, async () => {
                const result = await hardpointClient.deleteMount(mount.id);
                if (result.status === 'error') throw new Error(result.message);
              })
            }
          />
        ))
      )}
    </section>
  );
}

