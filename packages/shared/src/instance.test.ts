import { describe, expect, it } from 'vitest';
import {
  BEACON_PRODUCT,
  INSTANCE_API_VERSION,
  isInstanceInfo,
  isServerUrl,
  parseConnectLink,
  serverCandidates,
} from './instance.js';

describe('isInstanceInfo', () => {
  it('accepts the real shape', () => {
    expect(
      isInstanceInfo({ product: BEACON_PRODUCT, apiVersion: INSTANCE_API_VERSION, setupRequired: true }),
    ).toBe(true);
  });

  it('rejects anything that is not exactly that shape', () => {
    expect(isInstanceInfo(null)).toBe(false);
    expect(isInstanceInfo({})).toBe(false);
    expect(isInstanceInfo({ status: 'ok', database: 'up' })).toBe(false);
    expect(isInstanceInfo({ product: 'other', apiVersion: 1, setupRequired: true })).toBe(false);
    expect(isInstanceInfo({ product: BEACON_PRODUCT, apiVersion: '1', setupRequired: true })).toBe(
      false,
    );
    expect(isInstanceInfo({ product: BEACON_PRODUCT, apiVersion: 1 })).toBe(false);
  });
});

describe('isServerUrl', () => {
  it('accepts https, and http for an install on a private network', () => {
    expect(isServerUrl('https://beacon.example.com')).toBe(true);
    expect(isServerUrl('http://beacon.internal:8080')).toBe(true);
  });

  it('refuses anything that is not the web', () => {
    expect(isServerUrl('file:///etc/passwd')).toBe(false);
    expect(isServerUrl('javascript:alert(1)')).toBe(false);
    expect(isServerUrl('beacon.example.com')).toBe(false);
    expect(isServerUrl('')).toBe(false);
  });
});

describe('serverCandidates', () => {
  it('tries only https for a public-looking bare host', () => {
    const candidates = serverCandidates('beacon.example.com');

    expect(candidates).toEqual([
      { serverUrl: 'https://beacon.example.com', apiUrl: 'https://beacon.example.com/api' },
      { serverUrl: 'https://beacon.example.com', apiUrl: 'https://beacon.example.com' },
    ]);
  });

  it('never mistakes host:port for a scheme', () => {
    const candidates = serverCandidates('localhost:3000');

    expect(candidates.map((c) => c.apiUrl)).toEqual([
      'https://localhost:3000/api',
      'https://localhost:3000',
      'http://localhost:3000/api',
      'http://localhost:3000',
    ]);
  });

  it('adds http as a second candidate for a private-looking host', () => {
    const candidates = serverCandidates('beacon.internal');

    expect(candidates.map((c) => c.apiUrl)).toEqual([
      'https://beacon.internal/api',
      'https://beacon.internal',
      'http://beacon.internal/api',
      'http://beacon.internal',
    ]);
  });

  it('adds http for a bare intranet name and an RFC1918 address', () => {
    expect(serverCandidates('beacon').map((c) => c.apiUrl)).toEqual([
      'https://beacon/api',
      'https://beacon',
      'http://beacon/api',
      'http://beacon',
    ]);
    expect(serverCandidates('10.0.0.5').map((c) => c.apiUrl)).toEqual([
      'https://10.0.0.5/api',
      'https://10.0.0.5',
      'http://10.0.0.5/api',
      'http://10.0.0.5',
    ]);
  });

  it('brackets a bare IPv6 loopback literal and tries http, since it is private', () => {
    expect(serverCandidates('::1').map((c) => c.apiUrl)).toEqual([
      'https://[::1]/api',
      'https://[::1]',
      'http://[::1]/api',
      'http://[::1]',
    ]);
  });

  it('recognises IPv6 link-local and unique-local ranges as private too', () => {
    expect(serverCandidates('fe80::1').map((c) => c.apiUrl)[0]).toBe('https://[fe80::1]/api');
    expect(serverCandidates('fe80::1').length).toBe(4);
    expect(serverCandidates('fd12:3456::1').length).toBe(4);
  });

  it('tries only https for a public-looking IPv6 literal', () => {
    expect(serverCandidates('2001:db8::1').map((c) => c.apiUrl)).toEqual([
      'https://[2001:db8::1]/api',
      'https://[2001:db8::1]',
    ]);
  });

  it('respects an explicit scheme and stays https-only when https is typed', () => {
    expect(serverCandidates('https://beacon.example.com').map((c) => c.apiUrl)).toEqual([
      'https://beacon.example.com/api',
      'https://beacon.example.com',
    ]);
  });

  it('honours an explicit http on a public host — the user asked for it', () => {
    expect(serverCandidates('http://beacon.example.com').map((c) => c.apiUrl)).toEqual([
      'http://beacon.example.com/api',
      'http://beacon.example.com',
    ]);
  });

  it('treats a typed /api suffix as the API base itself, deriving the parent as serverUrl', () => {
    expect(serverCandidates('https://api.example.com/api')).toEqual([
      { serverUrl: 'https://api.example.com', apiUrl: 'https://api.example.com/api' },
    ]);
  });

  it('trims trailing slashes', () => {
    expect(serverCandidates('https://beacon.example.com/').map((c) => c.apiUrl)).toEqual([
      'https://beacon.example.com/api',
      'https://beacon.example.com',
    ]);
  });

  it('refuses anything that is not a web address', () => {
    expect(serverCandidates('file:///etc/passwd')).toEqual([]);
    expect(serverCandidates('javascript:alert(1)')).toEqual([]);
    expect(serverCandidates('mailto:it@example.com')).toEqual([]);
    expect(serverCandidates('')).toEqual([]);
    expect(serverCandidates('   ')).toEqual([]);
  });
});

describe('parseConnectLink', () => {
  it('reads the server address out of a well-formed link', () => {
    expect(
      parseConnectLink('beacon://connect?url=' + encodeURIComponent('https://beacon.example.com')),
    ).toBe('https://beacon.example.com');
  });

  it('rejects anything that is not exactly that shape', () => {
    expect(parseConnectLink('not a url')).toBeNull();
    expect(parseConnectLink('https://beacon.example.com/connect?url=https://x.com')).toBeNull();
    expect(parseConnectLink('beacon://open?url=https://beacon.example.com')).toBeNull();
    expect(parseConnectLink('beacon://connect')).toBeNull();
    expect(
      parseConnectLink('beacon://connect?url=' + encodeURIComponent('javascript:alert(1)')),
    ).toBeNull();
  });
});
