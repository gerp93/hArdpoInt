import { describe, expect, it } from 'vitest';
import {
  copyableCommand,
  describeInvocation,
  normalizeCommand,
  normalizeHost,
  sshArgs,
  validateCommand,
  validateHost,
  type SavedCommand,
  type SshHost,
} from './commandSchema';
import { dangerousCommandReason, riskReason, secretWarning } from './commandRisk';

const host: SshHost = {
  id: 'debian',
  label: 'Debian server',
  host: '192.168.68.110',
  user: 'kvg',
  port: null,
  identityFile: null,
};

const sync: SavedCommand = {
  id: 'punctual-sync',
  name: 'Punctual sync',
  group: 'Punctual',
  note: null,
  where: { kind: 'ssh', hostId: 'debian' },
  command: 'punctual sync',
  cwd: null,
  timeoutSec: 60,
  confirm: false,
};

describe('sshArgs', () => {
  it('builds the exact argv with no prompts and `--` before the destination', () => {
    expect(sshArgs(host, 'punctual sync')).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ServerAliveInterval=15',
      '-T',
      '--',
      'kvg@192.168.68.110',
      'punctual sync',
    ]);
  });

  it('adds -p and -i only when set, and uses a bare alias when there is no user', () => {
    const args = sshArgs({ ...host, user: null, host: 'homeserver', port: 2222, identityFile: 'C:\\keys\\id' }, 'uptime');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
    expect(args[args.indexOf('-i') + 1]).toBe('C:\\keys\\id');
    expect(args.slice(-3)).toEqual(['--', 'homeserver', 'uptime']);
  });
});

describe('describeInvocation / copyableCommand', () => {
  it('shows the full ssh line, and a short pasteable one', () => {
    expect(describeInvocation(sync, host)).toContain('BatchMode=yes');
    expect(describeInvocation(sync, host)).toContain('"punctual sync"');
    expect(copyableCommand(sync, host)).toBe('ssh kvg@192.168.68.110 punctual sync');
  });

  it('shows local commands with their folder', () => {
    const local: SavedCommand = { ...sync, where: { kind: 'local' }, cwd: 'C:\\tools', command: 'dir' };
    expect(describeInvocation(local, null)).toBe('(in C:\\tools) dir');
    expect(copyableCommand(local, null)).toBe('dir');
  });
});

describe('validateHost', () => {
  it('accepts normal hosts, IPs and aliases', () => {
    expect(validateHost(host)).toBeNull();
    expect(validateHost({ ...host, host: 'my-server.local', user: null })).toBeNull();
    expect(validateHost({ ...host, host: 'fe80::1' })).toBeNull();
  });

  it('rejects the fullwidth at-sign, a leading dash, spaces and bad ports', () => {
    expect(validateHost({ ...host, user: 'kvg＠192.168.68.110' })).not.toBeNull();
    expect(validateHost({ ...host, user: '-oProxyCommand=calc' })).not.toBeNull();
    expect(validateHost({ ...host, host: '-oProxyCommand=calc' })).not.toBeNull();
    expect(validateHost({ ...host, host: 'a b' })).not.toBeNull();
    expect(validateHost({ ...host, host: '１９２.168.1.1' })).not.toBeNull();
    expect(validateHost({ ...host, port: 70000 })).not.toBeNull();
    expect(validateHost({ ...host, identityFile: '-oProxyCommand=calc' })).not.toBeNull();
  });
});

describe('validateCommand', () => {
  it('accepts a good command', () => {
    expect(validateCommand(sync, [host])).toBeNull();
  });

  it('rejects multi-line, empty, dangling-host and dash-leading remote commands', () => {
    expect(validateCommand({ ...sync, command: 'a\nb' }, [host])).not.toBeNull();
    expect(validateCommand({ ...sync, command: '  ' }, [host])).not.toBeNull();
    expect(validateCommand(sync, [])).not.toBeNull();
    expect(validateCommand({ ...sync, command: '-v uptime' }, [host])).not.toBeNull();
    expect(validateCommand({ ...sync, id: 'has space' }, [host])).not.toBeNull();
    expect(validateCommand({ ...sync, timeoutSec: 0 }, [host])).not.toBeNull();
  });
});

describe('normalize', () => {
  it('drops entries without the essentials and clamps the timeout', () => {
    expect(normalizeCommand({ id: 'x', name: 'x' })).toBeNull();
    expect(normalizeCommand('nope')).toBeNull();
    expect(normalizeCommand({ id: 'x', name: 'x', command: 'dir', timeoutSec: 99999 })?.timeoutSec).toBe(3600);
    expect(normalizeCommand({ id: 'x', name: 'x', command: 'dir', timeoutSec: -4 })?.timeoutSec).toBe(1);
    expect(normalizeCommand({ id: 'x', name: 'x', command: 'dir' })?.timeoutSec).toBe(60);
  });

  it('treats an ssh command without a host as local only when kind is not ssh', () => {
    expect(normalizeCommand({ id: 'x', name: 'x', command: 'a', where: { kind: 'ssh' } })?.where).toEqual({ kind: 'local' });
    expect(normalizeCommand({ id: 'x', name: 'x', command: 'a', where: { kind: 'ssh', hostId: 'h' } })?.where).toEqual({
      kind: 'ssh',
      hostId: 'h',
    });
  });

  it('normalizes hosts', () => {
    expect(normalizeHost({ id: 'h', host: 'a.b' })).toMatchObject({ label: 'a.b', user: null, port: null });
    expect(normalizeHost({ id: 'h' })).toBeNull();
  });
});

describe('risk heuristics', () => {
  it('flags destructive and service-changing commands', () => {
    expect(dangerousCommandReason('rm -rf /tmp/x')).not.toBeNull();
    expect(riskReason('sudo systemctl restart nginx')).not.toBeNull();
    expect(riskReason('systemctl restart nginx')).not.toBeNull();
    expect(riskReason('reboot')).not.toBeNull();
    expect(riskReason('pkill python')).not.toBeNull();
    expect(riskReason('apt remove foo')).not.toBeNull();
  });

  it('leaves read-only commands alone', () => {
    expect(riskReason('punctual sync')).toBeNull();
    expect(riskReason('punctual status')).toBeNull();
    expect(riskReason('tail -n 100 /var/log/syslog')).toBeNull();
    expect(riskReason('systemctl status nginx')).toBeNull();
  });

  it('warns about secrets in commands', () => {
    expect(secretWarning('mysql --password=hunter2 -e x')).not.toBeNull();
    expect(secretWarning('curl -H "Authorization: Bearer abcdefghijklmnop" x')).not.toBeNull();
    expect(secretWarning('sshpass -p x ssh host')).not.toBeNull();
    expect(secretWarning('git clone https://user:pw@host/repo')).not.toBeNull();
    expect(secretWarning('export API_KEY=abc123')).not.toBeNull();
    expect(secretWarning('punctual sync')).toBeNull();
    expect(secretWarning('tail -n 100 /var/log/syslog')).toBeNull();
  });
});
