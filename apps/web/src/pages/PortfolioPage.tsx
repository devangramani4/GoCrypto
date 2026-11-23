import type { OptionPositionDto } from '@gocrypto/shared-types';
import { D, formatUsd } from '@gocrypto/trading-utils';
import { Badge, Card, DataTable, Skeleton, Stat, Tabs, type Column } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { AreaChart } from '../components/chart/AreaChart';
import { AssetLabel, ChangePct, PnL } from '../components/common';
import { Donut } from '../components/common/Donut';
import { FuturesPositionsTable } from '../components/trading/PositionsTable';
import { api } from '../lib/api';
import { coinColor, fmtDateTime, fmtPrice, formatNumber, formatPercent } from '../lib/format';
import { useAuthed } from '../lib/hooks';

type Range = '24h' | '7d' | '30d' | '90d' | '1y';

export function OptionPositionsTable() {
  const authed = useAuthed();
  const q = useQuery({ queryKey: ['positions', 'options'], queryFn: () => api.options.positions(), enabled: authed });
  const columns: Column<OptionPositionDto>[] = [
    {
      key: 's',
      header: 'Contract',
      render: (p) => (
        <span className="col" style={{ gap: 2 }}>
          <strong>{p.symbol}</strong>
          <span className="row" style={{ gap: 4 }}>
            <Badge tone={p.side === 'LONG' ? 'up' : 'down'}>{p.side === 'LONG' ? 'Long' : 'Short'}</Badge>
            <Badge tone={p.optionType === 'CALL' ? 'brand' : 'warn'}>{p.optionType}</Badge>
          </span>
        </span>
      ),
    },
    { key: 'k', header: 'Strike / Expiry', render: (p) => <span className="num">{`${formatNumber(p.strike, 0)} · ${fmtDateTime(p.expiry)}`}</span> },
    { key: 'q', header: 'Qty', align: 'right', render: (p) => <span className="num">{formatNumber(p.quantity, 4, { trim: true })}</span> },
    { key: 'a', header: 'Avg / Mark', align: 'right', render: (p) => <span className="num">{`${fmtPrice(p.avgPrice)} / ${fmtPrice(p.markPrice)}`}</span> },
    { key: 'g', header: 'Δ / Θ', align: 'right', render: (p) => <span className="num muted">{`${p.greeks.delta.toFixed(3)} / ${p.greeks.theta.toFixed(2)}`}</span> },
    { key: 'm', header: 'Margin', align: 'right', render: (p) => <span className="num">{formatNumber(p.margin, 2)}</span> },
    { key: 'u', header: 'Unrealized PnL', align: 'right', render: (p) => <PnL value={p.unrealizedPnl} /> },
    { key: 'r', header: 'Realized', align: 'right', render: (p) => <PnL value={p.realizedPnl} /> },
  ];
  return <DataTable columns={columns} rows={q.data} rowKey={(p) => p.symbol} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty="No option positions" />;
}

export function PortfolioPage() {
  const authed = useAuthed();
  const [range, setRange] = useState<Range>('30d');
  const [posTab, setPosTab] = useState<'futures' | 'options'>('futures');
  const summary = useQuery({ queryKey: ['portfolio', 'summary'], queryFn: () => api.portfolio.summary(), enabled: authed, refetchInterval: 30_000 });
  const perf = useQuery({ queryKey: ['portfolio', 'performance', range], queryFn: () => api.portfolio.performance(range), enabled: authed });
  const alloc = useQuery({ queryKey: ['portfolio', 'allocation'], queryFn: () => api.portfolio.allocation(), enabled: authed });
  const holdings = useQuery({ queryKey: ['portfolio', 'holdings'], queryFn: () => api.portfolio.holdings(), enabled: authed });
  const s = summary.data;
  const series = perf.data ?? [];
  const change = series.length > 1 ? D(series[series.length - 1]!.value).minus(series[0]!.value) : null;
  const accounts = s
    ? [
        { label: 'Spot', value: s.spotValue },
        { label: 'Futures', value: s.futuresValue },
        { label: 'Options', value: s.optionsValue },
      ]
    : [];

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">Valuations use live index prices; PnL includes trading fees and funding.</p>
        </div>
      </div>

      <div className="stats-grid stats-grid--4">
        <Card>
          <Stat label="Total value" icon="wallet" loading={summary.isLoading} value={s ? formatUsd(s.totalValue) : '—'} sub={s ? `Available ${formatUsd(s.availableBalance)}` : undefined} />
        </Card>
        <Card>
          <Stat label="Today's PnL" icon="trendUp" loading={summary.isLoading} value={s ? <PnL value={s.todayPnl} suffix="USD" /> : '—'} sub={s ? formatPercent(s.todayPnlPercent) : undefined} subTone={s && D(s.todayPnlPercent).lt(0) ? 'down' : 'up'} />
        </Card>
        <Card>
          <Stat label="Unrealized / realized PnL" icon="activity" loading={summary.isLoading} value={s ? <PnL value={s.unrealizedPnl} /> : '—'} sub={s ? <>Realized <PnL value={s.realizedPnl} /></> : undefined} />
        </Card>
        <Card>
          <Stat label="ROI" icon="pie" loading={summary.isLoading} value={s ? <span className={D(s.roi).gte(0) ? 'up' : 'down'}>{formatPercent(s.roi)}</span> : '—'} sub={s ? `In ${formatUsd(s.totalDeposits)} · Out ${formatUsd(s.totalWithdrawals)}` : undefined} />
        </Card>
      </div>

      <div className="portfolio-grid">
        <Card
          title={
            <span className="row" style={{ gap: 10 }}>
              <h3 className="gc-card__title">Performance</h3>
              {change && <PnL value={change.toFixed()} suffix="USD" />}
            </span>
          }
          actions={
            <Tabs
              variant="pills"
              value={range}
              onChange={setRange}
              tabs={(['24h', '7d', '30d', '90d', '1y'] as Range[]).map((r) => ({ value: r, label: r.toUpperCase() }))}
            />
          }
        >
          {perf.isLoading ? <Skeleton height={260} /> : series.length > 1 ? <AreaChart points={series} height={260} tone={change && change.lt(0) ? 'down' : 'up'} /> : <div className="gc-state">Not enough history for this range yet.</div>}
        </Card>
        <Card title="Allocation">
          {alloc.isLoading ? (
            <Skeleton height={200} />
          ) : alloc.data?.length ? (
            <div className="alloc">
              <Donut
                items={alloc.data.map((a) => ({ label: a.asset, percent: Number(D(a.percent).mul(100).toFixed(4)) }))}
                center={
                  <>
                    <span className="faint" style={{ fontSize: 11 }}>
                      Assets
                    </span>
                    <strong>{alloc.data.length}</strong>
                  </>
                }
              />
              <ul className="alloc__legend">
                {alloc.data.slice(0, 8).map((a) => (
                  <li key={a.asset}>
                    <i style={{ background: coinColor(a.asset) }} />
                    <span>{a.asset}</span>
                    <span className="spacer" />
                    <span className="num muted">{formatUsd(a.value)}</span>
                    <span className="num" style={{ width: 56, textAlign: 'right' }}>
                      {formatPercent(a.percent, 1, false)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="gc-state">
              <span>
                No assets yet. <Link to="/wallet/deposit">Deposit</Link> to get started.
              </span>
            </div>
          )}
          {s && (
            <div className="acct-split">
              {accounts.map((a) => (
                <div key={a.label} className="acct-split__row">
                  <span className="muted">{a.label}</span>
                  <div className="acct-split__bar">
                    <span style={{ width: `${D(s.totalValue).gt(0) ? D(a.value).div(s.totalValue).mul(100).toNumber() : 0}%` }} />
                  </div>
                  <span className="num">{formatUsd(a.value)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Spot holdings" noPadding>
        <DataTable
          rows={holdings.data}
          rowKey={(h) => h.asset}
          loading={holdings.isLoading}
          error={holdings.error}
          onRetry={() => void holdings.refetch()}
          empty="No holdings"
          columns={[
            { key: 'a', header: 'Asset', render: (h) => <AssetLabel asset={h.asset} /> },
            { key: 'q', header: 'Quantity', align: 'right', render: (h) => <span className="num">{formatNumber(h.quantity, 8, { trim: true })}</span> },
            { key: 'av', header: 'Available', align: 'right', render: (h) => <span className="num muted">{formatNumber(h.available, 8, { trim: true })}</span> },
            { key: 'l', header: 'Locked', align: 'right', render: (h) => <span className="num muted">{formatNumber(h.locked, 8, { trim: true })}</span> },
            { key: 'p', header: 'Price', align: 'right', render: (h) => <span className="num">{fmtPrice(h.price)}</span> },
            { key: 'c', header: '24h', align: 'right', render: (h) => <ChangePct value={h.change24h} /> },
            { key: 'v', header: 'Value', align: 'right', render: (h) => <strong className="num">{formatUsd(h.usdValue)}</strong> },
          ]}
        />
      </Card>

      <Card
        noPadding
        title={
          <Tabs
            value={posTab}
            onChange={setPosTab}
            tabs={[
              { value: 'futures', label: 'Futures positions' },
              { value: 'options', label: 'Option positions' },
            ]}
          />
        }
      >
        {posTab === 'futures' ? <FuturesPositionsTable /> : <OptionPositionsTable />}
      </Card>
    </div>
  );
}
