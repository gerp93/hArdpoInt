import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import type { PermissionResult, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../../shared/agentTypes';
import { isResearchUrl, isSensitivePath, readTargetPath } from './policy';
import { buildSystemPrompt } from './prompt';
import { assistantAvailable, claudeExecutablePath, loadSdk } from './sdk';
import { createHardpointServer, READ_ONLY_TOOLS, SERVER_NAME } from './tools';

/**
 * The Assistant can read and look things up, and manage mounts through the hardpoint tools. It is
 * NOT given Bash, Write or Edit: it cannot change any file or run any command of its own.
 */
const BUILTIN_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
const DISALLOWED_TOOLS = ['Bash', 'Write', 'Edit', 'NotebookEdit'];
// Read/Glob/Grep/WebFetch go through decide() (credential locations are refused, docs hosts are
// allowed, other URLs ask). Mount tools that change things ask, except as described in decide().
const AUTO_ALLOWED = ['WebSearch', ...READ_ONLY_TOOLS];
const SAVE_MOUNT = `mcp__${SERVER_NAME}__save_mount`;
const START_MOUNT = `mcp__${SERVER_NAME}__start_mount`;
const STOP_MOUNT = `mcp__${SERVER_NAME}__stop_mount`;

const MAX_TURNS = 80;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** One-line description of what an approval is for. */
export function describeTool(toolName: string, input: Record<string, unknown>): string {
  const mcpPrefix = `mcp__${SERVER_NAME}__`;
  if (toolName === 'Read') return `Read file: ${String(input.file_path ?? '')}`;
  if (toolName === 'WebFetch') return `Fetch page: ${String(input.url ?? '')}`;
  if (toolName === 'Glob' || toolName === 'Grep') {
    return `Search files: ${String(input.pattern ?? '')}${input.path ? ` in ${String(input.path)}` : ''}`;
  }
  if (toolName.startsWith(mcpPrefix)) {
    const action = toolName.slice(mcpPrefix.length);
    const mount = asRecord(input.mount);
    const target = String(mount.name ?? input.id ?? '');
    const verbs: Record<string, string> = {
      save_mount: 'Save mount',
      delete_mount: 'Delete mount',
      start_mount: 'Start',
      stop_mount: 'Stop',
    };
    return `${verbs[action] ?? action}${target ? `: ${target}` : ''}`;
  }
  return `Use ${toolName}`;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (asRecord(block).type === 'text' ? String(asRecord(block).text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export class AgentSession {
  private sessionId: string | undefined;
  private query: Query | null = null;
  private abort: AbortController | null = null;
  private pending = new Map<string, Pending>();
  private loginProcess: ReturnType<typeof spawn> | null = null;
  /** Mounts whose save the user approved this turn: starting/stopping those needs no second OK. */
  private approvedMounts = new Set<string>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get running(): boolean {
    return this.query != null;
  }

  async send(
    text: string,
    workspace: string
  ): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
    if (this.query) return { status: 'error', message: 'The assistant is still working on the last message.' };
    const available = assistantAvailable();
    if (!available.ok) return { status: 'error', message: available.message };

    try {
      fs.mkdirSync(workspace, { recursive: true });
      const sdk = await loadSdk();
      this.abort = new AbortController();
      this.query = sdk.query({
        prompt: text,
        options: {
          cwd: workspace,
          resume: this.sessionId,
          abortController: this.abort,
          pathToClaudeCodeExecutable: claudeExecutablePath(),
          // Hermetic: ignore the user's own Claude settings, hooks and skills.
          settingSources: [],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: buildSystemPrompt(workspace) },
          includePartialMessages: true,
          maxTurns: MAX_TURNS,
          tools: BUILTIN_TOOLS,
          disallowedTools: DISALLOWED_TOOLS,
          mcpServers: { [SERVER_NAME]: createHardpointServer(sdk) },
          allowedTools: AUTO_ALLOWED,
          permissionMode: 'default',
          canUseTool: (toolName, input, options) =>
            this.decide(toolName, input, options.requestId, options.signal),
        },
      });
    } catch (e) {
      this.query = null;
      this.abort = null;
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }

    this.emit({ kind: 'running', running: true });
    void this.pump(this.query);
    return { status: 'ok' };
  }

  private async pump(query: Query): Promise<void> {
    const streamed = new Map<string, string>();
    let currentMessageId = '';
    let authFailed = false;
    let authAnnounced = false;
    const announceAuth = () => {
      if (authAnnounced) return;
      authAnnounced = true;
      this.emit({ kind: 'auth_required' });
    };

    try {
      for await (const message of query) {
        const m = message as SDKMessage;
        if (m.type === 'system' && m.subtype === 'init') {
          this.sessionId = m.session_id;
        } else if (m.type === 'stream_event' && m.parent_tool_use_id == null) {
          const event = m.event;
          if (event.type === 'message_start') {
            currentMessageId = event.message.id;
          } else if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta' &&
            currentMessageId
          ) {
            const key = `${currentMessageId}:${event.index}`;
            const text = (streamed.get(key) ?? '') + event.delta.text;
            streamed.set(key, text);
            this.emit({ kind: 'text', key, text });
          }
        } else if (m.type === 'assistant' && m.parent_tool_use_id == null) {
          if (m.error === 'authentication_failed') authFailed = true;
          m.message.content.forEach((block, index) => {
            if (block.type === 'text') {
              if (m.error) return; // surfaced via auth_required / error below
              this.emit({ kind: 'text', key: `${m.message.id}:${index}`, text: block.text });
            } else if (block.type === 'tool_use') {
              this.emit({ kind: 'tool', id: block.id, name: block.name, input: block.input });
            }
          });
        } else if (m.type === 'user' && Array.isArray(m.message.content)) {
          for (const block of m.message.content) {
            if (typeof block === 'object' && block.type === 'tool_result') {
              this.emit({
                kind: 'tool_result',
                id: block.tool_use_id,
                isError: Boolean(block.is_error),
                text: toolResultText(block.content).slice(0, 4000),
              });
            }
          }
        } else if (m.type === 'result') {
          if (authFailed) announceAuth();
          else this.emit({ kind: 'done', costUsd: m.total_cost_usd ?? null, isError: m.is_error });
        }
      }
    } catch (e) {
      // The SDK throws after yielding an error result; a sign-in problem is already reported.
      if (authFailed) announceAuth();
      else if (!this.abort?.signal.aborted) {
        this.emit({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      this.denyAllPending('The assistant stopped.');
      this.approvedMounts.clear();
      this.query = null;
      this.abort = null;
      this.emit({ kind: 'running', running: false });
    }
  }

  /** Allow, refuse, or ask the user. Reads are open except credential locations. */
  private decide(
    toolName: string,
    input: Record<string, unknown>,
    requestId: string | undefined,
    signal: AbortSignal
  ): Promise<PermissionResult> {
    const allow = Promise.resolve<PermissionResult>({ behavior: 'allow', updatedInput: input });

    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
      const targets = [readTargetPath(toolName, input), input.pattern, input.glob].filter(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      if (targets.some((t) => isSensitivePath(t))) {
        return Promise.resolve<PermissionResult>({
          behavior: 'deny',
          message: 'Reading credentials, keys and browser profile data is not allowed.',
        });
      }
      return allow;
    }
    if (toolName === 'WebFetch' && isResearchUrl(input.url)) return allow;
    if (
      (toolName === START_MOUNT || toolName === STOP_MOUNT) &&
      typeof input.id === 'string' &&
      this.approvedMounts.has(input.id)
    ) {
      return allow;
    }
    return this.askUser(toolName, input, requestId, signal);
  }

  private askUser(
    toolName: string,
    input: Record<string, unknown>,
    requestId: string | undefined,
    signal: AbortSignal
  ): Promise<PermissionResult> {
    const id = requestId ?? randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { toolName, input, resolve });
      signal.addEventListener('abort', () => {
        if (this.pending.delete(id)) {
          this.emit({ kind: 'approval_done', requestId: id });
          resolve({ behavior: 'deny', message: 'Cancelled.' });
        }
      });
      this.emit({ kind: 'approval', requestId: id, toolName, title: describeTool(toolName, input), input });
    });
  }

  approve(requestId: string, allow: boolean): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.emit({ kind: 'approval_done', requestId });
    if (allow && pending.toolName === SAVE_MOUNT) {
      const id = asRecord(pending.input.mount).id;
      if (typeof id === 'string') this.approvedMounts.add(id);
    }
    pending.resolve(
      allow
        ? { behavior: 'allow', updatedInput: pending.input }
        : { behavior: 'deny', message: 'The user declined this action.' }
    );
  }

  private denyAllPending(message: string): void {
    for (const [id, pending] of this.pending) {
      this.emit({ kind: 'approval_done', requestId: id });
      pending.resolve({ behavior: 'deny', message });
    }
    this.pending.clear();
  }

  async interrupt(): Promise<void> {
    this.denyAllPending('Interrupted by the user.');
    try {
      await this.query?.interrupt();
    } catch {
      this.abort?.abort();
    }
  }

  async reset(): Promise<void> {
    await this.interrupt();
    this.abort?.abort();
    this.sessionId = undefined;
    this.approvedMounts.clear();
  }

  /** Run the bundled Claude's browser sign-in. The user finishes it in their browser. */
  login(): Promise<void> {
    if (this.loginProcess) return Promise.resolve();
    return new Promise((resolve) => {
      const child = spawn(claudeExecutablePath(), ['auth', 'login'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.loginProcess = child;
      let output = '';
      let announced = false;
      const finish = (event: AgentEvent) => {
        this.loginProcess = null;
        clearTimeout(timer);
        this.emit(event);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ kind: 'login', state: 'failed', message: 'Sign-in timed out.' });
      }, LOGIN_TIMEOUT_MS);

      this.emit({ kind: 'login', state: 'started' });
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (/invalid code/i.test(chunk.toString())) {
          this.emit({
            kind: 'login',
            state: 'started',
            url: output.match(/https:\/\/[^\s"'<>]+/)?.[0],
            message: "That code didn't work. Copy the whole code and try again.",
          });
        }
        const url = output.match(/https:\/\/[^\s"'<>]+/)?.[0];
        if (url && !announced) {
          announced = true;
          this.emit({ kind: 'login', state: 'started', url });
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (err) => finish({ kind: 'login', state: 'failed', message: err.message }));
      child.on('close', (code) =>
        finish(
          code === 0
            ? { kind: 'login', state: 'ok' }
            : { kind: 'login', state: 'failed', message: output.trim().slice(-300) || `Exited with code ${code}.` }
        )
      );
    });
  }

  /** The browser sign-in can't reach Hardpoint directly, so it shows a code to paste back. */
  submitLoginCode(code: string): void {
    const trimmed = code.trim();
    if (trimmed) this.loginProcess?.stdin?.write(`${trimmed}
`);
  }

  /** Is the bundled Claude signed in? */
  authStatus(): Promise<{ loggedIn: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(claudeExecutablePath(), ['auth', 'status'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('error', () => resolve({ loggedIn: false }));
      child.on('close', () => {
        try {
          resolve({ loggedIn: Boolean(JSON.parse(out).loggedIn) });
        } catch {
          resolve({ loggedIn: false });
        }
      });
    });
  }

  dispose(): void {
    this.denyAllPending('Hardpoint is closing.');
    this.abort?.abort();
    this.loginProcess?.kill();
  }
}
