import { describe, expect, it } from 'vitest';
import { BEACON_PRODUCT, INSTANCE_API_VERSION, type InstanceInfo } from '@beacon/shared';
import { NetworkError, ProtocolError } from './errors.js';
import { discoverInstance, type FetchInstanceInfo } from './discovery.js';

const INFO: InstanceInfo = {
  product: BEACON_PRODUCT,
  apiVersion: INSTANCE_API_VERSION,
  setupRequired: false,
};

function fakeFetch(byUrl: Record<string, InstanceInfo | Error>): FetchInstanceInfo {
  return async (apiUrl: string) => {
    const outcome = byUrl[apiUrl];

    if (outcome === undefined) throw new NetworkError(`no fixture for ${apiUrl}`);
    if (outcome instanceof Error) throw outcome;

    return outcome;
  };
}

describe('discoverInstance', () => {
  it('rejects an address with no usable candidates before ever fetching', async () => {
    const outcome = await discoverInstance('javascript:alert(1)', fakeFetch({}));

    expect(outcome).toEqual({ ok: false, reason: 'invalid', url: 'javascript:alert(1)' });
  });

  it('keeps the first candidate that answers as Beacon', async () => {
    const fetchInfo = fakeFetch({
      'https://beacon.example.com/api': INFO,
    });

    const outcome = await discoverInstance('beacon.example.com', fetchInfo);

    expect(outcome).toEqual({
      ok: true,
      serverUrl: 'https://beacon.example.com',
      apiUrl: 'https://beacon.example.com/api',
      info: INFO,
      versionMismatch: false,
    });
  });

  it('falls through to the next candidate when the first is unreachable', async () => {
    const fetchInfo = fakeFetch({
      'https://beacon.example.com/api': new NetworkError('ECONNREFUSED'),
      'https://beacon.example.com': INFO,
    });

    const outcome = await discoverInstance('beacon.example.com', fetchInfo);

    expect(outcome).toMatchObject({ ok: true, apiUrl: 'https://beacon.example.com' });
  });

  it('reports unreachable when every candidate never answers', async () => {
    const fetchInfo = fakeFetch({
      'https://beacon.example.com/api': new NetworkError('ECONNREFUSED'),
      'https://beacon.example.com': new NetworkError('ECONNREFUSED'),
    });

    const outcome = await discoverInstance('beacon.example.com', fetchInfo);

    expect(outcome).toEqual({
      ok: false,
      reason: 'unreachable',
      url: 'https://beacon.example.com',
    });
  });

  it('reports notBeacon when something answered but never as Beacon', async () => {
    const fetchInfo = fakeFetch({
      'https://example.com/api': new ProtocolError('not JSON'),
      'https://example.com': new NetworkError('ECONNREFUSED'),
    });

    const outcome = await discoverInstance('example.com', fetchInfo);

    expect(outcome).toEqual({ ok: false, reason: 'notBeacon', url: 'https://example.com/api' });
  });

  it('prefers notBeacon over unreachable, whichever candidate produced it', async () => {
    const fetchInfo = fakeFetch({
      'https://example.com/api': new NetworkError('ECONNREFUSED'),
      'https://example.com': new ProtocolError('not JSON'),
    });

    const outcome = await discoverInstance('example.com', fetchInfo);

    expect(outcome).toEqual({ ok: false, reason: 'notBeacon', url: 'https://example.com' });
  });

  it('accepts an instance that still needs to be installed', async () => {
    const fetchInfo = fakeFetch({
      'https://beacon.example.com/api': { ...INFO, setupRequired: true },
    });

    const outcome = await discoverInstance('beacon.example.com', fetchInfo);

    expect(outcome).toMatchObject({ ok: true, info: { setupRequired: true } });
  });

  it('connects to a server with a newer contract version instead of refusing it', async () => {
    const fetchInfo = fakeFetch({
      'https://beacon.example.com/api': { ...INFO, apiVersion: INSTANCE_API_VERSION + 1 },
    });

    const outcome = await discoverInstance('beacon.example.com', fetchInfo);

    expect(outcome).toMatchObject({ ok: true, versionMismatch: true });
  });
});
