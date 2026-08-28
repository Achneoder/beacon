import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '@beacon/shared';

/**
 * The identity JwtStrategy put on the request. Throws rather than returning undefined:
 * a handler asking for the current user is by definition not @Public().
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException();

    return user;
  },
);
