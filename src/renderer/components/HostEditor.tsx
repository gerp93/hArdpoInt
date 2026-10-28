import { useState } from 'react';
import type { CommandsApi, SavedCommand, SshHost } from '../../shared/commandSchema';
import { sshTarget, validateHost } from '../../shared/commandSchema';

function blankHost(): SshHost {
  return { id: `host-${Date.now().toString(36)}`, label: '', host: '', user: null, port: null, identityFile: null };
}

/** The SSH hosts commands can run on. Keys come from ssh itself; no passwords are stored. */
export function HostEditor({
  api,
  hosts,
  commands,
  onChanged,
  onDone,
}: {
  api: CommandsApi;
  hosts: SshHost[];
  commands: SavedCommand[];
  onChanged: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<SshHost | null>(hosts.length === 0 ? blankHost() : null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  async function save() {
    if (!draft) return;
    const host = { ...draft, label: draft.label.trim() || draft.host.trim(), host: draft.host.trim(), user: draft.user?.trim() || null, identityFile: draft.identityFile?.trim() || null };
    const result = await api.saveHost(host);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    setError(null);
    setDraft(null);
    onChanged();
  }

  async function remove(host: SshHost) {
    if (!window.confirm(`Delete SSH host “${host.label}”?`)) return;
    const result = await api.deleteHost(host.id);
    if (result.status === 'error') setError(result.message);
    else {
      setError(null);
      onChanged();
    }
  }

  async function test(host: SshHost) {
    setTesting(host.id);
    setTestResult(null);
    try {
      const result = await api.testHost(host.id);
      setTestResult({ id: host.id, ok: result.status === 'ok', message: result.message });
    } catch (e) {
      setTestResult({ id: host.id, ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(null);
    }
  }

  const problem = draft ? validateHost({ ...draft, label: draft.label || draft.host, host: draft.host.trim(), user: draft.user?.trim() || null, identityFile: draft.identityFile?.trim() || null }) : null;

  return (
    <section className="card card-fill cb-editor">
      <div className="card-header">
        <h2>SSH hosts</h2>
        <div className="btn-row btn-row-flush">
          <button type="button" className="btn btn-sm" disabled={!!draft} onClick={() => setDraft(blankHost())}>
            Add host
          </button>
          <button type="button" className="btn btn-sm" onClick={onDone}>
            Back
          </button>
        </div>
      </div>
      <div className="scroll-body">
        <p className="muted cb-hint">
          Commands connect with your system <code>ssh</code> and your SSH keys, never a password, and never prompt. An unknown server must be trusted once from a terminal (<code>ssh user@host</code>). If your key has a passphrase it needs to be loaded in ssh-agent.
        </p>
        {error && <p className="banner banner-error">{error}</p>}

        {hosts.length > 0 && (
          <ul className="mcp-list">
            {hosts.map((h) => {
              const uses = commands.filter((c) => c.where.kind === 'ssh' && c.where.hostId === h.id).length;
              return (
                <li key={h.id} className="mcp-row cb-host-row">
                  <div className="mcp-main">
                    <strong>{h.label}</strong>
                    <div className="muted mcp-sub">
                      {sshTarget(h)}
                      {h.port !== null ? `:${h.port}` : ''}
                      {h.identityFile ? ` · key ${h.identityFile}` : ''} · {uses} command{uses === 1 ? '' : 's'}
                    </div>
                    {testResult?.id === h.id && (
                      <div className={`cb-test ${testResult.ok ? 'cb-test-ok' : 'cb-test-bad'}`}>{testResult.message}</div>
                    )}
                  </div>
                  <button type="button" className="btn btn-sm" disabled={testing !== null} onClick={() => void test(h)}>
                    {testing === h.id ? 'Testing…' : 'Test'}
                  </button>
                  <span className="btn-row btn-row-flush">
                    <button type="button" className="btn btn-sm" onClick={() => setDraft(h)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void remove(h)}>
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {draft && (
          <div className="cb-hostform">
            <label className="cb-field">
              <span>Name</span>
              <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Debian server" autoFocus />
            </label>
            <label className="cb-field">
              <span>Host (name, IP or ssh config alias)</span>
              <input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="192.168.68.110" spellCheck={false} />
            </label>
            <label className="cb-field">
              <span>User (blank = from your ssh config)</span>
              <input value={draft.user ?? ''} onChange={(e) => setDraft({ ...draft, user: e.target.value })} placeholder="kvg" spellCheck={false} />
            </label>
            <label className="cb-field cb-narrow">
              <span>Port (blank = default)</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={draft.port ?? ''}
                onChange={(e) => setDraft({ ...draft, port: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
            <label className="cb-field">
              <span>Key file (blank = ssh default or agent)</span>
              <input value={draft.identityFile ?? ''} onChange={(e) => setDraft({ ...draft, identityFile: e.target.value })} placeholder="C:\Users\you\.ssh\id_ed25519" spellCheck={false} />
            </label>
            {problem && draft.host.trim() && <p className="muted cb-hint">{problem}</p>}
            <div className="btn-row">
              <button type="button" className="btn" disabled={!!problem || !draft.host.trim()} onClick={() => void save()}>
                Save host
              </button>
              <button type="button" className="btn" onClick={() => { setDraft(null); setError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
