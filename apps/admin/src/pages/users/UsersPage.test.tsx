import { ApiError } from '@gocrypto/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alice, bob, page } from '../../test/fixtures';
import { createMockClient, renderWithProviders, signInAs } from '../../test/utils';
import { UsersPage } from './UsersPage';

describe('UsersPage', () => {
  beforeEach(() => signInAs('SUPER_ADMIN'));

  it('renders table rows from the mocked API client', async () => {
    const users = vi.fn().mockResolvedValue(page([alice, bob], 2));
    renderWithProviders(<UsersPage />, { client: createMockClient({ admin: { users } }), route: '/users' });

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2 users
    expect(within(rows[1]!).getByText('Alice Trader')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Active')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('2FA')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('bob@example.com')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Frozen')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('No 2FA')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Never')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1–2 of 2');
    expect(users).toHaveBeenCalledWith({ q: undefined, status: undefined, role: undefined, page: 1, pageSize: 25 });
  });

  it('passes search, filters and pagination to the API', async () => {
    const users = vi.fn().mockResolvedValue(page([alice], 60));
    renderWithProviders(<UsersPage />, { client: createMockClient({ admin: { users } }), route: '/users' });
    const user = userEvent.setup();
    await screen.findByText('alice@example.com');

    await user.type(screen.getByLabelText('Search users'), 'alice');
    await waitFor(() => expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'alice', page: 1 })));

    await user.selectOptions(screen.getByLabelText('Status'), 'FROZEN');
    await waitFor(() => expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'alice', status: 'FROZEN' })));

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'FROZEN', page: 2, pageSize: 25 })));
  });

  it('reads filters from the URL', async () => {
    const users = vi.fn().mockResolvedValue(page([bob]));
    renderWithProviders(<UsersPage />, { client: createMockClient({ admin: { users } }), route: '/users?status=FROZEN&role=USER' });
    await screen.findByText('bob@example.com');
    expect(users).toHaveBeenCalledWith({ q: undefined, status: 'FROZEN', role: 'USER', page: 1, pageSize: 25 });
    expect(screen.getByLabelText('Status')).toHaveValue('FROZEN');
  });

  it('shows an error state with retry', async () => {
    const users = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(500, { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable' } }))
      .mockResolvedValueOnce(page([alice]));
    renderWithProviders(<UsersPage />, { client: createMockClient({ admin: { users } }), route: '/users' });
    const user = userEvent.setup();

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const users = vi.fn().mockResolvedValue(page([], 0));
    renderWithProviders(<UsersPage />, { client: createMockClient({ admin: { users } }), route: '/users?q=nobody' });
    expect(await screen.findByText('No users match these filters')).toBeInTheDocument();
  });
});
