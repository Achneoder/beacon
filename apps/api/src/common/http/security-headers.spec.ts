import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { securityHeaders } from './security-headers.js';

function run(request: Partial<Request> = {}): Map<string, unknown> {
  const headers = new Map<string, unknown>();
  const response = {
    setHeader: (key: string, value: unknown) => {
      headers.set(key, value);
    },
  };
  const next = vi.fn();

  securityHeaders({ secure: false, ...request } as Request, response as unknown as Response, next);
  expect(next).toHaveBeenCalledOnce();

  return headers;
}

describe('securityHeaders', () => {
  it('marks every response no-store — the API only ever returns personal data', () => {
    expect(run().get('Cache-Control')).toBe('no-store');
  });

  it('sets the headers a JSON API actually needs', () => {
    const headers = run();

    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('announces HSTS only over TLS', () => {
    expect(run({ secure: false }).has('Strict-Transport-Security')).toBe(false);
    expect(run({ secure: true }).get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });
});
