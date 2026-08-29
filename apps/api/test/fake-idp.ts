import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';

export interface FakeIdpClaims {
  /** Defaults to a fixed subject when omitted — nothing here reads it. */
  sub?: string;
  email?: string;
  /**
   * Normally the value openid-client generated and Beacon stored for this attempt.
   * Overriding it here is how the "wrong nonce" e2e case is produced — a real IdP
   * would never do this, but simulating it is the only way to prove `OidcClient`
   * actually rejects a mismatch rather than trusting the ID token blindly.
   */
  nonce?: string;
  [claim: string]: unknown;
}

/**
 * A throwaway OIDC provider for `sso.e2e-spec.ts`: real discovery document, real JWKS,
 * real RS256-signed ID tokens — so the suite exercises `openid-client` itself rather
 * than a mock standing in for it, the same reason Mailpit sits in for a mocked
 * `MailService` elsewhere in this suite.
 *
 * Runs on plain HTTP on a loopback address. `IsIssuerUrl` and `OidcClient.discover`
 * both carve out the same RFC 8252 exemption a real local dev IdP (Keycloak on
 * localhost, say) needs, and this is what exercises it.
 *
 * There is no interactive `/authorize` step: the suite never drives a browser, so it
 * calls `issueCode()` itself to stand in for "the person finished signing in at the
 * IdP", then drives Beacon's own callback with the resulting code — the same contract
 * a real authorization response fulfils.
 */
export class FakeIdp {
  issuerUrl = '';

  private server: Server | null = null;
  private privateKey!: CryptoKey;
  private publicJwk: Record<string, unknown> = {};
  private codes = new Map<string, FakeIdpClaims>();

  async start(): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.publicJwk = { ...(await exportJWK(publicKey)), kid: 'fake-idp-key', alg: 'RS256', use: 'sig' };

    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    this.server = server;

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    this.issuerUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  /** Registers what the token endpoint hands back for one, single-use authorization code. */
  issueCode(claims: FakeIdpClaims): string {
    const code = `code-${this.codes.size}-${Math.random().toString(36).slice(2, 10)}`;
    this.codes.set(code, claims);

    return code;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.issuerUrl);

    if (url.pathname === '/.well-known/openid-configuration') {
      this.json(res, 200, {
        issuer: this.issuerUrl,
        authorization_endpoint: `${this.issuerUrl}/authorize`,
        token_endpoint: `${this.issuerUrl}/token`,
        jwks_uri: `${this.issuerUrl}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
      return;
    }

    if (url.pathname === '/jwks') {
      this.json(res, 200, { keys: [this.publicJwk] });
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      await this.handleToken(req, res);
      return;
    }

    this.json(res, 404, { error: 'not_found' });
  }

  private async handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const params = new URLSearchParams(await readBody(req));
    const code = params.get('code') ?? '';
    const claims = this.codes.get(code);
    // Authorization codes are single-use too — the same replay protection the state
    // hash gives Beacon's own side of the exchange.
    this.codes.delete(code);

    if (!claims) {
      this.json(res, 400, { error: 'invalid_grant' });
      return;
    }

    const { sub, ...rest } = claims;
    const clientId = params.get('client_id') ?? 'unknown-client';

    const idToken = await new SignJWT(rest)
      .setProtectedHeader({ alg: 'RS256', kid: 'fake-idp-key' })
      .setIssuer(this.issuerUrl)
      .setAudience(clientId)
      .setSubject(sub ?? 'fake-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.privateKey);

    this.json(res, 200, {
      access_token: 'fake-access-token',
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
