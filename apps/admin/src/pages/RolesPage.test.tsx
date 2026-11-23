import { ALL_PERMISSIONS, type AdminRoleDto } from '@gocrypto/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockClient, renderWithProviders, signInAs } from '../test/utils';
import { RolesPage, groupPermissions, roleChanges } from './RolesPage';

const roles: AdminRoleDto[] = [
  { code: 'SUPPORT', name: 'Support', description: 'Customer support', isSystem: true, permissions: ['dashboard.read', 'users.read'] },
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Everything', isSystem: true, permissions: [...ALL_PERMISSIONS] },
];

describe('RolesPage', () => {
  it('keeps SUPER_ADMIN read-only and saves an edited role', async () => {
    signInAs('SUPER_ADMIN');
    const setRolePermissions = vi.fn().mockResolvedValue([{ ...roles[0], permissions: ['dashboard.read', 'users.read', 'users.freeze'] }, roles[1]]);
    renderWithProviders(<RolesPage />, { client: createMockClient({ admin: { roles: vi.fn().mockResolvedValue(roles), setRolePermissions } }) });

    const locked = await screen.findByLabelText('Super Admin: settings.write');
    expect(locked).toBeChecked();
    expect(locked).toBeDisabled();

    const freeze = screen.getByLabelText('Support: users.freeze');
    expect(freeze).not.toBeChecked();
    expect(freeze).toBeEnabled();

    const user = userEvent.setup();
    await user.click(freeze);
    await user.click(screen.getByRole('button', { name: 'Review & save (1)' }));
    const dialog = screen.getByRole('dialog', { name: 'Save role permissions' });
    expect(within(dialog).getByText('+ users.freeze')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save 1 role' }));

    await waitFor(() => expect(setRolePermissions).toHaveBeenCalledWith('SUPPORT', ['dashboard.read', 'users.read', 'users.freeze']));
    expect(setRolePermissions).toHaveBeenCalledTimes(1);
  });

  it('is read-only without roles.write', async () => {
    signInAs('VIEW_ONLY', ['roles.read']);
    renderWithProviders(<RolesPage />, { client: createMockClient({ admin: { roles: vi.fn().mockResolvedValue(roles) } }) });
    expect(await screen.findByLabelText('Support: users.read')).toBeDisabled();
    expect(screen.getByText('Read-only · requires roles.write')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review & save/ })).not.toBeInTheDocument();
  });
});

describe('role matrix helpers', () => {
  it('groups the permission catalogue by category prefix', () => {
    const groups = groupPermissions();
    expect(groups.map((g) => g.category)).toContain('withdrawals');
    expect(groups.find((g) => g.category === 'users')?.permissions).toEqual(['users.read', 'users.write', 'users.freeze', 'users.trading', 'users.security', 'users.roles']);
    expect(groups.flatMap((g) => g.permissions)).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('diffs drafts against the server and never includes SUPER_ADMIN', () => {
    const changes = roleChanges(roles, { SUPPORT: ['users.read', 'audit.read'], SUPER_ADMIN: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ added: ['audit.read'], removed: ['dashboard.read'], permissions: ['users.read', 'audit.read'] });
  });
});
