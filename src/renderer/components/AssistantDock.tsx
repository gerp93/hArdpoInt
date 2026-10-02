import { useCallback, useState } from 'react';
import { isEmbeddedHttpMode } from '../utils/api';
import { ChatPanel } from './ChatPanel';
import './chat.css';

const OPEN_KEY = 'hardpoint-assistant-open';

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Floating assistant, available on every view. The panel stays mounted while closed so the
 * conversation and any pending approval are not lost; the launcher shows when it needs attention.
 */
export function AssistantDock() {
  const agent = isEmbeddedHttpMode() ? undefined : window.hardpoint?.agent;
  const [open, setOpen] = useState(readOpen);
  const [status, setStatus] = useState({ running: false, needsApproval: false });

  const setOpenPersisted = useCallback((next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, []);

  if (!agent) return null;

  return (
    <div className="assistant-dock">
      <div className={`assistant-window${open ? '' : ' assistant-hidden'}`}>
        <ChatPanel agent={agent} onClose={() => setOpenPersisted(false)} onStatus={setStatus} />
      </div>
      {!open && (
        <button
          type="button"
          className={`btn assistant-launcher${status.needsApproval ? ' assistant-attention' : ''}`}
          onClick={() => setOpenPersisted(true)}
        >
          Assistant
          {status.needsApproval ? ' · needs your OK' : status.running ? ' · working…' : ''}
        </button>
      )}
    </div>
  );
}
