import { type FeeScheduleDto, MARKET_TYPES, type MarketType } from '@gocrypto/shared-types';
import { Alert, Badge, Button, type Column, DataTable, EmptyState, ErrorState, Switch, TextInput, cx } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { ActionDialog } from '../components/ActionDialog';
import { AppModal } from '../components/AppModal';
import { BlockSkeleton } from '../components/feedback';
import { PageHeader, Panel } from '../components/PageHeader';
import { SearchInput } from '../components/SearchInput';
import { Amount } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { dec, fmtRate } from '../lib/format';
import { useOpenEffect } from '../lib/hooks';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { humanize } from '../lib/status';
import { useAction } from '../lib/useAction';
import { validateRate } from '../lib/validators';

// ───────────────────────────── fee schedule grid ─────────────────────────────

type CellKey = `${MarketType}:${number}`;
interface CellValue {
  maker: string;
  taker: string;
}

const cellKey = (t: MarketType, tier: number): CellKey => `${t}:${tier}`;

function toGrid(schedule: FeeScheduleDto[]): Record<CellKey, CellValue> {
  const out: Record<CellKey, CellValue> = {};
  for (const r of schedule) out[cellKey(r.marketType, r.vipTier)] = { maker: r.makerRate, taker: r.takerRate };
  return out;
}

/** Rows that differ from the server copy, validated like the API (`adminFeeScheduleSchema`). */
export function diffSchedule(
  original: Record<CellKey, CellValue>,
  draft: Record<CellKey, CellValue>,
): { changes: FeeScheduleDto[]; errors: Record<string, string> } {
  const changes: FeeScheduleDto[] = [];
  const errors: Record<string, string> = {};
  for (const [key, v] of Object.entries(draft) as [CellKey, CellValue][]) {
    const o = original[key];
    const maker = v.maker.trim();
    const taker = v.taker.trim();
    if (o && maker === o.maker && taker === o.taker) continue;
    if (!o && !maker && !taker) continue;
    const [marketType, tier] = key.split(':') as [MarketType, string];
    const makerErr = validateRate(maker, true);
    const takerErr = validateRate(taker, false);
    if (makerErr) errors[`${key}:maker`] = makerErr;
    if (takerErr) errors[`${key}:taker`] = takerErr;
    if (!makerErr && !takerErr) changes.push({ marketType, vipTier: Number(tier), makerRate: maker, takerRate: taker });
  }
  return { changes, errors };
}

function RateCell({ value, original, error, editable, label, onChange }: { value: string; original: string | undefined; error?: string; editable: boolean; label: string; onChange: (v: string) => void }) {
  if (!editable) return <span className="num">{value ? fmtRate(value) : <span className="faint">—</span>}</span>;
  const dirty = value.trim() !== (original ?? '');
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }} title={error}>
      <TextInput
        size="sm"
        aria-label={label}
        className={cx('adm-inline-input', dirty && 'adm-inline-input--dirty')}
        value={value}
        placeholder="—"
        aria-invalid={error ? true : undefined}
        style={{ width: 96 }}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className={cx('adm-cell-sub', 'num', error && 'down')}>{error ? 'Invalid' : value.trim() && dec(value) ? fmtRate(value) : ' '}</span>
    </span>
  );
}

function FeeSchedulePanel({ schedule }: { schedule: FeeScheduleDto[] }) {
  const client = useApi();
  const can = useCan();
  const editable = can('fees.write');
  const original = useMemo(() => toGrid(schedule), [schedule]);
  const [draft, setDraft] = useState<Record<CellKey, CellValue>>(original);
  const [extraTiers, setExtraTiers] = useState<number[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [source, setSource] = useState(schedule);

  // Server copy changed (after save / refetch): reset the draft to it.
  if (source !== schedule) {
    setSource(schedule);
    setDraft(original);
    setExtraTiers([]);
  }

  const tiers = useMemo(() => {
    const set = new Set<number>(schedule.map((r) => r.vipTier));
    for (const t of extraTiers) set.add(t);
    return [...set].sort((a, b) => a - b);
  }, [schedule, extraTiers]);

  const { changes, errors } = diffSchedule(original, draft);
  const errorCount = Object.keys(errors).length;
  const nextTier = (tiers[tiers.length - 1] ?? -1) + 1;

  const save = useAction<FeeScheduleDto[], FeeScheduleDto[]>({
    mutationFn: (rows) => client.admin.setFees(rows),
    success: (_d, rows) => `Fee schedule updated (${rows.length} row${rows.length === 1 ? '' : 's'})`,
    invalidate: [qk.fees],
    errorToast: false,
    onSuccess: () => setConfirming(false),
  });

  const update = (key: CellKey, field: keyof CellValue, value: string) =>
    setDraft((d) => ({ ...d, [key]: { maker: d[key]?.maker ?? '', taker: d[key]?.taker ?? '', [field]: value } }));

  return (
    <Panel
      title="Trading fee schedule"
      actions={
        editable && (
          <>
            <Button size="sm" icon="plus" disabled={nextTier > 9} onClick={() => setExtraTiers((t) => [...t, nextTier])}>
              Add VIP {nextTier > 9 ? '' : nextTier}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!changes.length && !errorCount && !extraTiers.length}
              onClick={() => {
                setDraft(original);
                setExtraTiers([]);
              }}
            >
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={!changes.length || errorCount > 0} onClick={() => setConfirming(true)}>
              Save changes{changes.length ? ` (${changes.length})` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="adm-toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          Rates are decimals (0.001 = 0.1%). Maker rates may be negative for rebates. Users without a schedule row for their tier pay the VIP 0 rate; market and
          per-user overrides take precedence.
        </span>
      </div>
      <div className="gc-table-wrap">
        <table className="gc-table">
          <thead>
            <tr>
              <th rowSpan={2}>VIP tier</th>
              {MARKET_TYPES.map((t) => (
                <th key={t} colSpan={2} style={{ borderLeft: '1px solid var(--c-border)', textAlign: 'center', color: 'var(--c-text-muted)', fontWeight: 600 }}>
                  {humanize(t)}
                </th>
              ))}
            </tr>
            <tr>
              {MARKET_TYPES.map((t) => (
                <FragmentHeaders key={t} />
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr key={tier} className={cx(MARKET_TYPES.some((t) => changes.some((c) => c.marketType === t && c.vipTier === tier)) && 'adm-row--dirty')}>
                <td>
                  <Badge tone={tier === 0 ? undefined : 'brand'}>VIP {tier}</Badge>
                </td>
                {MARKET_TYPES.map((t) => {
                  const key = cellKey(t, tier);
                  const v = draft[key] ?? { maker: '', taker: '' };
                  return (
                    <FeeCells
                      key={t}
                      value={v}
                      original={original[key]}
                      errors={{ maker: errors[`${key}:maker`], taker: errors[`${key}:taker`] }}
                      editable={editable}
                      label={`${humanize(t)} VIP ${tier}`}
                      onChange={(field, value) => update(key, field, value)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tiers.length === 0 && <EmptyState icon="dollar" title="No fee schedule rows" description="Add VIP 0 to define the default rates." />}
      <ActionDialog
        open={confirming}
        title="Update fee schedule"
        confirmLabel="Apply new fees"
        description={
          <div className="adm-stack" style={{ gap: 8 }}>
            <span>These rates apply to new fills for every user on the affected VIP tiers immediately.</span>
            <table className="gc-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Tier</th>
                  <th className="right">Maker</th>
                  <th className="right">Taker</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const o = original[cellKey(c.marketType, c.vipTier)];
                  return (
                    <tr key={`${c.marketType}:${c.vipTier}`}>
                      <td>{humanize(c.marketType)}</td>
                      <td className="num">VIP {c.vipTier}</td>
                      <td className="right num">
                        {o ? <span className="faint">{fmtRate(o.maker)} → </span> : null}
                        {fmtRate(c.makerRate)}
                      </td>
                      <td className="right num">
                        {o ? <span className="faint">{fmtRate(o.taker)} → </span> : null}
                        {fmtRate(c.takerRate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        }
        wide
        pending={save.isPending}
        error={save.error ? errorMessage(save.error) : null}
        onConfirm={() => save.mutate(changes)}
        onClose={() => {
          save.reset();
          setConfirming(false);
        }}
      />
    </Panel>
  );
}

function FragmentHeaders() {
  return (
    <>
      <th className="right" style={{ borderLeft: '1px solid var(--c-border)' }}>
        Maker
      </th>
      <th className="right">Taker</th>
    </>
  );
}

function FeeCells({
  value,
  original,
  errors,
  editable,
  label,
  onChange,
}: {
  value: CellValue;
  original: CellValue | undefined;
  errors: { maker?: string; taker?: string };
  editable: boolean;
  label: string;
  onChange: (field: keyof CellValue, value: string) => void;
}) {
  return (
    <>
      <td className="right" style={{ borderLeft: '1px solid var(--c-border)' }}>
        <RateCell value={value.maker} original={original?.maker} error={errors.maker} editable={editable} label={`${label} maker rate`} onChange={(v) => onChange('maker', v)} />
      </td>
      <td className="right">
        <RateCell value={value.taker} original={original?.taker} error={errors.taker} editable={editable} label={`${label} taker rate`} onChange={(v) => onChange('taker', v)} />
      </td>
    </>
  );
}

// ───────────────────────────── withdrawal networks ─────────────────────────────

export interface NetworkFeeRow {
  asset: string;
  network: string;
  withdrawalFee: string;
  minWithdrawal: string;
  minDeposit: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  confirmations: number;
}

export function toNetworkRow(r: Record<string, unknown>): NetworkFeeRow {
  return {
    asset: String(r.asset ?? ''),
    network: String(r.network ?? ''),
    withdrawalFee: String(r.withdrawalFee ?? '0'),
    minWithdrawal: String(r.minWithdrawal ?? '0'),
    minDeposit: String(r.minDeposit ?? '0'),
    depositEnabled: Boolean(r.depositEnabled),
    withdrawEnabled: Boolean(r.withdrawEnabled),
    confirmations: Number(r.confirmations ?? 0),
  };
}

type Toggle = { row: NetworkFeeRow; field: 'depositEnabled' | 'withdrawEnabled'; value: boolean };

function NetworksPanel({ rows }: { rows: NetworkFeeRow[] }) {
  const client = useApi();
  const can = useCan();
  const editable = can('fees.write');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<NetworkFeeRow | null>(null);
  const [toggle, setToggle] = useState<Toggle | null>(null);

  const patch = useAction<Toggle>({
    mutationFn: (t) => client.admin.updateAssetNetwork(t.row.asset, t.row.network, { [t.field]: t.value }),
    success: (_d, t) => `${t.row.asset} on ${t.row.network}: ${t.field === 'depositEnabled' ? 'deposits' : 'withdrawals'} ${t.value ? 'enabled' : 'disabled'}`,
    invalidate: [qk.fees],
    onSuccess: () => setToggle(null),
  });

  const onToggle = (t: Toggle) => {
    // Disabling a rail affects every user immediately: confirm first. Enabling applies directly.
    if (t.value) patch.mutate(t);
    else setToggle(t);
  };

  const filter = q.trim().toUpperCase();
  const visible = filter ? rows.filter((r) => r.asset.includes(filter) || r.network.includes(filter)) : rows;

  const columns: Column<NetworkFeeRow>[] = [
    { key: 'asset', header: 'Asset', render: (r) => <strong style={{ fontWeight: 600 }}>{r.asset}</strong> },
    { key: 'network', header: 'Network', render: (r) => <Badge>{r.network}</Badge> },
    { key: 'fee', header: 'Withdrawal fee', align: 'right', render: (r) => <Amount value={r.withdrawalFee} asset={r.asset} /> },
    { key: 'minW', header: 'Min withdrawal', align: 'right', render: (r) => <Amount value={r.minWithdrawal} /> },
    { key: 'minD', header: 'Min deposit', align: 'right', render: (r) => <Amount value={r.minDeposit} /> },
    { key: 'conf', header: 'Confirmations', align: 'right', render: (r) => <span className="num">{r.confirmations}</span> },
    {
      key: 'dep',
      header: 'Deposits',
      render: (r) => (
        <span className="row" style={{ gap: 8 }}>
          <Switch
            label={`${r.asset} ${r.network} deposits`}
            checked={r.depositEnabled}
            disabled={!editable || patch.isPending}
            onChange={(v) => onToggle({ row: r, field: 'depositEnabled', value: v })}
          />
          <span className={r.depositEnabled ? 'up' : 'faint'} style={{ fontSize: 12 }}>
            {r.depositEnabled ? 'On' : 'Off'}
          </span>
        </span>
      ),
    },
    {
      key: 'wd',
      header: 'Withdrawals',
      render: (r) => (
        <span className="row" style={{ gap: 8 }}>
          <Switch
            label={`${r.asset} ${r.network} withdrawals`}
            checked={r.withdrawEnabled}
            disabled={!editable || patch.isPending}
            onChange={(v) => onToggle({ row: r, field: 'withdrawEnabled', value: v })}
          />
          <span className={r.withdrawEnabled ? 'up' : 'faint'} style={{ fontSize: 12 }}>
            {r.withdrawEnabled ? 'On' : 'Off'}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" icon="pen" disabled={!editable} onClick={() => setEditing(r)}>
          Edit
        </Button>
      ),
    },
  ];

  return (
    <Panel title="Withdrawal fees & limits">
      <div className="adm-toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Filter by asset or network" delay={120} />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {rows.length} asset networks
        </span>
      </div>
      <DataTable
        columns={columns}
        rows={visible}
        rowKey={(r) => `${r.asset}:${r.network}`}
        empty={<EmptyState icon="wallet" title="No networks match this filter" />}
      />
      <NetworkEditDialog row={editing} onClose={() => setEditing(null)} />
      <ActionDialog
        open={toggle !== null}
        title={toggle?.field === 'depositEnabled' ? 'Disable deposits' : 'Disable withdrawals'}
        tone="danger"
        confirmLabel="Disable"
        description={
          toggle && (
            <>
              {toggle.field === 'depositEnabled' ? 'New deposits' : 'New withdrawal requests'} for <strong>{toggle.row.asset}</strong> on{' '}
              <strong>{toggle.row.network}</strong> will be rejected for all users until re-enabled.
            </>
          )
        }
        pending={patch.isPending}
        onConfirm={() => toggle && patch.mutate(toggle)}
        onClose={() => setToggle(null)}
      />
    </Panel>
  );
}

const DECIMAL = /^\d+(\.\d+)?$/;

function NetworkEditDialog({ row, onClose }: { row: NetworkFeeRow | null; onClose: () => void }) {
  const client = useApi();
  const formId = useId();
  const [form, setForm] = useState({ withdrawalFee: '', minWithdrawal: '', minDeposit: '', confirmations: '' });
  const [submitted, setSubmitted] = useState(false);

  useOpenEffect(row !== null, () => {
    if (!row) return;
    setForm({ withdrawalFee: row.withdrawalFee, minWithdrawal: row.minWithdrawal, minDeposit: row.minDeposit, confirmations: String(row.confirmations) });
    setSubmitted(false);
  });

  const action = useAction<{ row: NetworkFeeRow; body: Record<string, unknown> }>({
    mutationFn: ({ row: r, body }) => client.admin.updateAssetNetwork(r.asset, r.network, body),
    success: (_d, v) => `${v.row.asset} on ${v.row.network} updated`,
    invalidate: [qk.fees],
    errorToast: false,
    onSuccess: onClose,
  });

  if (!row) return null;
  const errors: Record<string, string> = {};
  for (const k of ['withdrawalFee', 'minWithdrawal', 'minDeposit'] as const) if (!DECIMAL.test(form[k].trim())) errors[k] = 'Non-negative decimal, e.g. 0.0005';
  const conf = Number(form.confirmations);
  if (!Number.isInteger(conf) || conf < 1 || conf > 1000) errors.confirmations = 'Whole number between 1 and 1000';
  const fee = dec(form.withdrawalFee);
  const minW = dec(form.minWithdrawal);
  if (fee && minW && !errors.minWithdrawal && minW.lte(fee)) errors.minWithdrawal = 'Should exceed the withdrawal fee';

  const body: Record<string, unknown> = {};
  if (form.withdrawalFee.trim() !== row.withdrawalFee) body.withdrawalFee = form.withdrawalFee.trim();
  if (form.minWithdrawal.trim() !== row.minWithdrawal) body.minWithdrawal = form.minWithdrawal.trim();
  if (form.minDeposit.trim() !== row.minDeposit) body.minDeposit = form.minDeposit.trim();
  if (conf !== row.confirmations) body.confirmations = conf;
  const dirty = Object.keys(body).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || !dirty) return;
    action.mutate({ row, body });
  };

  return (
    <AppModal
      open
      title={`${row.asset} · ${row.network}`}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={action.isPending} disabled={!dirty}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form-grid" onSubmit={submit} noValidate>
        <TextInput label="Withdrawal fee" inputMode="decimal" suffix={row.asset} value={form.withdrawalFee} error={submitted ? errors.withdrawalFee : null} onChange={(e) => setForm((f) => ({ ...f, withdrawalFee: e.target.value }))} />
        <TextInput label="Min withdrawal" inputMode="decimal" suffix={row.asset} value={form.minWithdrawal} error={submitted ? errors.minWithdrawal : null} onChange={(e) => setForm((f) => ({ ...f, minWithdrawal: e.target.value }))} />
        <TextInput label="Min deposit" inputMode="decimal" suffix={row.asset} value={form.minDeposit} error={submitted ? errors.minDeposit : null} onChange={(e) => setForm((f) => ({ ...f, minDeposit: e.target.value }))} />
        <TextInput
          label="Confirmations"
          inputMode="numeric"
          value={form.confirmations}
          error={submitted ? errors.confirmations : null}
          hint={`Network-wide: applies to every asset on ${row.network}`}
          onChange={(e) => setForm((f) => ({ ...f, confirmations: e.target.value.replace(/\D/g, '') }))}
        />
        {action.error ? (
          <div className="adm-span-all">
            <Alert tone="error">{errorMessage(action.error)}</Alert>
          </div>
        ) : null}
      </form>
    </AppModal>
  );
}

// ───────────────────────────── page ─────────────────────────────

export function FeesPage() {
  const client = useApi();
  const query = useQuery({ queryKey: qk.fees, queryFn: () => client.admin.fees() });
  const networks = useMemo(() => (query.data?.withdrawal ?? []).map(toNetworkRow).sort((a, b) => a.asset.localeCompare(b.asset) || a.network.localeCompare(b.network)), [query.data]);
  return (
    <div className="adm-page">
      <PageHeader title="Fees" subtitle="VIP trading fee schedule and per-network withdrawal fees, minimums and rails." />
      {query.isPending ? (
        <>
          <Panel title="Trading fee schedule">
            <BlockSkeleton rows={5} height={28} />
          </Panel>
          <Panel title="Withdrawal fees & limits">
            <BlockSkeleton rows={6} />
          </Panel>
        </>
      ) : query.isError ? (
        <div className="adm-panel">
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        <>
          <FeeSchedulePanel schedule={query.data.schedule} />
          <NetworksPanel rows={networks} />
        </>
      )}
    </div>
  );
}
