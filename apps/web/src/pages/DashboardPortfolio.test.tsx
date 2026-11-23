import type { PortfolioSummaryDto } from '@gocrypto/shared-types';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, resetMockApi } from '../test/mockApi';
import { renderRoute, signIn } from '../test/render';
import { DashboardPage } from './DashboardPage';
import { PortfolioPage } from './PortfolioPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  const m = await import('../test/mockApi');
  return { ...actual, api: m.mockApi, realtime: m.fakeRealtime };
});
// Canvas charts are not available in jsdom.
vi.mock('../components/chart/AreaChart', () => ({ AreaChart: () => <div data-testid="area-chart" /> }));

const SUMMARY: PortfolioSummaryDto = {
  totalValue: '12345.67',
  availableBalance: '1000',
  usedMargin: '250',
  unrealizedPnl: '12.5',
  realizedPnl: '-3.25',
  todayPnl: '45.1',
  todayPnlPercent: '0.0037',
  totalDeposits: '10000',
  totalWithdrawals: '0',
  roi: '0.2345',
  spotValue: '12000',
  futuresValue: '345.67',
  optionsValue: '0',
  openOrders: 2,
  openPositions: 1,
  ts: 0,
};

describe('Dashboard', () => {
  beforeEach(() => {
    resetMockApi();
    signIn();
    mockApi.portfolio.summary.mockResolvedValue(SUMMARY);
    mockApi.portfolio.performance.mockResolvedValue([
      { t: 1, value: '12000' },
      { t: 2, value: '12345.67' },
    ]);
  });

  it('shows balance, PnL, activity counts and the security checklist', async () => {
    renderRoute(<DashboardPage />, { route: '/dashboard', path: '/dashboard' });
    expect(await screen.findByText('$12,345.67')).toBeInTheDocument();
    expect(screen.getByText('+45.10 USD')).toBeInTheDocument();
    expect(screen.getByText('2 · 1')).toBeInTheDocument();
    expect(await screen.findByText('55/100')).toBeInTheDocument();
    expect(screen.getByText('Two-factor authentication')).toBeInTheDocument();
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});

describe('Portfolio', () => {
  beforeEach(() => {
    resetMockApi();
    signIn();
    mockApi.portfolio.summary.mockResolvedValue(SUMMARY);
    mockApi.portfolio.holdings.mockResolvedValue([
      { asset: 'BTC', quantity: '0.2', available: '0.2', locked: '0', price: '50000', usdValue: '10000', change24h: '0.0125' },
      { asset: 'USDT', quantity: '2345.67', available: '2000', locked: '345.67', price: '1', usdValue: '2345.67', change24h: '0' },
    ]);
    mockApi.portfolio.allocation.mockResolvedValue([
      { asset: 'BTC', value: '10000', percent: '0.81' },
      { asset: 'USDT', value: '2345.67', percent: '0.19' },
    ]);
  });

  it('renders summary, allocation and holdings from exact decimal strings', async () => {
    renderRoute(<PortfolioPage />, { route: '/portfolio', path: '/portfolio' });
    expect(await screen.findByText('81.0%')).toBeInTheDocument();
    expect(screen.getByText('19.0%')).toBeInTheDocument();
    expect(await screen.findByText('$10,000.00', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('+23.45%')).toBeInTheDocument();
    const table = screen.getAllByRole('table')[0]!;
    expect(within(table).getByText('2,345.67')).toBeInTheDocument();
  });
});
