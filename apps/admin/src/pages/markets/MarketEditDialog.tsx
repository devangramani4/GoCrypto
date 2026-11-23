import type { MarketDto, MarketStatus } from '@gocrypto/shared-types';
import { Alert, Button, TextInput } from '@gocrypto/ui';
import { adminUpdateMarketSchema } from '@gocrypto/validation';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { AppModal } from '../../components/AppModal';
import { useApi } from '../../lib/ApiContext';
import { errorMessage, serverFieldErrors } from '../../lib/errors';
import { useOpenEffect } from '../../lib/hooks';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { useAction } from '../../lib/useAction';
import { type FilterForm, FilterFields, StatusSelect, crossFieldErrors, zodErrors } from './marketForm';

interface EditForm extends FilterForm {
  status: MarketStatus;
  maxLeverage: string;
  defaultLeverage: string;
}

/** The API reports "no override" as "0" (it cannot distinguish an explicit 0% override). */
function overrideValue(rate: string): string {
  return rate === '0' ? '' : rate;
}

function initialForm(m: MarketDto): EditForm {
  return {
    status: m.status,
    tickSize: m.tickSize,
    stepSize: m.stepSize,
    minQty: m.minQty,
    maxQty: m.maxQty,
    minNotional: m.minNotional,
    priceBand: m.priceBand,
    makerFeeRate: overrideValue(m.makerFeeRate),
    takerFeeRate: overrideValue(m.takerFeeRate),
    maxLeverage: m.futures ? String(m.futures.maxLeverage) : '',
    defaultLeverage: m.futures ? String(m.futures.defaultLeverage) : '',
  };
}

/** Only changed fields are sent (PATCH semantics); blank fee overrides clear the override. */
export function buildMarketPatch(m: MarketDto, f: EditForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (f.status !== m.status) patch.status = f.status;
  for (const k of ['tickSize', 'stepSize', 'minQty', 'maxQty', 'minNotional', 'priceBand'] as const) {
    if (f[k].trim() !== m[k]) patch[k] = f[k].trim();
  }
  for (const k of ['makerFeeRate', 'takerFeeRate'] as const) {
    const next = f[k].trim();
    if (next !== overrideValue(m[k])) patch[k] = next === '' ? null : next;
  }
  if (m.futures) {
    if (f.maxLeverage.trim() !== String(m.futures.maxLeverage)) patch.maxLeverage = f.maxLeverage.trim() === '' ? Number.NaN : Number(f.maxLeverage);
    if (f.defaultLeverage.trim() !== String(m.futures.defaultLeverage)) patch.defaultLeverage = f.defaultLeverage.trim() === '' ? Number.NaN : Number(f.defaultLeverage);
  }
  return patch;
}

export function MarketEditDialog({ market, onClose }: { market: MarketDto | null; onClose: () => void }) {
  const client = useApi();
  const qc = useQueryClient();
  const can = useCan();
  const formId = useId();
  const [form, setForm] = useState<EditForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useOpenEffect(market !== null, () => {
    if (!market) return;
    setForm(initialForm(market));
    setErrors({});
  });

  const action = useAction<{ id: number; patch: Record<string, unknown> }, MarketDto>({
    mutationFn: ({ id, patch }) => client.admin.updateMarket(id, patch),
    success: (m) => `${m.symbol} updated`,
    invalidate: [qk.markets],
    errorToast: false,
    onSuccess: (m) => {
      qc.setQueryData<MarketDto[]>(qk.markets, (list) => list?.map((x) => (x.id === m.id ? m : x)));
      onClose();
    },
  });

  if (!market || !form) return null;
  const canRisk = can('risk.write');
  const patch = buildMarketPatch(market, form);
  const dirty = Object.keys(patch).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = adminUpdateMarketSchema.safeParse(patch);
    const errs: Record<string, string> = { ...(parsed.success ? {} : zodErrors(parsed.error)), ...crossFieldErrors(form) };
    if (market.futures) {
      const max = Number(form.maxLeverage);
      const def = Number(form.defaultLeverage);
      if (Number.isFinite(max) && Number.isFinite(def) && def > max) errs.defaultLeverage = 'Cannot exceed max leverage';
    }
    setErrors(errs);
    if (Object.keys(errs).length || !dirty) return;
    action.mutate({ id: market.id, patch });
  };

  const serverErrors = serverFieldErrors(action.error);
  const shown = { ...serverErrors, ...errors };
  const set = (p: Partial<EditForm>) => setForm((f) => (f ? { ...f, ...p } : f));

  return (
    <AppModal
      open
      wide
      title={`Edit ${market.symbol}`}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      footer={
        <>
          <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
            {dirty ? `${Object.keys(patch).length} field(s) changed` : 'No changes'}
          </span>
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={action.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form-grid adm-form-grid--3" onSubmit={submit} noValidate>
        <StatusSelect value={form.status} error={shown.status} onChange={(status) => set({ status })} />
        {form.status !== market.status && (form.status === 'HALTED' || form.status === 'DELISTED') && (
          <div className="adm-span-all">
            <Alert tone="warn">
              {form.status === 'HALTED' ? 'Halting stops matching for this market immediately. Open orders stay on the book.' : 'Delisting removes the market from trading.'}
            </Alert>
          </div>
        )}
        <FilterFields form={form} errors={shown} onChange={set} />
        {market.futures && (
          <>
            <div className="adm-form-section">Leverage {canRisk ? '' : '· requires risk.write'}</div>
            <TextInput
              label="Max leverage"
              inputMode="numeric"
              value={form.maxLeverage}
              disabled={!canRisk}
              error={shown.maxLeverage}
              suffix="x"
              onChange={(e) => set({ maxLeverage: e.target.value.replace(/\D/g, '') })}
            />
            <TextInput
              label="Default leverage"
              inputMode="numeric"
              value={form.defaultLeverage}
              disabled={!canRisk}
              error={shown.defaultLeverage}
              suffix="x"
              onChange={(e) => set({ defaultLeverage: e.target.value.replace(/\D/g, '') })}
            />
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
