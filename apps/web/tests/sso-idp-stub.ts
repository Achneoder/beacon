import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * The bare minimum an OIDC issuer needs to answer for `PUT /sso/settings` to accept
 * `enabled: true` — a discovery document naming plausible endpoints. That is as far as
 * this suite drives SSO: per `ROADMAP.md`'s phase 7, "No real IdP; the redirect itself
 * is the API suite's job" — `apps/api/test/sso.e2e-spec.ts` runs the full round trip
 * against a fake IdP that actually signs ID tokens. This one only has to exist long
 * enough for the settings screen's own save-and-discover flow to succeed for real.
 */
export interface StubIdp {
	issuerUrl: string;
	stop: () => Promise<void>;
}

export async function startStubIdp(): Promise<StubIdp> {
	let issuerUrl = '';

	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', issuerUrl || 'http://127.0.0.1');

		if (url.pathname === '/.well-known/openid-configuration') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					issuer: issuerUrl,
					authorization_endpoint: `${issuerUrl}/authorize`,
					token_endpoint: `${issuerUrl}/token`,
					jwks_uri: `${issuerUrl}/jwks`,
					response_types_supported: ['code'],
					subject_types_supported: ['public'],
					id_token_signing_alg_values_supported: ['RS256']
				})
			);
			return;
		}

		res.writeHead(404);
		res.end();
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	issuerUrl = `http://127.0.0.1:${port}`;

	return {
		issuerUrl,
		stop: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			})
	};
}
