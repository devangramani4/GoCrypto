import type { AuditLogDto } from '@gocrypto/shared-types';
import { Badge, Button, type Column, DataTable, EmptyState, Select, TextInput } from '@gocrypto/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AppModal } from '../components/AppModal';
import { JsonView, safeStringify } from '../components/feedback';
import { PageHeader, Panel } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { SearchInput } from '../components/SearchInput';
import { DateTime, Mono, UserLink } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { fromDateInput } from '../lib/format';
import { intParam, useSearchState } from '../lib/hooks';
import { qk } from '../lib/queryKeys';

const DEFAULTS = { q: '', type: '', userId: '', from: '', to: '', page: '1', pageSize: '50' };

const ACTION_PREFIXES = [
  { value: '', label: 'All actions' },
  { value: 'admin.', label: 'All admin actions' },
  { value: 'admin.user.', label: 'Admin · accounts' },
  { value: 'admin.market.', label: 'Admin · markets' },
  { value: 'admin.fees.', label: 'Admin · fees' },
  { value: 'admin.asset_network.', label: 'Admin · networks' },
  { value: 'admin.order.', label: 'Admin · orders' },
  { value: 'admin.withdrawal.', label: 'Admin · withdrawals' },
  { value: 'admin.wallet.', label: 'Admin · balance adjustments' },
  { value: 'admin.security.', label: 'Admin · security alerts' },
  { value: 'admin.roles.', label: 'Admin · roles' },
  { value: 'admin.settings.', label: 'Admin · settings' },
  { value: 'auth.', label: 'Auth (sign-up, recovery)' },
  { value: 'security.', label: 'User security changes' },
  { value: 'wallet.', label: 'User wallet actions' },
];

const ACTOR_TONE = { ADMIN: 'brand', USER: undefined, SYSTEM: 'warn' } as const;

function actionTone(action: string): 'down' | 'warn' | 'brand' | undefined {
  if (/(freeze|disable|reset_security|revoke|reject|cancel|adjust|roles\.update|settings\.update)/.test(action)) return 'down';
  if (action.startsWith('admin.')) return 'warn';
  return undefined;
}

function TargetCell({ log }: { log: AuditLogDto }) {
  if (!log.targetType) return <span className="faint">—</span>;
  if (log.targetType === 'USER' && log.targetId) {
    return (
      <span>
        <span className="faint">User </span>
        <UserLink id={log.targetId} email={`#${log.targetId}`} />
      </span>
    );
  }
  return (
    <span>
      <span className="faint">{log.targetType.toLowerCase()} </span>
      <span className="adm-mono">{log.targetId ?? ''}</span>
    </span>
  );
}

export function AuditLogsPage() {
  const client = useApi();
  const [s, set] = useSearchState(DEFAULTS);
  const page = intParam(s.page, 1);
  const pageSize = intParam(s.pageSize, 50);
  const from = s.from ? fromDateInput(s.from, 'start') : null;
  const to = s.to ? fromDateInput(s.to, 'end') : null;
  const params = { q: s.q || undefined, type: s.type || undefined, userId: s.userId || undefined, from: from ?? undefined, to: to ?? undefined, page, pageSize };
  const query = useQuery({ queryKey: qk.audit(params), queryFn: () => client.admin.auditLogs(params), placeholderData: keepPreviousData });
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const filtered = Boolean(s.q || s.type || s.userId || s.from || s.to);

  const columns: Column<AuditLogDto>[] = [
    { key: 'time', header: 'Time', render: (l) => <DateTime value={l.createdAt} /> },
    {
      key: 'actor',
      header: 'Actor',
      render: (l) => (
        <span className="row" style={{ gap: 6 }}>
          <Badge tone={ACTOR_TONE[l.actorType]}>{l.actorType}</Badge>
          {l.actorId ? <UserLink id={l.actorId} email={l.actorEmail} /> : <span className="faint">system</span>}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (l) => (
        <Badge tone={actionTone(l.action)}>
          <span className="adm-mono" style={{ fontSize: 11 }}>
            {l.action}
          </span>
        </Badge>
      ),
    },
    { key: 'target', header: 'Target', render: (l) => <TargetCell log={l} /> },
    { key: 'ip', header: 'IP', render: (l) => <Mono value={l.ip} /> },
    {
      key: 'meta',
      header: 'Details',
      render: (l) =>
        l.metadata ? (
          <span className="adm-json-inline" title="Click the row for full details">
            {safeStringify(l.metadata)}
          </span>
        ) : (
          <span className="faint">—</span>
        ),
    },
  ];

  return (
    <div className="adm-page">
      <PageHeader title="Audit logs" subtitle="Append-only record of administrative and security-relevant actions. Click a row for full details." />
      <Panel>
        <div className="adm-toolbar">
          <SearchInput value={s.q} onChange={(q) => set({ q, page: '1' })} placeholder="Search action, actor email or exact IP" label="Search audit logs" />
          <div className="adm-toolbar__field" style={{ width: 210 }}>
            <Select size="sm" aria-label="Action type" value={s.type} options={ACTION_PREFIXES} onChange={(e) => set({ type: e.target.value, page: '1' })} />
          </div>
          <SearchInput className="adm-toolbar__field--sm" value={s.userId} onChange={(v) => set({ userId: v.replace(/\D/g, ''), page: '1' })} placeholder="User ID" label="User ID (actor or target)" />
          <div style={{ width: 150 }}>
            <TextInput size="sm" type="date" aria-label="From date" value={s.from} max={s.to || undefined} onChange={(e) => set({ from: e.target.value, page: '1' })} />
          </div>
          <div style={{ width: 150 }}>
            <TextInput size="sm" type="date" aria-label="To date" value={s.to} min={s.from || undefined} onChange={(e) => set({ to: e.target.value, page: '1' })} />
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" icon="x" onClick={() => set({}, { reset: true })}>
              Clear
            </Button>
          )}
        </div>
        <DataTable
          columns={columns}
          rows={query.data?.items}
          rowKey={(l) => l.id}
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={setSelected}
          empty={<EmptyState icon="file" title={filtered ? 'No log entries match these filters' : 'No audit entries yet'} />}
        />
        {query.data && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={query.data.total}
            fetching={query.isFetching}
            onPageChange={(p) => set({ page: String(p) })}
            onPageSizeChange={(n) => set({ pageSize: String(n), page: '1' })}
          />
        )}
      </Panel>
      <AppModal open={selected !== null} title={selected ? selected.action : ''} onClose={() => setSelected(null)} wide>
        {selected && (
          <div className="adm-stack">
            <div className="adm-form-grid">
              <div>
                <div className="gc-field__label">When</div>
                <DateTime value={selected.createdAt} relative />
              </div>
              <div>
                <div className="gc-field__label">Actor</div>
                <span className="row" style={{ gap: 6 }}>
                  <Badge tone={ACTOR_TONE[selected.actorType]}>{selected.actorType}</Badge>
                  {selected.actorId ? <UserLink id={selected.actorId} email={selected.actorEmail} /> : 'system'}
                </span>
              </div>
              <div>
                <div className="gc-field__label">Target</div>
                <TargetCell log={selected} />
              </div>
              <div>
                <div className="gc-field__label">IP address</div>
                <Mono value={selected.ip} copy />
              </div>
            </div>
            <div>
              <div className="gc-field__label" style={{ marginBottom: 6 }}>
                Metadata
              </div>
              {selected.metadata ? <JsonView value={selected.metadata} /> : <span className="faint">No metadata recorded</span>}
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
}
