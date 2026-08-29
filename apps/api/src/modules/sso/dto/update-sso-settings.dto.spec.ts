import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSsoSettingsDto } from './update-sso-settings.dto.js';

const VALID = {
  displayName: 'Okta',
  issuerUrl: 'https://example.okta.com',
  clientId: 'client-123',
  clientSecret: 'super-secret',
  enabled: true,
  enforced: false,
};

describe('UpdateSsoSettingsDto', () => {
  it('accepts a valid https issuer', async () => {
    const dto = plainToInstance(UpdateSsoSettingsDto, VALID);

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-https issuer on a real host', async () => {
    const dto = plainToInstance(UpdateSsoSettingsDto, { ...VALID, issuerUrl: 'http://example.okta.com' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'issuerUrl')).toBe(true);
  });

  it('rejects a value that is not a url at all', async () => {
    const dto = plainToInstance(UpdateSsoSettingsDto, { ...VALID, issuerUrl: 'not-a-url' });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'issuerUrl')).toBe(true);
  });

  it('allows plain http on loopback — RFC 8252\'s native-app exemption, for a local dev IdP', async () => {
    const dto = plainToInstance(UpdateSsoSettingsDto, {
      ...VALID,
      issuerUrl: 'http://localhost:8080/realms/beacon',
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a save that omits the client secret', async () => {
    const { clientSecret: _clientSecret, ...withoutSecret } = VALID;
    const dto = plainToInstance(UpdateSsoSettingsDto, withoutSecret);

    expect(await validate(dto)).toHaveLength(0);
  });
});
