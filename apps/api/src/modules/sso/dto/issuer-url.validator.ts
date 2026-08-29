import { registerDecorator, type ValidationOptions } from 'class-validator';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * An OIDC issuer has to be https in production — its discovery document and every
 * token it hands back are bearer credentials. The one exception is a loopback host,
 * the same carve-out RFC 8252 makes for native-app redirect URIs: it is what lets a
 * developer point this at an IdP running on their own machine, and what lets the e2e
 * suite's fake IdP (`test/fake-idp.ts`) run without a certificate.
 */
export function IsIssuerUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIssuerUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;

          let url: URL;
          try {
            url = new URL(value);
          } catch {
            return false;
          }

          if (url.protocol === 'https:') return true;

          return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
        },
        defaultMessage(): string {
          return 'issuerUrl must be an https URL (loopback hosts may use http)';
        },
      },
    });
  };
}
