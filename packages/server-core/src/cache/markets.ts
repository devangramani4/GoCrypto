import type {
  AddressFormatCode,
  AssetDto,
  MarketDto,
  MarketStatus,
  MarketType,
  NetworkDto,
  OptionType,
} from '@gocrypto/shared-types';
import { type RiskTier, toPlain } from '@gocrypto/trading-utils';
import type { Database } from '../db/database';
import { toMsStrict } from '../db/database';
import { AppError } from '../errors';

export interface FuturesInfo {
  underlyingAssetId: number;
  underlying: string;
  settleAssetId: number;
  settleAsset: string;
  contractSize: string;
  maxLeverage: number;
  defaultLeverage: number;
  fundingIntervalHours: number;
  interestRate: string;
  maxFundingRate: string;
  liquidationFeeRate: string;
  maxPositionNotional: string | null;
  riskTiers: RiskTier[];
}

export interface OptionInfo {
  underlyingAssetId: number;
  underlying: string;
  optionType: OptionType;
  strike: string;
  expiryAt: number;
  contractSize: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SETTLED';
  settlementPrice: string | null;
}

export interface MarketInfo {
  id: number;
  symbol: string;
  type: MarketType;
  displayName: string;
  baseAssetId: number;
  quoteAssetId: number;
  base: string;
  quote: string;
  status: MarketStatus;
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  maxMarketQty: string | null;
  priceBand: string;
  makerFeeRate: string | null;
  takerFeeRate: string | null;
  sortOrder: number;
  futures?: FuturesInfo;
  option?: OptionInfo;
}

export interface NetworkInfo {
  id: number;
  code: string;
  name: string;
  addressFormat: AddressFormatCode;
  confirmations: number;
  memoSupported: boolean;
  explorerTxUrl: string | null;
  isActive: boolean;
}

export interface AssetNetworkInfo {
  id: number;
  assetId: number;
  networkId: number;
  network: NetworkInfo;
  contractAddress: string | null;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  minDeposit: string;
  minWithdrawal: string;
  withdrawalFee: string;
  withdrawalPrecision: number;
}

export interface AssetInfo {
  id: number;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl: string | null;
  isActive: boolean;
  isStable: boolean;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  sortOrder: number;
  networks: AssetNetworkInfo[];
}

const plain = (v: unknown): string => toPlain(String(v ?? '0'));

/** In-memory cache of markets, contracts and risk tiers; reloaded on `config.changed`. */
export class MarketCache {
  private bySymbolMap = new Map<string, MarketInfo>();
  private byIdMap = new Map<number, MarketInfo>();
  private loadedAt = 0;

  constructor(private readonly db: Database) {}

  async load(): Promise<void> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT m.*, b.symbol AS base_symbol, q.symbol AS quote_symbol
         FROM markets m
         JOIN assets b ON b.id = m.base_asset_id
         JOIN assets q ON q.id = m.quote_asset_id`,
    );
    const futures = await this.db.query<Record<string, unknown>>(
      `SELECT fc.*, u.symbol AS underlying_symbol, s.symbol AS settle_symbol
         FROM futures_contracts fc
         JOIN assets u ON u.id = fc.underlying_asset_id
         JOIN assets s ON s.id = fc.settle_asset_id`,
    );
    const tiers = await this.db.query<Record<string, unknown>>('SELECT * FROM futures_risk_tiers ORDER BY market_id, tier');
    const options = await this.db.query<Record<string, unknown>>(
      `SELECT oc.*, u.symbol AS underlying_symbol FROM options_contracts oc JOIN assets u ON u.id = oc.underlying_asset_id`,
    );

    const tiersByMarket = new Map<number, RiskTier[]>();
    for (const t of tiers) {
      const list = tiersByMarket.get(Number(t.market_id)) ?? [];
      list.push({
        tier: Number(t.tier),
        maxNotional: plain(t.max_notional),
        maxLeverage: Number(t.max_leverage),
        maintenanceMarginRate: plain(t.maintenance_margin_rate),
        maintenanceAmount: plain(t.maintenance_amount),
      });
      tiersByMarket.set(Number(t.market_id), list);
    }
    const futuresByMarket = new Map<number, FuturesInfo>();
    for (const f of futures) {
      const id = Number(f.market_id);
      futuresByMarket.set(id, {
        underlyingAssetId: Number(f.underlying_asset_id),
        underlying: String(f.underlying_symbol),
        settleAssetId: Number(f.settle_asset_id),
        settleAsset: String(f.settle_symbol),
        contractSize: plain(f.contract_size),
        maxLeverage: Number(f.max_leverage),
        defaultLeverage: Number(f.default_leverage),
        fundingIntervalHours: Number(f.funding_interval_hours),
        interestRate: plain(f.interest_rate),
        maxFundingRate: plain(f.max_funding_rate),
        liquidationFeeRate: plain(f.liquidation_fee_rate),
        maxPositionNotional: f.max_position_notional == null ? null : plain(f.max_position_notional),
        riskTiers: tiersByMarket.get(id) ?? [],
      });
    }
    const optionsByMarket = new Map<number, OptionInfo>();
    for (const o of options) {
      optionsByMarket.set(Number(o.market_id), {
        underlyingAssetId: Number(o.underlying_asset_id),
        underlying: String(o.underlying_symbol),
        optionType: o.option_type as OptionType,
        strike: plain(o.strike),
        expiryAt: toMsStrict(o.expiry_at),
        contractSize: plain(o.contract_size),
        status: o.status as OptionInfo['status'],
        settlementPrice: o.settlement_price == null ? null : plain(o.settlement_price),
      });
    }

    const bySymbol = new Map<string, MarketInfo>();
    const byId = new Map<number, MarketInfo>();
    for (const r of rows) {
      const id = Number(r.id);
      const m: MarketInfo = {
        id,
        symbol: String(r.symbol),
        type: r.type as MarketType,
        displayName: String(r.display_name),
        baseAssetId: Number(r.base_asset_id),
        quoteAssetId: Number(r.quote_asset_id),
        base: String(r.base_symbol),
        quote: String(r.quote_symbol),
        status: r.status as MarketStatus,
        tickSize: plain(r.tick_size),
        stepSize: plain(r.step_size),
        minQty: plain(r.min_qty),
        maxQty: plain(r.max_qty),
        minNotional: plain(r.min_notional),
        maxMarketQty: r.max_market_qty == null ? null : plain(r.max_market_qty),
        priceBand: plain(r.price_band),
        makerFeeRate: r.maker_fee_rate == null ? null : plain(r.maker_fee_rate),
        takerFeeRate: r.taker_fee_rate == null ? null : plain(r.taker_fee_rate),
        sortOrder: Number(r.sort_order),
      };
      const f = futuresByMarket.get(id);
      if (f) m.futures = f;
      const o = optionsByMarket.get(id);
      if (o) m.option = o;
      bySymbol.set(m.symbol, m);
      byId.set(id, m);
    }
    this.bySymbolMap = bySymbol;
    this.byIdMap = byId;
    this.loadedAt = Date.now();
  }

  get size(): number {
    return this.byIdMap.size;
  }

  get lastLoadedAt(): number {
    return this.loadedAt;
  }

  bySymbol(symbol: string): MarketInfo | undefined {
    return this.bySymbolMap.get(symbol);
  }

  byId(id: number): MarketInfo | undefined {
    return this.byIdMap.get(id);
  }

  require(symbol: string, type?: MarketType): MarketInfo {
    const m = this.bySymbolMap.get(symbol);
    if (!m || (type && m.type !== type)) throw new AppError('MARKET_NOT_FOUND', `Market ${symbol} not found`);
    return m;
  }

  requireId(id: number): MarketInfo {
    const m = this.byIdMap.get(id);
    if (!m) throw new AppError('MARKET_NOT_FOUND', `Market ${id} not found`);
    return m;
  }

  list(type?: MarketType): MarketInfo[] {
    const all = [...this.byIdMap.values()];
    return (type ? all.filter((m) => m.type === type) : all).sort((a, b) => a.sortOrder - b.sortOrder || a.symbol.localeCompare(b.symbol));
  }

  /** Active option contracts, optionally for one underlying. */
  options(underlying?: string): MarketInfo[] {
    return this.list('OPTIONS').filter((m) => m.option && (!underlying || m.option.underlying === underlying));
  }

  /** The perpetual contract for an underlying asset, if any. */
  perpFor(underlying: string): MarketInfo | undefined {
    return this.list('FUTURES').find((m) => m.futures?.underlying === underlying);
  }

  toDto(m: MarketInfo, rates?: { maker: string; taker: string }): MarketDto {
    const dto: MarketDto = {
      id: m.id,
      symbol: m.symbol,
      type: m.type,
      displayName: m.displayName,
      base: m.base,
      quote: m.quote,
      status: m.status,
      tickSize: m.tickSize,
      stepSize: m.stepSize,
      minQty: m.minQty,
      maxQty: m.maxQty,
      minNotional: m.minNotional,
      pricePrecision: Math.max(0, decimals(m.tickSize)),
      qtyPrecision: Math.max(0, decimals(m.stepSize)),
      makerFeeRate: rates?.maker ?? m.makerFeeRate ?? '0',
      takerFeeRate: rates?.taker ?? m.takerFeeRate ?? '0',
      priceBand: m.priceBand,
    };
    if (m.futures) {
      dto.futures = {
        underlying: m.futures.underlying,
        settleAsset: m.futures.settleAsset,
        contractType: 'PERPETUAL',
        maxLeverage: m.futures.maxLeverage,
        defaultLeverage: m.futures.defaultLeverage,
        fundingIntervalHours: m.futures.fundingIntervalHours,
        liquidationFeeRate: m.futures.liquidationFeeRate,
        riskTiers: m.futures.riskTiers.map((t) => ({ ...t })),
      };
    }
    if (m.option) {
      dto.option = {
        underlying: m.option.underlying,
        optionType: m.option.optionType,
        strike: m.option.strike,
        expiry: m.option.expiryAt,
        contractSize: m.option.contractSize,
        settlementPrice: m.option.settlementPrice,
      };
    }
    return dto;
  }
}

function decimals(step: string): number {
  const i = step.indexOf('.');
  return i === -1 ? 0 : step.length - i - 1;
}

/** In-memory cache of assets and their networks. */
export class AssetCache {
  private bySymbolMap = new Map<string, AssetInfo>();
  private byIdMap = new Map<number, AssetInfo>();
  private networksByCode = new Map<string, NetworkInfo>();
  private networksById = new Map<number, NetworkInfo>();

  constructor(private readonly db: Database) {}

  async load(): Promise<void> {
    const assets = await this.db.query<Record<string, unknown>>('SELECT * FROM assets ORDER BY sort_order, symbol');
    const networks = await this.db.query<Record<string, unknown>>('SELECT * FROM networks');
    const links = await this.db.query<Record<string, unknown>>('SELECT * FROM asset_networks');
    const netById = new Map<number, NetworkInfo>();
    const netByCode = new Map<string, NetworkInfo>();
    for (const n of networks) {
      const info: NetworkInfo = {
        id: Number(n.id),
        code: String(n.code),
        name: String(n.name),
        addressFormat: n.address_format as AddressFormatCode,
        confirmations: Number(n.confirmations),
        memoSupported: Boolean(n.memo_supported),
        explorerTxUrl: (n.explorer_tx_url as string | null) ?? null,
        isActive: Boolean(n.is_active),
      };
      netById.set(info.id, info);
      netByCode.set(info.code, info);
    }
    const bySymbol = new Map<string, AssetInfo>();
    const byId = new Map<number, AssetInfo>();
    for (const a of assets) {
      const info: AssetInfo = {
        id: Number(a.id),
        symbol: String(a.symbol),
        name: String(a.name),
        decimals: Number(a.decimals),
        iconUrl: (a.icon_url as string | null) ?? null,
        isActive: Boolean(a.is_active),
        isStable: Boolean(a.is_stable),
        depositEnabled: Boolean(a.deposit_enabled),
        withdrawEnabled: Boolean(a.withdraw_enabled),
        sortOrder: Number(a.sort_order),
        networks: [],
      };
      bySymbol.set(info.symbol, info);
      byId.set(info.id, info);
    }
    for (const l of links) {
      const asset = byId.get(Number(l.asset_id));
      const network = netById.get(Number(l.network_id));
      if (!asset || !network) continue;
      asset.networks.push({
        id: Number(l.id),
        assetId: asset.id,
        networkId: network.id,
        network,
        contractAddress: (l.contract_address as string | null) ?? null,
        depositEnabled: Boolean(l.deposit_enabled),
        withdrawEnabled: Boolean(l.withdraw_enabled),
        minDeposit: plain(l.min_deposit),
        minWithdrawal: plain(l.min_withdrawal),
        withdrawalFee: plain(l.withdrawal_fee),
        withdrawalPrecision: Number(l.withdrawal_precision),
      });
    }
    this.bySymbolMap = bySymbol;
    this.byIdMap = byId;
    this.networksByCode = netByCode;
    this.networksById = netById;
  }

  bySymbol(symbol: string): AssetInfo | undefined {
    return this.bySymbolMap.get(symbol);
  }

  byId(id: number): AssetInfo | undefined {
    return this.byIdMap.get(id);
  }

  require(symbol: string): AssetInfo {
    const a = this.bySymbolMap.get(symbol);
    if (!a) throw new AppError('ASSET_NOT_FOUND', `Asset ${symbol} not found`);
    return a;
  }

  requireId(id: number): AssetInfo {
    const a = this.byIdMap.get(id);
    if (!a) throw new AppError('ASSET_NOT_FOUND', `Asset ${id} not found`);
    return a;
  }

  symbolOf(id: number): string {
    return this.byIdMap.get(id)?.symbol ?? String(id);
  }

  network(code: string): NetworkInfo | undefined {
    return this.networksByCode.get(code);
  }

  networkById(id: number): NetworkInfo | undefined {
    return this.networksById.get(id);
  }

  requireAssetNetwork(assetSymbol: string, networkCode: string): { asset: AssetInfo; link: AssetNetworkInfo } {
    const asset = this.require(assetSymbol);
    const link = asset.networks.find((n) => n.network.code === networkCode);
    if (!link) throw new AppError('NETWORK_NOT_FOUND', `${assetSymbol} is not supported on ${networkCode}`);
    return { asset, link };
  }

  list(): AssetInfo[] {
    return [...this.byIdMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  toDto(a: AssetInfo, usdPrice: string | null): AssetDto {
    return {
      symbol: a.symbol,
      name: a.name,
      precision: a.decimals,
      iconUrl: a.iconUrl,
      depositEnabled: a.depositEnabled,
      withdrawEnabled: a.withdrawEnabled,
      usdPrice,
      networks: a.networks.map(
        (n): NetworkDto => ({
          code: n.network.code,
          name: n.network.name,
          addressFormat: n.network.addressFormat,
          confirmations: n.network.confirmations,
          depositEnabled: n.depositEnabled && a.depositEnabled,
          withdrawEnabled: n.withdrawEnabled && a.withdrawEnabled,
          minDeposit: n.minDeposit,
          minWithdrawal: n.minWithdrawal,
          withdrawalFee: n.withdrawalFee,
          withdrawalPrecision: n.withdrawalPrecision,
          memoSupported: n.network.memoSupported,
          explorerTxUrl: n.network.explorerTxUrl,
        }),
      ),
    };
  }
}
