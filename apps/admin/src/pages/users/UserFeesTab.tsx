import { MARKET_TYPES, type AdminUserDetailDto, type MarketType } from '@gocrypto/shared-types';
import { Alert, Badge, Button, type Column, DataTable, EmptyState, Select, TextInput } from '@gocrypto/ui';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';
import { AppModal } from '../../components/AppModal';
import { GuardedButton } from '../../components/GuardedButton';
import { DateTime } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { errorMessage } from '../../lib/errors';
import { useOpenEffect } from '../../lib/hooks';
import { fmtRate, fromDateInput, toDateInput, toMs } from '../../lib/format';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { humanize } from '../../lib/status';
import { useAction } from '../../lib/useAction';
import { validateRate } from '../../lib/validators';

interface FeeOverride {
  marketType: MarketType;
  makerRate: string;
  takerRate: string;
  expiresAt: number | null;
}

export function UserFeesTab({ user }: { user: AdminUserDetailDto }) {
  const client = useApi();
  const can = useCan();
  const query = useQuery({ queryKey: qk.userFees(user.id), queryFn: () => client.admin.userFees(user.id) });
  const [editing, setEditing] = useState<FeeOverride | 'new' | null>(null);
  const [removing, setRemoving] = useState<MarketType | null>(null);
  const remove = useAction<MarketType>({
    mutationFn: (mt) => client.admin.deleteUserFee(user.id, mt),
    success: (_d, mt) => `${humanize(mt)} fee override removed`,
    invalidate: [qk.userFees(user.id)],
    errorToast: false,
    onSuccess: () => setRemoving(null),
  });
  const writable = can('fees.write');

  const columns: Column<FeeOverride>[] = [
    { key: 'type', header: 'Market type', render: (f) => <Badge tone="brand">{humanize(f.marketType)}</Badge> },
    { key: 'maker', header: 'Maker', align: 'right', render: (f) => <span className="num">{fmtRate(f.makerRate)}</span> },
    { key: 'taker', header: 'Taker', align: 'right', render: (f) => <span className="num">{fmtRate(f.takerRate)}</span> },
    {
      key: 'expires',
      header: 'Expires',
      render: (f) =>
        f.expiresAt ? (
          <span>
            <DateTime value={f.expiresAt} />
            {f.expiresAt < Date.now() && (
              <>
                {' '}
                <Badge tone="warn">Expired</Badge>
              </>
            )}
          </span>
        ) : (
          <span className="faint">Never</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (f) => (
        <span className="adm-table-actions">
          <Button size="sm" icon="pen" disabled={!writable} onClick={() => setEditing(f)}>
            Edit
          </Button>
          <Button size="sm" variant="danger" disabled={!writable} onClick={() => setRemoving(f.marketType)}>
            Remove
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="adm-toolbar">
        <span className="muted" style={{ fontSize: 12 }}>
          Overrides take precedence over market and VIP-tier fees (VIP {user.vipTier}). Maker rates may be negative (rebates).
        </span>
        <span className="spacer" />
        <GuardedButton perm="fees.write" size="sm" icon="plus" onClick={() => setEditing('new')}>
          Set override
        </GuardedButton>
      </div>
      <DataTable
        columns={columns}
        rows={query.data}
        rowKey={(f) => f.marketType}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState icon="dollar" title="No fee overrides" description="This user pays the standard schedule for their VIP tier." />}
      />
      <FeeOverrideDialog userId={user.id} value={editing} existing={query.data} onClose={() => setEditing(null)} />
      <ActionDialog
        open={removing !== null}
        title="Remove fee override"
        tone="danger"
        confirmLabel="Remove override"
        description={removing ? `The user returns to the standard ${humanize(removing).toLowerCase()} fee schedule immediately.` : undefined}
        pending={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => {
          remove.reset();
          setRemoving(null);
        }}
      />
    </>
  );
}

function FeeOverrideDialog({ userId, value, existing, onClose }: { userId: string; value: FeeOverride | 'new' | null; existing: FeeOverride[] | undefined; onClose: () => void }) {
  const client = useApi();
  const formId = useId();
  const open = value !== null;
  const [marketType, setMarketType] = useState<MarketType>('SPOT');
  const [maker, setMaker] = useState('');
  const [taker, setTaker] = useState('');
  const [expires, setExpires] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [expiresError, setExpiresError] = useState<string | null>(null);

  useOpenEffect(open, () => {
    if (!value) return;
    setSubmitted(false);
    setExpiresError(null);
    if (value === 'new') {
      const free = MARKET_TYPES.find((t) => !existing?.some((e) => e.marketType === t)) ?? 'SPOT';
      setMarketType(free);
      setMaker('');
      setTaker('');
      setExpires('');
    } else {
      setMarketType(value.marketType);
      setMaker(value.makerRate);
      setTaker(value.takerRate);
      const ms = toMs(value.expiresAt);
      setExpires(ms ? toDateInput(ms) : '');
    }
  });

  const makerError = validateRate(maker, true);
  const takerError = validateRate(taker, false);
  const expiresAt = expires ? fromDateInput(expires, 'end') : null;

  const action = useAction<{ marketType: MarketType; makerRate: string; takerRate: string; expiresAt: number | null }>({
    mutationFn: (body) => client.admin.setUserFee(userId, body),
    success: (_d, v) => `${humanize(v.marketType)} fee override saved`,
    invalidate: [qk.userFees(userId)],
    errorToast: false,
    onSuccess: onClose,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const expiryError = expires && (!expiresAt || expiresAt <= Date.now()) ? 'Pick a future date' : null;
    setExpiresError(expiryError);
    if (makerError || takerError || expiryError) return;
    action.mutate({ marketType, makerRate: maker.trim(), takerRate: taker.trim(), expiresAt });
  };

  const replacing = value === 'new' && Boolean(existing?.some((e) => e.marketType === marketType));

  return (
    <AppModal
      open={open}
      title={value === 'new' ? 'Set fee override' : 'Edit fee override'}
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
          <Button type="submit" form={formId} variant="primary" loading={action.isPending}>
            Save override
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form-grid" onSubmit={submit} noValidate>
        <div className="adm-span-all">
          <Select
            label="Market type"
            value={marketType}
            disabled={value !== 'new'}
            options={MARKET_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            onChange={(e) => setMarketType(e.target.value as MarketType)}
          />
        </div>
        <TextInput
          label="Maker rate"
          inputMode="decimal"
          placeholder="0.0002"
          value={maker}
          error={submitted ? makerError : null}
          hint={!makerError ? `= ${fmtRate(maker.trim())}` : 'Negative = rebate'}
          onChange={(e) => setMaker(e.target.value)}
        />
        <TextInput
          label="Taker rate"
          inputMode="decimal"
          placeholder="0.0005"
          value={taker}
          error={submitted ? takerError : null}
          hint={!takerError ? `= ${fmtRate(taker.trim())}` : 'Below 0.1 (10%)'}
          onChange={(e) => setTaker(e.target.value)}
        />
        <div className="adm-span-all">
          <TextInput label="Expires (optional)" type="date" value={expires} error={submitted ? expiresError : null} hint="Leave empty for a permanent override" onChange={(e) => setExpires(e.target.value)} />
        </div>
        {replacing && (
          <div className="adm-span-all">
            <Alert tone="info">An override for {humanize(marketType).toLowerCase()} already exists and will be replaced.</Alert>
          </div>
        )}
        {action.error ? (
          <div className="adm-span-all">
            <Alert tone="error">{errorMessage(action.error)}</Alert>
          </div>
        ) : null}
      </form>
    </AppModal>
  );
}
