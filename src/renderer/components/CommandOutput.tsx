import { useEffect, useRef } from 'react';
import type { LastRun } from '../../shared/commandSchema';
import { OUTCOME_LABEL, exitLabel, formatDuration, timeAgo } from '../utils/commandView';

export interface LiveRun {
  runId: string;
  startedAt: string;
  display: string;
  text: string;
}

/** Output of the selected command: the live run if there is one, otherwise the last run. */
export function CommandOutput({
  name,
  viaSsh,
  live,
  last,
  onCancel,
  onClear,
}: {
  name: string;
  viaSsh: boolean;
  live: LiveRun | undefined;
  last: LastRun | undefined;
  onCancel: () => void;
  onClear: () => void;
}) {
  const text = live ? live.text : (last?.outputTail ?? '');
  const display = live ? live.display : last?.display;
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, live?.runId]);

  function copyOutput() {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="cb-output">
      <div className="cb-output-head">
        <strong>{name}</strong>
        {live ? (
          <span className="status-pill status-run">Running…</span>
        ) : last ? (
          <>
            <span className={`status-pill ${last.outcome === 'ok' ? 'status-ok' : 'status-down'}`}>
              {OUTCOME_LABEL[last.outcome]}
            </span>
            <span className="muted">
              {exitLabel(last, viaSsh)} · {formatDuration(last.durationMs)} · {timeAgo(last.startedAt)}
            </span>
          </>
        ) : (
          <span className="muted">Not run yet</span>
        )}
        <span className="cb-spacer" />
        {live && (
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={!text} onClick={copyOutput}>
          Copy output
        </button>
        <button type="button" className="btn btn-sm" disabled={!!live || !last} onClick={onClear}>
          Clear
        </button>
      </div>
      {display && <code className="cmd-preview cb-ran">{display}</code>}
      <pre
        ref={ref}
        className="cb-pre"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {text || (live ? 'Waiting for output…' : last ? '(no output)' : '')}
      </pre>
    </div>
  );
}
