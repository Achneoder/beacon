import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { LogMailService } from './log-mail.service.js';

describe('LogMailService', () => {
  it('reports no delivery instead of throwing, so a caller can fall back', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const mail = new LogMailService();

    await expect(mail.send({ to: 'a@b.test', subject: 'hi', text: 'body' })).resolves.toBe(false);
  });
});
