import { useEffect, useState } from 'react';
import type { Mount } from '../../shared/mountSchema';
import {
  blankMount,
  normalizeMount,
  parseMountJson,
  portFromHostUrl,
} from '../../shared/mountSchema';
import { hardpointClient } from '../utils/api';

const STEPS = ['Identity', 'Launch', 'Start', 'Stop', 'Panels', 'Review'] as const;

export function MountStepper({
  initial,
  embedded,
  onCancel,
  onSaved,
}: {
  initial: Mount;
  embedded: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Mount>(() => normalizeMount(initial) ?? blankMount(initial));
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState(() => JSON.stringify(draft, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<boolean | null>(null);

  const step = STEPS[stepIndex];

  useEffect(() => {
    if (mode === 'json') {
      setJsonText(JSON.stringify(draft, null, 2));
      setJsonError(null);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- sync when switching to JSON only

  useEffect(() => {
    let cancelled = false;
    const url = draft.hostUrl?.trim();
    if (!url) {
      setProbe(null);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2_000) });
          if (!cancelled) {
            setProbe(res.ok || (res.status >= 400 && res.status < 500));
          }
        } catch {
          if (!cancelled) setProbe(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [draft.hostUrl]);

  function applyJson(): boolean {
    const parsed = parseMountJson(jsonText);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return false;
    }
    setDraft(parsed.mount);
    setJsonError(null);
    return true;
  }

  function switchToVisual() {
    if (mode === 'json' && !applyJson()) return;
    setMode('visual');
  }

  function switchToJson() {
    setJsonText(JSON.stringify(draft, null, 2));
    setJsonError(null);
    setMode('json');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let mount = draft;
      if (mode === 'json') {
        const parsed = parseMountJson(jsonText);
        if (!parsed.ok) {
          setJsonError(parsed.error);
          setBusy(false);
          return;
        }
        mount = parsed.mount;
      }
      const result = await hardpointClient.saveMount(mount);
      if (result.status === 'error') throw new Error(result.message);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickFolder() {
    setBusy(true);
    try {
      const pick = await hardpointClient.chooseMountDir();
      if (pick.status === 'cancelled') return;
      if (pick.status === 'error') throw new Error(pick.message);
      setDraft((d) => ({ ...d, launch: { mode: 'folder', cwd: pick.dir } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mount-stepper">
      <div className="card-header">
        <h2>{initial.name ? `Edit mount` : 'Add mount'}</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          <button
            type="button"
            className={`btn btn-sm${mode === 'visual' ? ' active-tab' : ''}`}
            onClick={switchToVisual}
          >
            Visual
          </button>
          <button
            type="button"
            className={`btn btn-sm${mode === 'json' ? ' active-tab' : ''}`}
            onClick={switchToJson}
          >
            Mount JSON
          </button>
        </div>
      </div>

      {mode === 'visual' && (
        <>
          <div className="stepper-tabs" role="tablist">
            {STEPS.map((s, i) => (
              <button
                key={s}
                type="button"
                role="tab"
                className={`gpu-proc-tab${i === stepIndex ? ' active' : ''}`}
                onClick={() => setStepIndex(i)}
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>

          {step === 'Identity' && (
            <div className="stepper-body">
              <label className="field">
                Name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                Host URL
                <input
                  value={draft.hostUrl ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      hostUrl: e.target.value.trim() || null,
                    })
                  }
                  placeholder="http://127.0.0.1:11434"
                />
              </label>
              <p className="muted">
                Probe:{' '}
                {probe == null ? '—' : probe ? 'Reachable' : 'Down'}
              </p>
            </div>
          )}

          {step === 'Launch' && (
            <div className="stepper-body">
              <p className="muted">Where Start runs from.</p>
              <div className="btn-row">
                <button
                  type="button"
                  className={`btn${draft.launch.mode === 'unset' ? '' : ' btn-sm'}`}
                  onClick={() => setDraft({ ...draft, launch: { mode: 'unset', cwd: null } })}
                >
                  Not set
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDraft({ ...draft, launch: { mode: 'path', cwd: null } })}
                >
                  Use PATH
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={embedded || busy}
                  onClick={() => void pickFolder()}
                >
                  Choose folder
                </button>
              </div>
              <p className="card-meta">
                Current:{' '}
                {draft.launch.mode === 'path'
                  ? 'PATH'
                  : draft.launch.cwd ?? 'Not set'}
              </p>
            </div>
          )}

          {step === 'Start' && (
            <div className="stepper-body">
              <label className="field">
                Start command
                <input
                  value={draft.start?.command ?? ''}
                  onChange={(e) => {
                    const command = e.target.value;
                    setDraft({
                      ...draft,
                      start: command.trim()
                        ? {
                            type: 'shell',
                            command,
                            preview: draft.start?.preview,
                            cwdRequired: draft.start?.cwdRequired,
                          }
                        : null,
                    });
                  }}
                  placeholder="ollama serve"
                />
              </label>
              <label className="field">
                Preview (optional)
                <input
                  value={draft.start?.preview ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      start: draft.start
                        ? { ...draft.start, preview: e.target.value || undefined }
                        : null,
                    })
                  }
                />
              </label>
              <label className="field check">
                <input
                  type="checkbox"
                  checked={Boolean(draft.start?.cwdRequired)}
                  disabled={!draft.start}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      start: draft.start
                        ? { ...draft.start, cwdRequired: e.target.checked }
                        : null,
                    })
                  }
                />
                Require launch folder (cwd)
              </label>
            </div>
          )}

          {step === 'Stop' && (
            <div className="stepper-body">
              <label className="field">
                Stop port
                <input
                  type="number"
                  value={
                    draft.stop?.type === 'port'
                      ? draft.stop.port ?? portFromHostUrl(draft.hostUrl, 8080)
                      : portFromHostUrl(draft.hostUrl, 8080)
                  }
                  onChange={(e) => {
                    const port = Number(e.target.value);
                    setDraft({
                      ...draft,
                      stop: {
                        type: 'port',
                        port: Number.isFinite(port) ? port : 8080,
                        preview: draft.stop?.preview,
                        afterShell: draft.stop?.afterShell,
                      },
                    });
                  }}
                />
              </label>
              <label className="field">
                Preview (optional)
                <input
                  value={draft.stop?.preview ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      stop: draft.stop
                        ? { ...draft.stop, preview: e.target.value || undefined }
                        : {
                            type: 'port',
                            port: portFromHostUrl(draft.hostUrl, 8080),
                            preview: e.target.value || undefined,
                          },
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDraft({ ...draft, stop: null })}
              >
                Clear stop
              </button>
            </div>
          )}

          {step === 'Panels' && (
            <div className="stepper-body">
              <p className="muted">
                Resource tables (list API → columns → actions) are easiest to edit in{' '}
                <strong>Mount JSON</strong>. Visual mode lets you clear panels or keep what&apos;s
                there.
              </p>
              <p className="card-meta">
                {draft.panels.length === 0
                  ? 'No panels configured.'
                  : `${draft.panels.length} panel(s): ${draft.panels.map((p) => p.id).join(', ')}`}
              </p>
              {draft.panels.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setDraft({ ...draft, panels: [] })}
                >
                  Clear panels
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={switchToJson}>
                Edit panels in JSON
              </button>
            </div>
          )}

          {step === 'Review' && (
            <div className="stepper-body">
              <pre className="json-preview">{JSON.stringify(draft, null, 2)}</pre>
            </div>
          )}

          <div className="btn-row stepper-nav">
            <button
              type="button"
              className="btn btn-sm"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </button>
            {stepIndex < STEPS.length - 1 ? (
              <button
                type="button"
                className="btn"
                onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
              >
                Next
              </button>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
                Save mount
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {mode === 'json' && (
        <div className="stepper-body">
          <textarea
            className="json-editor"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
          />
          {jsonError && <p className="banner banner-error">{jsonError}</p>}
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                if (applyJson()) void save();
              }}
            >
              Save mount
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="banner banner-error">{error}</p>}
    </div>
  );
}
