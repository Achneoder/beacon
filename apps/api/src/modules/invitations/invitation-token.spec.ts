import { describe, expect, it } from 'vitest';
import {
  acceptUrl,
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  isAcceptable,
} from './invitation-token.js';

describe('invitation tokens', () => {
  it('mints a distinct url-safe token each time', () => {
    const first = createInvitationToken();
    const second = createInvitationToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes deterministically, and never back to the token', () => {
    const token = createInvitationToken();

    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
    expect(hashInvitationToken(token)).toHaveLength(64);
    expect(hashInvitationToken(token)).not.toContain(token);
  });
});

describe('isAcceptable', () => {
  const now = new Date('2026-08-28T09:00:00Z');

  it('accepts a fresh, unspent invitation', () => {
    expect(isAcceptable({ acceptedAt: null, expiresAt: invitationExpiry(now) }, now)).toBe(true);
  });

  it('refuses one that was already spent', () => {
    expect(isAcceptable({ acceptedAt: now, expiresAt: invitationExpiry(now) }, now)).toBe(false);
  });

  it('refuses one that has expired', () => {
    const expiry = invitationExpiry(new Date('2026-08-01T09:00:00Z'));

    expect(isAcceptable({ acceptedAt: null, expiresAt: expiry }, now)).toBe(false);
  });

  it('treats the expiry instant itself as too late', () => {
    expect(isAcceptable({ acceptedAt: null, expiresAt: now }, now)).toBe(false);
  });
});

describe('acceptUrl', () => {
  it('points at the web app, not the API, and tolerates a trailing slash', () => {
    expect(acceptUrl('http://localhost:5173/', 'abc')).toBe('http://localhost:5173/invite/abc');
    expect(acceptUrl('https://beacon.app', 'abc')).toBe('https://beacon.app/invite/abc');
  });
});
