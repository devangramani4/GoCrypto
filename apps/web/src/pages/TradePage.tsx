import type { MarketDto } from '@gocrypto/shared-types';
import { EmptyState, Icon, Skeleton, Tabs } from '@gocrypto/ui';
import { useEffect, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { Link, Navigate, useParams } from 'react-router';
import { TradingChart } from '../components/chart/TradingChart';
import { MarketHeader, MarketList, RecentTrades } from '../components/trading/MarketWidgets';
import { OrderBook } from '../components/trading/OrderBook';
import { OrdersPanel } from '../components/trading/OrdersPanel';
import { SpotOrderForm } from '../components/trading/SpotOrderForm';
import { FuturesOrderForm } from '../components/trading/FuturesOrderForm';
import { fmtPrice } from '../lib/format';
import { useMarkets, useTicker } from '../lib/hooks';
import { usePrefs } from '../stores/session';
import { useTicket } from '../stores/ticket';

type Kind = 'spot' | 'futures';

function useDocumentTitle(market: MarketDto | undefined) {
  const { data: t } = useTicker(market?.symbol ?? '');
  useEffect(() => {
    if (!market) return;
    document.title = t
      ? `${fmtPrice(t.lastPrice, market)} | ${market.symbol} | GoCrypto`
      : `${market.symbol} | GoCrypto`;
  }, [market, t]);
  useEffect(() => () => void (document.title = 'GoCrypto'), []);
}

function useIsWide(min = 1100): boolean {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : true,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return wide;
}

function BookPanel({ market }: { market: MarketDto }) {
  const [tab, setTab] = useState<'book' | 'trades'>('book');
  const pick = useTicket((s) => s.pick);
  return (
    <div className="panel">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'book', label: 'Order book' },
          { value: 'trades', label: 'Trades' },
        ]}
      />
      <div className="panel__body">
        {tab === 'book' ? (
          <OrderBook market={market} onPriceClick={(p) => pick(p)} />
        ) : (
          <RecentTrades market={market} />
        )}
      </div>
    </div>
  );
}

function Ticket({ market, kind }: { market: MarketDto; kind: Kind }) {
  return (
    <div className="panel panel--ticket">
      {kind === 'futures' ? <FuturesOrderForm market={market} /> : <SpotOrderForm market={market} />}
    </div>
  );
}

export function TradePage({ kind }: { kind: Kind }) {
  const { symbol = '' } = useParams();
  const type = kind === 'futures' ? 'FUTURES' : 'SPOT';
  const { data: markets, isLoading, error } = useMarkets(type);
  const market = markets?.find((m) => m.symbol === symbol.toUpperCase());
  const setLast = usePrefs((s) => s.setLast);
  const pro = usePrefs((s) => s.proLayout);
  const setPro = usePrefs((s) => s.setProLayout);
  const wide = useIsWide();
  useDocumentTitle(market);
  useEffect(() => {
    if (market) setLast(kind, market.symbol);
  }, [market, kind, setLast]);

  if (isLoading) {
    return (
      <div className="trade-skeleton">
        <Skeleton height={56} />
        <Skeleton height={480} />
      </div>
    );
  }
  if (error)
    return (
      <EmptyState icon="alert" title="Markets are unavailable" description="Check your connection and try again." />
    );
  if (!market) {
    const fallback = markets?.[0]?.symbol;
    if (fallback && symbol.toUpperCase() !== fallback)
      return <Navigate to={`/${kind === 'futures' ? 'futures' : 'trade'}/${fallback}`} replace />;
    return <EmptyState title="Market not found" description={<Link to="/markets">Browse all markets</Link>} />;
  }

  const layoutToggle = wide && (
    <button
      type="button"
      className="layout-toggle"
      onClick={() => setPro(!pro)}
      title={pro ? 'Classic layout' : 'Pro layout (resizable panels)'}
    >
      <Icon name={pro ? 'grid' : 'layers'} size={14} /> {pro ? 'Classic' : 'Pro'}
    </button>
  );

  if (wide && pro) return <ProLayout market={market} kind={kind} toggle={layoutToggle} />;

  return (
    <div className={`trade trade--${kind}`}>
      <div className="trade__head">
        <MarketHeader market={market} kind={kind} />
        {layoutToggle}
      </div>
      <div className="trade__chart panel">
        <TradingChart symbol={market.symbol} pricePrecision={market.pricePrecision} tickSize={market.tickSize} />
      </div>
      <div className="trade__book">
        <BookPanel market={market} />
      </div>
      <div className="trade__form">
        <Ticket market={market} kind={kind} />
      </div>
      <div className="trade__orders panel">
        <OrdersPanel kind={kind} market={market} />
      </div>
    </div>
  );
}

/** Resizable multi-panel workspace (desktop app & wide screens); layout persists per market type. */
function ProLayout({ market, kind, toggle }: { market: MarketDto; kind: Kind; toggle: React.ReactNode }) {
  const outer = useDefaultLayout({ id: `gc-pro-${kind}-outer`, storage: localStorage });
  const center = useDefaultLayout({ id: `gc-pro-${kind}-center`, storage: localStorage });
  const right = useDefaultLayout({ id: `gc-pro-${kind}-right`, storage: localStorage });
  const pick = useTicket((s) => s.pick);
  return (
    <div className="pro">
      <div className="trade__head">
        <MarketHeader market={market} kind={kind} />
        {toggle}
      </div>
      <Group
        orientation="horizontal"
        className="pro__group"
        defaultLayout={outer.defaultLayout}
        onLayoutChanged={outer.onLayoutChanged}
      >
        <Panel id="markets" defaultSize="16%" minSize="10%" collapsible className="pro__panel">
          <div className="panel">
            <div className="panel__title">Markets</div>
            <div className="panel__body">
              <MarketList type={kind === 'futures' ? 'FUTURES' : 'SPOT'} active={market.symbol} compact />
            </div>
          </div>
        </Panel>
        <Separator className="pro__sep" />
        <Panel id="center" defaultSize="50%" minSize="30%" className="pro__panel">
          <Group orientation="vertical" defaultLayout={center.defaultLayout} onLayoutChanged={center.onLayoutChanged}>
            <Panel id="chart" defaultSize="64%" minSize="25%" className="pro__panel">
              <div className="panel">
                <TradingChart
                  symbol={market.symbol}
                  pricePrecision={market.pricePrecision}
                  tickSize={market.tickSize}
                />
              </div>
            </Panel>
            <Separator className="pro__sep pro__sep--h" />
            <Panel id="orders" defaultSize="36%" minSize="12%" className="pro__panel">
              <div className="panel">
                <OrdersPanel kind={kind} market={market} />
              </div>
            </Panel>
          </Group>
        </Panel>
        <Separator className="pro__sep" />
        <Panel id="book" defaultSize="16%" minSize="12%" className="pro__panel">
          <Group orientation="vertical" defaultLayout={right.defaultLayout} onLayoutChanged={right.onLayoutChanged}>
            <Panel id="ob" defaultSize="62%" minSize="20%" className="pro__panel">
              <div className="panel">
                <div className="panel__title">Order book</div>
                <div className="panel__body">
                  <OrderBook market={market} onPriceClick={(p) => pick(p)} rows={20} />
                </div>
              </div>
            </Panel>
            <Separator className="pro__sep pro__sep--h" />
            <Panel id="trades" defaultSize="38%" minSize="15%" className="pro__panel">
              <div className="panel">
                <div className="panel__title">Trades</div>
                <div className="panel__body">
                  <RecentTrades market={market} />
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
        <Separator className="pro__sep" />
        <Panel id="ticket" defaultSize="18%" minSize="15%" className="pro__panel">
          <Ticket market={market} kind={kind} />
        </Panel>
      </Group>
    </div>
  );
}
