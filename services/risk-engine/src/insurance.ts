import type { Core } from '@gocrypto/server-core';
import { D, dmin, floorToStep } from '@gocrypto/trading-utils';
import type { OrderAdmissionService } from './admission';

/**
 * Gradually unwinds positions the insurance fund took over during liquidations by sending
 * reduce-only market orders into the order book (in small chunks to limit market impact).
 */
export class InsuranceUnwinder {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly core: Core,
    private readonly admission: OrderAdmissionService,
    private readonly opts: { intervalMs?: number; chunkUsd?: string } = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs ?? 15_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ins = this.core.users.systemIds.insuranceFund;
      const positions = await this.core.futures.positionsOf(ins);
      for (const pos of positions) {
        if (!pos.side || pos.qty.isZero()) continue;
        const market = this.core.markets.requireId(pos.marketId);
        const mark = await this.core.prices.markPrice(market.symbol);
        if (!mark) continue;
        const chunkQty = floorToStep(D(this.opts.chunkUsd ?? '25000').div(mark.markPrice), market.stepSize);
        const qty = floorToStep(dmin(pos.qty, chunkQty.gt(0) ? chunkQty : pos.qty), market.stepSize);
        if (qty.lt(market.minQty)) continue;
        await this.admission
          .placeFuturesOrder(
            ins,
            { symbol: market.symbol, side: pos.side === 'LONG' ? 'SELL' : 'BUY', type: 'MARKET', quantity: qty.toFixed(), reduceOnly: true },
            { source: 'SYSTEM', system: true },
          )
          .catch((e) => this.core.log.debug({ err: e, symbol: market.symbol }, 'insurance unwind order not filled'));
      }
    } catch (e) {
      this.core.log.warn({ err: e }, 'insurance unwind failed');
    } finally {
      this.running = false;
    }
  }
}
