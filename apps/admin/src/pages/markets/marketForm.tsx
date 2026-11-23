import { MARKET_STATUSES, type MarketStatus } from '@gocrypto/shared-types';
import { Select, TextInput } from '@gocrypto/ui';
import { fieldErrors, type z } from '@gocrypto/validation';
import { dec, fmtRate } from '../../lib/format';
import { humanize } from '../../lib/status';

/** String-typed form state for market filters (inputs keep exactly what the admin typed). */
export interface FilterForm {
  tickSize: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  priceBand: string;
  makerFeeRate: string;
  takerFeeRate: string;
}

export const STATUS_OPTIONS = MARKET_STATUSES.map((s) => ({ value: s, label: humanize(s) }));

export function statusHint(status: MarketStatus): string {
  switch (status) {
    case 'TRADING':
      return 'Open for trading';
    case 'PRE_TRADING':
      return 'Visible, order entry disabled until launch';
    case 'HALTED':
      return 'Trading paused — open orders remain on the book';
    case 'DELISTED':
      return 'Removed from trading';
    case 'SETTLED':
      return 'Contract settled';
  }
}

export function zodErrors(error: z.ZodError): Record<string, string> {
  return fieldErrors(error);
}

/** Client-side cross-field checks the schemas cannot express. */
export function crossFieldErrors(f: Pick<FilterForm, 'minQty' | 'maxQty'>): Record<string, string> {
  const min = dec(f.minQty);
  const max = dec(f.maxQty);
  return min && max && min.gt(max) ? { maxQty: 'Must be at least the minimum quantity' } : {};
}

export function FilterFields({
  form,
  errors,
  onChange,
  showOverrides = true,
}: {
  form: FilterForm;
  errors: Record<string, string>;
  onChange: (patch: Partial<FilterForm>) => void;
  showOverrides?: boolean;
}) {
  const rateHint = (v: string) => (v.trim() ? (dec(v) ? `= ${fmtRate(v.trim())}` : undefined) : 'Blank = VIP fee schedule');
  return (
    <>
      <div className="adm-form-section">Price & quantity filters</div>
      <TextInput label="Tick size" inputMode="decimal" value={form.tickSize} error={errors.tickSize} onChange={(e) => onChange({ tickSize: e.target.value })} />
      <TextInput label="Step size" inputMode="decimal" value={form.stepSize} error={errors.stepSize} onChange={(e) => onChange({ stepSize: e.target.value })} />
      <TextInput label="Min quantity" inputMode="decimal" value={form.minQty} error={errors.minQty} onChange={(e) => onChange({ minQty: e.target.value })} />
      <TextInput label="Max quantity" inputMode="decimal" value={form.maxQty} error={errors.maxQty} onChange={(e) => onChange({ maxQty: e.target.value })} />
      <TextInput label="Min notional" inputMode="decimal" value={form.minNotional} error={errors.minNotional} onChange={(e) => onChange({ minNotional: e.target.value })} />
      <TextInput
        label="Price band"
        inputMode="decimal"
        value={form.priceBand}
        error={errors.priceBand}
        hint={dec(form.priceBand) ? `±${fmtRate(form.priceBand)} from reference price` : 'Max deviation, e.g. 0.05'}
        onChange={(e) => onChange({ priceBand: e.target.value })}
      />
      {showOverrides && (
        <>
          <div className="adm-form-section">Fee overrides</div>
          <TextInput
            label="Maker fee override"
            inputMode="decimal"
            placeholder="Schedule"
            value={form.makerFeeRate}
            error={errors.makerFeeRate}
            hint={rateHint(form.makerFeeRate)}
            onChange={(e) => onChange({ makerFeeRate: e.target.value })}
          />
          <TextInput
            label="Taker fee override"
            inputMode="decimal"
            placeholder="Schedule"
            value={form.takerFeeRate}
            error={errors.takerFeeRate}
            hint={rateHint(form.takerFeeRate)}
            onChange={(e) => onChange({ takerFeeRate: e.target.value })}
          />
        </>
      )}
    </>
  );
}

export function StatusSelect({ value, onChange, error }: { value: MarketStatus; onChange: (s: MarketStatus) => void; error?: string }) {
  return (
    <div>
      <Select label="Status" value={value} options={STATUS_OPTIONS} error={error} onChange={(e) => onChange(e.target.value as MarketStatus)} />
      <span className="gc-field__hint" style={{ display: 'block', marginTop: 6 }}>
        {statusHint(value)}
      </span>
    </div>
  );
}

/** Trim and drop empty strings so optional fields are omitted from the payload. */
export function trimmed(v: string): string | undefined {
  const t = v.trim();
  return t ? t : undefined;
}
