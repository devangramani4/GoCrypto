import type { FeeScheduleDto, MarketType } from '@gocrypto/shared-types';
import { D, type Decimal, type DecimalLike, dmin, q18Up, toPlain } from '@gocrypto/trading-utils';
import type { MarketInfo } from '../cache/markets';
import type { Database } from '../db/database';
import { toMs } from '../db/database';

export interface FeeRates {
  maker: string;
  taker: string;
}

export interface FeeSubject {
  id: string;
  vipTier: number;
  isSystem: boolean;
}

const FALLBACK: Record<MarketType, FeeRates> = {
  SPOT: { maker: '0.001', taker: '0.001' },
  FUTURES: { maker: '0.0002', taker: '0.0005' },
  OPTIONS: { maker: '0.0003', taker: '0.0003' },
};

/**
 * Fee configuration resolved without code changes:
 *   user override (user_fees) > market override (markets.*_fee_rate) > VIP schedule (fees) > fallback.
 * System accounts (market maker, insurance fund) trade fee-free.
 */
export class FeeService {
  private schedule = new Map<string, FeeRates>();
  private overrides = new Map<string, { rates: FeeRates | null; expiresAt: number | null; fetchedAt: number }>();

  constructor(private readonly db: Database) {}

  async load(): Promise<void> {
    const rows = await this.db.query<{ market_type: MarketType; vip_tier: number; maker_rate: string; taker_rate: string }>(
      'SELECT market_type, vip_tier, maker_rate, taker_rate FROM fees',
    );
    const next = new Map<string, FeeRates>();
    for (const r of rows) next.set(`${r.market_type}:${r.vip_tier}`, { maker: toPlain(r.maker_rate), taker: toPlain(r.taker_rate) });
    this.schedule = next;
    this.overrides.clear();
  }

  scheduleList(): FeeScheduleDto[] {
    return [...this.schedule.entries()]
      .map(([k, v]) => {
        const [marketType, tier] = k.split(':');
        return { marketType: marketType as MarketType, vipTier: Number(tier), makerRate: v.maker, takerRate: v.taker };
      })
      .sort((a, b) => a.marketType.localeCompare(b.marketType) || a.vipTier - b.vipTier);
  }

  invalidateUser(userId: string): void {
    for (const k of this.overrides.keys()) if (k.startsWith(`${userId}:`)) this.overrides.delete(k);
  }

  private async userOverride(userId: string, type: MarketType): Promise<FeeRates | null> {
    const k = `${userId}:${type}`;
    const cached = this.overrides.get(k);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < 60_000) {
      return cached.rates && (!cached.expiresAt || cached.expiresAt > now) ? cached.rates : null;
    }
    const row = await this.db.one<{ maker_rate: string; taker_rate: string; expires_at: Date | null }>(
      'SELECT maker_rate, taker_rate, expires_at FROM user_fees WHERE user_id = ? AND market_type = ?',
      [userId, type],
    );
    const rates = row ? { maker: toPlain(row.maker_rate), taker: toPlain(row.taker_rate) } : null;
    const expiresAt = row ? toMs(row.expires_at) : null;
    this.overrides.set(k, { rates, expiresAt, fetchedAt: now });
    return rates && (!expiresAt || expiresAt > now) ? rates : null;
  }

  async ratesFor(user: FeeSubject, market: MarketInfo): Promise<FeeRates> {
    if (user.isSystem) return { maker: '0', taker: '0' };
    const override = await this.userOverride(user.id, market.type);
    if (override) return override;
    const tierRates =
      this.schedule.get(`${market.type}:${user.vipTier}`) ?? this.schedule.get(`${market.type}:0`) ?? FALLBACK[market.type];
    return {
      maker: market.makerFeeRate ?? tierRates.maker,
      taker: market.takerFeeRate ?? tierRates.taker,
    };
  }

  /** Trading fee for a notional (rounded up to storage precision; maker rebates are negative). */
  static tradingFee(notional: DecimalLike, rate: DecimalLike): Decimal {
    const r = D(rate);
    if (r.isZero()) return D(0);
    const fee = D(notional).mul(r);
    return fee.isNegative() ? fee.toDecimalPlaces(18, 1) : q18Up(fee);
  }

  /**
   * Options fee (Deribit-style): rate * index * qty, capped at 12.5% of the premium paid.
   */
  static optionFee(rate: DecimalLike, indexPrice: DecimalLike, premium: DecimalLike, qty: DecimalLike): Decimal {
    const r = D(rate);
    if (r.isZero()) return D(0);
    const base = D(indexPrice).mul(qty).mul(r);
    const cap = D(premium).mul(qty).mul('0.125');
    return q18Up(dmin(base, cap));
  }
}
