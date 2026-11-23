import { SECURITY_ALERT_TYPES, type SecurityAlertDto } from '@gocrypto/shared-types';
import { Badge, Button, Checkbox, type Column, DataTable, EmptyState, ErrorState, Progress, Segmented, Select, Stat, Tabs } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActionDialog } from '../components/ActionDialog';
import { AppModal } from '../components/AppModal';
import { BlockSkeleton, JsonView, safeStringify } from '../components/feedback';
import { PageHeader, Panel } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { DateTime, Mono, StatusBadge, UserLink } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { fmtInt, fmtPct, fmtRelative, fmtUtc } from '../lib/format';
import { intParam, useSearchState } from '../lib/hooks';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { SEVERITY_TONE, humanize } from '../lib/status';
import { useAction } from '../lib/useAction';

type TabKey = 'logins' | 'alerts' | 'ips' | 'devices' | 'adoption';
const TAB_KEYS: TabKey[] = ['logins', 'alerts', 'ips', 'devices', 'adoption'];

const DEFAULTS = { tab: 'logins', status: '', q: '', type: '', hours: '24', suspicious: '', page: '1', pageSize: '25' };

// ───────────────────────────── row shapes (untyped endpoints) ─────────────────────────────

export interface LoginRow {
  id: string;
  userId: string | null;
  email: string | null;
  method: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  platform: string | null;
  createdAt: number;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function toLoginRow(r: Record<string, unknown>): LoginRow {
  return {
    id: String(r.id ?? ''),
    userId: str(r.userId),
    email: str(r.email),
    method: String(r.method ?? ''),
    success: Boolean(r.success),
    reason: str(r.reason),
    ip: str(r.ip),
    userAgent: str(r.userAgent),
    platform: str(r.platform),
    createdAt: Number(r.createdAt ?? 0),
  };
}

export interface IpRow {
  ip: string;
  attempts: number;
  failures: number;
  distinctUsers: number;
  lastSeen: number;
  suspicious: boolean;
}

export function toIpRow(r: Record<string, unknown>): IpRow {
  return {
    ip: String(r.ip ?? ''),
    attempts: Number(r.attempts ?? 0),
    failures: Number(r.failures ?? 0),
    distinctUsers: Number(r.distinctUsers ?? 0),
    lastSeen: Number(r.lastSeen ?? 0),
    suspicious: Boolean(r.suspicious),
  };
}

interface DeviceRow {
  id: string;
  userId: string;
  userEmail: string;
  name: string | null;
  platform: string;
  lastIp: string | null;
  lastSeenAt: number;
  trusted: boolean;
}

function toDeviceRow(r: Record<string, unknown>): DeviceRow {
  return {
    id: String(r.id ?? ''),
    userId: String(r.userId ?? ''),
    userEmail: String(r.userEmail ?? ''),
    name: str(r.name),
    platform: String(r.platform ?? ''),
    lastIp: str(r.lastIp),
    lastSeenAt: Number(r.lastSeenAt ?? 0),
    trusted: Boolean(r.trusted),
  };
}

// ───────────────────────────── tabs ─────────────────────────────

function LoginsTab({ s, set }: TabProps) {
  const client = useApi();
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const params = { status: s.status || undefined, q: s.q || undefined, page, pageSize };
  const query = useQuery({
    queryKey: qk.logins(params),
    queryFn: () => client.admin.logins(params),
    placeholderData: keepPreviousData,
    select: (d) => ({ ...d, items: d.items.map(toLoginRow) }),
  });
  const columns: Column<LoginRow>[] = [
    { key: 'time', header: 'Time', render: (l) => <DateTime value={l.createdAt} /> },
    { key: 'account', header: 'Account', render: (l) => (l.userId || l.email ? <UserLink id={l.userId} email={l.email} /> : <span className="faint">Unknown</span>) },
    {
      key: 'result',
      header: 'Result',
      render: (l) => (l.success ? <Badge tone="up">Success</Badge> : <Badge tone="down">{l.reason ? humanize(l.reason) : 'Failed'}</Badge>),
    },
    { key: 'method', header: 'Method', render: (l) => <span className="muted">{humanize(l.method)}</span> },
    {
      key: 'ip',
      header: 'IP',
      render: (l) =>
        l.ip ? (
          <button type="button" className="adm-link-btn adm-mono" title="Show all attempts from this IP" onClick={() => set({ q: l.ip ?? '', page: '1' })}>
            {l.ip}
          </button>
        ) : (
          <span className="faint">—</span>
        ),
    },
    { key: 'platform', header: 'Platform', render: (l) => (l.platform ? <Badge>{l.platform}</Badge> : <span className="faint">—</span>) },
    {
      key: 'ua',
      header: 'User agent',
      render: (l) => (
        <span className="truncate" style={{ display: 'inline-block', maxWidth: 300 }} title={l.userAgent ?? undefined}>
          {l.userAgent ?? '—'}
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="adm-toolbar">
        <Segmented
          value={s.status === 'SUCCESS' || s.status === 'FAILED' ? s.status : 'ALL'}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'SUCCESS', label: 'Successful' },
            { value: 'FAILED', label: 'Failed' },
          ]}
          onChange={(v) => set({ status: v === 'ALL' ? '' : v, page: '1' })}
        />
        <SearchInput value={s.q} onChange={(q) => set({ q, page: '1' })} placeholder="Search email or exact IP" label="Search sign-ins" />
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(l) => l.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="lock" title="No sign-in attempts match" />}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} fetching={query.isFetching} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(n) => set({ pageSize: String(n), page: '1' })} />}
    </>
  );
}

function AlertsTab({ s, set }: TabProps) {
  const client = useApi();
  const can = useCan();
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const status = s.status === 'RESOLVED' || s.status === 'ALL' ? s.status : 'OPEN';
  const params = { status: status === 'ALL' ? undefined : status, type: s.type || undefined, page, pageSize };
  const query = useQuery({ queryKey: qk.alerts(params), queryFn: () => client.admin.alerts(params), placeholderData: keepPreviousData });
  const [resolving, setResolving] = useState<SecurityAlertDto | null>(null);
  const [details, setDetails] = useState<SecurityAlertDto | null>(null);
  const resolve = useAction<SecurityAlertDto>({
    mutationFn: (a) => client.admin.resolveAlert(a.id),
    success: 'Alert resolved',
    invalidate: [qk.alertsAll, qk.dashboard],
    errorToast: false,
    onSuccess: () => setResolving(null),
  });
  const canWrite = can('security.write');
  const columns: Column<SecurityAlertDto>[] = [
    { key: 'time', header: 'Raised', render: (a) => <DateTime value={a.createdAt} relative /> },
    { key: 'severity', header: 'Severity', render: (a) => <StatusBadge value={a.severity} tones={SEVERITY_TONE} /> },
    { key: 'type', header: 'Type', render: (a) => <span style={{ fontWeight: 500 }}>{humanize(a.type)}</span> },
    { key: 'user', header: 'User', render: (a) => <UserLink id={a.userId} email={a.userEmail} /> },
    { key: 'ip', header: 'IP', render: (a) => <Mono value={a.ip} /> },
    {
      key: 'details',
      header: 'Details',
      render: (a) =>
        a.details ? (
          <button type="button" className="adm-link-btn" title="View details" onClick={() => setDetails(a)}>
            <span className="adm-json-inline">{safeStringify(a.details)}</span>
          </button>
        ) : (
          <span className="faint">—</span>
        ),
    },
    {
      key: 'state',
      header: 'Status',
      render: (a) =>
        a.resolvedAt ? (
          <span title={fmtUtc(a.resolvedAt)}>
            <Badge>Resolved</Badge> <span className="faint" style={{ fontSize: 11 }}>{fmtRelative(a.resolvedAt)}</span>
          </span>
        ) : (
          <Badge tone="warn">Open</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) =>
        a.resolvedAt ? null : (
          <Button size="sm" icon="check" disabled={!canWrite} title={canWrite ? undefined : 'Requires permission: security.write'} onClick={() => setResolving(a)}>
            Resolve
          </Button>
        ),
    },
  ];
  return (
    <>
      <div className="adm-toolbar">
        <Segmented
          value={status}
          options={[
            { value: 'OPEN', label: 'Open' },
            { value: 'RESOLVED', label: 'Resolved' },
            { value: 'ALL', label: 'All' },
          ]}
          onChange={(v) => set({ status: v === 'OPEN' ? '' : v, page: '1' })}
        />
        <div className="adm-toolbar__field">
          <Select
            size="sm"
            aria-label="Alert type"
            value={s.type}
            options={[{ value: '', label: 'All types' }, ...SECURITY_ALERT_TYPES.map((t) => ({ value: t, label: humanize(t) }))]}
            onChange={(e) => set({ type: e.target.value, page: '1' })}
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(a) => a.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="shield" title={status === 'OPEN' ? 'No open alerts' : 'No alerts match'} description={status === 'OPEN' ? 'Everything has been triaged.' : undefined} />}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} fetching={query.isFetching} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(n) => set({ pageSize: String(n), page: '1' })} />}
      <ActionDialog
        open={resolving !== null}
        title="Resolve alert"
        confirmLabel="Mark resolved"
        description={resolving && `${humanize(resolving.type)} (${resolving.severity.toLowerCase()} severity)${resolving.userEmail ? ` for ${resolving.userEmail}` : ''}. Confirm it has been investigated; the resolution is audited.`}
        pending={resolve.isPending}
        error={resolve.error ? errorMessage(resolve.error) : null}
        onConfirm={() => resolving && resolve.mutate(resolving)}
        onClose={() => {
          resolve.reset();
          setResolving(null);
        }}
      />
      <AppModal open={details !== null} title={details ? `${humanize(details.type)} · details` : ''} onClose={() => setDetails(null)} wide>
        {details && <JsonView value={details.details} />}
      </AppModal>
    </>
  );
}

const WINDOWS = [
  { value: '1', label: 'Last hour' },
  { value: '24', label: 'Last 24 hours' },
  { value: '72', label: 'Last 3 days' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
];

function IpsTab({ s, set }: TabProps) {
  const client = useApi();
  const hours = Math.min(720, Math.max(1, intParam(s.hours, 24)));
  const query = useQuery({ queryKey: qk.ips(hours), queryFn: () => client.admin.ips(hours), select: (rows) => rows.map(toIpRow) });
  const onlySuspicious = s.suspicious === '1';
  const rows = useMemo(() => (onlySuspicious ? query.data?.filter((r) => r.suspicious) : query.data), [query.data, onlySuspicious]);
  const flagged = query.data?.filter((r) => r.suspicious).length ?? 0;
  const columns: Column<IpRow>[] = [
    {
      key: 'ip',
      header: 'IP address',
      render: (r) => (
        <span className="row" style={{ gap: 8 }}>
          <Mono value={r.ip} copy />
          {r.suspicious && <Badge tone="down">Suspicious</Badge>}
        </span>
      ),
    },
    { key: 'attempts', header: 'Attempts', align: 'right', render: (r) => <span className="num">{fmtInt(r.attempts)}</span> },
    { key: 'failures', header: 'Failures', align: 'right', render: (r) => <span className={r.failures ? 'num down' : 'num'}>{fmtInt(r.failures)}</span> },
    {
      key: 'rate',
      header: 'Failure rate',
      align: 'right',
      render: (r) => <span className="num">{r.attempts ? fmtPct((r.failures / r.attempts) * 100, 0) : '—'}</span>,
    },
    { key: 'users', header: 'Accounts', align: 'right', render: (r) => <span className={r.distinctUsers >= 5 ? 'num warn' : 'num'}>{fmtInt(r.distinctUsers)}</span> },
    { key: 'seen', header: 'Last seen', render: (r) => <DateTime value={r.lastSeen} relative /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" variant="ghost" icon="search" onClick={() => set({ tab: 'logins', q: r.ip, status: '', page: '1' })}>
          Sign-ins
        </Button>
      ),
    },
  ];
  return (
    <>
      <div className="adm-toolbar">
        <div className="adm-toolbar__field">
          <Select size="sm" aria-label="Time window" value={String(hours)} options={WINDOWS} onChange={(e) => set({ hours: e.target.value })} />
        </div>
        <Checkbox checked={onlySuspicious} onChange={(v) => set({ suspicious: v ? '1' : '' })}>
          Suspicious only
        </Checkbox>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          Flagged when an IP has ≥ 10 failures or targets ≥ 5 accounts · top 100 by failures
        </span>
        {flagged > 0 && <Badge tone="down">{flagged} flagged</Badge>}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.ip}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="globe" title={onlySuspicious ? 'No suspicious IPs in this window' : 'No sign-in activity in this window'} />}
      />
    </>
  );
}

function DevicesTab({ s, set }: TabProps) {
  const client = useApi();
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 25);
  const params = { page, pageSize };
  const query = useQuery({
    queryKey: qk.devices(params),
    queryFn: () => client.admin.devices(params),
    placeholderData: keepPreviousData,
    select: (d) => ({ ...d, items: d.items.map(toDeviceRow) }),
  });
  const columns: Column<DeviceRow>[] = [
    { key: 'seen', header: 'Last seen', render: (d) => <DateTime value={d.lastSeenAt} relative /> },
    { key: 'user', header: 'User', render: (d) => <UserLink id={d.userId} email={d.userEmail} /> },
    { key: 'name', header: 'Device', render: (d) => d.name ?? <span className="faint">Unnamed</span> },
    { key: 'platform', header: 'Platform', render: (d) => <Badge>{d.platform}</Badge> },
    { key: 'ip', header: 'Last IP', render: (d) => <Mono value={d.lastIp} /> },
    { key: 'trusted', header: 'Trust', render: (d) => (d.trusted ? <Badge tone="up">Trusted</Badge> : <Badge>Untrusted</Badge>) },
  ];
  return (
    <>
      <div className="adm-toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          Active (non-revoked) devices across all accounts, most recently seen first.
        </span>
      </div>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(d) => d.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="smartphone" title="No registered devices" />}
      />
      {query.data && <Pagination page={page} pageSize={pageSize} total={query.data.total} fetching={query.isFetching} onPageChange={(p) => set({ page: String(p) })} onPageSizeChange={(n) => set({ pageSize: String(n), page: '1' })} />}
    </>
  );
}

function AdoptionCard({ label, count, percent, total, hint }: { label: string; count: number; percent: number; total: number; hint: string }) {
  const tone = percent >= 75 ? 'up' : percent >= 40 ? 'warn' : 'down';
  return (
    <div className="adm-stat">
      <Stat label={label} value={fmtPct(percent)} sub={`${fmtInt(count)} of ${fmtInt(total)} users`} />
      <div style={{ marginTop: 10 }}>
        <Progress value={percent / 100} tone={tone} />
      </div>
      <div className="adm-cell-sub" style={{ marginTop: 8 }}>
        {hint}
      </div>
    </div>
  );
}

function AdoptionTab() {
  const client = useApi();
  const query = useQuery({ queryKey: qk.twoFactor, queryFn: () => client.admin.twoFactor() });
  if (query.isPending) return <BlockSkeleton rows={4} height={40} />;
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  const d = query.data;
  const n = (k: string) => Number(d[k] ?? 0);
  const total = n('totalUsers');
  return (
    <div className="adm-stack" style={{ padding: 16 }}>
      <div className="adm-stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        <AdoptionCard label="Two-factor authentication" count={n('twoFactorEnabled')} percent={n('twoFactorPercent')} total={total} hint="Authenticator app (TOTP) enabled" />
        <AdoptionCard label="Trading PIN" count={n('pinSet')} percent={n('pinPercent')} total={total} hint="PIN set for order and withdrawal confirmation" />
        <AdoptionCard label="Verified email" count={n('emailVerified')} percent={n('emailVerifiedPercent')} total={total} hint="Required before withdrawals" />
      </div>
      <div className="adm-muted-box">
        Accounts without 2FA add +10 to every withdrawal risk score (flag <code className="adm-mono">NO_2FA</code>). Encourage adoption through in-app prompts
        before raising review thresholds.
      </div>
    </div>
  );
}

// ───────────────────────────── page ─────────────────────────────

type State = typeof DEFAULTS;
interface TabProps {
  s: State;
  set: (patch: Partial<State>, opts?: { reset?: boolean }) => void;
}

export function SecurityPage() {
  const [s, setState] = useSearchState(DEFAULTS);
  const tab: TabKey = TAB_KEYS.includes(s.tab as TabKey) ? (s.tab as TabKey) : 'logins';
  const set: TabProps['set'] = (patch, opts) => {
    // Switching tabs starts from a clean filter set.
    if (patch.tab && patch.tab !== tab) setState({ ...patch }, { reset: true });
    else setState(patch, opts);
  };
  return (
    <div className="adm-page">
      <PageHeader title="Security" subtitle="Sign-in activity, security alerts, IP and device monitoring, and account protection adoption." />
      <Panel>
        <Tabs<TabKey>
          value={tab}
          tabs={[
            { value: 'logins', label: 'Sign-in activity' },
            { value: 'alerts', label: 'Alerts' },
            { value: 'ips', label: 'IP monitoring' },
            { value: 'devices', label: 'Devices' },
            { value: 'adoption', label: '2FA & PIN adoption' },
          ]}
          onChange={(t) => set({ tab: t })}
        />
        {tab === 'logins' && <LoginsTab s={s} set={set} />}
        {tab === 'alerts' && <AlertsTab s={s} set={set} />}
        {tab === 'ips' && <IpsTab s={s} set={set} />}
        {tab === 'devices' && <DevicesTab s={s} set={set} />}
        {tab === 'adoption' && <AdoptionTab />}
      </Panel>
    </div>
  );
}
