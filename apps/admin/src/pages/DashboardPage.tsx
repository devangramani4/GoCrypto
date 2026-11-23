import type { AdminDashboardDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { Button, ErrorState, Icon, type IconName, Skeleton, cx } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader, Panel } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { VolumeChart } from '../components/VolumeChart';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { dec, fmtDateTime, fmtInt, fmtUsd, fmtUsdCompact } from '../lib/format';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';

interface QueueItem {
  label: string;
  value: number | undefined;
  icon: IconName;
  tone: 'warn' | 'down';
  to?: string;
  hint: string;
}

function QueueRow({ item, loading }: { item: QueueItem; loading: boolean }) {
  const active = (item.value ?? 0) > 0;
  const content = (
    <>
      <span className={cx('adm-avatar')} style={{ background: active ? `var(--c-${item.tone}-soft)` : 'var(--c-raised)', color: active ? `var(--c-${item.tone})` : 'var(--c-text-faint)' }}>
        <Icon name={item.icon} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 500, color: 'var(--c-text)' }}>{item.label}</span>
        <span className="adm-cell-sub">{item.hint}</span>
      </span>
      {loading ? (
        <Skeleton width={36} height={18} />
      ) : (
        <strong className={cx('num', active && item.tone)} style={{ fontSize: 18 }}>
          {fmtInt(item.value)}
        </strong>
      )}
      {item.to && <Icon name="chevronRight" size={14} className="faint" />}
    </>
  );
  const style = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--c-border)', color: 'inherit' } as const;
  return item.to ? (
    <Link to={item.to} style={style} className="adm-queue-row">
      {content}
    </Link>
  ) : (
    <div style={style}>{content}</div>
  );
}

function netFlow(d: AdminDashboardDto | undefined): string | undefined {
  const dep = dec(d?.wallet.deposits24hUsd);
  const wd = dec(d?.wallet.withdrawals24hUsd);
  return dep && wd ? D(dep).minus(wd).toFixed() : undefined;
}

export function DashboardPage() {
  const client = useApi();
  const can = useCan();
  const query = useQuery({ queryKey: qk.dashboard, queryFn: () => client.admin.dashboard(), refetchInterval: 30_000 });
  const d = query.data;
  const loading = query.isPending;
  const flow = netFlow(d);

  if (query.isError && !d) {
    return (
      <div className="adm-page">
        <PageHeader title="Dashboard" />
        <div className="adm-panel">
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      </div>
    );
  }

  const queue: QueueItem[] = [
    {
      label: 'Withdrawals awaiting review',
      value: d?.wallet.pendingWithdrawals,
      icon: 'wallet',
      tone: 'warn',
      hint: 'Pending review, approved or processing',
      to: can('wallet.read') ? '/wallet?tab=pending' : undefined,
    },
    {
      label: 'Open security alerts',
      value: d?.security.openAlerts,
      icon: 'shield',
      tone: 'down',
      hint: 'Unresolved alerts across all users',
      to: can('security.read') ? '/security?tab=alerts' : undefined,
    },
    {
      label: 'Failed logins (24h)',
      value: d?.security.failedLogins24h,
      icon: 'lock',
      tone: 'warn',
      hint: 'Wrong password, locked or blocked attempts',
      to: can('security.read') ? '/security?tab=logins&status=FAILED' : undefined,
    },
    {
      label: 'Frozen accounts',
      value: d?.users.frozen,
      icon: 'user',
      tone: 'warn',
      hint: 'Accounts blocked from trading and withdrawals',
      to: can('users.read') ? '/users?status=FROZEN' : undefined,
    },
  ];

  return (
    <div className="adm-page">
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="row" style={{ gap: 6 }}>
            Platform activity over the last 24 hours
            {d && query.dataUpdatedAt > 0 && <span className="faint">· updated {fmtDateTime(query.dataUpdatedAt)}</span>}
          </span>
        }
        actions={
          <Button size="sm" icon="refresh" loading={query.isFetching && !loading} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="adm-stat-grid">
        <StatCard icon="activity" label="Volume (24h)" value={fmtUsdCompact(d?.trading.volume24hUsd)} sub={d ? fmtUsd(d.trading.volume24hUsd) : undefined} loading={loading} />
        <StatCard icon="swap" label="Trades (24h)" value={fmtInt(d?.trading.trades24h)} loading={loading} to={can('orders.read') ? '/orders?tab=trades' : undefined} />
        <StatCard icon="list" label="Open orders" value={fmtInt(d?.trading.openOrders)} loading={loading} to={can('orders.read') ? '/orders?status=OPEN' : undefined} />
        <StatCard icon="layers" label="Open positions" value={fmtInt(d?.trading.openPositions)} sub="Futures, non-system accounts" loading={loading} />
        <StatCard icon="dollar" label="Fees (24h)" value={fmtUsd(d?.revenue.fees24hUsd)} loading={loading} to={can('reports.read') ? '/reports' : undefined} />
        <StatCard icon="dollar" label="Fees (30d)" value={fmtUsdCompact(d?.revenue.fees30dUsd)} loading={loading} to={can('reports.read') ? '/reports' : undefined} />
      </div>

      <div className="adm-grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)' }}>
        <Panel
          title="Hourly volume"
          actions={
            <div className="adm-legend">
              <span>
                <i style={{ background: 'var(--c-brand)' }} />
                Quote volume (USD)
              </span>
            </div>
          }
        >
          <div style={{ padding: '8px 8px 4px' }}>{loading ? <Skeleton height={280} /> : <VolumeChart series={d?.volumeSeries ?? []} />}</div>
        </Panel>
        <Panel title="Operations queue">
          <div className="adm-queue">
            {queue.map((item) => (
              <QueueRow key={item.label} item={item} loading={loading} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="adm-section-label">Users</div>
      <div className="adm-stat-grid">
        <StatCard icon="users" label="Total users" value={fmtInt(d?.users.total)} loading={loading} to={can('users.read') ? '/users' : undefined} />
        <StatCard icon="plus" label="New sign-ups (24h)" value={fmtInt(d?.users.new24h)} loading={loading} />
        <StatCard icon="activity" label="Active (24h)" value={fmtInt(d?.users.active24h)} sub="Signed in during the last day" loading={loading} />
      </div>

      <div className="adm-section-label">Wallet flows</div>
      <div className="adm-stat-grid">
        <StatCard icon="arrowDownLeft" label="Deposits (24h)" value={fmtUsd(d?.wallet.deposits24hUsd)} loading={loading} to={can('wallet.read') ? '/wallet?tab=deposits' : undefined} />
        <StatCard icon="arrowUpRight" label="Withdrawals (24h)" value={fmtUsd(d?.wallet.withdrawals24hUsd)} sub="Completed" loading={loading} to={can('wallet.read') ? '/wallet?tab=withdrawals' : undefined} />
        <StatCard
          icon="swap"
          label="Net flow (24h)"
          value={fmtUsd(flow)}
          sub={flow === undefined ? undefined : D(flow).isNegative() ? 'Net outflow' : 'Net inflow'}
          subTone={flow === undefined ? undefined : D(flow).isNegative() ? 'down' : 'up'}
          loading={loading}
        />
      </div>
    </div>
  );
}
