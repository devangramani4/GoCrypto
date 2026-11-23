import type {
  AccountType,
  AddressFormatCode,
  ApiKeyPermission,
  DepositStatus,
  LedgerType,
  MarginMode,
  MarketStatus,
  MarketType,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
  OptionType,
  OrderSide,
  OrderSource,
  OrderStatus,
  OrderType,
  Platform,
  PositionSide,
  SecurityAlertType,
  TimeInForce,
  TransferType,
  TriggerState,
  UserRole,
  UserStatus,
  WithdrawalStatus,
} from './enums';
import type { Permission } from './permissions';

/** Decimal values always travel as strings; never parse them into JS numbers for money math. */
export type DecimalString = string;
/** Unix epoch milliseconds. */
export type Timestamp = number;

// ───────────────────────────── pagination ─────────────────────────────

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ───────────────────────────── system ─────────────────────────────

export interface SystemStatusDto {
  /** SANDBOX = paper trading with simulated deposits; LIVE requires a completed regulatory review. */
  mode: 'SANDBOX' | 'LIVE';
  serverTime: Timestamp;
  version: string;
  simulatedDeposits: boolean;
}

// ───────────────────────────── users & auth ─────────────────────────────

export interface UserDto {
  id: string;
  uid: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  tradingEnabled: boolean;
  withdrawalsEnabled: boolean;
  twoFactorEnabled: boolean;
  hasTradingPin: boolean;
  kycLevel: number;
  vipTier: number;
  permissions: Permission[];
  createdAt: Timestamp;
  lastLoginAt: Timestamp | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Timestamp;
  refreshTokenExpiresAt: Timestamp;
  sessionId: string;
}

export type MfaMethod = 'TOTP' | 'BACKUP_CODE';

export type LoginResult =
  | { status: 'OK'; user: UserDto; tokens: AuthTokens }
  | { status: 'MFA_REQUIRED'; mfaToken: string; methods: MfaMethod[] };

export interface SessionDto {
  id: string;
  deviceName: string | null;
  platform: Platform;
  ip: string | null;
  userAgent: string | null;
  createdAt: Timestamp;
  lastUsedAt: Timestamp;
  expiresAt: Timestamp;
  current: boolean;
}

export interface DeviceDto {
  id: string;
  deviceId: string;
  name: string | null;
  platform: Platform;
  lastIp: string | null;
  lastSeenAt: Timestamp;
  trusted: boolean;
  pushEnabled: boolean;
  createdAt: Timestamp;
  current: boolean;
}

export interface LoginHistoryDto {
  id: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  platform: Platform | null;
  deviceName: string | null;
  createdAt: Timestamp;
}

export interface SecurityOverviewDto {
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  hasTradingPin: boolean;
  antiPhishingCodeSet: boolean;
  activeSessions: number;
  devices: number;
  passwordChangedAt: Timestamp | null;
  withdrawalLockUntil: Timestamp | null;
  /** 0-100 heuristic used by clients to nudge users. */
  securityScore: number;
}

export interface TwoFactorSetupDto {
  secret: string;
  otpauthUrl: string;
}

export interface ApiKeyDto {
  id: string;
  keyId: string;
  label: string;
  permissions: ApiKeyPermission[];
  ipWhitelist: string[];
  createdAt: Timestamp;
  lastUsedAt: Timestamp | null;
  expiresAt: Timestamp | null;
}

export interface ApiKeyCreatedDto extends ApiKeyDto {
  /** Returned exactly once at creation. */
  secret: string;
}

export type NotificationPrefs = Record<NotificationCategory, Record<NotificationChannel, boolean>>;

export interface UserSettingsDto {
  notificationPrefs: NotificationPrefs;
  locale: string;
  theme: 'dark' | 'light' | 'system';
  confirmOrders: boolean;
}

// ───────────────────────────── assets & markets ─────────────────────────────

export interface NetworkDto {
  code: string;
  name: string;
  addressFormat: AddressFormatCode;
  confirmations: number;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minDeposit: DecimalString;
  minWithdrawal: DecimalString;
  withdrawalFee: DecimalString;
  withdrawalPrecision: number;
  memoSupported: boolean;
  explorerTxUrl: string | null;
}

export interface AssetDto {
  symbol: string;
  name: string;
  precision: number;
  iconUrl: string | null;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  networks: NetworkDto[];
  usdPrice: DecimalString | null;
}

export interface RiskTierDto {
  tier: number;
  maxNotional: DecimalString;
  maxLeverage: number;
  maintenanceMarginRate: DecimalString;
  maintenanceAmount: DecimalString;
}

export interface FuturesContractInfo {
  underlying: string;
  settleAsset: string;
  contractType: 'PERPETUAL';
  maxLeverage: number;
  defaultLeverage: number;
  fundingIntervalHours: number;
  liquidationFeeRate: DecimalString;
  riskTiers: RiskTierDto[];
}

export interface OptionContractInfo {
  underlying: string;
  optionType: OptionType;
  strike: DecimalString;
  expiry: Timestamp;
  contractSize: DecimalString;
  settlementPrice: DecimalString | null;
}

export interface MarketDto {
  id: number;
  symbol: string;
  type: MarketType;
  displayName: string;
  base: string;
  quote: string;
  status: MarketStatus;
  tickSize: DecimalString;
  stepSize: DecimalString;
  minQty: DecimalString;
  maxQty: DecimalString;
  minNotional: DecimalString;
  pricePrecision: number;
  qtyPrecision: number;
  makerFeeRate: DecimalString;
  takerFeeRate: DecimalString;
  priceBand: DecimalString;
  futures?: FuturesContractInfo;
  option?: OptionContractInfo;
}

export interface TickerDto {
  symbol: string;
  type: MarketType;
  lastPrice: DecimalString;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  volume: DecimalString;
  quoteVolume: DecimalString;
  priceChange: DecimalString;
  priceChangePercent: DecimalString;
  bestBid: DecimalString | null;
  bestBidQty: DecimalString | null;
  bestAsk: DecimalString | null;
  bestAskQty: DecimalString | null;
  trades: number;
  markPrice?: DecimalString;
  indexPrice?: DecimalString;
  fundingRate?: DecimalString;
  nextFundingTime?: Timestamp;
  openInterest?: DecimalString;
  ts: Timestamp;
}

export type PriceLevel = [price: DecimalString, quantity: DecimalString];

export interface OrderBookDto {
  symbol: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  seq: number;
  ts: Timestamp;
}

export interface PublicTradeDto {
  id: string;
  symbol: string;
  price: DecimalString;
  qty: DecimalString;
  quoteQty: DecimalString;
  /** Taker side. */
  side: OrderSide;
  ts: Timestamp;
}

export interface CandleDto {
  /** Open time (ms). */
  t: Timestamp;
  o: DecimalString;
  h: DecimalString;
  l: DecimalString;
  c: DecimalString;
  v: DecimalString;
  qv: DecimalString;
  n: number;
}

export interface MarkPriceDto {
  symbol: string;
  markPrice: DecimalString;
  indexPrice: DecimalString;
  fundingRate: DecimalString;
  nextFundingTime: Timestamp;
  ts: Timestamp;
}

// ───────────────────────────── orders ─────────────────────────────

export interface OrderDto {
  id: string;
  clientOrderId: string;
  symbol: string;
  marketType: MarketType;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  triggerState: TriggerState;
  price: DecimalString | null;
  stopPrice: DecimalString | null;
  quantity: DecimalString | null;
  quoteQuantity: DecimalString | null;
  filledQuantity: DecimalString;
  filledQuote: DecimalString;
  avgPrice: DecimalString | null;
  feeTotal: DecimalString;
  feeAsset: string | null;
  reduceOnly: boolean;
  postOnly: boolean;
  closePosition: boolean;
  leverage: number | null;
  marginMode: MarginMode | null;
  ocoGroupId: string | null;
  rejectReason: string | null;
  source: OrderSource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FillDto {
  id: string;
  orderId: string;
  tradeId: string;
  symbol: string;
  marketType: MarketType;
  side: OrderSide;
  isMaker: boolean;
  price: DecimalString;
  qty: DecimalString;
  quoteQty: DecimalString;
  fee: DecimalString;
  feeAsset: string;
  realizedPnl: DecimalString | null;
  ts: Timestamp;
}

export interface PlaceOrderResult {
  order: OrderDto;
  /** Present when the order was processed by the engine before the API responded. */
  fills: FillDto[];
}

// ───────────────────────────── wallet ─────────────────────────────

export interface BalanceDto {
  asset: string;
  account: AccountType;
  available: DecimalString;
  locked: DecimalString;
  total: DecimalString;
  usdValue: DecimalString;
}

export interface WalletOverviewDto {
  totalUsd: DecimalString;
  accounts: Record<AccountType, { totalUsd: DecimalString; balances: BalanceDto[] }>;
}

export interface DepositAddressDto {
  asset: string;
  network: string;
  address: string;
  memo: string | null;
}

export interface DepositDto {
  id: string;
  asset: string;
  network: string;
  address: string;
  memo: string | null;
  txHash: string;
  amount: DecimalString;
  confirmations: number;
  requiredConfirmations: number;
  status: DepositStatus;
  createdAt: Timestamp;
  creditedAt: Timestamp | null;
}

export interface WithdrawalDto {
  id: string;
  asset: string;
  network: string;
  address: string;
  memo: string | null;
  amount: DecimalString;
  fee: DecimalString;
  receiveAmount: DecimalString;
  status: WithdrawalStatus;
  txHash: string | null;
  riskFlags: string[];
  reviewNote: string | null;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
}

export interface WithdrawalLimitsDto {
  asset: string;
  network: string;
  fee: DecimalString;
  minAmount: DecimalString;
  available: DecimalString;
  dailyLimitUsd: DecimalString;
  usedTodayUsd: DecimalString;
  remainingTodayUsd: DecimalString;
  requires: { pin: boolean; totp: boolean; emailCode: boolean };
}

export interface TransferDto {
  id: string;
  asset: string;
  amount: DecimalString;
  type: TransferType;
  fromAccount: AccountType;
  toAccount: AccountType;
  direction: 'IN' | 'OUT' | 'INTERNAL';
  counterparty: string | null;
  createdAt: Timestamp;
}

export interface LedgerEntryDto {
  id: string;
  asset: string;
  account: AccountType;
  type: LedgerType;
  availableDelta: DecimalString;
  lockedDelta: DecimalString;
  availableAfter: DecimalString;
  lockedAfter: DecimalString;
  refType: string | null;
  refId: string | null;
  description: string | null;
  createdAt: Timestamp;
}

export interface AddressBookEntryDto {
  id: string;
  network: string;
  address: string;
  memo: string | null;
  label: string;
  createdAt: Timestamp;
}

// ───────────────────────────── futures ─────────────────────────────

export interface FuturesPositionDto {
  symbol: string;
  side: PositionSide;
  quantity: DecimalString;
  entryPrice: DecimalString;
  markPrice: DecimalString;
  indexPrice: DecimalString;
  liquidationPrice: DecimalString | null;
  bankruptcyPrice: DecimalString | null;
  leverage: number;
  marginMode: MarginMode;
  margin: DecimalString;
  initialMargin: DecimalString;
  maintenanceMargin: DecimalString;
  notional: DecimalString;
  unrealizedPnl: DecimalString;
  realizedPnl: DecimalString;
  roe: DecimalString;
  marginRatio: DecimalString;
  fundingFees: DecimalString;
  takeProfitPrice: DecimalString | null;
  stopLossPrice: DecimalString | null;
  updatedAt: Timestamp;
}

export interface FuturesAccountDto {
  asset: string;
  walletBalance: DecimalString;
  availableBalance: DecimalString;
  marginBalance: DecimalString;
  unrealizedPnl: DecimalString;
  positionMargin: DecimalString;
  orderMargin: DecimalString;
  maintenanceMargin: DecimalString;
  marginRatio: DecimalString;
}

export interface FuturesSettingsDto {
  symbol: string;
  leverage: number;
  marginMode: MarginMode;
  maxLeverage: number;
}

export interface FundingRateDto {
  symbol: string;
  fundingRate: DecimalString;
  fundingTime: Timestamp;
  markPrice: DecimalString;
  indexPrice: DecimalString;
}

export interface FundingPaymentDto {
  id: string;
  symbol: string;
  amount: DecimalString;
  rate: DecimalString;
  positionQty: DecimalString;
  markPrice: DecimalString;
  fundingTime: Timestamp;
}

export interface LiquidationDto {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: DecimalString;
  entryPrice: DecimalString;
  markPrice: DecimalString;
  marginMode: MarginMode;
  loss: DecimalString;
  fee: DecimalString;
  createdAt: Timestamp;
}

// ───────────────────────────── options ─────────────────────────────

export interface OptionGreeksDto {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionQuoteDto {
  symbol: string;
  bid: DecimalString | null;
  bidQty: DecimalString | null;
  ask: DecimalString | null;
  askQty: DecimalString | null;
  last: DecimalString | null;
  markPrice: DecimalString;
  markIv: number;
  bidIv: number | null;
  askIv: number | null;
  volume24h: DecimalString;
  openInterest: DecimalString;
  greeks: OptionGreeksDto;
}

export interface OptionsChainRowDto {
  strike: DecimalString;
  call: OptionQuoteDto | null;
  put: OptionQuoteDto | null;
}

export interface OptionsChainDto {
  underlying: string;
  expiry: Timestamp;
  indexPrice: DecimalString;
  atmStrike: DecimalString | null;
  rows: OptionsChainRowDto[];
  ts: Timestamp;
}

export interface OptionExpiryDto {
  expiry: Timestamp;
  daysToExpiry: number;
  contracts: number;
}

export interface OptionPositionDto {
  symbol: string;
  underlying: string;
  optionType: OptionType;
  strike: DecimalString;
  expiry: Timestamp;
  side: PositionSide;
  quantity: DecimalString;
  avgPrice: DecimalString;
  markPrice: DecimalString;
  unrealizedPnl: DecimalString;
  realizedPnl: DecimalString;
  margin: DecimalString;
  greeks: OptionGreeksDto;
  updatedAt: Timestamp;
}

export interface OptionsAccountDto {
  asset: string;
  walletBalance: DecimalString;
  availableBalance: DecimalString;
  locked: DecimalString;
  unrealizedPnl: DecimalString;
  equity: DecimalString;
  marginUsed: DecimalString;
  greeks: OptionGreeksDto;
}

export interface OptionSettlementDto {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: DecimalString;
  strike: DecimalString;
  settlementPrice: DecimalString;
  payout: DecimalString;
  createdAt: Timestamp;
}

// ───────────────────────────── portfolio ─────────────────────────────

export interface PortfolioSummaryDto {
  totalValue: DecimalString;
  availableBalance: DecimalString;
  usedMargin: DecimalString;
  unrealizedPnl: DecimalString;
  realizedPnl: DecimalString;
  todayPnl: DecimalString;
  todayPnlPercent: DecimalString;
  totalDeposits: DecimalString;
  totalWithdrawals: DecimalString;
  roi: DecimalString;
  spotValue: DecimalString;
  futuresValue: DecimalString;
  optionsValue: DecimalString;
  openOrders: number;
  openPositions: number;
  ts: Timestamp;
}

export interface AllocationItemDto {
  asset: string;
  value: DecimalString;
  percent: DecimalString;
}

export interface PerformancePointDto {
  t: Timestamp;
  value: DecimalString;
}

export interface HoldingDto {
  asset: string;
  quantity: DecimalString;
  available: DecimalString;
  locked: DecimalString;
  price: DecimalString;
  usdValue: DecimalString;
  change24h: DecimalString;
}

// ───────────────────────────── notifications ─────────────────────────────

export interface NotificationDto {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: Timestamp;
}

// ───────────────────────────── admin ─────────────────────────────

export interface AdminUserListItemDto {
  id: string;
  uid: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  tradingEnabled: boolean;
  withdrawalsEnabled: boolean;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  kycLevel: number;
  vipTier: number;
  createdAt: Timestamp;
  lastLoginAt: Timestamp | null;
}

export interface AdminUserDetailDto extends AdminUserListItemDto {
  phone: string | null;
  hasTradingPin: boolean;
  balances: BalanceDto[];
  openOrders: number;
  openPositions: number;
  devices: DeviceDto[];
  sessions: SessionDto[];
  recentLogins: LoginHistoryDto[];
}

export interface AdminDashboardDto {
  users: { total: number; new24h: number; active24h: number; frozen: number };
  trading: { volume24hUsd: DecimalString; trades24h: number; openOrders: number; openPositions: number };
  wallet: {
    pendingWithdrawals: number;
    deposits24hUsd: DecimalString;
    withdrawals24hUsd: DecimalString;
  };
  revenue: { fees24hUsd: DecimalString; fees30dUsd: DecimalString };
  security: { openAlerts: number; failedLogins24h: number };
  volumeSeries: { t: Timestamp; volumeUsd: DecimalString; feesUsd: DecimalString }[];
}

export interface AdminRoleDto {
  code: UserRole;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM';
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Timestamp;
}

export interface SecurityAlertDto {
  id: string;
  userId: string | null;
  userEmail: string | null;
  type: SecurityAlertType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  ip: string | null;
  details: Record<string, unknown> | null;
  resolvedAt: Timestamp | null;
  createdAt: Timestamp;
}

export interface FeeScheduleDto {
  marketType: MarketType;
  vipTier: number;
  makerRate: DecimalString;
  takerRate: DecimalString;
}

export interface UserFeeOverrideDto {
  userId: string;
  marketType: MarketType;
  makerRate: DecimalString;
  takerRate: DecimalString;
  expiresAt: Timestamp | null;
}

export interface RevenueReportRowDto {
  period: string;
  marketType: MarketType | 'WITHDRAWAL';
  /** Asset the fees were charged in. */
  asset: string;
  fees: DecimalString;
  trades: number;
  /** Trading: quote notional of the fills; withdrawals: amount withdrawn. Denominated in `volumeAsset`. */
  volume: DecimalString;
  volumeAsset: string;
}

export interface ServiceHealthDto {
  name: string;
  status: 'UP' | 'DOWN' | 'DEGRADED';
  lastHeartbeat: Timestamp | null;
  details: Record<string, unknown> | null;
}

export interface SystemHealthDto {
  services: ServiceHealthDto[];
  database: { status: 'UP' | 'DOWN'; latencyMs: number | null; connections: number | null };
  redis: { status: 'UP' | 'DOWN'; latencyMs: number | null; usedMemory: string | null };
  websocket: { connections: number };
  process: { uptimeSec: number; rssBytes: number; heapUsedBytes: number; cpuUserMicros: number; loadAvg: number[] };
}
