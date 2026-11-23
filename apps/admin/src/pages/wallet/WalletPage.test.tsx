import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { page } from '../../test/fixtures';
import { createMockClient, renderWithProviders, signInAs } from '../../test/utils';
import { WalletPage } from './WalletPage';
import type { AdminWithdrawal } from './withdrawals';

const pending: AdminWithdrawal = {
  id: '900',
  asset: 'BTC',
  network: 'BTC',
  address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  memo: null,
  amount: '1.5',
  fee: '0.0002',
  receiveAmount: '1.4998',
  status: 'PENDING_REVIEW',
  txHash: null,
  riskFlags: ['LARGE_AMOUNT', 'NEW_ADDRESS'],
  reviewNote: null,
  createdAt: Date.now() - 120_000,
  completedAt: null,
  userId: '101',
  userEmail: 'alice@example.com',
  riskScore: 70,
  amountUsd: '101250',
};

describe('WalletPage review queue', () => {
  it('requires a note to reject and approves with the review endpoint', async () => {
    signInAs('FINANCE', ['wallet.read', 'withdrawals.review', 'users.read']);
    const withdrawals = vi.fn().mockResolvedValue(page([pending]));
    const reviewWithdrawal = vi.fn().mockResolvedValue({ ...pending, status: 'APPROVED' });
    renderWithProviders(<WalletPage />, { client: createMockClient({ admin: { withdrawals, reviewWithdrawal } }), route: '/wallet' });
    const user = userEvent.setup();

    expect(await screen.findByText('Large amount')).toBeInTheDocument();
    expect(screen.getByText('New address')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alice@example.com' })).toHaveAttribute('href', '/users/101');
    expect(withdrawals).toHaveBeenCalledWith({ status: 'PENDING_REVIEW', page: 1, pageSize: 25 });

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const reject = screen.getByRole('dialog', { name: 'Reject withdrawal' });
    await user.click(within(reject).getByRole('button', { name: 'Reject withdrawal' }));
    expect(within(reject).getByText(/Enter a reason/)).toBeInTheDocument();
    expect(reviewWithdrawal).not.toHaveBeenCalled();
    await user.click(within(reject).getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    const approve = screen.getByRole('dialog', { name: 'Approve withdrawal' });
    await user.click(within(approve).getByRole('button', { name: /^Approve 1\.5 BTC/ }));
    await waitFor(() => expect(reviewWithdrawal).toHaveBeenCalledWith('900', 'APPROVE', undefined));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Approve withdrawal' })).not.toBeInTheDocument());
    expect(await screen.findByText(/Withdrawal approved/)).toBeInTheDocument();
  });

  it('disables review actions without withdrawals.review', async () => {
    signInAs('SUPPORT', ['wallet.read']);
    renderWithProviders(<WalletPage />, { client: createMockClient({ admin: { withdrawals: vi.fn().mockResolvedValue(page([pending])) } }), route: '/wallet' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByText('Read-only · requires withdrawals.review')).toBeInTheDocument();
  });
});
