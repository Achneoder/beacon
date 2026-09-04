import { describe, expect, it, vi } from 'vitest';
import { OrganizationService } from './organization.service.js';
import { Role } from '../roles/role.entity.js';

interface FakeRole {
  key: string;
  isSystem: boolean;
  permissions: string[];
}

function fakeEm(roles: FakeRole[]) {
  const fork = {
    find: vi.fn().mockResolvedValue(roles),
    flush: vi.fn().mockResolvedValue(undefined),
  };

  return { fork: vi.fn().mockReturnValue(fork), ...fork };
}

describe('OrganizationService.onModuleInit', () => {
  it('adds a permission a later DEFAULT_ROLES change introduces', async () => {
    const employee: FakeRole = { key: 'employee', isSystem: true, permissions: ['attendance:read'] };
    const em = fakeEm([employee]);
    const service = new OrganizationService(em as never);

    await service.onModuleInit();

    expect(employee.permissions).toContain('document:write');
    expect(em.flush).toHaveBeenCalledTimes(1);
  });

  it('only queries system roles the organization has not edited', async () => {
    // The query is the whole protection: a role somebody edited in the role editor
    // must never be handed to the loop below, which would rewrite it from
    // DEFAULT_ROLES on the next boot and silently undo their change.
    const em = fakeEm([]);
    const service = new OrganizationService(em as never);

    await service.onModuleInit();

    expect(em.find).toHaveBeenCalledWith(Role, { isSystem: true, customized: false });
  });

  it('does not flush when every system role already matches its defaults', async () => {
    const owner: FakeRole = {
      key: 'owner',
      isSystem: true,
      permissions: [
        'organization:read',
        'organization:manage',
        'employee:read',
        'employee:manage',
        'attendance:read',
        'attendance:write',
        'attendance:approve',
        'holiday:request',
        'holiday:approve',
        'document:read',
        'document:write',
        'document:manage',
        'project:manage',
        'time:read',
        'time:write',
        'report:read',
      ],
    };
    const em = fakeEm([owner]);
    const service = new OrganizationService(em as never);

    await service.onModuleInit();

    expect(em.flush).not.toHaveBeenCalled();
  });

  it('leaves a role whose key is not a default role untouched', async () => {
    const custom: FakeRole = { key: 'auditor', isSystem: true, permissions: ['report:read'] };
    const em = fakeEm([custom]);
    const service = new OrganizationService(em as never);

    await service.onModuleInit();

    expect(custom.permissions).toEqual(['report:read']);
    expect(em.flush).not.toHaveBeenCalled();
  });
});
