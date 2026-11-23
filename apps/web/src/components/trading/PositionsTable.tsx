import type { FuturesPositionDto, MarketDto } from '@gocrypto/shared-types';
import { D, floorToStep, formatNumber, liquidationPrice, roe, unrealizedPnl } from '@gocrypto/trading-utils';
import { Badge, Button, DataTable, KeyValue, Modal, Segmented, useToast, type Column } from '@gocrypto/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../../lib/api';
import { fmtPrice, fmtQty, formatPercent, isPositive, signClass } from '../../lib/format';
import { useFuturesAccount, useFuturesPositions, useLiveMarks, useMarketMap } from '../../lib/hooks';
import { DecimalInput } from './controls';

interface LivePosition extends FuturesPositionDto {
  liveMark: string;
  livePnl: string;
  liveRoe: string;
}

function invalidateTrading(qc: ReturnType<typeof useQueryClient>) {
  for (const k of ['orders', 'positions', 'futures-account', 'balances', 'fills', 'portfolio']) void qc.invalidateQueries({ queryKey: [k] });
}

export function FuturesPositionsTable({ symbol, compact }: { symbol?: string; compact?: boolean }) {
  const { data, isLoading, error, refetch } = useFuturesPositions();
  const markets = useMarketMap('FUTURES');
  const navigate = useNavigate();
  const rows = useMemo(() => (data ?? []).filter((p) => !symbol || p.symbol === symbol), [data, symbol]);
  const marks = useLiveMarks(
    rows.map((p) => p.symbol),
    Object.fromEntries(rows.map((p) => [p.symbol, p.markPrice])),
  );
  const live: LivePosition[] = rows.map((p) => {
    const mark = marks[p.symbol] ?? p.markPrice;
    const pnl = unrealizedPnl(p.side, p.quantity, p.entryPrice, mark);
    return { ...p, liveMark: mark, livePnl: pnl.toFixed(), liveRoe: D(p.initialMargin).gt(0) ? roe(pnl, p.initialMargin).toFixed() : '0' };
  });
  const [closing, setClosing] = useState<LivePosition | null>(null);
  const [tpsl, setTpsl] = useState<LivePosition | null>(null);
  const [adjust, setAdjust] = useState<LivePosition | null>(null);

  const columns: Column<LivePosition>[] = [
    {
      key: 'symbol',
      header: 'Contract',
      render: (p) => (
        <button type="button" className="pos-sym" onClick={() => navigate(`/futures/${p.symbol}`)}>
          <span className={`pos-sym__bar ${p.side === 'LONG' ? 'up' : 'down'}`} />
          <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}>
            <strong>{p.symbol}</strong>
            <span className="row" style={{ gap: 4 }}>
              <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side === 'LONG' ? 'Long' : 'Short'}</Badge>
              <Badge>
                {p.marginMode === 'CROSS' ? 'Cross' : 'Isolated'} {p.leverage}x
              </Badge>
            </span>
          </span>
        </button>
      ),
    },
    { key: 'size', header: 'Size', align: 'right', render: (p) => <span className={`num ${p.side === 'LONG' ? 'up' : 'down'}`}>{fmtQty(p.quantity, markets.get(p.symbol))}</span> },
    { key: 'entry', header: 'Entry price', align: 'right', render: (p) => <span className="num">{fmtPrice(p.entryPrice, markets.get(p.symbol))}</span> },
    { key: 'mark', header: 'Mark price', align: 'right', render: (p) => <span className="num">{fmtPrice(p.liveMark, markets.get(p.symbol))}</span> },
    { key: 'liq', header: 'Liq. price', align: 'right', render: (p) => <span className="num warn">{fmtPrice(p.liquidationPrice, markets.get(p.symbol))}</span> },
    {
      key: 'margin',
      header: 'Margin',
      align: 'right',
      render: (p) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          <span className="num">{formatNumber(p.margin, 2)}</span>
          {p.marginMode === 'ISOLATED' && (
            <button type="button" className="link-btn" onClick={() => setAdjust(p)} aria-label="Adjust margin">
              ±
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'ratio',
      header: 'Margin ratio',
      align: 'right',
      render: (p) => <span className={`num ${D(p.marginRatio).gte(0.8) ? 'down' : D(p.marginRatio).gte(0.5) ? 'warn' : ''}`}>{formatPercent(p.marginRatio, 2, false)}</span>,
    },
    {
      key: 'pnl',
      header: 'PnL (ROE)',
      align: 'right',
      render: (p) => (
        <span className={`num ${signClass(p.livePnl)}`}>
          {formatNumber(p.livePnl, 2, { sign: true })}
          <br />
          <span style={{ fontSize: 11 }}>({formatPercent(p.liveRoe)})</span>
        </span>
      ),
    },
    {
      key: 'tpsl',
      header: 'TP / SL',
      align: 'right',
      render: (p) => (
        <button type="button" className="link-btn num" onClick={() => setTpsl(p)}>
          {p.takeProfitPrice ? fmtPrice(p.takeProfitPrice, markets.get(p.symbol)) : '—'} / {p.stopLossPrice ? fmtPrice(p.stopLossPrice, markets.get(p.symbol)) : '—'}
        </button>
      ),
    },
    {
      key: 'actions',
      header: 'Close',
      align: 'right',
      render: (p) => (
        <Button size="sm" onClick={() => setClosing(p)}>
          Close
        </Button>
      ),
    },
  ];

  const visible = compact ? columns.filter((c) => !['ratio', 'tpsl'].includes(c.key)) : columns;

  return (
    <>
      <DataTable
        columns={visible}
        rows={live}
        rowKey={(p) => p.symbol}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        empty={<span>No open positions</span>}
      />
      {closing && markets.get(closing.symbol) && <ClosePositionModal position={closing} market={markets.get(closing.symbol)!} onClose={() => setClosing(null)} />}
      {tpsl && markets.get(tpsl.symbol) && <TpSlModal position={tpsl} market={markets.get(tpsl.symbol)!} onClose={() => setTpsl(null)} />}
      {adjust && markets.get(adjust.symbol) && <AdjustMarginModal position={adjust} market={markets.get(adjust.symbol)!} onClose={() => setAdjust(null)} />}
    </>
  );
}

function ClosePositionModal({ position: p, market, onClose }: { position: LivePosition; market: MarketDto; onClose: () => void }) {
  const [mode, setMode] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [price, setPrice] = useState(D(p.liveMark).toFixed(market.pricePrecision));
  const [qty, setQty] = useState(D(p.quantity).toFixed());
  const toast = useToast();
  const qc = useQueryClient();
  const full = D(qty).eq(p.quantity);
  const close = useMutation({
    mutationFn: async () => {
      if (mode === 'MARKET') return api.futures.closePosition(p.symbol, full ? undefined : qty);
      return api.futures.place({ symbol: p.symbol, side: p.side === 'LONG' ? 'SELL' : 'BUY', type: 'LIMIT', price, quantity: qty, reduceOnly: true, timeInForce: 'GTC' });
    },
    onSuccess: ({ order }) => {
      toast.success(mode === 'MARKET' ? 'Position close submitted' : 'Close order placed', `${fmtQty(order.quantity, market)} ${market.base} ${order.status === 'FILLED' ? `@ ${fmtPrice(order.avgPrice, market)}` : ''}`);
      invalidateTrading(qc);
      onClose();
    },
    onError: (e) => toast.error('Could not close position', errorMessage(e)),
  });
  const valid = isPositive(qty) && D(qty).lte(p.quantity) && (mode === 'MARKET' || isPositive(price));
  const estPnl = isPositive(qty) ? unrealizedPnl(p.side, qty, p.entryPrice, mode === 'LIMIT' && isPositive(price) ? price : p.liveMark) : D(0);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${p.symbol} ${p.side === 'LONG' ? 'long' : 'short'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={p.side === 'LONG' ? 'sell' : 'buy'} loading={close.isPending} disabled={!valid} onClick={() => close.mutate()}>
            {mode === 'MARKET' ? 'Market close' : 'Place close order'}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'MARKET', label: 'Market' },
            { value: 'LIMIT', label: 'Limit' },
          ]}
        />
        {mode === 'LIMIT' && <DecimalInput label="Price" unit={market.quote} value={price} onChange={setPrice} decimals={market.pricePrecision} />}
        <DecimalInput label="Quantity" unit={market.base} value={qty} onChange={setQty} decimals={market.qtyPrecision} error={isPositive(qty) && D(qty).gt(p.quantity) ? 'Exceeds position size' : null} />
        <div className="row" style={{ gap: 6 }}>
          {[25, 50, 75, 100].map((pc) => (
            <Button key={pc} size="sm" onClick={() => setQty(floorToStep(D(p.quantity).mul(pc).div(100), market.stepSize).toFixed())}>
              {pc}%
            </Button>
          ))}
        </div>
        <KeyValue
          items={[
            ['Position', `${fmtQty(p.quantity, market)} ${market.base} @ ${fmtPrice(p.entryPrice, market)}`],
            ['Mark price', fmtPrice(p.liveMark, market)],
            ['Est. realized PnL', <span key="p" className={signClass(estPnl.toFixed())}>{formatNumber(estPnl, 2, { sign: true })} USDT</span>],
          ]}
        />
      </div>
    </Modal>
  );
}

function TpSlModal({ position: p, market, onClose }: { position: LivePosition; market: MarketDto; onClose: () => void }) {
  const [tp, setTp] = useState(p.takeProfitPrice ? D(p.takeProfitPrice).toFixed(market.pricePrecision) : '');
  const [sl, setSl] = useState(p.stopLossPrice ? D(p.stopLossPrice).toFixed(market.pricePrecision) : '');
  const toast = useToast();
  const qc = useQueryClient();
  const long = p.side === 'LONG';
  const tpErr = tp && (long ? D(tp).lte(p.liveMark) : D(tp).gte(p.liveMark)) ? `Must be ${long ? 'above' : 'below'} the mark price` : null;
  const slErr = sl && (long ? D(sl).gte(p.liveMark) : D(sl).lte(p.liveMark)) ? `Must be ${long ? 'below' : 'above'} the mark price` : null;
  const save = useMutation({
    mutationFn: () => api.futures.setTpSl(p.symbol, { takeProfitPrice: tp || null, stopLossPrice: sl || null }),
    onSuccess: () => {
      toast.success('TP/SL updated');
      invalidateTrading(qc);
      onClose();
    },
    onError: (e) => toast.error('Could not update TP/SL', errorMessage(e)),
  });
  const pnlAt = (price: string) => (isPositive(price) ? formatNumber(unrealizedPnl(p.side, p.quantity, p.entryPrice, price), 2, { sign: true }) : '—');
  return (
    <Modal
      open
      onClose={onClose}
      title={`TP/SL · ${p.symbol}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={Boolean(tpErr || slErr)} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <KeyValue
          items={[
            ['Entry price', fmtPrice(p.entryPrice, market)],
            ['Mark price', fmtPrice(p.liveMark, market)],
            ['Liq. price', fmtPrice(p.liquidationPrice, market)],
          ]}
        />
        <DecimalInput label="Take profit" unit={market.quote} value={tp} onChange={setTp} decimals={market.pricePrecision} error={tpErr} placeholder="None" />
        <div className="faint" style={{ fontSize: 12, marginTop: -6 }}>
          Est. PnL at TP: <span className={signClass(isPositive(tp) ? unrealizedPnl(p.side, p.quantity, p.entryPrice, tp).toFixed() : null)}>{pnlAt(tp)}</span>
        </div>
        <DecimalInput label="Stop loss" unit={market.quote} value={sl} onChange={setSl} decimals={market.pricePrecision} error={slErr} placeholder="None" />
        <div className="faint" style={{ fontSize: 12, marginTop: -6 }}>
          Est. PnL at SL: <span className={signClass(isPositive(sl) ? unrealizedPnl(p.side, p.quantity, p.entryPrice, sl).toFixed() : null)}>{pnlAt(sl)}</span>
        </div>
        <p className="faint" style={{ fontSize: 12 }}>TP/SL close the entire position at market when the mark price reaches the trigger. Leave a field empty to remove it.</p>
      </div>
    </Modal>
  );
}

function AdjustMarginModal({ position: p, market, onClose }: { position: LivePosition; market: MarketDto; onClose: () => void }) {
  const [dir, setDir] = useState<'ADD' | 'REMOVE'>('ADD');
  const [amount, setAmount] = useState('');
  const { data: account } = useFuturesAccount();
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => setAmount(''), [dir]);
  const maxRemovable = D(p.margin).minus(D(p.notional).div(p.leverage)).plus(D(p.livePnl).lt(0) ? p.livePnl : 0);
  const max = dir === 'ADD' ? D(account?.availableBalance ?? 0) : maxRemovable.gt(0) ? maxRemovable : D(0);
  const newMargin = isPositive(amount) ? (dir === 'ADD' ? D(p.margin).plus(amount) : D(p.margin).minus(amount)) : D(p.margin);
  const newLiq = market.futures?.riskTiers?.length
    ? liquidationPrice({ side: p.side, qty: p.quantity, entryPrice: p.entryPrice, margin: newMargin, tiers: market.futures.riskTiers })
    : null;
  const save = useMutation({
    mutationFn: () => api.futures.adjustMargin(p.symbol, amount, dir),
    onSuccess: () => {
      toast.success(dir === 'ADD' ? 'Margin added' : 'Margin removed');
      invalidateTrading(qc);
      onClose();
    },
    onError: (e) => toast.error('Could not adjust margin', errorMessage(e)),
  });
  const over = isPositive(amount) && D(amount).gt(max);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust margin · ${p.symbol}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!isPositive(amount) || over} onClick={() => save.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { value: 'ADD', label: 'Add margin' },
            { value: 'REMOVE', label: 'Remove margin' },
          ]}
        />
        <DecimalInput label="Amount" unit="USDT" value={amount} onChange={setAmount} decimals={8} error={over ? 'Exceeds the maximum' : null} />
        <KeyValue
          items={[
            ['Current margin', `${formatNumber(p.margin, 2)} USDT`],
            [dir === 'ADD' ? 'Max addable' : 'Max removable (est.)', <button key="m" type="button" className="link-btn num" onClick={() => setAmount(max.toDecimalPlaces(8, 1).toFixed())}>{formatNumber(max, 2)} USDT</button>],
            ['Liq. price after', <span key="l" className="warn num">{newLiq ? fmtPrice(newLiq.toFixed(), market) : '—'}</span>],
          ]}
        />
      </div>
    </Modal>
  );
}
