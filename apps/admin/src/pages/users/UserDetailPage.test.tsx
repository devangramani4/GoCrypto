import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { userDetail } from '../../test/fixtures';
import { createMockClient, renderWithProviders, signInAs } from '../../test/utils';
import { UserDetailPage } from './UserDetailPage';

function renderDetail(client: ReturnType<typeof createMockClient>) {
  return renderWithProviders(
    <Routes>
      <Route path="/users/:id" element={<UserDetailPage />} />
    </Routes>,
    { client, route: '/users/101' },
  );
}

describe('UserDetailPage', () => {
  it('freezes an account only after a reason is given', async () => {
    signInAs('RISK_MANAGER', ['users.read', 'users.freeze']);
    const user = vi.fn().mockResolvedValue(userDetail());
    const freeze = vi.fn().mockResolvedValue({ ok: true });
    renderDetail(createMockClient({ admin: { user, freeze } }));
    const ue = userEvent.setup();

    expect(await screen.findByRole('heading', { name: /alice@example\.com/ })).toBeInTheDocument();
    expect(user).toHaveBeenCalledWith('101');
    // Balances come from the detail payload (available + total columns, plus the USD total footer).
    expect(screen.getAllByText('1,500.5')).toHaveLength(2);
    expect(screen.getAllByText('$1,500.50')).toHaveLength(2); // row USD value + total footer

    await ue.click(screen.getByRole('button', { name: 'Freeze' }));
    const dialog = screen.getByRole('dialog', { name: 'Freeze account' });
    await ue.click(within(dialog).getByRole('button', { name: 'Freeze account' }));
    expect(within(dialog).getByText(/Enter a reason/)).toBeInTheDocument();
    expect(freeze).not.toHaveBeenCalled();

    await ue.type(within(dialog).getByLabelText('Reason'), 'Suspicious withdrawal pattern');
    await ue.click(within(dialog).getByRole('button', { name: 'Freeze account' }));
    await waitFor(() => expect(freeze).toHaveBeenCalledWith('101', 'Suspicious withdrawal pattern'));
  });

  it('disables actions and hides tabs the role lacks', async () => {
    signInAs('SUPPORT', ['users.read', 'users.security']);
    renderDetail(createMockClient({ admin: { user: vi.fn().mockResolvedValue(userDetail()) } }));

    await screen.findByRole('heading', { name: /alice@example\.com/ });
    expect(screen.getByRole('button', { name: 'Freeze' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke sessions' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: /Balances/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Ledger/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Orders/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Fee overrides/ })).not.toBeInTheDocument();
  });

  it('shows not-found for unknown ids', async () => {
    signInAs('SUPER_ADMIN');
    renderWithProviders(
      <Routes>
        <Route path="/users/:id" element={<UserDetailPage />} />
      </Routes>,
      { route: '/users/not-a-number' },
    );
    expect(await screen.findByText('No user with this id')).toBeInTheDocument();
  });
});
