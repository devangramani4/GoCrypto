import { TextInput, cx } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { sanitizeDecimal } from '../../lib/format';

/** Exchange-style numeric input: label on the left, unit on the right, decimal-only. */
export function DecimalInput({
  label,
  unit,
  value,
  onChange,
  decimals,
  error,
  disabled,
  placeholder,
  name,
}: {
  label: ReactNode;
  unit?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  decimals: number;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
}) {
  return (
    <div className="dec-input">
      <TextInput
        variant="trade"
        prefix={label}
        suffix={unit}
        value={value}
        name={name}
        aria-label={typeof label === 'string' ? label : name}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(sanitizeDecimal(e.target.value, decimals))}
        className={error ? 'gc-input--invalid' : undefined}
      />
      {error && <div className="gc-field__error">{error}</div>}
    </div>
  );
}

/** 0-100% allocation slider with quick marks. */
export function PercentSlider({
  value,
  onChange,
  disabled,
  tone,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  tone?: 'up' | 'down';
}) {
  return (
    <div className={cx('pct', tone && `pct--${tone}`)}>
      <input
        type="range"
        className="gc-slider"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        aria-label="Percentage of available balance"
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, var(--pct-fill) ${value}%, var(--c-border-strong) ${value}%)` }}
      />
      <div className="pct__marks">
        {[0, 25, 50, 75, 100].map((m) => (
          <button
            key={m}
            type="button"
            className={cx('pct__mark', value >= m && 'on')}
            onClick={() => onChange(m)}
            disabled={disabled}
          >
            {m}%
          </button>
        ))}
      </div>
    </div>
  );
}

export function InfoRow({ label, children, tip }: { label: ReactNode; children: ReactNode; tip?: string }) {
  return (
    <div className="info-row">
      <span className="faint" data-tip={tip}>
        {label}
      </span>
      <span className="num">{children}</span>
    </div>
  );
}

/** Shown in place of the submit button for anonymous visitors. */
export function AuthCta() {
  const loc = useLocation();
  const next = encodeURIComponent(loc.pathname + loc.search);
  return (
    <div className="auth-cta">
      <Link className="gc-btn gc-btn--primary gc-btn--block" to={`/login?next=${next}`}>
        Log in
      </Link>
      <Link className="gc-btn gc-btn--block" to={`/register?next=${next}`}>
        Create account
      </Link>
    </div>
  );
}
