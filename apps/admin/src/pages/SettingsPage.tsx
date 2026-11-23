import { Alert, Badge, Button, type Column, DataTable, ErrorState, Switch } from '@gocrypto/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { ActionDialog } from '../components/ActionDialog';
import { AppModal } from '../components/AppModal';
import { BlockSkeleton, safeStringify } from '../components/feedback';
import { PageHeader, Panel } from '../components/PageHeader';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { useOpenEffect } from '../lib/hooks';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { humanize } from '../lib/status';
import { useAction } from '../lib/useAction';

/** Operator-facing descriptions of the runtime settings exposed by the API. */
export const SETTING_DESCRIPTIONS: Record<string, string> = {
  'withdrawal.daily_limit_usd': 'Daily withdrawal limit in USD per KYC level (keys "0"–"3").',
  'withdrawal.review_threshold_usd': 'Withdrawals at or above this USD value always go to manual review.',
  'withdrawal.new_address_review': 'Weight first-time destination addresses heavier in the withdrawal risk score.',
  'withdrawal.security_lock_hours': 'Hours withdrawals stay locked after a password, 2FA or PIN change.',
  'withdrawal.require_email_code': 'Require an emailed confirmation code for every withdrawal.',
  'risk.max_open_orders': 'Maximum open orders per user.',
  'risk.max_order_notional_usd': 'Maximum notional of a single order, in USD.',
  'risk.daily_order_notional_usd': 'Maximum total order notional per user per day, in USD.',
  'risk.liquidation_warning_ratio': 'Margin ratio (0–1) at which users get a liquidation warning.',
  'security.max_login_attempts': 'Failed sign-ins before the account is temporarily locked.',
  'security.login_lock_minutes': 'Minutes an account stays locked after too many failed sign-ins.',
  'security.pin_max_attempts': 'Failed trading-PIN entries before the PIN is locked.',
  'security.pin_lock_minutes': 'Minutes the trading PIN stays locked.',
  'sandbox.max_simulated_deposit_usd': 'Largest simulated deposit a user may create in sandbox mode (USD).',
  'maintenance.trading_halted': 'Halt order placement for every customer account (system accounts keep trading).',
};

/** Settings whose change has an immediate platform-wide blast radius. */
const CRITICAL = new Set(['maintenance.trading_halted', 'withdrawal.require_email_code']);

type Kind = 'boolean' | 'integer' | 'number' | 'decimal' | 'string' | 'decimal-map' | 'object' | 'array' | 'null';

const DECIMAL = /^\d+(\.\d+)?$/;

export function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'string') return DECIMAL.test(v) ? 'decimal' : 'string';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') {
    const values = Object.values(v as Record<string, unknown>);
    return values.length > 0 && values.every((x) => typeof x === 'string' && DECIMAL.test(x)) ? 'decimal-map' : 'object';
  }
  return 'string';
}

const KIND_LABEL: Record<Kind, string> = {
  boolean: 'true / false',
  integer: 'whole number',
  number: 'number',
  decimal: 'decimal string, e.g. "10000"',
  string: 'string',
  'decimal-map': 'object of decimal strings',
  object: 'object',
  array: 'array',
  null: 'null',
};

/** Parse JSON and enforce that the value keeps the shape the server code expects. */
export function validateSettingInput(original: unknown, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  const expected = kindOf(original);
  if (expected === 'null') return { ok: true, value };
  if (expected === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return { ok: false, error: `Expected a ${KIND_LABEL.integer} (≥ 0)` };
    return { ok: true, value };
  }
  if (expected === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'Expected a number' };
    return { ok: true, value };
  }
  if (expected === 'decimal') {
    if (typeof value !== 'string' || !DECIMAL.test(value)) return { ok: false, error: `Expected a ${KIND_LABEL.decimal} (quoted, no exponent)` };
    return { ok: true, value };
  }
  if (expected === 'decimal-map') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: `Expected an ${KIND_LABEL['decimal-map']}` };
    const bad = Object.entries(value as Record<string, unknown>).find(([, v]) => typeof v !== 'string' || !DECIMAL.test(v));
    if (bad) return { ok: false, error: `"${bad[0]}" must be a decimal string, e.g. "50000"` };
    const missing = Object.keys(original as Record<string, unknown>).filter((k) => !(k in (value as Record<string, unknown>)));
    if (missing.length) return { ok: false, error: `Missing key(s): ${missing.join(', ')}` };
    return { ok: true, value };
  }
  const actual = kindOf(value);
  const compatible = expected === actual || (expected === 'object' && (actual === 'decimal-map' || actual === 'object')) || (expected === 'string' && actual === 'decimal');
  return compatible ? { ok: true, value } : { ok: false, error: `Expected a ${KIND_LABEL[expected]}` };
}

function ValuePreview({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return value ? <Badge tone="up">On</Badge> : <Badge>Off</Badge>;
  if (typeof value === 'string') return <span className="adm-mono">"{value}"</span>;
  if (typeof value === 'number') return <span className="num adm-mono">{value}</span>;
  return <span className="adm-json-inline" style={{ maxWidth: 420 }}>{safeStringify(value)}</span>;
}

interface SettingRow {
  key: string;
  value: unknown;
}

function SettingEditor({ row, onClose }: { row: SettingRow | null; onClose: () => void }) {
  const client = useApi();
  const qc = useQueryClient();
  const formId = useId();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useOpenEffect(row !== null, () => {
    setText(safeStringify(row?.value, 2));
    setSubmitted(false);
  });

  const action = useAction<{ key: string; value: unknown }, Record<string, unknown>>({
    mutationFn: ({ key, value }) => client.admin.setSetting(key, value),
    success: (_d, v) => `${v.key} updated`,
    errorToast: false,
    onSuccess: (all) => {
      qc.setQueryData(qk.settings, all);
      onClose();
    },
  });

  if (!row) return null;
  const result = validateSettingInput(row.value, text);
  const unchanged = result.ok && safeStringify(result.value) === safeStringify(row.value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!result.ok || unchanged) return;
    action.mutate({ key: row.key, value: result.value });
  };

  return (
    <AppModal
      open
      wide
      title={row.key}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      footer={
        <>
          <Button
            variant="ghost"
            style={{ marginRight: 'auto' }}
            disabled={!result.ok}
            onClick={() => result.ok && setText(safeStringify(result.value, 2))}
          >
            Format JSON
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={action.isPending} disabled={unchanged}>
            Save setting
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <div className="muted">{SETTING_DESCRIPTIONS[row.key] ?? 'Runtime setting.'}</div>
        <div className="gc-field">
          <label className="gc-field__label" htmlFor={`${formId}-value`}>
            <span>Value (JSON)</span>
            <span className="faint">Expected: {KIND_LABEL[kindOf(row.value)]}</span>
          </label>
          <textarea
            id={`${formId}-value`}
            className="adm-textarea"
            spellCheck={false}
            value={text}
            rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
            aria-invalid={!result.ok ? true : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          {!result.ok ? (
            <span className="gc-field__error" role="alert">
              {result.error}
            </span>
          ) : (
            <span className="gc-field__hint">{unchanged ? 'No changes' : 'Valid — applied to every service immediately after saving.'}</span>
          )}
        </div>
        {submitted && CRITICAL.has(row.key) && result.ok && !unchanged && <Alert tone="warn">This setting affects every customer immediately.</Alert>}
        {action.error ? <Alert tone="error">{errorMessage(action.error)}</Alert> : null}
      </form>
    </AppModal>
  );
}

export function SettingsPage() {
  const client = useApi();
  const qc = useQueryClient();
  const can = useCan();
  const editable = can('settings.write');
  const query = useQuery({ queryKey: qk.settings, queryFn: () => client.admin.settings() });
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [toggling, setToggling] = useState<{ key: string; value: boolean } | null>(null);

  const toggle = useAction<{ key: string; value: boolean }, Record<string, unknown>>({
    mutationFn: ({ key, value }) => client.admin.setSetting(key, value),
    success: (_d, v) => `${v.key} ${v.value ? 'enabled' : 'disabled'}`,
    errorToast: false,
    onSuccess: (all) => {
      qc.setQueryData(qk.settings, all);
      setToggling(null);
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, SettingRow[]>();
    for (const [key, value] of Object.entries(query.data ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const group = key.split('.')[0] ?? 'other';
      map.set(group, [...(map.get(group) ?? []), { key, value }]);
    }
    return [...map.entries()];
  }, [query.data]);

  const columns: Column<SettingRow>[] = [
    {
      key: 'key',
      header: 'Setting',
      width: '46%',
      render: (r) => (
        <div className="adm-wrap">
          <span className="adm-mono" style={{ fontWeight: 500 }}>
            {r.key}
          </span>
          <span className="adm-cell-sub">{SETTING_DESCRIPTIONS[r.key] ?? ''}</span>
        </div>
      ),
    },
    { key: 'type', header: 'Type', width: '12%', render: (r) => <span className="faint" style={{ fontSize: 11.5 }}>{kindOf(r.value).replace('-', ' ')}</span> },
    { key: 'value', header: 'Current value', width: '28%', render: (r) => <ValuePreview value={r.value} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '14%',
      render: (r) => (
        <span className="adm-table-actions" style={{ alignItems: 'center' }}>
          {typeof r.value === 'boolean' && (
            <Switch label={`Toggle ${r.key}`} checked={r.value} disabled={!editable} onChange={(v) => setToggling({ key: r.key, value: v })} />
          )}
          <Button size="sm" icon="pen" disabled={!editable} onClick={() => setEditing(r)}>
            Edit
          </Button>
        </span>
      ),
    },
  ];

  const halted = query.data?.['maintenance.trading_halted'] === true;

  return (
    <div className="adm-page">
      <PageHeader
        title="Settings"
        subtitle="Runtime configuration read by every service. Values are JSON; changes are audited and take effect without a restart."
        actions={!editable ? <Badge tone="warn">Read-only · requires settings.write</Badge> : undefined}
      />
      {halted && <Alert tone="error">Trading is currently halted platform-wide (maintenance.trading_halted = true).</Alert>}
      {query.isPending ? (
        <Panel>
          <BlockSkeleton rows={8} height={22} />
        </Panel>
      ) : query.isError ? (
        <div className="adm-panel">
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      ) : (
        groups.map(([group, rows]) => (
          <Panel key={group} title={humanize(group)}>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
          </Panel>
        ))
      )}
      <SettingEditor row={editing} onClose={() => setEditing(null)} />
      <ActionDialog
        open={toggling !== null}
        title={toggling ? `${toggling.value ? 'Enable' : 'Disable'} ${toggling.key}` : ''}
        tone={toggling && CRITICAL.has(toggling.key) ? 'danger' : 'primary'}
        confirmLabel={toggling?.value ? 'Enable' : 'Disable'}
        description={toggling && (SETTING_DESCRIPTIONS[toggling.key] ?? 'Runtime setting.')}
        pending={toggle.isPending}
        error={toggle.error ? errorMessage(toggle.error) : null}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onClose={() => {
          toggle.reset();
          setToggling(null);
        }}
      />
    </div>
  );
}
