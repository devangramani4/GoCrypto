import type {
  AddressBookEntryDto,
  AdminDashboardDto,
  AdminRoleDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  AllocationItemDto,
  ApiKeyCreatedDto,
  ApiKeyDto,
  AssetDto,
  AuditLogDto,
  AuthTokens,
  BalanceDto,
  CandleDto,
  CursorPage,
  DepositAddressDto,
  DepositDto,
  DeviceDto,
  FeeScheduleDto,
  FillDto,
  FundingPaymentDto,
  FundingRateDto,
  FuturesAccountDto,
  FuturesPositionDto,
  FuturesSettingsDto,
  HoldingDto,
  LedgerEntryDto,
  LiquidationDto,
  LoginHistoryDto,
  LoginResult,
  MarginMode,
  MarketDto,
  MarketType,
  MarkPriceDto,
  NotificationDto,
  OffsetPage,
  OptionExpiryDto,
  OptionPositionDto,
  OptionsAccountDto,
  OptionsChainDto,
  OptionSettlementDto,
  OrderBookDto,
  OrderDto,
  PerformancePointDto,
  Permission,
  PlaceOrderResult,
  PortfolioSummaryDto,
  PublicTradeDto,
  RevenueReportRowDto,
  SecurityAlertDto,
  SecurityOverviewDto,
  SessionDto,
  SystemHealthDto,
  SystemStatusDto,
  TickerDto,
  Timeframe,
  TransferDto,
  TwoFactorSetupDto,
  UserDto,
  UserSettingsDto,
  WalletOverviewDto,
  WithdrawalDto,
  WithdrawalLimitsDto,
} from '@gocrypto/shared-types';
import { HttpClient, type HttpOptions, randomId } from './http';

type Q = Record<string, string | number | boolean | null | undefined>;
type Body = Record<string, unknown>;

/**
 * Typed GoCrypto API client. All decimal values are strings — never convert them to JS numbers
 * for arithmetic; use @gocrypto/trading-utils for any calculation.
 */
export class GoCryptoClient {
  readonly http: HttpClient;

  constructor(opts: HttpOptions) {
    this.http = new HttpClient(opts);
  }

  private get<T>(path: string, query?: Q, auth = true) {
    return this.http.request<T>('GET', path, { query, auth });
  }
  private post<T>(path: string, body?: unknown, opts: { auth?: boolean; idempotencyKey?: string } = {}) {
    return this.http.request<T>('POST', path, { body: body ?? {}, ...opts });
  }
  private put<T>(path: string, body?: unknown) {
    return this.http.request<T>('PUT', path, { body: body ?? {} });
  }
  private patch<T>(path: string, body?: unknown) {
    return this.http.request<T>('PATCH', path, { body: body ?? {} });
  }
  private del<T>(path: string, query?: Q) {
    return this.http.request<T>('DELETE', path, { query });
  }

  private async withTokens(res: LoginResult | { user: UserDto; tokens: AuthTokens }) {
    if ('tokens' in res && res.tokens) await this.http.setTokens(res.tokens);
    return res;
  }

  readonly system = {
    status: () => this.get<SystemStatusDto>('/api/v1/system/status', undefined, false),
  };

  readonly auth = {
    register: async (body: { email: string; password: string; displayName?: string; referralCode?: string; acceptTerms: true }) =>
      this.withTokens(await this.post<{ user: UserDto; tokens: AuthTokens }>('/api/v1/auth/register', body, { auth: false })) as Promise<{ user: UserDto; tokens: AuthTokens }>,
    login: async (body: { email: string; password: string; deviceName?: string }) =>
      this.withTokens(await this.post<LoginResult>('/api/v1/auth/login', body, { auth: false })) as Promise<LoginResult>,
    loginMfa: async (body: { mfaToken: string; code?: string; backupCode?: string }) =>
      this.withTokens(await this.post<LoginResult>('/api/v1/auth/login/2fa', body, { auth: false })) as Promise<LoginResult>,
    google: async (idToken: string) => this.withTokens(await this.post<LoginResult>('/api/v1/auth/oauth/google', { idToken }, { auth: false })) as Promise<LoginResult>,
    apple: async (identityToken: string, nonce?: string, fullName?: string) =>
      this.withTokens(await this.post<LoginResult>('/api/v1/auth/oauth/apple', { identityToken, nonce, fullName }, { auth: false })) as Promise<LoginResult>,
    logout: async () => {
      try {
        await this.http.request('POST', '/api/v1/auth/logout', { body: {} });
      } finally {
        await this.http.setTokens(null);
      }
    },
    /** Restore a session (web: from the refresh cookie; native: from secure storage). */
    restore: () => this.http.refresh(),
    sendEmailVerification: () => this.post<{ ok: true }>('/api/v1/auth/email/send-verification'),
    verifyEmail: (code: string) => this.post<{ ok: true }>('/api/v1/auth/email/verify', { code }),
    sendPhoneOtp: (phone: string) => this.post<{ ok: true }>('/api/v1/auth/phone/send-otp', { phone }),
    verifyPhone: (phone: string, code: string) => this.post<{ ok: true }>('/api/v1/auth/phone/verify', { phone, code }),
    forgotPassword: (email: string) => this.post<{ ok: true }>('/api/v1/auth/password/forgot', { email }, { auth: false }),
    resetPassword: (body: { email: string; code: string; newPassword: string }) => this.post<{ ok: true }>('/api/v1/auth/password/reset', body, { auth: false }),
    changePassword: (body: { currentPassword: string; newPassword: string; totpCode?: string }) => this.post<{ ok: true }>('/api/v1/auth/password/change', body),
    setup2fa: () => this.post<TwoFactorSetupDto>('/api/v1/auth/2fa/setup'),
    enable2fa: (code: string) => this.post<{ backupCodes: string[] }>('/api/v1/auth/2fa/enable', { code }),
    disable2fa: (code: string, password: string) => this.post<{ ok: true }>('/api/v1/auth/2fa/disable', { code, password }),
    setPin: (pin: string, password: string) => this.post<{ ok: true }>('/api/v1/auth/pin', { pin, password }),
    changePin: (currentPin: string, newPin: string) => this.put<{ ok: true }>('/api/v1/auth/pin', { currentPin, newPin }),
    verifyPin: (pin: string) => this.post<{ ok: true }>('/api/v1/auth/pin/verify', { pin }),
    security: () => this.get<SecurityOverviewDto>('/api/v1/auth/security'),
    sessions: () => this.get<SessionDto[]>('/api/v1/auth/sessions'),
    revokeSession: (id: string) => this.del<void>(`/api/v1/auth/sessions/${id}`),
    revokeOtherSessions: () => this.del<{ revoked: number }>('/api/v1/auth/sessions'),
    devices: () => this.get<DeviceDto[]>('/api/v1/auth/devices'),
    updateDevice: (id: string, body: { name?: string; trusted?: boolean }) => this.patch<{ ok: true }>(`/api/v1/auth/devices/${id}`, body),
    removeDevice: (id: string) => this.del<void>(`/api/v1/auth/devices/${id}`),
    registerPushToken: (token: string, provider: 'EXPO' | 'FCM' | 'APNS' | 'WEB') => this.post<{ ok: true }>('/api/v1/auth/devices/push-token', { token, provider }),
    unregisterPushToken: () => this.del<{ ok: true }>('/api/v1/auth/devices/push-token'),
    loginHistory: (cursor?: string) => this.get<CursorPage<LoginHistoryDto>>('/api/v1/auth/login-history', { cursor }),
  };

  readonly users = {
    me: () => this.get<UserDto>('/api/v1/users/me'),
    update: (body: { displayName?: string; locale?: string; antiPhishingCode?: string }) => this.patch<UserDto>('/api/v1/users/me', body),
    settings: () => this.get<UserSettingsDto>('/api/v1/users/me/settings'),
    updateSettings: (body: Omit<Partial<UserSettingsDto>, 'notificationPrefs'> & { notificationPrefs?: Partial<{ [C in keyof UserSettingsDto['notificationPrefs']]: Partial<UserSettingsDto['notificationPrefs'][C]> }> }) =>
      this.put<UserSettingsDto>('/api/v1/users/me/settings', body),
    apiKeys: () => this.get<ApiKeyDto[]>('/api/v1/users/me/api-keys'),
    createApiKey: (body: { label: string; permissions: string[]; ipWhitelist?: string[]; totpCode?: string }) =>
      this.post<ApiKeyCreatedDto>('/api/v1/users/me/api-keys', body),
    revokeApiKey: (id: string) => this.del<void>(`/api/v1/users/me/api-keys/${id}`),
  };

  readonly assets = {
    list: () => this.get<AssetDto[]>('/api/v1/assets', undefined, false),
  };

  readonly markets = {
    list: (type?: MarketType) => this.get<MarketDto[]>('/api/v1/markets', { type }, false),
    tickers: (type?: MarketType) => this.get<TickerDto[]>('/api/v1/markets/tickers', { type }, false),
    get: (symbol: string) => this.get<MarketDto>(`/api/v1/markets/${symbol}`, undefined, false),
    ticker: (symbol: string) => this.get<TickerDto>(`/api/v1/markets/${symbol}/ticker`, undefined, false),
    orderBook: (symbol: string, depth = 50, step?: string) => this.get<OrderBookDto>(`/api/v1/markets/${symbol}/orderbook`, { depth, step }, false),
    trades: (symbol: string, limit = 50) => this.get<PublicTradeDto[]>(`/api/v1/markets/${symbol}/trades`, { limit }, false),
    candles: (symbol: string, interval: Timeframe, opts: { from?: number; to?: number; limit?: number } = {}) =>
      this.get<CandleDto[]>(`/api/v1/markets/${symbol}/candles`, { interval, ...opts }, false),
    mark: (symbol: string) => this.get<MarkPriceDto>(`/api/v1/markets/${symbol}/mark`, undefined, false),
  };

  readonly spot = {
    place: (body: Body) => this.post<PlaceOrderResult>('/api/v1/spot/orders', body, { idempotencyKey: randomId('o') }),
    placeOco: (body: Body) => this.post<{ listId: string; orders: PlaceOrderResult[] }>('/api/v1/spot/orders/oco', body, { idempotencyKey: randomId('o') }),
    amend: (id: string, body: { price?: string; quantity?: string }) => this.patch<OrderDto>(`/api/v1/spot/orders/${id}`, body),
    cancel: (id: string) => this.del<OrderDto>(`/api/v1/spot/orders/${id}`),
    cancelAll: (symbol?: string) => this.del<{ cancelled: string[] }>('/api/v1/spot/orders', { symbol }),
    open: (symbol?: string) => this.get<OrderDto[]>('/api/v1/spot/orders/open', { symbol }),
  };

  readonly orders = {
    history: (q: { cursor?: string; limit?: number; marketType?: MarketType; symbol?: string; status?: string; side?: string; from?: number; to?: number } = {}) =>
      this.get<CursorPage<OrderDto>>('/api/v1/orders', q),
    open: (q: { marketType?: MarketType; symbol?: string } = {}) => this.get<OrderDto[]>('/api/v1/orders/open', q),
    get: (id: string) => this.get<{ order: OrderDto; fills: FillDto[]; history: { event: string; status: string; ts: number }[] }>(`/api/v1/orders/${id}`),
    cancel: (id: string) => this.del<OrderDto>(`/api/v1/orders/${id}`),
    cancelAll: (symbol?: string) => this.del<{ cancelled: string[] }>('/api/v1/orders', { symbol }),
  };

  readonly trades = {
    history: (q: { cursor?: string; limit?: number; marketType?: MarketType; symbol?: string; from?: number; to?: number } = {}) =>
      this.get<CursorPage<FillDto>>('/api/v1/trades', q),
  };

  readonly futures = {
    account: () => this.get<FuturesAccountDto>('/api/v1/futures/account'),
    positions: () => this.get<FuturesPositionDto[]>('/api/v1/futures/positions'),
    settings: (symbol: string) => this.get<FuturesSettingsDto>(`/api/v1/futures/settings/${symbol}`),
    setLeverage: (symbol: string, leverage: number) => this.post<FuturesSettingsDto>('/api/v1/futures/leverage', { symbol, leverage }),
    setMarginMode: (symbol: string, marginMode: MarginMode) => this.post<FuturesSettingsDto>('/api/v1/futures/margin-mode', { symbol, marginMode }),
    place: (body: Body) => this.post<PlaceOrderResult>('/api/v1/futures/orders', body, { idempotencyKey: randomId('f') }),
    cancel: (id: string) => this.del<OrderDto>(`/api/v1/futures/orders/${id}`),
    open: (symbol?: string) => this.get<OrderDto[]>('/api/v1/futures/orders/open', { symbol }),
    closePosition: (symbol: string, quantity?: string) => this.post<PlaceOrderResult>(`/api/v1/futures/positions/${symbol}/close`, quantity ? { quantity } : {}, { idempotencyKey: randomId('c') }),
    adjustMargin: (symbol: string, amount: string, direction: 'ADD' | 'REMOVE') =>
      this.post<FuturesPositionDto | null>(`/api/v1/futures/positions/${symbol}/margin`, { amount, direction }),
    setTpSl: (symbol: string, body: { takeProfitPrice?: string | null; stopLossPrice?: string | null }) =>
      this.post<PlaceOrderResult[]>(`/api/v1/futures/positions/${symbol}/tpsl`, body),
    fundingRates: (symbol: string) => this.get<FundingRateDto[]>(`/api/v1/futures/funding-rates/${symbol}`, undefined, false),
    fundingHistory: () => this.get<FundingPaymentDto[]>('/api/v1/futures/funding-history'),
    liquidations: () => this.get<LiquidationDto[]>('/api/v1/futures/liquidations'),
  };

  readonly options = {
    underlyings: () => this.get<string[]>('/api/v1/options/underlyings', undefined, false),
    expiries: (underlying: string) => this.get<OptionExpiryDto[]>('/api/v1/options/expiries', { underlying }, false),
    chain: (underlying: string, expiry: number) => this.get<OptionsChainDto>('/api/v1/options/chain', { underlying, expiry }, false),
    place: (body: Body) => this.post<PlaceOrderResult>('/api/v1/options/orders', body, { idempotencyKey: randomId('x') }),
    cancel: (id: string) => this.del<OrderDto>(`/api/v1/options/orders/${id}`),
    open: (symbol?: string) => this.get<OrderDto[]>('/api/v1/options/orders/open', { symbol }),
    positions: () => this.get<OptionPositionDto[]>('/api/v1/options/positions'),
    account: () => this.get<OptionsAccountDto>('/api/v1/options/account'),
    settlements: () => this.get<OptionSettlementDto[]>('/api/v1/options/settlements'),
  };

  readonly wallet = {
    overview: () => this.get<WalletOverviewDto>('/api/v1/wallet/overview'),
    balances: (account?: string, includeZero = false) => this.get<BalanceDto[]>('/api/v1/wallet/balances', { account, includeZero }),
    depositAddress: (asset: string, network: string) => this.get<DepositAddressDto>('/api/v1/wallet/deposit-address', { asset, network }),
    deposits: (cursor?: string) => this.get<CursorPage<DepositDto>>('/api/v1/wallet/deposits', { cursor }),
    simulateDeposit: (body: { asset: string; network: string; amount: string }) => this.post<DepositDto>('/api/v1/wallet/deposits/simulate', body),
    withdrawals: (cursor?: string) => this.get<CursorPage<WithdrawalDto>>('/api/v1/wallet/withdrawals', { cursor }),
    withdrawalLimits: (asset: string, network: string) => this.get<WithdrawalLimitsDto>('/api/v1/wallet/withdrawals/limits', { asset, network }),
    sendWithdrawalCode: (body: { asset: string; amount: string; address: string }) => this.post<{ ok: true }>('/api/v1/wallet/withdrawals/email-code', body),
    withdraw: (body: Body & { idempotencyKey?: string }) => {
      const idempotencyKey = (body.idempotencyKey as string | undefined) ?? randomId('w');
      return this.post<WithdrawalDto>('/api/v1/wallet/withdrawals', { ...body, idempotencyKey }, { idempotencyKey });
    },
    cancelWithdrawal: (id: string) => this.del<WithdrawalDto>(`/api/v1/wallet/withdrawals/${id}`),
    transfer: (body: { asset: string; amount: string; from: string; to: string }) => this.post<TransferDto>('/api/v1/wallet/transfer', { ...body, idempotencyKey: randomId('t') }),
    internalTransfer: (body: Body) => {
      const idempotencyKey = randomId('i');
      return this.post<TransferDto>('/api/v1/wallet/internal-transfer', { ...body, idempotencyKey }, { idempotencyKey });
    },
    transfers: (cursor?: string) => this.get<CursorPage<TransferDto>>('/api/v1/wallet/transfers', { cursor }),
    history: (q: { cursor?: string; limit?: number; asset?: string; account?: string; type?: string } = {}) =>
      this.get<CursorPage<LedgerEntryDto>>('/api/v1/wallet/history', q),
    addressBook: () => this.get<AddressBookEntryDto[]>('/api/v1/wallet/address-book'),
    addAddress: (body: { network: string; address: string; memo?: string | null; label: string }) => this.post<AddressBookEntryDto>('/api/v1/wallet/address-book', body),
    removeAddress: (id: string) => this.del<void>(`/api/v1/wallet/address-book/${id}`),
    validateAddress: (network: string, address: string, memo?: string | null) =>
      this.post<{ valid: boolean; reason?: string; normalized?: string }>('/api/v1/wallet/validate-address', { network, address, memo }),
  };

  readonly portfolio = {
    summary: () => this.get<PortfolioSummaryDto>('/api/v1/portfolio/summary'),
    allocation: () => this.get<AllocationItemDto[]>('/api/v1/portfolio/allocation'),
    holdings: () => this.get<HoldingDto[]>('/api/v1/portfolio/holdings'),
    performance: (range: '24h' | '7d' | '30d' | '90d' | '1y' = '30d') => this.get<PerformancePointDto[]>('/api/v1/portfolio/performance', { range }),
    positions: () => this.get<{ futures: FuturesPositionDto[]; options: OptionPositionDto[] }>('/api/v1/portfolio/positions'),
  };

  readonly notifications = {
    list: (q: { cursor?: string; limit?: number; unread?: boolean } = {}) =>
      this.get<CursorPage<NotificationDto>>('/api/v1/notifications', { ...q, unread: q.unread ? 'true' : undefined }),
    unreadCount: () => this.get<{ count: number }>('/api/v1/notifications/unread-count'),
    markRead: (id: string) => this.post<{ ok: true }>(`/api/v1/notifications/${id}/read`),
    markAllRead: () => this.post<{ updated: number }>('/api/v1/notifications/read-all'),
  };

  readonly admin = {
    me: () => this.get<{ userId: string; email: string | null; displayName: string | null; role: string; permissions: Permission[] }>('/api/v1/admin/me'),
    dashboard: () => this.get<AdminDashboardDto>('/api/v1/admin/dashboard'),
    users: (q: Q = {}) => this.get<OffsetPage<AdminUserListItemDto>>('/api/v1/admin/users', q),
    user: (id: string) => this.get<AdminUserDetailDto>(`/api/v1/admin/users/${id}`),
    updateUser: (id: string, body: Body) => this.patch<AdminUserDetailDto>(`/api/v1/admin/users/${id}`, body),
    freeze: (id: string, reason: string) => this.post<{ ok: true }>(`/api/v1/admin/users/${id}/freeze`, { reason }),
    unfreeze: (id: string, reason: string) => this.post<{ ok: true }>(`/api/v1/admin/users/${id}/unfreeze`, { reason }),
    disable: (id: string, reason: string) => this.post<{ ok: true }>(`/api/v1/admin/users/${id}/disable`, { reason }),
    setTrading: (id: string, enabled: boolean, reason: string) => this.post<{ ok: true }>(`/api/v1/admin/users/${id}/trading`, { enabled, reason }),
    resetSecurity: (id: string, body: { reason: string; resetTwoFactor?: boolean; resetPin?: boolean; revokeSessions?: boolean }) =>
      this.post<{ ok: true }>(`/api/v1/admin/users/${id}/reset-security`, body),
    revokeSessions: (id: string) => this.post<{ revoked: number }>(`/api/v1/admin/users/${id}/revoke-sessions`),
    userLoginHistory: (id: string, cursor?: string) => this.get<CursorPage<LoginHistoryDto>>(`/api/v1/admin/users/${id}/login-history`, { cursor }),
    userOrders: (id: string, q: Q = {}) => this.get<OffsetPage<OrderDto & { userEmail: string }>>(`/api/v1/admin/users/${id}/orders`, q),
    userLedger: (id: string, cursor?: string) => this.get<CursorPage<LedgerEntryDto>>(`/api/v1/admin/users/${id}/ledger`, { cursor }),
    userFees: (id: string) => this.get<{ marketType: MarketType; makerRate: string; takerRate: string; expiresAt: number | null }[]>(`/api/v1/admin/users/${id}/fees`),
    setUserFee: (id: string, body: Body) => this.put<unknown>(`/api/v1/admin/users/${id}/fees`, body),
    deleteUserFee: (id: string, marketType: MarketType) => this.del<{ ok: true }>(`/api/v1/admin/users/${id}/fees/${marketType}`),
    adjustBalance: (id: string, body: { asset: string; account: string; amount: string; reason: string }) => this.post<{ ok: true }>(`/api/v1/admin/users/${id}/adjust-balance`, body),
    markets: (type?: MarketType) => this.get<MarketDto[]>('/api/v1/admin/markets', { type }),
    createSpotMarket: (body: Body) => this.post<MarketDto>('/api/v1/admin/markets/spot', body),
    createFuturesMarket: (body: Body) => this.post<MarketDto>('/api/v1/admin/markets/futures', body),
    updateMarket: (id: number, body: Body) => this.patch<MarketDto>(`/api/v1/admin/markets/${id}`, body),
    setRiskTiers: (id: number, tiers: unknown[]) => this.put<MarketDto>(`/api/v1/admin/markets/${id}/risk-tiers`, { tiers }),
    reloadMarket: (id: number) => this.post<{ ok: true }>(`/api/v1/admin/markets/${id}/reload`),
    options: (q: Q = {}) => this.get<OffsetPage<MarketDto>>('/api/v1/admin/options', q),
    fees: () => this.get<{ schedule: FeeScheduleDto[]; withdrawal: Record<string, unknown>[] }>('/api/v1/admin/fees'),
    setFees: (fees: FeeScheduleDto[]) => this.put<FeeScheduleDto[]>('/api/v1/admin/fees', { fees }),
    updateAssetNetwork: (asset: string, network: string, body: Body) => this.patch<{ ok: true }>(`/api/v1/admin/assets/${asset}/networks/${network}`, body),
    orders: (q: Q = {}) => this.get<OffsetPage<OrderDto & { userId: string; userEmail: string }>>('/api/v1/admin/orders', q),
    cancelOrder: (id: string, reason: string) => this.post<OrderDto>(`/api/v1/admin/orders/${id}/cancel`, { reason }),
    trades: (q: Q = {}) => this.get<OffsetPage<Record<string, unknown>>>('/api/v1/admin/trades', q),
    liquidations: (q: Q = {}) => this.get<Record<string, unknown>[]>('/api/v1/admin/liquidations', q),
    deposits: (q: Q = {}) => this.get<OffsetPage<DepositDto & { userId: string; userEmail: string }>>('/api/v1/admin/deposits', q),
    withdrawals: (q: Q = {}) =>
      this.get<OffsetPage<WithdrawalDto & { userId: string; userEmail: string; riskScore: number; amountUsd: string }>>('/api/v1/admin/withdrawals', q),
    reviewWithdrawal: (id: string, decision: 'APPROVE' | 'REJECT', note?: string) =>
      this.post<WithdrawalDto>(`/api/v1/admin/withdrawals/${id}/review`, { decision, note }),
    balances: () => this.get<{ totals: Record<string, unknown>[]; system: Record<string, BalanceDto[]> }>('/api/v1/admin/balances'),
    revenue: (q: Q = {}) => this.get<RevenueReportRowDto[]>('/api/v1/admin/reports/revenue', q),
    transactions: (q: Q = {}) => this.get<Record<string, unknown>[]>('/api/v1/admin/reports/transactions', q),
    logins: (q: Q = {}) => this.get<OffsetPage<Record<string, unknown>>>('/api/v1/admin/security/logins', q),
    alerts: (q: Q = {}) => this.get<OffsetPage<SecurityAlertDto>>('/api/v1/admin/security/alerts', q),
    resolveAlert: (id: string) => this.post<{ ok: true }>(`/api/v1/admin/security/alerts/${id}/resolve`),
    ips: (hours = 24) => this.get<Record<string, unknown>[]>('/api/v1/admin/security/ips', { hours }),
    devices: (q: Q = {}) => this.get<OffsetPage<Record<string, unknown>>>('/api/v1/admin/security/devices', q),
    twoFactor: () => this.get<Record<string, number>>('/api/v1/admin/security/2fa'),
    roles: () => this.get<AdminRoleDto[]>('/api/v1/admin/roles'),
    setRolePermissions: (code: string, permissions: Permission[]) => this.put<AdminRoleDto[]>(`/api/v1/admin/roles/${code}/permissions`, { permissions }),
    auditLogs: (q: Q = {}) => this.get<{ items: AuditLogDto[]; total: number }>('/api/v1/admin/audit-logs', q),
    settings: () => this.get<Record<string, unknown>>('/api/v1/admin/settings'),
    setSetting: (key: string, value: unknown) => this.put<Record<string, unknown>>('/api/v1/admin/settings', { key, value }),
    systemHealth: () => this.get<SystemHealthDto>('/api/v1/admin/system/health'),
  };
}
