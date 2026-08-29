import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  apiUrlFor,
  isServerUrl,
  readSettings,
  settingsPath,
  writeSettings,
} from './settings.js';

describe('isServerUrl', () => {
  it('accepts https, and http for an install on a private network', () => {
    expect(isServerUrl('https://beacon.example.com')).toBe(true);
    expect(isServerUrl('http://beacon.internal:8080')).toBe(true);
  });

  it('refuses anything that is not the web', () => {
    // A stored `file:` or `javascript:` must never become something the window loads.
    expect(isServerUrl('file:///etc/passwd')).toBe(false);
    expect(isServerUrl('javascript:alert(1)')).toBe(false);
    expect(isServerUrl('beacon.example.com')).toBe(false);
    expect(isServerUrl('')).toBe(false);
  });
});

describe('apiUrlFor', () => {
  it('derives the API from the server, so setup is one field', () => {
    expect(apiUrlFor({ ...DEFAULT_SETTINGS, serverUrl: 'https://beacon.example.com' })).toBe(
      'https://beacon.example.com/api',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(apiUrlFor({ ...DEFAULT_SETTINGS, serverUrl: 'https://beacon.example.com/' })).toBe(
      'https://beacon.example.com/api',
    );
  });

  it('lets a deployment that splits them say so', () => {
    expect(
      apiUrlFor({
        ...DEFAULT_SETTINGS,
        serverUrl: 'https://beacon.example.com',
        apiUrl: 'https://api.example.com',
      }),
    ).toBe('https://api.example.com');
  });

  it('is null until a server is configured', () => {
    expect(apiUrlFor(DEFAULT_SETTINGS)).toBeNull();
  });
});

describe('readSettings', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'beacon-settings-'));
    path = settingsPath(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to tracking automatically — the feature is the point', () => {
    expect(readSettings(path).autoTrack).toBe(true);
  });

  it('round-trips what was written', () => {
    const settings = { ...DEFAULT_SETTINGS, serverUrl: 'https://beacon.example.com', autoTrack: false };
    writeSettings(path, settings);

    expect(readSettings(path)).toEqual(settings);
  });

  it('discards a server address that no longer parses', () => {
    writeFileSync(path, JSON.stringify({ serverUrl: 'javascript:alert(1)' }), 'utf8');

    expect(readSettings(path).serverUrl).toBeNull();
  });

  it('falls back to the defaults rather than refusing to start on nonsense', () => {
    writeFileSync(path, 'not json at all', 'utf8');

    expect(readSettings(path)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps a lock grace that would defeat its own purpose', () => {
    writeFileSync(path, JSON.stringify({ lockGraceSeconds: 0 }), 'utf8');
    expect(readSettings(path).lockGraceSeconds).toBe(5);

    writeFileSync(path, JSON.stringify({ lockGraceSeconds: 99_999 }), 'utf8');
    expect(readSettings(path).lockGraceSeconds).toBe(600);
  });

  it('narrows a regional locale to a language it carries', () => {
    writeFileSync(path, JSON.stringify({ language: 'de-AT' }), 'utf8');

    expect(readSettings(path).language).toBe('de');
  });
});
