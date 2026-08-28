import type { CreateUserRequest } from '@beacon/shared';
import { PersonDto } from './employment.dto.js';

/**
 * The organization is never in the body — it comes from the access token, which is how
 * tenant isolation is enforced. Nor is a password: a created user is `invited` until
 * someone accepts an invitation for that address.
 */
export class CreateUserDto extends PersonDto implements CreateUserRequest {}
