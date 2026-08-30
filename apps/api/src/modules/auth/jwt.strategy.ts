import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser, Permission } from '@beacon/shared';

/** Claims Beacon puts in the access token. */
export interface JwtPayload {
  sub: string;
  org: string;
  email: string;
  permissions: Permission[];
}

/**
 * The access token carries the permission set, so authorizing a request costs no
 * database round-trip. The trade-off is staleness: a permission change takes effect
 * when the token expires (JWT_EXPIRES_IN, 15 minutes by default).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      // Pinned rather than inferred. `jsonwebtoken` already restricts a string secret
      // to the HMAC family, so `alg: none` was never accepted — this is drift defence:
      // the day `JWT_SECRET` becomes a key object or a JWKS, an unpinned verifier would
      // silently widen to whatever that key type allows.
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      organizationId: payload.org,
      email: payload.email,
      permissions: payload.permissions ?? [],
    };
  }
}
