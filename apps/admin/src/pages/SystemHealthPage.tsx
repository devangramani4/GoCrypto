import type { ServiceHealthDto, SystemHealthDto } from '@gocrypto/shared-types';
import { Alert, Badge, Button, type Column, DataTable, EmptyState, ErrorState, Icon, KeyValue, Progress, Skeleton, Switch } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { PageHeader, Panel } from '../components/PageHeader';
import { StatusBadge } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { fmtBytes, fmtDuration, fmtInt, fmtRelative, fmtUtc } from '../lib/format';
import { useNow } from '../lib/hooks';
import { qk } from '../lib/queryKeys';
import { HEALTH_TONE } from '../lib/status';

const REFRESH_MS = 10_000;

function HealthDot({ status }: { status: 'UP' | 'DOWN' | 'DEGRADED' }) {
  const cls = status === 'UP' ? 'adm-health-dot--up' : status === 'DEGRADED' ? 'adm-health-dot--warn' : 'adm-health-dot--down';
  return <span className={`adm-health-dot ${cls}`} aria-hidden="true" />;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Service-specific heartbeat extras (everything except the common fields). */
function extras(details: Record<string, unknown> | null): [string, unknown][] {
  if (!details) return [];
  const common = new Set(['service', 'instance', 'ts', 'uptimeSec', 'rssBytes', 'heapUsedBytes']);
  return Object.entries(details).filter(([k, v]) => !common.has(k) && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'));
}

export function overallStatus(h: SystemHealthDto): { tone: 'up' | 'warn' | 'down'; text: string } {
  const down = h.services.filter((s) => s.status === 'DOWN').length + (h.database.status === 'DOWN' ? 1 : 0) + (h.redis.status === 'DOWN' ? 1 : 0);
  const degraded = h.services.filter((s) => s.status === 'DEGRADED').length;
  if (down) return { tone: 'down', text: `${down} component${down === 1 ? '' : 's'} down` };
  if (degraded) return { tone: 'warn', text: `${degraded} service${degraded === 1 ? '' : 's'} degraded (stale heartbeat)` };
  return { tone: 'up', text: 'All systems operational' };
}

function serviceColumns(now: number): Column<ServiceHealthDto>[] {
  return [
    {
      key: 'name',
      header: 'Service',
      render: (s) => (
        <span className="row" style={{ gap: 10 }}>
          <HealthDot status={s.status} />
          <span>
            <strong style={{ fontWeight: 600 }}>{s.name}</strong>
            <span className="adm-cell-sub adm-mono">{typeof s.details?.instance === 'string' ? s.details.instance : 'no live instance'}</span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge value={s.status} tones={HEALTH_TONE} /> },
    {
      key: 'beat',
      header: 'Last heartbeat',
      render: (s) =>
        s.lastHeartbeat ? (
          <span className="num" title={fmtUtc(s.lastHeartbeat)}>
            {fmtRelative(s.lastHeartbeat, now)}
          </span>
        ) : (
          <span className="faint">Never / expired</span>
        ),
    },
    { key: 'uptime', header: 'Uptime', align: 'right', render: (s) => <span className="num">{fmtDuration(num(s.details?.uptimeSec))}</span> },
    { key: 'rss', header: 'RSS', align: 'right', render: (s) => <span className="num">{fmtBytes(num(s.details?.rssBytes))}</span> },
    { key: 'heap', header: 'Heap used', align: 'right', render: (s) => <span className="num">{fmtBytes(num(s.details?.heapUsedBytes))}</span> },
    {
      key: 'extra',
      header: 'Details',
      render: (s) => {
        const x = extras(s.details);
        return x.length ? (
          <span className="adm-chip-row">
            {x.map(([k, v]) => (
              <Badge key={k}>
                {k}: {String(v)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="faint">—</span>
        );
      },
    },
  ];
}

function Infra({ title, status, items }: { title: string; status: 'UP' | 'DOWN'; items: [ReactNode, ReactNode][] }) {
  return (
    <Panel
      title={
        <span className="row" style={{ gap: 8 }}>
          <HealthDot status={status} />
          <h2 className="adm-panel__title">{title}</h2>
        </span>
      }
      actions={<StatusBadge value={status} tones={HEALTH_TONE} />}
    >
      <div className="adm-panel__body adm-kv-card" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <KeyValue items={items} />
      </div>
    </Panel>
  );
}

function latency(ms: number | null): ReactNode {
  if (ms === null) return <span className="faint">—</span>;
  return <span className={ms > 100 ? 'num warn' : 'num'}>{ms.toFixed(ms < 10 ? 1 : 0)} ms</span>;
}

export function SystemHealthPage() {
  const client = useApi();
  const [auto, setAuto] = useState(true);
  const now = useNow(1_000);
  const query = useQuery({
    queryKey: qk.health,
    queryFn: () => client.admin.systemHealth(),
    refetchInterval: auto ? REFRESH_MS : false,
    refetchIntervalInBackground: false,
  });
  const h = query.data;
  const overall = h ? overallStatus(h) : null;
  const services = h ? [...h.services].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'DOWN' ? -1 : b.status === 'DOWN' ? 1 : a.status === 'DEGRADED' ? -1 : 1)) : undefined;

  return (
    <div className="adm-page">
      <PageHeader
        title="System health"
        subtitle={
          <span className="adm-refresh-note">
            {auto ? `Auto-refresh every ${REFRESH_MS / 1000}s` : 'Auto-refresh paused'}
            {query.dataUpdatedAt > 0 && <> · updated {fmtRelative(query.dataUpdatedAt, now)}</>}
          </span>
        }
        actions={
          <>
            <span className="row" style={{ gap: 8, fontSize: 12 }}>
              <Switch label="Auto-refresh" checked={auto} onChange={setAuto} />
              <span className="muted">Auto-refresh</span>
            </span>
            <Button size="sm" icon="refresh" loading={query.isFetching} onClick={() => void query.refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      {query.isError && !h ? (
        <div className="adm-panel">
          <ErrorState title="Health check failed" description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <>
          {query.isError && h && <Alert tone="error">Latest refresh failed ({errorMessage(query.error)}). Showing the last successful snapshot.</Alert>}
          {overall ? (
            <div className={`adm-banner adm-banner--${overall.tone}`} role="status">
              <Icon name={overall.tone === 'up' ? 'check' : 'alert'} size={16} />
              {overall.text}
            </div>
          ) : (
            <Skeleton height={38} />
          )}

          <Panel title="Services">
            <DataTable
              columns={serviceColumns(now)}
              rows={services}
              rowKey={(s) => `${s.name}:${typeof s.details?.instance === 'string' ? s.details.instance : 'none'}`}
              loading={query.isPending}
              skeletonRows={6}
              empty={<EmptyState icon="server" title="No services reported" />}
            />
          </Panel>

          <div className="adm-grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {h ? (
              <>
                <Infra
                  title="MySQL"
                  status={h.database.status}
                  items={[
                    ['Latency', latency(h.database.latencyMs)],
                    ['Connections', <span className="num">{fmtInt(h.database.connections)}</span>],
                  ]}
                />
                <Infra
                  title="Redis"
                  status={h.redis.status}
                  items={[
                    ['Latency', latency(h.redis.latencyMs)],
                    ['Used memory', <span className="num">{h.redis.usedMemory ?? '—'}</span>],
                  ]}
                />
                <Infra
                  title="WebSocket gateway"
                  status={h.services.some((s) => s.name === 'websocket' && s.status !== 'DOWN') ? 'UP' : 'DOWN'}
                  items={[['Open connections', <span className="num">{fmtInt(h.websocket.connections)}</span>]]}
                />
                <Panel title="API process">
                  <div className="adm-panel__body adm-kv-card" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    <KeyValue
                      items={[
                        ['Uptime', <span className="num">{fmtDuration(h.process.uptimeSec)}</span>],
                        ['RSS', <span className="num">{fmtBytes(h.process.rssBytes)}</span>],
                        [
                          'Heap used',
                          <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                            <span className="num">{fmtBytes(h.process.heapUsedBytes)}</span>
                            <span style={{ width: 60 }}>
                              <Progress value={h.process.rssBytes ? h.process.heapUsedBytes / h.process.rssBytes : 0} />
                            </span>
                          </span>,
                        ],
                        ['Load avg (1/5/15m)', <span className="num">{h.process.loadAvg.map((l) => l.toFixed(2)).join(' / ') || '—'}</span>],
                        ['CPU (user)', <span className="num">{fmtDuration(h.process.cpuUserMicros / 1_000_000)}</span>],
                      ]}
                    />
                  </div>
                </Panel>
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={130} style={{ borderRadius: 10 }} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
