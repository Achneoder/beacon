import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'beacon:public';

/**
 * Requests are authenticated by default — JwtAuthGuard is registered globally. Handlers
 * that must be reachable without a session (login, registration) opt out with this.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
