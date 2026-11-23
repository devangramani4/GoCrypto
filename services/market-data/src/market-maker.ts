import type { AccountType, OrderSide } from '@gocrypto/shared-types';
import type { OrderAdmissionService } from '@gocrypto/risk-engine';
import {
  type BalanceChange,
  type Core,
  type EngineGateway,
  type MarketInfo,
  SYSTEM_EMAILS,
  walletKey,
} from '@gocrypto/server-core';
import { D, type Decimal, ROUND_DOWN, ceilToStep, dmin, floorToStep } from '@gocrypto/trading-utils';
import type { PriceEngine } from './price-engine';

interface Quote {
  id: string;
  side: OrderSide;
  price: string;
}

const LEVELS = 12;
/** USD float kept in each per-book market-maker sub-account (refilled from the main account when below half). */
const SPOT_FLOAT_USD = 3_000_000;
const FUTURES_FLOAT_USD = 10_000_000;

/**
 * Sandbox liquidity: a market maker quoting real orders on every spot/futures book (and the
 * nearest option strikes) around the index price, plus a separate "flow" account that sends small
 * taker orders so the books trade and prices track the index. Both are ordinary (system) users:
 * every order goes through the same risk checks, engine and settlement as client orders.
 *
 * Each spot/futures book is quoted from its own funded sub-account (mm+{symbol}@system.gocrypto), like
 * independent liquidity providers: a single account quoting every book made one wallet row the lock hot
 * spot for all markets. Sub-accounts are funded from the main market-maker account through ledger
 * transfers, so balances still reconcile. Option quotes (low frequency) stay on the main account.
 */
export class MarketMaker {
  private timers: NodeJS.Timeout[] = [];
  private mmId = '';
  private flowId = '';
  private readonly busy = new Set<number>();
  private readonly lastRef = new Map<number, number>();
  /** marketId -> sub-account user id quoting that book. */
  private readonly bookAccounts = new Map<number, string>();

  constructor(
    private readonly core: Core,
    private readonly admission: OrderAdmissionService,
    private readonly engine: EngineGateway,
    private readonly prices: PriceEngine,
  ) {}

  async start(): Promise<void> {
    this.mmId = this.core.users.systemIds.marketMaker;
    const flow = await this.core.users.findByEmail(SYSTEM_EMAILS.flowTrader);
    this.flowId = flow ? String(flow.id) : '';
    if (this.mmId === '0') {
      this.core.log.warn('market maker account missing; run the seed');
      return;
    }
    const books = this.core.markets.list().filter((m) => m.type !== 'OPTIONS');
    for (const m of books) {
      try {
        this.bookAccounts.set(m.id, await this.setupBookAccount(m));
      } catch (e) {
        this.core.log.warn(
          { err: e, symbol: m.symbol },
          'market-maker sub-account setup failed; quoting from the main account',
        );
      }
    }
    // Start from a clean slate: cancel quotes left over from a previous run (main account, sub-accounts, flow).
    const owners = [...new Set([this.mmId, ...this.bookAccounts.values(), ...(this.flowId ? [this.flowId] : [])])];
    const leftovers = await this.core.db.query<{ market_id: number; user_id: string }>(
      `SELECT DISTINCT market_id, user_id FROM orders WHERE user_id IN (${owners.map(() => '?').join(', ')}) AND status IN ('NEW','OPEN','PARTIALLY_FILLED')`,
      owners,
    );
    for (const r of leftovers) {
      await this.engine.submit({
        kind: 'CANCEL_ALL',
        marketId: Number(r.market_id),
        userId: String(r.user_id),
        reason: 'SYSTEM',
      });
    }
    this.timers.push(setInterval(() => void this.refill(), 60_000));
    books.forEach((m, i) => {
      const t = setInterval(() => void this.requote(m.id), 2000 + (i % 5) * 150);
      this.timers.push(t);
    });
    if (this.flowId) {
      this.timers.push(setInterval(() => void this.flow(), 700));
    }
    this.timers.push(setInterval(() => void this.quoteOptions(), 15_000));
    setTimeout(() => void this.quoteOptions(), 5000);
    this.core.log.info({ markets: books.length }, 'market maker started');
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  private accountFor(m: MarketInfo): string {
    return this.bookAccounts.get(m.id) ?? this.mmId;
  }

  private async setupBookAccount(m: MarketInfo): Promise<string> {
    const email = `mm+${m.symbol.toLowerCase()}@system.gocrypto`;
    const existing = await this.core.users.findByEmail(email);
    const id = existing
      ? String(existing.id)
      : await this.core.users.createUser(this.core.db, {
          email,
          passwordHash: null,
          isSystem: true,
          displayName: `Market maker ${m.symbol}`,
        });
    await this.fund(m, id);
    return id;
  }

  private async refill(): Promise<void> {
    for (const m of this.core.markets.list().filter((x) => x.type !== 'OPTIONS')) {
      const id = this.bookAccounts.get(m.id);
      if (id)
        await this.fund(m, id).catch((e: Error) =>
          this.core.log.warn({ err: e.message, symbol: m.symbol }, 'mm refill failed'),
        );
    }
  }

  /** Top a book sub-account up to its USD float from the main account (paired ledger transfers). */
  private async fund(m: MarketInfo, id: string): Promise<void> {
    const targets: { assetId: number; account: AccountType; usd: number }[] =
      m.type === 'SPOT'
        ? [
            { assetId: m.baseAssetId, account: 'SPOT', usd: SPOT_FLOAT_USD },
            { assetId: m.quoteAssetId, account: 'SPOT', usd: SPOT_FLOAT_USD },
          ]
        : [{ assetId: m.quoteAssetId, account: 'FUTURES', usd: FUTURES_FLOAT_USD }];
    const keys = targets.flatMap((t) => [
      { userId: id, assetId: t.assetId, account: t.account },
      { userId: this.mmId, assetId: t.assetId, account: t.account },
    ]);
    await this.core.wallet.ensureWallets(this.core.db, keys);
    await this.core.db.transaction(async (tx) => {
      const wallets = await this.core.wallet.lockWallets(tx, keys);
      const changes: BalanceChange[] = [];
      for (const t of targets) {
        const asset = this.core.assets.byId(t.assetId);
        const px = (asset && this.prices.indexOf(asset.symbol)) || 1;
        const target = D(t.usd / px).toDecimalPlaces(asset?.decimals ?? 8, ROUND_DOWN);
        const have = wallets.get(walletKey({ userId: id, assetId: t.assetId, account: t.account }))!.available;
        if (have.gte(target.div(2))) continue;
        const source = wallets.get(walletKey({ userId: this.mmId, assetId: t.assetId, account: t.account }))!.available;
        const amount = dmin(target.minus(have), source).toDecimalPlaces(asset?.decimals ?? 8, ROUND_DOWN);
        if (amount.lte(0)) continue;
        changes.push(
          {
            userId: this.mmId,
            assetId: t.assetId,
            account: t.account,
            available: amount.neg(),
            type: 'TRANSFER_OUT',
            refType: 'MM_FUNDING',
            refId: id,
          },
          {
            userId: id,
            assetId: t.assetId,
            account: t.account,
            available: amount,
            type: 'TRANSFER_IN',
            refType: 'MM_FUNDING',
            refId: this.mmId,
          },
        );
      }
      if (changes.length) await this.core.wallet.apply(tx, changes, wallets);
    });
  }

  /** Reference price for a market from the index feed. */
  private reference(m: MarketInfo): number | null {
    if (m.type === 'SPOT') {
      const b = this.prices.indexOf(m.base);
      const q = this.prices.indexOf(m.quote);
      if (!b || !q) return null;
      return b / q;
    }
    if (m.type === 'FUTURES') return this.prices.indexOf(m.futures!.underlying);
    return null;
  }

  private ladder(m: MarketInfo, ref: number): { side: OrderSide; price: Decimal; qty: Decimal }[] {
    const out: { side: OrderSide; price: Decimal; qty: Decimal }[] = [];
    const tick = Number(m.tickSize);
    // Snap the reference to a coarse grid so small index moves do not churn every quote.
    const grid = Math.max(tick, ref * 0.0003);
    const anchor = Math.round(ref / grid) * grid;
    const half = Math.max(tick, ref * 0.00025);
    // Level sizes are defined in USD; convert to quote units (e.g. BTC on ETH/BTC), not 1 quote = 1 USD.
    const quoteUsd = this.prices.indexOf(m.quote) ?? 1;
    for (let i = 0; i < LEVELS; i++) {
      const offset = half + i * Math.max(tick, ref * 0.00045) * (1 + i * 0.12);
      const notional = ((m.type === 'FUTURES' ? 6000 : 3000) * (1 + i * 0.6) * (0.6 + Math.random() * 0.8)) / quoteUsd;
      const bidPrice = floorToStep(D((anchor - offset).toFixed(10)), m.tickSize);
      const askPrice = ceilToStep(D((anchor + offset).toFixed(10)), m.tickSize);
      for (const [side, price] of [
        ['BUY', bidPrice],
        ['SELL', askPrice],
      ] as const) {
        if (price.lte(0)) continue;
        let qty = floorToStep(D(notional).div(price), m.stepSize);
        if (qty.lt(m.minQty)) qty = D(m.minQty);
        if (qty.mul(price).lt(m.minNotional)) qty = ceilToStep(D(m.minNotional).div(price).mul('1.1'), m.stepSize);
        out.push({ side, price, qty });
      }
    }
    return out;
  }

  private async openQuotes(marketId: number, userId: string): Promise<Quote[]> {
    const rows = await this.core.db.query<{ id: string; side: OrderSide; price: string }>(
      "SELECT id, side, price FROM orders WHERE user_id = ? AND market_id = ? AND status IN ('NEW','OPEN','PARTIALLY_FILLED') AND price IS NOT NULL",
      [userId, marketId],
    );
    return rows.map((r) => ({ id: String(r.id), side: r.side, price: D(r.price).toFixed() }));
  }

  private async place(m: MarketInfo, side: OrderSide, price: Decimal, qty: Decimal): Promise<void> {
    const ctx = { source: 'SYSTEM' as const, system: true, awaitEngine: false };
    const base = { symbol: m.symbol, side, type: 'LIMIT' as const, price: price.toFixed(), quantity: qty.toFixed() };
    const owner = this.accountFor(m);
    if (m.type === 'SPOT') await this.admission.placeSpotOrder(owner, base, ctx);
    else if (m.type === 'FUTURES') await this.admission.placeFuturesOrder(owner, base, ctx);
    else await this.admission.placeOptionsOrder(owner, base, ctx);
  }

  async requote(marketId: number): Promise<void> {
    if (this.busy.has(marketId)) return;
    const m = this.core.markets.byId(marketId);
    if (!m || m.status !== 'TRADING') return;
    const ref = this.reference(m);
    if (!ref) return;
    const last = this.lastRef.get(marketId);
    const existing = await this.openQuotes(marketId, this.accountFor(m));
    if (last && Math.abs(ref / last - 1) < 0.0002 && existing.length >= LEVELS * 2 - 2) return;
    this.busy.add(marketId);
    try {
      this.lastRef.set(marketId, ref);
      const desired = this.ladder(m, ref);
      const keep = new Set<string>();
      const wanted = new Set(desired.map((d) => `${d.side}:${d.price.toFixed()}`));
      for (const q of existing) {
        const k = `${q.side}:${q.price}`;
        const stale = !wanted.has(k) || keep.has(k);
        if (stale)
          await this.engine.submit(
            { kind: 'CANCEL', orderId: q.id, marketId, reason: 'SYSTEM' },
            { awaitResult: false },
          );
        else keep.add(k);
      }
      for (const d of desired) {
        if (keep.has(`${d.side}:${d.price.toFixed()}`)) continue;
        await this.place(m, d.side, d.price, d.qty).catch((e: Error) =>
          this.core.log.debug({ err: e.message, symbol: m.symbol }, 'mm quote rejected'),
        );
      }
    } catch (e) {
      this.core.log.warn({ err: e, symbol: m.symbol }, 'requote failed');
    } finally {
      this.busy.delete(marketId);
    }
  }

  /** Small taker orders from the flow account, nudging last price toward the index. */
  private async flow(): Promise<void> {
    const markets = this.core.markets.list().filter((m) => m.type !== 'OPTIONS' && m.status === 'TRADING');
    const m = markets[Math.floor(Math.random() * markets.length)];
    if (!m) return;
    const ref = this.reference(m);
    if (!ref) return;
    const lastStr = await this.core.prices.lastPrice(m.symbol);
    const last = lastStr ? Number(lastStr) : ref;
    const drift = (ref - last) / ref;
    const buyProb = Math.max(0.15, Math.min(0.85, 0.5 + drift * 400));
    const side: OrderSide = Math.random() < buyProb ? 'BUY' : 'SELL';
    const notional = 150 + Math.random() ** 2 * 6000;
    let qty = floorToStep(D(notional).div(ref.toFixed(10)), m.stepSize);
    if (qty.lt(m.minQty)) qty = D(m.minQty);
    const ctx = { source: 'SYSTEM' as const, system: true, awaitEngine: false };
    try {
      if (m.type === 'SPOT') {
        await this.admission.placeSpotOrder(
          this.flowId,
          { symbol: m.symbol, side, type: 'MARKET', quantity: qty.toFixed() },
          ctx,
        );
      } else {
        const pos = await this.core.db.one<{ side: string | null; quantity: string }>(
          'SELECT side, quantity FROM futures_positions WHERE user_id = ? AND market_id = ?',
          [this.flowId, m.id],
        );
        const tooBig = pos?.side && D(pos.quantity).mul(ref.toFixed(10)).gt(250_000);
        const reduceSide: OrderSide | null = pos?.side === 'LONG' ? 'SELL' : pos?.side === 'SHORT' ? 'BUY' : null;
        await this.admission.placeFuturesOrder(
          this.flowId,
          {
            symbol: m.symbol,
            side: tooBig && reduceSide ? reduceSide : side,
            type: 'MARKET',
            quantity: qty.toFixed(),
            reduceOnly: Boolean(tooBig && reduceSide),
          },
          ctx,
        );
      }
    } catch (e) {
      this.core.log.debug({ err: (e as Error).message, symbol: m.symbol }, 'flow order rejected');
    }
  }

  /** Two-sided quotes on the nearest expiries / strikes around the money. */
  private async quoteOptions(): Promise<void> {
    for (const underlying of this.core.options.underlyings()) {
      const idx = this.prices.indexOf(underlying);
      if (!idx) continue;
      const baseIv = await this.core.options.baseIv(underlying);
      const expiries = this.core.options.expiries(underlying).slice(0, 3);
      for (const exp of expiries) {
        const contracts = this.core.markets
          .options(underlying)
          .filter((m) => m.option!.expiryAt === exp.expiry && m.status === 'TRADING')
          .sort((a, b) => Math.abs(Number(a.option!.strike) - idx) - Math.abs(Number(b.option!.strike) - idx))
          .slice(0, 14);
        for (const m of contracts) {
          const { mark } = this.core.options.markFor(m, idx, baseIv);
          const existing = await this.openQuotes(m.id, this.mmId);
          const tick = D(m.tickSize);
          const width = mark.mul('0.04').plus(tick);
          const bid = floorToStep(mark.minus(width), m.tickSize);
          const ask = ceilToStep(mark.plus(width), m.tickSize);
          const fresh =
            existing.length === 2 &&
            existing.some((q) => q.side === 'BUY' && D(q.price).eq(bid)) &&
            existing.some((q) => q.side === 'SELL' && D(q.price).eq(ask));
          if (fresh) continue;
          for (const q of existing)
            await this.engine.submit(
              { kind: 'CANCEL', orderId: q.id, marketId: m.id, reason: 'SYSTEM' },
              { awaitResult: false },
            );
          const qty = floorToStep(D(1 + Math.random() * 9), m.stepSize);
          if (bid.gt(0)) await this.place(m, 'BUY', bid, qty).catch(() => undefined);
          await this.place(m, 'SELL', ask, qty).catch(() => undefined);
        }
      }
    }
    // Occasional option trades so the chain shows volume / open interest.
    if (this.flowId && Math.random() < 0.6) {
      const live = this.core.markets.options().filter((m) => m.status === 'TRADING');
      const m = live[Math.floor(Math.random() * Math.min(live.length, 60))];
      if (m) {
        await this.admission
          .placeOptionsOrder(
            this.flowId,
            { symbol: m.symbol, side: Math.random() < 0.6 ? 'BUY' : 'SELL', type: 'MARKET', quantity: '0.5' },
            {
              source: 'SYSTEM',
              system: true,
              awaitEngine: false,
            },
          )
          .catch(() => undefined);
      }
    }
  }
}
