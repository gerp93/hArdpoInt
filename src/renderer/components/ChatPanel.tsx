import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentApi, AgentEvent } from '../../shared/types';

type ChatItem =
  | { type: 'user'; id: string; text: string }
  | { type: 'text'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown; result?: { isError: boolean; text: string } }
  | { type: 'note'; id: string; text: string; error?: boolean };

interface Approval {
  requestId: string;
  toolName: string;
  title: string;
  input: unknown;
}

const EXAMPLES = [
  'Set up ComfyUI so I can start it from here',
  'Add my Wreckfest 2 dedicated server',
  "What's running on this PC that isn't on the dashboard yet?",
];

function prettyToolName(name: string): string {
  return name.replace(/^mcp__hardpoint__/, '');
}

let counter = 0;
const nextId = () => `c${Date.now().toString(36)}-${counter++}`;

function ApprovalCard({
  approval,
  onAnswer,
}: {
  approval: Approval;
  onAnswer: (allow: boolean) => void;
}) {
  const command =
    approval.toolName === 'Bash' && typeof (approval.input as { command?: unknown })?.command === 'string'
      ? String((approval.input as { command: string }).command)
      : null;
  return (
    <div className="chat-approval">
      <p className="chat-approval-title">Needs your OK: {approval.title}</p>
      {command && <pre className="chat-code">{command}</pre>}
      <details>
        <summary className="muted">Details</summary>
        <pre className="chat-code">{JSON.stringify(approval.input, null, 2)}</pre>
      </details>
      <div className="btn-row" style={{ margin: '0.5rem 0 0' }}>
        <button type="button" className="btn" onClick={() => onAnswer(true)}>
          Approve
        </button>
        <button type="button" className="btn btn-sm" onClick={() => onAnswer(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({
  agent,
  onClose,
  onStatus,
}: {
  agent: AgentApi;
  onClose: () => void;
  onStatus: (status: { running: boolean; needsApproval: boolean }) => void;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState('');
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [login, setLogin] = useState<{ state: 'idle' | 'started' | 'failed'; url?: string; message?: string }>({
    state: 'idle',
  });
  const listRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.kind) {
      case 'text':
        setItems((prev) => {
          const at = prev.findIndex((i) => i.type === 'text' && i.id === event.key);
          if (at === -1) return [...prev, { type: 'text', id: event.key, text: event.text }];
          const next = prev.slice();
          next[at] = { type: 'text', id: event.key, text: event.text };
          return next;
        });
        break;
      case 'tool':
        setItems((prev) =>
          prev.some((i) => i.type === 'tool' && i.id === event.id)
            ? prev
            : [...prev, { type: 'tool', id: event.id, name: event.name, input: event.input }]
        );
        break;
      case 'tool_result':
        setItems((prev) =>
          prev.map((i) =>
            i.type === 'tool' && i.id === event.id
              ? { ...i, result: { isError: event.isError, text: event.text } }
              : i
          )
        );
        break;
      case 'approval':
        setApprovals((prev) => [...prev, event]);
        break;
      case 'approval_done':
        setApprovals((prev) => prev.filter((a) => a.requestId !== event.requestId));
        break;
      case 'running':
        setRunning(event.running);
        break;
      case 'done':
        if (event.isError) {
          setItems((prev) => [...prev, { type: 'note', id: nextId(), text: 'The assistant hit an error.', error: true }]);
        }
        break;
      case 'auth_required':
        setLoggedIn(false);
        break;
      case 'login':
        if (event.state === 'ok') {
          setLoggedIn(true);
          setLogin({ state: 'idle' });
        } else {
          setLogin({ state: event.state, url: event.url, message: event.message });
        }
        break;
      case 'error':
        setItems((prev) => [...prev, { type: 'note', id: nextId(), text: event.message, error: true }]);
        break;
    }
  }, []);

  useEffect(() => agent.onEvent(handleEvent), [agent, handleEvent]);

  useEffect(() => {
    void agent.getWorkspace().then(setWorkspace).catch(() => setWorkspace(null));
    void agent.authStatus().then((s) => setLoggedIn(s.loggedIn)).catch(() => setLoggedIn(null));
  }, [agent]);

  useEffect(() => {
    onStatus({ running, needsApproval: approvals.length > 0 });
  }, [running, approvals.length, onStatus]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, approvals]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    setDraft('');
    setItems((prev) => [...prev, { type: 'user', id: nextId(), text: trimmed }]);
    const result = await agent.send(trimmed);
    if (result.status === 'error') {
      setItems((prev) => [...prev, { type: 'note', id: nextId(), text: result.message, error: true }]);
    }
  }

  async function newChat() {
    await agent.reset();
    setItems([]);
    setApprovals([]);
  }

  async function changeWorkspace() {
    const pick = await agent.chooseWorkspace();
    if (pick.status === 'ok') setWorkspace(pick.dir);
  }

  return (
    <section className="chat-panel">
      <div className="card-header">
        <h2>Assistant</h2>
        <div className="btn-row" style={{ margin: 0 }}>
          {items.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => void newChat()}>
              New chat
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <p className="muted chat-intro">
        Tell it a server you want to run. It works out the commands, ports and stop method, and adds
        the card for you.
        {workspace && (
          <>
            {' '}
            Works in <code className="install-path">{workspace}</code>{' '}
            <button type="button" className="btn btn-sm" disabled={running} onClick={() => void changeWorkspace()}>
              Change
            </button>
          </>
        )}
      </p>

      {loggedIn === false && (
        <div className="banner banner-info">
          <p style={{ margin: '0 0 0.4rem' }}>
            Sign in to Claude to use the assistant. It opens your browser; Hardpoint never sees your password.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={login.state === 'started'}
            onClick={() => {
              setLogin({ state: 'started' });
              void agent.login();
            }}
          >
            {login.state === 'started' ? 'Waiting for sign-in…' : 'Sign in'}
          </button>
          {login.state === 'started' && login.url && (
            <p className="card-meta">
              Browser didn&apos;t open?{' '}
              <a href={login.url} target="_blank" rel="noreferrer">
                Open the sign-in page
              </a>
            </p>
          )}
          {login.state === 'failed' && (
            <p className="card-meta">Sign-in failed: {login.message ?? 'unknown error'}</p>
          )}
        </div>
      )}

      <div className="chat-list" ref={listRef}>
        {items.length === 0 && (
          <div className="chat-examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="chat-chip"
                disabled={running || loggedIn === false}
                onClick={() => void send(example)}
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {items.map((item) => {
          if (item.type === 'user') {
            return (
              <div key={item.id} className="chat-msg chat-user">
                {item.text}
              </div>
            );
          }
          if (item.type === 'text') {
            return (
              <div key={item.id} className="chat-msg chat-assistant">
                {item.text}
              </div>
            );
          }
          if (item.type === 'note') {
            return (
              <div key={item.id} className={`chat-note${item.error ? ' chat-note-error' : ''}`}>
                {item.text}
              </div>
            );
          }
          return (
            <details key={item.id} className={`chat-tool${item.result?.isError ? ' chat-tool-error' : ''}`}>
              <summary>
                <code>{prettyToolName(item.name)}</code>
                {!item.result && <span className="muted"> running…</span>}
                {item.result?.isError && <span className="muted"> failed</span>}
              </summary>
              <pre className="chat-code">{JSON.stringify(item.input, null, 2)}</pre>
              {item.result && <pre className="chat-code">{item.result.text}</pre>}
            </details>
          );
        })}
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.requestId}
            approval={approval}
            onAnswer={(allow) => void agent.approve(approval.requestId, allow)}
          />
        ))}
        {running && approvals.length === 0 && <div className="chat-note">Working…</div>}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          className="chat-input"
          rows={2}
          value={draft}
          placeholder="e.g. Set up Open WebUI so I can start it from here"
          disabled={loggedIn === false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
        />
        {running ? (
          <button type="button" className="btn" onClick={() => void agent.interrupt()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn" disabled={!draft.trim() || loggedIn === false}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}
