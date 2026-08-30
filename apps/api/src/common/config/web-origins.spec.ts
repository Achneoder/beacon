import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { parseOriginList, webBaseUrl } from './web-origins.js';

const configFor = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('parseOriginList', () => {
  it('splits, trims and drops trailing slashes', () => {
    expect(parseOriginList(' https://a.test/ , https://b.test ')).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
  });

  it.each([undefined, '', '  ', ',,'])('reads %p as no origins at all', (raw) => {
    expect(parseOriginList(raw)).toEqual([]);
  });
});

describe('webBaseUrl', () => {
  it('prefers WEB_BASE_URL', () => {
    const config = configFor({ WEB_BASE_URL: 'https://web.test/', CORS_ORIGIN: 'https://other.test' });

    expect(webBaseUrl(config)).toBe('https://web.test');
  });

  it('takes only the first CORS_ORIGIN, never the whole list', () => {
    // The bug this exists to stop: the list used whole built
    // "https://a.test,https://b.test/invite/…", a link nobody can follow.
    const config = configFor({ CORS_ORIGIN: 'https://a.test,https://b.test' });

    expect(webBaseUrl(config)).toBe('https://a.test');
  });

  it('falls back to the dev SPA when nothing is configured', () => {
    expect(webBaseUrl(configFor({}))).toBe('http://localhost:5173');
  });
});
