import { Organization } from './modules/organizations/organization.entity.js';
import { Role } from './modules/roles/role.entity.js';
import { Department } from './modules/departments/department.entity.js';
import { Team } from './modules/teams/team.entity.js';
import { User } from './modules/users/user.entity.js';
import { Invitation } from './modules/invitations/invitation.entity.js';
import { RefreshToken } from './modules/auth/refresh-token.entity.js';

/**
 * Explicit entity registry. MikroORM's glob-based discovery would need to require()
 * .ts sources, which breaks under ESM and Vitest — so every entity is listed here.
 * Add new entities to this array.
 */
export const ENTITIES = [Organization, Role, Department, Team, User, Invitation, RefreshToken];
