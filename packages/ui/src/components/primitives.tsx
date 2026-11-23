import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  useId,
} from 'react';
import { Icon, type IconName } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'buy' | 'sell' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'gc-btn',
        variant !== 'default' && `gc-btn--${variant}`,
        size !== 'md' && `gc-btn--${size}`,
        block && 'gc-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="gc-spinner" style={{ width: 14, height: 14 }} />
      ) : icon ? (
        <Icon name={icon} size={15} />
      ) : null}
      {children}
    </button>
  );
});

export function IconButton({
  icon,
  label,
  size = 16,
  className,
  ...rest
}: { icon: IconName; label: string; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx('gc-icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export interface FieldProps {
  label?: ReactNode;
  labelRight?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, labelRight, error, hint, children, htmlFor }: FieldProps) {
  return (
    <div className="gc-field">
      {(label || labelRight) && (
        // labelRight (e.g. a "Forgot password?" link) stays outside <label> so it is not part of the input's accessible name.
        <div className="gc-field__label">
          <label htmlFor={htmlFor}>{label}</label>
          {labelRight}
        </div>
      )}
      {children}
      {error ? (
        <span className="gc-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="gc-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: ReactNode;
  labelRight?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  suffix?: ReactNode;
  prefix?: ReactNode;
  variant?: 'default' | 'trade';
  size?: 'sm' | 'md';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, labelRight, error, hint, suffix, prefix, variant = 'default', size = 'md', id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const box = (
    <div
      className={cx(
        'gc-input',
        variant === 'trade' && 'gc-input--trade',
        size === 'sm' && 'gc-input--sm',
        error && 'gc-input--invalid',
        className,
      )}
    >
      {prefix && <span className="gc-input__prefix">{prefix}</span>}
      <input ref={ref} id={inputId} aria-invalid={Boolean(error) || undefined} {...rest} />
      {suffix && <span className="gc-input__addon">{suffix}</span>}
    </div>
  );
  if (!label && !error && !hint && !labelRight) return box;
  return (
    <Field label={label} labelRight={labelRight} error={error} hint={hint} htmlFor={inputId}>
      {box}
    </Field>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: ReactNode;
  error?: string | null;
  options: { value: string; label: string }[];
  size?: 'sm' | 'md';
}

export function Select({ label, error, options, size = 'md', id, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const box = (
    <div className={cx('gc-input', size === 'sm' && 'gc-input--sm', error && 'gc-input--invalid')}>
      <select id={selectId} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="gc-input__addon">
        <Icon name="chevronDown" size={14} />
      </span>
    </div>
  );
  return label || error ? (
    <Field label={label} error={error} htmlFor={selectId}>
      {box}
    </Field>
  ) : (
    box
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="gc-checkbox">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="gc-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  variant,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  variant?: 'buy-sell';
  className?: string;
}) {
  return (
    <div className={cx('gc-seg', variant === 'buy-sell' && 'gc-seg--buy-sell', className)} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-side={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  variant,
  right,
  style,
}: {
  value: T;
  tabs: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  variant?: 'pills';
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={cx('gc-tabs', variant === 'pills' && 'gc-tabs--pills')} role="tablist" style={style}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="gc-tabs__count">{t.count}</span>}
        </button>
      ))}
      {right && (
        <>
          <span className="spacer" />
          {right}
        </>
      )}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: 'up' | 'down' | 'warn' | 'brand'; children: ReactNode }) {
  return <span className={cx('gc-badge', tone && `gc-badge--${tone}`)}>{children}</span>;
}

export function Card({
  title,
  actions,
  children,
  className,
  bodyStyle,
  noPadding,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyStyle?: CSSProperties;
  noPadding?: boolean;
}) {
  return (
    <section className={cx('gc-card', className)}>
      {(title || actions) && (
        <header className="gc-card__head">
          {typeof title === 'string' ? <h3 className="gc-card__title">{title}</h3> : title}
          <span className="spacer" />
          {actions}
        </header>
      )}
      <div className={noPadding ? undefined : 'gc-card__body'} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  subTone,
  icon,
  loading,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: 'up' | 'down';
  icon?: IconName;
  loading?: boolean;
}) {
  return (
    <div>
      <div className="gc-stat__label">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </div>
      {loading ? <Skeleton width={120} height={26} /> : <div className="gc-stat__value">{value}</div>}
      {sub !== undefined && !loading && <div className={cx('gc-stat__sub', subTone)}>{sub}</div>}
    </div>
  );
}

export function Skeleton({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
}) {
  return <span className="gc-skeleton" style={{ width, height, ...style }} />;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="gc-spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon = 'inbox',
  action,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="gc-state">
      <span className="gc-state__icon">
        <Icon name={icon} size={20} />
      </span>
      <strong style={{ color: 'var(--c-text-muted)', fontWeight: 500 }}>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="gc-state gc-state--error" role="alert">
      <span className="gc-state__icon">
        <Icon name="alert" size={20} />
      </span>
      <strong style={{ color: 'var(--c-text)', fontWeight: 500 }}>{title}</strong>
      {description && <span>{description}</span>}
      {onRetry && (
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Alert({
  tone = 'warn',
  children,
  icon,
}: {
  tone?: 'warn' | 'info' | 'error';
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div
      className={cx('gc-alert', tone !== 'warn' && `gc-alert--${tone}`)}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'alert')} size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl style={{ margin: 0 }}>
      {items.map(([k, v], i) => (
        <div className="gc-kv" key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'up' | 'down' | 'warn' }) {
  const color = tone ? `var(--c-${tone})` : undefined;
  return (
    <div
      className="gc-progress"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: color }} />
    </div>
  );
}
