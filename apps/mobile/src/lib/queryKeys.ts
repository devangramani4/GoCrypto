import type { AccountType, MarketType, Timeframe } from '@gocrypto/shared-types';

/**
 * Query key factory. Keys are hierarchical so that a prefix (e.g. ['orders']) invalidates every
 * order list at once when a realtime event arrives.
 */
export const qk = {
  me: ['me'] as const,
  security: ['auth', 'security'] as const,
  sessions: ['auth', 'sessions'] as const,
  devices: ['auth', 'devices'] as const,
  userSettings: ['user', 'settings'] as const,

  assets: ['assets'] as const,
  markets: (type?: MarketType) => ['markets', type ?? 'ALL'] as const,
  market: (symbol: string) => ['market', symbol] as const,
  tickers: ['tickers'] as const,
  ticker: (symbol: string) => ['ticker', symbol] as const,
  orderBook: (symbol: string) => ['orderbook', symbol] as const,
  publicTrades: (symbol: string) => ['publicTrades', symbol] as const,
  candles: (symbol: string, tf: Timeframe) => ['candles', symbol, tf] as const,
  mark: (symbol: string) => ['mark', symbol] as const,

  orders: ['orders'] as const,
  openOrders: (marketType: MarketType, symbol?: string) => ['orders', 'open', marketType, symbol ?? 'ALL'] as const,
  orderHistory: (marketType: MarketType, symbol?: string) =>
    ['orders', 'history', marketType, symbol ?? 'ALL'] as const,
  fills: ['fills'] as const,
  tradeHistory: (marketType: MarketType, symbol?: string) => ['fills', marketType, symbol ?? 'ALL'] as const,

  futures: ['futures'] as const,
  futuresAccount: ['futures', 'account'] as const,
  positions: ['futures', 'positions'] as const,
  futuresSettings: (symbol: string) => ['futures', 'settings', symbol] as const,

  optionsAccount: ['options', 'account'] as const,

  portfolio: ['portfolio'] as const,
  portfolioSummary: ['portfolio', 'summary'] as const,

  wallet: ['wallet'] as const,
  walletOverview: ['wallet', 'overview'] as const,
  balances: (account: AccountType) => ['wallet', 'balances', account] as const,
  depositAddress: (asset: string, network: string) => ['wallet', 'deposit-address', asset, network] as const,
  withdrawalLimits: (asset: string, network: string) => ['wallet', 'limits', asset, network] as const,
  deposits: ['wallet', 'deposits'] as const,
  withdrawals: ['wallet', 'withdrawals'] as const,
  transfers: ['wallet', 'transfers'] as const,

  notifications: ['notifications'] as const,
  notificationList: ['notifications', 'list'] as const,
  unreadCount: ['notifications', 'unread'] as const,
};
