import type { MarketDto, SecurityOverviewDto, TickerDto, UserDto } from '@gocrypto/shared-types';
import { vi } from 'vitest';

const page = () => ({ items: [], nextCursor: null });

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles accept any fixture shape */
type AnyFn = (...args: any[]) => any;
const fn = (impl?: AnyFn) => vi.fn<AnyFn>(impl);
/* eslint-enable @typescript-eslint/no-explicit-any */

export const USER: UserDto = {
  id: '42',
  uid: '10000042',
  email: 'trader@example.com',
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  displayName: 'Trader',
  role: 'USER',
  status: 'ACTIVE',
  tradingEnabled: true,
  withdrawalsEnabled: true,
  twoFactorEnabled: false,
  hasTradingPin: true,
  kycLevel: 1,
  vipTier: 0,
  permissions: [],
  createdAt: Date.UTC(2026, 0, 1),
  lastLoginAt: null,
};

export const SECURITY: SecurityOverviewDto = {
  emailVerified: true,
  phoneVerified: false,
  twoFactorEnabled: false,
  hasTradingPin: true,
  antiPhishingCodeSet: false,
  activeSessions: 1,
  devices: 1,
  passwordChangedAt: null,
  withdrawalLockUntil: null,
  securityScore: 55,
};

export const BTCUSDT: MarketDto = {
  id: 1,
  symbol: 'BTCUSDT',
  type: 'SPOT',
  displayName: 'BTC/USDT',
  base: 'BTC',
  quote: 'USDT',
  status: 'TRADING',
  tickSize: '0.01',
  stepSize: '0.00001',
  minQty: '0.00001',
  maxQty: '9000',
  minNotional: '5',
  pricePrecision: 2,
  qtyPrecision: 5,
  makerFeeRate: '0.001',
  takerFeeRate: '0.001',
  priceBand: '0.1',
};

export const BTC_TICKER: TickerDto = {
  symbol: 'BTCUSDT',
  type: 'SPOT',
  lastPrice: '50000',
  open: '49000',
  high: '51000',
  low: '48500',
  volume: '1200',
  quoteVolume: '60000000',
  priceChange: '1000',
  priceChangePercent: '0.0204',
  bestBid: '49999.99',
  bestBidQty: '1',
  bestAsk: '50000.01',
  bestAskQty: '1',
  trades: 1000,
  ts: Date.now(),
};

/** Fresh mock of every API namespace the web app touches; list endpoints resolve to empty data. */
export function createMockApi() {
  return {
    system: {
      status: fn(async () => ({
        mode: 'SANDBOX' as const,
        serverTime: Date.now(),
        version: 'test',
        simulatedDeposits: true,
      })),
    },
    auth: {
      login: fn(),
      loginMfa: fn(),
      register: fn(),
      logout: fn(async () => undefined),
      restore: fn(async () => null),
      forgotPassword: fn(),
      resetPassword: fn(),
      security: fn(async () => SECURITY),
      sessions: fn(async () => []),
      devices: fn(async () => []),
      loginHistory: fn(async () => page()),
    },
    users: { me: fn(async () => USER), settings: fn(), apiKeys: fn(async () => []), update: fn() },
    assets: { list: fn(async () => []) },
    markets: {
      list: fn(async () => []),
      tickers: fn(async () => []),
      ticker: fn(async () => BTC_TICKER),
      orderBook: fn(async (symbol: string) => ({ symbol, bids: [], asks: [], seq: 1, ts: 0 })),
      trades: fn(async () => []),
      candles: fn(async () => []),
      mark: fn(),
      get: fn(),
    },
    spot: { place: fn(), placeOco: fn(), cancel: fn(), open: fn(async () => []) },
    orders: { history: fn(async () => page()), open: fn(async () => []), cancel: fn(), cancelAll: fn() },
    trades: { history: fn(async () => page()) },
    futures: {
      account: fn(),
      positions: fn(async () => []),
      settings: fn(),
      place: fn(),
      fundingHistory: fn(async () => []),
      liquidations: fn(async () => []),
      setLeverage: fn(),
      setMarginMode: fn(),
      closePosition: fn(),
      setTpSl: fn(),
      adjustMargin: fn(),
    },
    options: {
      positions: fn(async () => []),
      open: fn(async () => []),
      account: fn(),
      settlements: fn(async () => []),
    },
    wallet: {
      overview: fn(),
      balances: fn(async () => []),
      deposits: fn(async () => page()),
      withdrawals: fn(async () => page()),
      transfers: fn(async () => page()),
      history: fn(async () => page()),
      withdrawalLimits: fn(),
      addressBook: fn(async () => []),
      validateAddress: fn(async () => ({ valid: true })),
      withdraw: fn(),
      sendWithdrawalCode: fn(),
      depositAddress: fn(),
      simulateDeposit: fn(),
      transfer: fn(),
      internalTransfer: fn(),
      cancelWithdrawal: fn(),
    },
    portfolio: {
      summary: fn(),
      allocation: fn(async () => []),
      holdings: fn(async () => []),
      performance: fn(async () => []),
      positions: fn(),
    },
    notifications: {
      list: fn(async () => page()),
      unreadCount: fn(async () => ({ count: 0 })),
      markRead: fn(),
      markAllRead: fn(),
    },
  };
}

export const mockApi = createMockApi();

export function resetMockApi(): void {
  Object.assign(mockApi, createMockApi());
}

export const fakeRealtime = {
  connectionStatus: 'connected' as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  refreshAuth: vi.fn(async () => true),
  subscribe: vi.fn(() => () => undefined),
  onStatus: vi.fn((l: (s: 'connected') => void) => {
    l('connected');
    return () => undefined;
  }),
};
