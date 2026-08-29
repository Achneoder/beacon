import { Injectable } from '@nestjs/common';
import * as client from 'openid-client';

export interface OidcProviderConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
}

export interface DiscoveredEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * The one seam onto `openid-client` — feature code never imports the SDK directly,
 * the same containment `StorageService`/`MailService`/`SearchService` hold their own
 * vendor SDKs behind. Hand-rolling ID-token verification is the one part of this
 * phase where a subtle mistake is silent, so issuer, audience, expiry and `nonce`
 * checks all stay inside the library rather than being reimplemented here.
 */
@Injectable()
export class OidcClient {
  async discover(
    provider: OidcProviderConfig,
  ): Promise<{ configuration: client.Configuration; endpoints: DiscoveredEndpoints }> {
    const issuer = new URL(provider.issuerUrl);
    // Plain http only ever reaches here for a loopback issuer — IsIssuerUrl refuses
    // anything else — so this is the same RFC 8252 exemption the DTO validator makes,
    // not a general relaxation of openid-client's own HTTPS-only default.
    const insecure = issuer.protocol === 'http:';

    const configuration = await client.discovery(
      issuer,
      provider.clientId,
      provider.clientSecret,
      undefined,
      insecure ? { execute: [client.allowInsecureRequests] } : undefined,
    );

    const server = configuration.serverMetadata();
    if (!server.authorization_endpoint || !server.token_endpoint || !server.jwks_uri) {
      throw new Error('the issuer is missing a required OIDC endpoint');
    }

    return {
      configuration,
      endpoints: {
        issuer: server.issuer,
        authorizationEndpoint: server.authorization_endpoint,
        tokenEndpoint: server.token_endpoint,
        jwksUri: server.jwks_uri,
      },
    };
  }

  /** PKCE (S256), `state` and `nonce` are generated fresh for every attempt. */
  async buildAuthorizationRequest(
    configuration: client.Configuration,
    redirectUri: string,
    scopes: string,
  ): Promise<AuthorizationRequest> {
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();
    const nonce = client.randomNonce();

    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    return { authorizationUrl: url.href, state, nonce, codeVerifier };
  }

  /**
   * Validates `state`, `nonce` and the PKCE verifier, exchanges the code at the token
   * endpoint, and returns the ID token's verified claims. Throws on any mismatch —
   * the caller maps that to the closed `SsoErrorCode` set, never to a raw message.
   */
  async exchange(
    configuration: client.Configuration,
    callbackUrl: URL,
    checks: { state: string; nonce: string; codeVerifier: string },
  ): Promise<Record<string, unknown>> {
    const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
    });

    const claims = tokens.claims();
    if (!claims) throw new Error('the token response carried no ID token');

    return claims;
  }
}
