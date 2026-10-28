import { useState } from 'react';
import type { CommandsApi, SavedCommand, SshHost } from '../../shared/commandSchema';
import { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC, copyableCommand, describeInvocation, validateCommand } from '../../shared/commandSchema';
import { riskReason, secretWarning } from '../../shared/commandRisk';
import { hardpointClient } from '../utils/api';

export function blankCommand(over: Partial<SavedCommand> = {}): SavedCommand {
  return {
    id: `cmd-${Date.now().toString(36)}`,
    name: '',
    group: null,
    note: null,
    where: { kind: 'local' },
    command: '',
    cwd: null,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    confirm: false,
    ...over,
  };
}

export function CommandEditor({
  api,
  initial,
  hosts,
  groups,
  onCancel,
  onSaved,
  onManageHosts,
}: {
  api: CommandsApi;
  initial: SavedCommand;
  hosts: SshHost[];
  groups: string[];
  onCancel: () => void;
  onSaved: () => void;
  onManageHosts: () => void;
}) {
  const [draft, setDraft] = useState<SavedCommand>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<SavedCommand>) => setDraft((d) => ({ ...d, ...patch }));
  const where = draft.where;
  const host = where.kind === 'ssh' ? (hosts.find((h) => h.id === where.hostId) ?? null) : null;
  const risk = draft.command.trim() ? riskReason(draft.command) : null;
  const secret = draft.command.trim() ? secretWarning(draft.command) : null;
  const problem = validateCommand(
    { ...draft, name: draft.name.trim() || '?', command: draft.command.trim() },
    hosts
  );
  const canPreview = draft.command.trim() && (draft.where.kind === 'local' || host);

  async function chooseFolder() {
    const pick = await hardpointClient.chooseMountDir();
    if (pick.status === 'ok') set({ cwd: pick.dir });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.save({
        ...draft,
        name: draft.name.trim(),
        command: draft.command.trim(),
        group: draft.group?.trim() || null,
        note: draft.note?.trim() || null,
        cwd: draft.where.kind === 'local' ? draft.cwd?.trim() || null : null,
      });
      if (result.status === 'error') setError(result.message);
      else onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card card-fill cb-editor">
      <div className="card-header">
        <h2>{initial.name ? 'Edit command' : 'New command'}</h2>
      </div>
      <div className="scroll-body">
        {error && <p className="banner banner-error">{error}</p>}

        <label className="cb-field">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Punctual sync" autoFocus />
        </label>

        <label className="cb-field">
          <span>Group (optional)</span>
          <input
            list="cb-groups"
            value={draft.group ?? ''}
            onChange={(e) => set({ group: e.target.value })}
            placeholder="Punctual"
          />
          <datalist id="cb-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>

        <label className="cb-field">
          <span>Runs on</span>
          <select
            value={draft.where.kind === 'ssh' ? draft.where.hostId : '__local'}
            onChange={(e) => set({ where: e.target.value === '__local' ? { kind: 'local' } : { kind: 'ssh', hostId: e.target.value } })}
          >
            <option value="__local">This PC</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                SSH: {h.label}
              </option>
            ))}
          </select>
        </label>
        {hosts.length === 0 && (
          <p className="muted cb-hint">
            To run something on another machine, add an SSH host first.{' '}
            <button type="button" className="btn btn-sm" onClick={onManageHosts}>
              Add SSH host…
            </button>
          </p>
        )}

        <label className="cb-field">
          <span>{draft.where.kind === 'ssh' ? 'Command (run by the server)' : 'Command (run by cmd.exe)'}</span>
          <input
            className="cb-mono"
            value={draft.command}
            onChange={(e) => set({ command: e.target.value })}
            placeholder={draft.where.kind === 'ssh' ? 'punctual sync' : 'dir C:\\'}
            spellCheck={false}
          />
        </label>
        {draft.where.kind === 'ssh' && (
          <p className="muted cb-hint">
            Runs exactly as typed on the server, with no prompts: use an SSH key (in ssh-agent if it has a passphrase). One line, no secrets.
          </p>
        )}

        {draft.where.kind === 'local' && (
          <div className="cb-field">
            <span>Working folder (optional)</span>
            <div className="cb-inline">
              <input value={draft.cwd ?? ''} onChange={(e) => set({ cwd: e.target.value })} placeholder="Current folder" />
              <button type="button" className="btn btn-sm" onClick={() => void chooseFolder()}>
                Choose…
              </button>
            </div>
          </div>
        )}

        <label className="cb-field cb-narrow">
          <span>Timeout (seconds)</span>
          <input
            type="number"
            min={1}
            max={MAX_TIMEOUT_SEC}
            value={draft.timeoutSec}
            onChange={(e) => set({ timeoutSec: Number(e.target.value) })}
          />
        </label>

        <label className="cb-check">
          <input
            type="checkbox"
            checked={draft.confirm || risk !== null}
            disabled={risk !== null}
            onChange={(e) => set({ confirm: e.target.checked })}
          />
          Ask before running
          {risk && <span className="muted"> — always, because this {risk}</span>}
        </label>

        <label className="cb-field">
          <span>Note (optional)</span>
          <input value={draft.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder="Sets the Samsung clocks via the server" />
        </label>

        {secret && <p className="banner banner-error">{secret}</p>}

        {canPreview ? (
          <div className="cb-field">
            <span>This will run</span>
            <code className="cmd-preview">{describeInvocation({ ...draft, command: draft.command.trim() }, host)}</code>
            {draft.where.kind === 'ssh' && (
              <span className="muted cb-hint">Same as typing: {copyableCommand({ ...draft, command: draft.command.trim() }, host)}</span>
            )}
          </div>
        ) : null}

        {problem && draft.name.trim() && draft.command.trim() && <p className="muted cb-hint">{problem}</p>}

        <div className="btn-row">
          <button type="button" className="btn" disabled={saving || !!problem || !draft.name.trim()} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="btn" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
