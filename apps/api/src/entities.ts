import { Organization } from './modules/organizations/organization.entity.js';

/**
 * Explicit entity registry. MikroORM's glob-based discovery would need to require()
 * .ts sources, which breaks under ESM and Vitest — so every entity is listed here.
 * Add new entities to this array.
 */
export const ENTITIES = [Organization];
