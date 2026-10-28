import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandEvent, LastRun, SavedCommand, SshHost } from '../../shared/commandSchema';
import { MAX_STORED_OUTPUT } from '../../shared/commandSchema';
import { CommandRunner, buildInvocation, cleanOutput } from './runner';

const host: SshHost = { id: 'debian', label: 'Debian', host: '192.168.68.110', user: 'kvg', port: null, identityFile: null };

const sshCommand: SavedCommand = {
  id: 'sync',
  name: 'Sync',
  group: null,
  note: null,
  where: { kind: 'ssh', hostId: 'debian' },
  command: 'punctual sync',
  cwd: null,
  timeoutSec: 60,
  confirm: false,
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  kill = vi.fn();
}

function setup(opts: { maxConcurrent?: number } = {}) {
  const children: FakeChild[] = [];
  const spawnFn = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  });
  const kill = vi.fn();
  const events: CommandEvent[] = [];
  const ended: [string, LastRun][] = [];
  const runner = new CommandRunner(
    (e) => events.push(e),
    (id, run) => ended.push([id, run]),
    { spawn: spawnFn as never, kill, platform: 'win32', sshPath: 'ssh.exe', flushMs: 10, ...opts }
  );
  return { runner, children, spawnFn, kill, events, ended };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function finishWith(child: FakeChild, code: number | null) {
  child.stdout.end();
  child.stderr.end();
  child.emit('close', code);
}

describe('buildInvocation', () => {
  it('runs ssh directly with an argument list and no shell', () => {
    const inv = buildInvocation(sshCommand, host, 'win32', 'C:\\ssh.exe');
    if ('error' in inv) throw new Error(inv.error);
    expect(inv.file).toBe('C:\\ssh.exe');
    expect(inv.args.slice(-3)).toEqual(['--', 'kvg@192.168.68.110', 'punctual sync']);
    expect(inv.args).toContain('BatchMode=yes');
    expect(inv.options.shell).toBeUndefined();
    expect(inv.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(inv.isSsh).toBe(true);
  });

  it('passes a Windows local command to cmd.exe verbatim inside one pair of quotes', () => {
    const local: SavedCommand = { ...sshCommand, where: { kind: 'local' }, command: 'echo "a b" & exit 3' };
    const inv = buildInvocation(local, null, 'win32');
    if ('error' in inv) throw new Error(inv.error);
    expect(inv.file).toBe('cmd.exe');
    expect(inv.args).toEqual(['/d', '/s', '/c', '"echo "a b" & exit 3"']);
    expect(inv.options.windowsVerbatimArguments).toBe(true);
  });

  it('uses sh -c elsewhere, and rejects a missing folder or host', () => {
    const local: SavedCommand = { ...sshCommand, where: { kind: 'local' }, command: 'ls' };
    const inv = buildInvocation(local, null, 'linux');
    if ('error' in inv) throw new Error(inv.error);
    expect([inv.file, inv.args]).toEqual(['/bin/sh', ['-c', 'ls']]);
    expect(buildInvocation({ ...local, cwd: 'Z:\\definitely\\not\\here' }, null, 'linux')).toHaveProperty('error');
    expect(buildInvocation(sshCommand, null, 'win32')).toHaveProperty('error');
  });
});

describe('cleanOutput', () => {
  it('strips escape codes and normalizes line endings', () => {
    expect(cleanOutput('\u001b[31mred\u001b[0m\r\nnext')).toBe('red\nnext');
  });
});

describe('CommandRunner', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('streams output and reports exit 0 as ok', async () => {
    const { runner, children, events, ended, spawnFn } = setup();
    const result = runner.start(sshCommand, host);
    expect(result.status).toBe('started');
    expect(spawnFn).toHaveBeenCalledWith('ssh.exe', expect.arrayContaining(['--', 'kvg@192.168.68.110']), expect.anything());

    children[0].stdout.write('hello\n');
    await tick();
    vi.advanceTimersByTime(20);
    finishWith(children[0], 0);
    await tick();

    expect(events.map((e) => e.kind)).toEqual(['start', 'output', 'end']);
    expect(events[1]).toMatchObject({ kind: 'output', text: 'hello\n' });
    expect(ended).toHaveLength(1);
    expect(ended[0][1]).toMatchObject({ outcome: 'ok', exitCode: 0, outputTail: 'hello\n' });
    expect(runner.running()).toEqual([]);
  });

  it('reports a non-zero exit as failed and keeps the code', async () => {
    const { runner, children, ended } = setup();
    runner.start(sshCommand, host);
    finishWith(children[0], 255);
    await tick();
    expect(ended[0][1]).toMatchObject({ outcome: 'failed', exitCode: 255 });
  });

  it('kills the process when the timeout passes', async () => {
    const { runner, children, kill, ended } = setup();
    runner.start({ ...sshCommand, timeoutSec: 5 }, host);
    vi.advanceTimersByTime(4999);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(kill).toHaveBeenCalledTimes(1);
    finishWith(children[0], null);
    await tick();
    expect(ended[0][1]).toMatchObject({ outcome: 'timeout', exitCode: null });
  });

  it('cancels a run by id', async () => {
    const { runner, children, kill, ended } = setup();
    const result = runner.start(sshCommand, host);
    if (result.status !== 'started') throw new Error('not started');
    runner.cancel(result.runId);
    expect(kill).toHaveBeenCalledTimes(1);
    finishWith(children[0], null);
    await tick();
    expect(ended[0][1].outcome).toBe('cancelled');
  });

  it('keeps only the end of very long output', async () => {
    const { runner, children, ended } = setup();
    runner.start(sshCommand, host);
    const big = 'x'.repeat(300 * 1024);
    children[0].stdout.write(`${big}END`);
    await tick();
    finishWith(children[0], 0);
    await tick();
    const tail = ended[0][1].outputTail;
    expect(tail.length).toBe(MAX_STORED_OUTPUT);
    expect(tail.endsWith('END')).toBe(true);
  });

  it('decodes UTF-8 split across chunks and strips ANSI', async () => {
    const { runner, children, ended } = setup();
    runner.start(sshCommand, host);
    const euro = Buffer.from('€');
    children[0].stdout.write(euro.subarray(0, 1));
    children[0].stdout.write(euro.subarray(1));
    children[0].stderr.write('\u001b[32mok\u001b[0m');
    await tick();
    finishWith(children[0], 0);
    await tick();
    expect(ended[0][1].outputTail).toContain('€');
    expect(ended[0][1].outputTail).toContain('ok');
    expect(ended[0][1].outputTail).not.toContain('\u001b');
  });

  it('refuses a second run of the same command and enforces the concurrency cap', () => {
    const { runner } = setup({ maxConcurrent: 2 });
    expect(runner.start(sshCommand, host).status).toBe('started');
    expect(runner.start(sshCommand, host)).toMatchObject({ status: 'error' });
    expect(runner.start({ ...sshCommand, id: 'b' }, host).status).toBe('started');
    expect(runner.start({ ...sshCommand, id: 'c' }, host)).toMatchObject({ status: 'error' });
  });

  it('explains a missing ssh client', async () => {
    const { runner, children, ended } = setup();
    runner.start(sshCommand, host);
    children[0].emit('error', Object.assign(new Error('spawn ssh.exe ENOENT'), { code: 'ENOENT' }));
    await tick();
    expect(ended[0][1].outcome).toBe('error');
    expect(ended[0][1].outputTail).toMatch(/OpenSSH/);
    // A late close must not report a second end.
    finishWith(children[0], 1);
    await tick();
    expect(ended).toHaveLength(1);
  });
});

describe.runIf(process.platform === 'win32')('CommandRunner with a real cmd.exe', () => {
  it('runs a quoted command line and reports its exit code', async () => {
    const events: CommandEvent[] = [];
    const runner = new CommandRunner(
      (e) => events.push(e),
      () => undefined
    );
    const run = await runner.runAndWait(
      { ...sshCommand, where: { kind: 'local' }, command: 'echo "a b" & exit 3', timeoutSec: 20 },
      null
    );
    if ('error' in run) throw new Error(run.error);
    expect(run.exitCode).toBe(3);
    expect(run.outcome).toBe('failed');
    expect(run.outputTail).toContain('"a b"');
  });
});
