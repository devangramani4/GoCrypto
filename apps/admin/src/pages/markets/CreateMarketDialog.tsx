import type { MarketDto, MarketStatus } from '@gocrypto/shared-types';
import { perpSymbol } from '@gocrypto/trading-utils';
import { Alert, Button, Select, TextInput } from '@gocrypto/ui';
import { adminCreateFuturesMarketSchema, adminCreateSpotMarketSchema } from '@gocrypto/validation';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { AppModal } from '../../components/AppModal';
import { useApi } from '../../lib/ApiContext';
import { errorMessage, serverFieldErrors } from '../../lib/errors';
import { useOpenEffect } from '../../lib/hooks';
import { qk } from '../../lib/queryKeys';
import { useAction } from '../../lib/useAction';
import { type FilterForm, FilterFields, StatusSelect, crossFieldErrors, trimmed, zodErrors } from './marketForm';

export type CreateKind = 'SPOT' | 'FUTURES';

interface CreateForm extends FilterForm {
  base: string;
  quote: string;
  status: MarketStatus;
  maxLeverage: string;
  defaultLeverage: string;
  fundingIntervalHours: string;
}

const EMPTY: CreateForm = {
  base: '',
  quote: 'USDT',
  status: 'PRE_TRADING',
  tickSize: '0.01',
  stepSize: '0.001',
  minQty: '0.001',
  maxQty: '100000',
  minNotional: '5',
  priceBand: '0.05',
  makerFeeRate: '',
  takerFeeRate: '',
  maxLeverage: '50',
  defaultLeverage: '10',
  fundingIntervalHours: '8',
};

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function buildCreatePayload(kind: CreateKind, f: CreateForm): Record<string, unknown> {
  const filters = {
    tickSize: f.tickSize.trim(),
    stepSize: f.stepSize.trim(),
    minQty: f.minQty.trim(),
    maxQty: f.maxQty.trim(),
    minNotional: f.minNotional.trim(),
    status: f.status,
  };
  if (kind === 'SPOT') {
    return {
      base: f.base,
      quote: f.quote,
      ...filters,
      priceBand: trimmed(f.priceBand),
      makerFeeRate: trimmed(f.makerFeeRate),
      takerFeeRate: trimmed(f.takerFeeRate),
    };
  }
  return {
    underlying: f.base,
    settleAsset: f.quote,
    ...filters,
    maxLeverage: num(f.maxLeverage),
    defaultLeverage: num(f.defaultLeverage),
    fundingIntervalHours: num(f.fundingIntervalHours),
  };
}

export function CreateMarketDialog({ kind, onClose }: { kind: CreateKind | null; onClose: () => void }) {
  const client = useApi();
  const formId = useId();
  const assets = useQuery({ queryKey: qk.assets, queryFn: () => client.assets.list(), enabled: kind !== null, staleTime: 5 * 60_000 });
  const [form, setForm] = useState<CreateForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useOpenEffect(kind !== null, () => {
    setForm({ ...EMPTY, quote: 'USDT', stepSize: kind === 'FUTURES' ? '0.001' : '0.0001' });
    setErrors({});
  });

  const action = useAction<{ kind: CreateKind; body: Record<string, unknown> }, MarketDto>({
    mutationFn: ({ kind: k, body }) => (k === 'SPOT' ? client.admin.createSpotMarket(body) : client.admin.createFuturesMarket(body)),
    success: (m) => `${m.symbol} created`,
    invalidate: [qk.markets],
    errorToast: false,
    onSuccess: onClose,
  });

  if (!kind) return null;
  const set = (p: Partial<CreateForm>) => setForm((f) => ({ ...f, ...p }));
  const assetOptions = [{ value: '', label: 'Select asset…' }, ...(assets.data ?? []).map((a) => ({ value: a.symbol, label: `${a.symbol} — ${a.name}` }))];
  const symbol = form.base && form.quote ? (kind === 'SPOT' ? `${form.base}${form.quote}` : perpSymbol(form.base, form.quote)) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = buildCreatePayload(kind, form);
    const parsed = kind === 'SPOT' ? adminCreateSpotMarketSchema.safeParse(body) : adminCreateFuturesMarketSchema.safeParse(body);
    const errs: Record<string, string> = parsed.success ? {} : zodErrors(parsed.error);
    // Align schema field names with the form fields.
    if (errs.underlying) errs.base = errs.underlying;
    if (errs.settleAsset) errs.quote = errs.settleAsset;
    if (!form.base) errs.base = kind === 'SPOT' ? 'Choose the base asset' : 'Choose the underlying asset';
    if (form.base && form.base === form.quote) errs.quote = 'Must differ from the base asset';
    Object.assign(errs, crossFieldErrors(form));
    if (kind === 'FUTURES' && Number(form.defaultLeverage) > Number(form.maxLeverage)) errs.defaultLeverage = 'Cannot exceed max leverage';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    action.mutate({ kind, body });
  };

  const shown = { ...serverFieldErrors(action.error), ...errors };

  return (
    <AppModal
      open
      wide
      title={kind === 'SPOT' ? 'New spot market' : 'New perpetual futures market'}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      footer={
        <>
          {symbol && (
            <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
              Symbol <strong className="adm-mono" style={{ color: 'var(--c-text)' }}>{symbol}</strong>
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={action.isPending}>
            Create market
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form-grid adm-form-grid--3" onSubmit={submit} noValidate>
        <Select label={kind === 'SPOT' ? 'Base asset' : 'Underlying'} value={form.base} options={assetOptions} error={shown.base} onChange={(e) => set({ base: e.target.value })} />
        <Select
          label={kind === 'SPOT' ? 'Quote asset' : 'Settlement asset'}
          value={form.quote}
          options={assetOptions.filter((o) => o.value)}
          error={shown.quote}
          onChange={(e) => set({ quote: e.target.value })}
        />
        <StatusSelect value={form.status} error={shown.status} onChange={(status) => set({ status })} />
        <FilterFields form={form} errors={shown} onChange={set} showOverrides={kind === 'SPOT'} />
        {kind === 'FUTURES' && (
          <>
            <div className="adm-form-section">Contract</div>
            <TextInput label="Max leverage" inputMode="numeric" suffix="x" value={form.maxLeverage} error={shown.maxLeverage} onChange={(e) => set({ maxLeverage: e.target.value.replace(/\D/g, '') })} />
            <TextInput label="Default leverage" inputMode="numeric" suffix="x" value={form.defaultLeverage} error={shown.defaultLeverage} onChange={(e) => set({ defaultLeverage: e.target.value.replace(/\D/g, '') })} />
            <TextInput
              label="Funding interval"
              inputMode="numeric"
              suffix="h"
              value={form.fundingIntervalHours}
              error={shown.fundingIntervalHours}
              onChange={(e) => set({ fundingIntervalHours: e.target.value.replace(/\D/g, '') })}
            />
            <div className="adm-span-all">
              <Alert tone="info">
                The market starts with a single risk tier at the max leverage. Configure the full bracket table from Risk tiers after creation; price band and fee
                overrides can be set with Edit.
              </Alert>
            </div>
          </>
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
