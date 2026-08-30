import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  effectiveServer,
  linkFromArgv,
  provisioningPaths,
  readProvisioning,
} from './provisioning.js';

describe('provisioningPaths', () => {
  it('picks a machine-level path per platform', () => {
    expect(provisioningPaths('linux', {})).toEqual(['/etc/beacon/desktop.json']);
    expect(provisioningPaths('darwin', {})).toEqual([
      '/Library/Application Support/Beacon/desktop.json',
    ]);
    expect(provisioningPaths('win32', { ProgramData: 'C:\\ProgramData' })).toEqual([
      'C:\\ProgramData\\Beacon\\desktop.json',
    ]);
  });

  it('falls back to the conventional ProgramData root on Windows', () => {
    expect(provisioningPaths('win32', {})).toEqual(['C:\\ProgramData\\Beacon\\desktop.json']);
  });
});

describe('readProvisioning', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beacon-provisioning-'));
    path = join(dir, 'desktop.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a valid file', () => {
    writeFileSync(path, JSON.stringify({ serverUrl: 'https://beacon.example.com' }), 'utf8');

    expect(readProvisioning([path], {})).toEqual({
      serverUrl: 'https://beacon.example.com',
      locked: false,
    });
  });

  it('honours locked', () => {
    writeFileSync(
      path,
      JSON.stringify({ serverUrl: 'https://beacon.example.com', locked: true }),
      'utf8',
    );

    expect(readProvisioning([path], {}).locked).toBe(true);
  });

  it('discards a malformed file rather than failing to boot', () => {
    writeFileSync(path, 'not json at all', 'utf8');

    expect(readProvisioning([path], {})).toEqual({ serverUrl: null, locked: false });
  });

  it('discards an address that is not usable', () => {
    writeFileSync(path, JSON.stringify({ serverUrl: 'javascript:alert(1)' }), 'utf8');

    expect(readProvisioning([path], {})).toEqual({ serverUrl: null, locked: false });
  });

  it('ignores unknown keys', () => {
    writeFileSync(
      path,
      JSON.stringify({ serverUrl: 'beacon.example.com', somethingElse: true }),
      'utf8',
    );

    expect(readProvisioning([path], {}).serverUrl).toBe('beacon.example.com');
  });

  it('falls back to the environment when no file exists', () => {
    expect(
      readProvisioning([path], {
        BEACON_SERVER_URL: 'https://beacon.example.com',
        BEACON_SERVER_LOCKED: 'true',
      }),
    ).toEqual({ serverUrl: 'https://beacon.example.com', locked: true });
  });

  it('prefers the file over the environment when both are present', () => {
    writeFileSync(path, JSON.stringify({ serverUrl: 'https://file.example.com' }), 'utf8');

    expect(
      readProvisioning([path], { BEACON_SERVER_URL: 'https://env.example.com' }).serverUrl,
    ).toBe('https://file.example.com');
  });

  it('is empty when nothing is provisioned', () => {
    expect(readProvisioning([path], {})).toEqual({ serverUrl: null, locked: false });
  });

  it('takes the first path that exists across several candidates', () => {
    const nested = join(dir, 'nested');
    mkdirSync(nested);
    const second = join(nested, 'desktop.json');
    writeFileSync(second, JSON.stringify({ serverUrl: 'https://second.example.com' }), 'utf8');

    expect(readProvisioning([path, second], {}).serverUrl).toBe('https://second.example.com');
  });
});

describe('effectiveServer', () => {
  it('lets the user’s own choice win over an unlocked default', () => {
    expect(
      effectiveServer('https://user.example.com', {
        serverUrl: 'https://provisioned.example.com',
        locked: false,
      }),
    ).toEqual({ serverUrl: 'https://user.example.com', locked: false });
  });

  it('falls back to the provisioned address when nothing is configured', () => {
    expect(
      effectiveServer(null, { serverUrl: 'https://provisioned.example.com', locked: false }),
    ).toEqual({ serverUrl: 'https://provisioned.example.com', locked: false });
  });

  it('lets a locked provisioning override an already-configured server', () => {
    expect(
      effectiveServer('https://user.example.com', {
        serverUrl: 'https://provisioned.example.com',
        locked: true,
      }),
    ).toEqual({ serverUrl: 'https://provisioned.example.com', locked: true });
  });

  it('is unconfigured when neither side has an address', () => {
    expect(effectiveServer(null, { serverUrl: null, locked: false })).toEqual({
      serverUrl: null,
      locked: false,
    });
  });
});

describe('linkFromArgv', () => {
  it('finds a beacon:// connect link among ordinary argv', () => {
    const link = linkFromArgv([
      '/usr/bin/beacon',
      '--foo',
      'beacon://connect?url=' + encodeURIComponent('https://beacon.example.com'),
    ]);

    expect(link).toBe('https://beacon.example.com');
  });

  it('is null when argv carries no link', () => {
    expect(linkFromArgv(['/usr/bin/beacon', '--foo'])).toBeNull();
  });
});
