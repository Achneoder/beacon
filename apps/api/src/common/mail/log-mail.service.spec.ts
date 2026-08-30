import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LogMailService } from './log-mail.service.js';

const MESSAGE = {
  to: 'invitee@example.com',
  subject: 'You have been invited',
  text: 'Set your password:\nhttps://beacon.example/invite/SUPER-SECRET-TOKEN',
};

function configFor(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('LogMailService', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Cleared, not just re-spied: `spyOn` hands back the same spy for a method it has
    // already replaced, so without this each test reads the first test's log line.
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
  });

  /** The one line this send produced. */
  const logged = () => String(warn.mock.calls.at(-1)?.[0]);

  it('never logs the body by default — an invitation body carries a live token', async () => {
    const service = new LogMailService(configFor({}));

    expect(await service.send(MESSAGE)).toBe(false);

    expect(logged()).not.toContain('SUPER-SECRET-TOKEN');
    expect(logged()).not.toContain('/invite/');
  });

  it('still records that a message was produced, and for whom', async () => {
    const service = new LogMailService(configFor({}));
    await service.send(MESSAGE);

    expect(logged()).toContain('You have been invited');
    expect(logged()).toContain('invitee@example.com');
  });

  it('logs the body only behind the explicit opt-in', async () => {
    const service = new LogMailService(configFor({ MAIL_LOG_BODY: 'true' }));
    await service.send(MESSAGE);

    expect(logged()).toContain('SUPER-SECRET-TOKEN');
  });

  it('treats any value but "true" as off', async () => {
    const service = new LogMailService(configFor({ MAIL_LOG_BODY: '1' }));
    await service.send(MESSAGE);

    expect(logged()).not.toContain('SUPER-SECRET-TOKEN');
  });
});
