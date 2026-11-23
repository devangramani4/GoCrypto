import { ApiError } from '@gocrypto/api-client';
import type { AssetDto, WithdrawalLimitsDto } from '@gocrypto/shared-types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, resetMockApi } from '../test/mockApi';
import { renderRoute, signIn } from '../test/render';
import { WithdrawPage } from './DepositWithdraw';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  const m = await import('../test/mockApi');
  return { ...actual, api: m.mockApi, realtime: m.fakeRealtime };
});

const USDT: AssetDto = {
  symbol: 'USDT',
  name: 'Tether',
  precision: 6,
  iconUrl: null,
  depositEnabled: true,
  withdrawEnabled: true,
  usdPrice: '1',
  networks: [
    {
      code: 'TRC20',
      name: 'TRON (TRC20)',
      addressFormat: 'TRON',
      confirmations: 20,
      depositEnabled: true,
      withdrawEnabled: true,
      minDeposit: '1',
      minWithdrawal: '10',
      withdrawalFee: '1',
      withdrawalPrecision: 6,
      memoSupported: false,
      explorerTxUrl: null,
    },
  ],
};

const LIMITS: WithdrawalLimitsDto = {
  asset: 'USDT',
  network: 'TRC20',
  fee: '1',
  minAmount: '10',
  available: '500',
  dailyLimitUsd: '100000',
  usedTodayUsd: '0',
  remainingTodayUsd: '100000',
  requires: { pin: true, totp: false, emailCode: false },
};

const ADDRESS = 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9';

async function fill(amount: string) {
  renderRoute(<WithdrawPage />, { route: '/wallet/withdraw?asset=USDT', path: '/wallet/withdraw' });
  await screen.findByText('TRON (TRC20)');
  await userEvent.type(screen.getByLabelText('Address'), ADDRESS);
  await waitFor(() => expect(mockApi.wallet.validateAddress).toHaveBeenCalledWith('TRC20', ADDRESS, null));
  await screen.findByText(/Valid TRC20 address/);
  await waitFor(() => expect(screen.getByText(/You will receive/)).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText('Amount'), amount);
}

describe('Withdraw', () => {
  beforeEach(() => {
    resetMockApi();
    signIn();
    mockApi.assets.list.mockResolvedValue([USDT]);
    mockApi.wallet.withdrawalLimits.mockResolvedValue(LIMITS);
  });

  it('never lets the user withdraw more than the available balance', async () => {
    await fill('600');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText(/exceeds your available balance/)).toBeInTheDocument();
    expect(screen.queryByText('Security verification')).not.toBeInTheDocument();
    expect(mockApi.wallet.withdraw).not.toHaveBeenCalled();
  });

  it('shows the fee-adjusted amount and requires the PIN', async () => {
    mockApi.wallet.withdraw.mockResolvedValue({ id: '9', asset: 'USDT', network: 'TRC20', address: ADDRESS, memo: null, amount: '100', fee: '1', receiveAmount: '99', status: 'PROCESSING', txHash: null, riskFlags: [], reviewNote: null, createdAt: 0, completedAt: null });
    await fill('100');
    expect(screen.getByText('99 USDT')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Security verification')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm withdrawal' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Security PIN'), '135790');
    await userEvent.click(confirm);
    await waitFor(() => expect(mockApi.wallet.withdraw).toHaveBeenCalledTimes(1));
    expect(mockApi.wallet.withdraw).toHaveBeenCalledWith({
      asset: 'USDT',
      network: 'TRC20',
      address: ADDRESS,
      memo: null,
      amount: '100',
      pin: '135790',
      idempotencyKey: expect.stringMatching(/^w[A-Za-z0-9_-]{8,}$/),
    });
  });

  it('reuses the same idempotency key when retrying after a failure', async () => {
    mockApi.wallet.withdraw.mockRejectedValueOnce(new ApiError(0, null, 'Network error')).mockRejectedValueOnce(new ApiError(0, null, 'Network error'));
    await fill('50');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await userEvent.type(await screen.findByLabelText('Security PIN'), '135790');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await screen.findByText('Network error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    await waitFor(() => expect(mockApi.wallet.withdraw).toHaveBeenCalledTimes(2));
    const [first, second] = mockApi.wallet.withdraw.mock.calls.map((c) => (c as unknown as [{ idempotencyKey: string }])[0].idempotencyKey);
    expect(first).toBe(second);
  });

  it('blocks withdrawals while the account has withdrawals disabled', async () => {
    signIn({ withdrawalsEnabled: false });
    renderRoute(<WithdrawPage />, { route: '/wallet/withdraw?asset=USDT', path: '/wallet/withdraw' });
    expect(await screen.findByText(/Withdrawals are disabled for this account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDisabled();
  });
});
