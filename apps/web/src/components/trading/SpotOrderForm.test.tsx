import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrefs } from '../../stores/session';
import { useTicket } from '../../stores/ticket';
import { BTCUSDT, mockApi, resetMockApi } from '../../test/mockApi';
import { renderRoute, signIn, signOut } from '../../test/render';
import { SpotOrderForm } from './SpotOrderForm';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  const m = await import('../../test/mockApi');
  return { ...actual, api: m.mockApi, realtime: m.fakeRealtime };
});

const balances = (usdt: string, btc = '0') => [
  { asset: 'USDT', account: 'SPOT', available: usdt, locked: '0', total: usdt, usdValue: usdt },
  { asset: 'BTC', account: 'SPOT', available: btc, locked: '0', total: btc, usdValue: '0' },
];

const placed = (over: Record<string, unknown> = {}) => ({
  order: { id: '1', symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', status: 'OPEN', quantity: '0.01', filledQuantity: '0', avgPrice: null, rejectReason: null, ...over },
  fills: [],
});

async function renderForm() {
  renderRoute(<SpotOrderForm market={BTCUSDT} />);
  // Price is prefilled from the live ticker.
  await waitFor(() => expect(screen.getByLabelText('Price')).toHaveValue('50000.00'));
}

describe('SpotOrderForm', () => {
  beforeEach(() => {
    resetMockApi();
    signIn();
    usePrefs.setState({ confirmOrders: true });
    mockApi.wallet.balances.mockResolvedValue(balances('1000', '0.5'));
  });

  it('places a limit buy with exact decimal strings after confirmation', async () => {
    mockApi.spot.place.mockResolvedValue(placed());
    await renderForm();
    await userEvent.type(screen.getByLabelText('Amount'), '0.01');
    expect(screen.getByLabelText('Total')).toHaveValue('500');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BTC' }));
    expect(await screen.findByText('Confirm buy order')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm buy' }));
    await waitFor(() => expect(mockApi.spot.place).toHaveBeenCalledTimes(1));
    expect(mockApi.spot.place).toHaveBeenCalledWith({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '50000.00', quantity: '0.01', timeInForce: 'GTC' });
    expect(await screen.findByText('Order placed')).toBeInTheDocument();
  });

  it('blocks orders that exceed the available balance (no request sent)', async () => {
    usePrefs.setState({ confirmOrders: false });
    await renderForm();
    await userEvent.type(screen.getByLabelText('Amount'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BTC' }));
    expect(await screen.findByText('Insufficient USDT balance')).toBeInTheDocument();
    expect(mockApi.spot.place).not.toHaveBeenCalled();
  });

  it('enforces the market minimum notional client-side', async () => {
    usePrefs.setState({ confirmOrders: false });
    await renderForm();
    await userEvent.type(screen.getByLabelText('Amount'), '0.00001');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BTC' }));
    expect(await screen.findByText('Order value is below the minimum notional')).toBeInTheDocument();
    expect(mockApi.spot.place).not.toHaveBeenCalled();
  });

  it('sends a market buy by quote amount', async () => {
    usePrefs.setState({ confirmOrders: false });
    mockApi.spot.place.mockResolvedValue(placed({ type: 'MARKET', status: 'FILLED', filledQuantity: '0.002', avgPrice: '50000' }));
    await renderForm();
    await userEvent.click(screen.getByRole('tab', { name: 'Market' }));
    await userEvent.type(screen.getByLabelText('Total'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BTC' }));
    await waitFor(() => expect(mockApi.spot.place).toHaveBeenCalledWith({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQuantity: '100' }));
    expect(await screen.findByText('Order filled')).toBeInTheDocument();
  });

  it('sells by percentage of the available base balance, rounded down to the step size', async () => {
    usePrefs.setState({ confirmOrders: false });
    mockApi.wallet.balances.mockResolvedValue(balances('0', '0.123456789'));
    mockApi.spot.place.mockResolvedValue(placed({ side: 'SELL' }));
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sell' }));
    await waitFor(() => expect(screen.getByText(/0\.12345 BTC|0\.12345/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('0.06172');
    await userEvent.click(screen.getByRole('button', { name: 'Sell BTC' }));
    await waitFor(() => expect(mockApi.spot.place).toHaveBeenCalledWith(expect.objectContaining({ side: 'SELL', quantity: '0.06172' })));
  });

  it('prevents duplicate submissions while an order is in flight', async () => {
    usePrefs.setState({ confirmOrders: false });
    mockApi.spot.place.mockReturnValue(new Promise(() => undefined));
    await renderForm();
    await userEvent.type(screen.getByLabelText('Amount'), '0.01');
    const button = screen.getByRole('button', { name: 'Buy BTC' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(mockApi.spot.place).toHaveBeenCalledTimes(1);
  });

  it('fills the price when an order-book level is clicked', async () => {
    await renderForm();
    act(() => useTicket.getState().pick('49000.50'));
    expect(screen.getByLabelText('Price')).toHaveValue('49000.50');
  });

  it('shows login / register actions to anonymous visitors', async () => {
    signOut();
    renderRoute(<SpotOrderForm market={BTCUSDT} />);
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy BTC' })).not.toBeInTheDocument();
  });
});
