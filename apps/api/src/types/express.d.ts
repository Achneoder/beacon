import type { AuthenticatedUser } from '@beacon/shared';

declare global {
  namespace Express {
    // Passport's own User interface is empty; this is what JwtStrategy returns.
    interface User extends AuthenticatedUser {}
  }
}

export {};
