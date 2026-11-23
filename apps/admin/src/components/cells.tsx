import type { UserRole } from '@gocrypto/shared-types';
import { shortAddress } from '@gocrypto/trading-utils';
import { Badge, IconButton, cx, useToast } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DASH, fmtAmount, fmtDateTime, fmtRelative, fmtSigned, fmtUsd, fmtUtc, signOf } from '../lib/format';
import { useCan } from '../lib/permissions';
import { ROLE_TONE, type Tone, humanize, toneOf } from '../lib/status';

export function StatusBadge({ value, tones, label, dot = true }: { value: string; tones?: Record<string, Tone>; label?: ReactNode; dot?: boolean }) {
  return (
    <Badge tone={tones ? toneOf(tones, value) : undefined}>
      {dot && <span className="adm-dot" />}
      {label ?? humanize(value)}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: UserRole | string }) {
  return <Badge tone={toneOf(ROLE_TONE, role)}>{humanize(role)}</Badge>;
}

/** Enabled / disabled flag badge. */
export function FlagBadge({ on, yes = 'Enabled', no = 'Disabled', offTone = 'down' }: { on: boolean; yes?: string; no?: string; offTone?: 'down' | 'warn' | 'none' }) {
  return on ? <Badge tone="up">{yes}</Badge> : <Badge tone={offTone === 'none' ? undefined : offTone}>{no}</Badge>;
}

/** Decimal amount (string) with tabular figures, optional sign colouring and asset suffix. */
export function Amount({ value, maxDp = 8, signed, colored, asset }: { value: unknown; maxDp?: number; signed?: boolean; colored?: boolean; asset?: string | null }) {
  const sign = colored ? signOf(value) : 0;
  return (
    <span className={cx('num', sign > 0 && 'up', sign < 0 && 'down')}>
      {signed ? fmtSigned(value, maxDp) : fmtAmount(value, maxDp)}
      {asset && <span className="faint"> {asset}</span>}
    </span>
  );
}

export function Usd({ value, dp = 2 }: { value: unknown; dp?: number }) {
  return <span className="num">{fmtUsd(value, dp)}</span>;
}

export function DateTime({ value, relative = false }: { value: unknown; relative?: boolean }) {
  const text = fmtDateTime(value);
  if (text === DASH) return <span className="faint">{DASH}</span>;
  return (
    <span className="num" title={fmtUtc(value)}>
      {text}
      {relative && <span className="adm-cell-sub">{fmtRelative(value)}</span>}
    </span>
  );
}

/** Compact two-line timestamp (time over date) for dense tables. */
export function DateTimeStacked({ value }: { value: unknown }) {
  const text = fmtDateTime(value);
  if (text === DASH) return <span className="faint">{DASH}</span>;
  const [date, time] = text.split(' ');
  return (
    <span className="num" title={fmtUtc(value)}>
      {time}
      <span className="adm-cell-sub">{date}</span>
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <IconButton
      icon="copy"
      label={label}
      size={13}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(
          () => toast.info('Copied to clipboard'),
          () => toast.error('Copy failed', 'Clipboard access was denied by the browser.'),
        );
      }}
    />
  );
}

/** Monospace identifier (hash, address, id) with optional shortening and copy button. */
export function Mono({ value, short, copy }: { value: string | null | undefined; short?: boolean; copy?: boolean }) {
  if (!value) return <span className="faint">{DASH}</span>;
  return (
    <span className="adm-copy">
      <span className="adm-mono truncate" title={value}>
        {short ? shortAddress(value, 8, 6) : value}
      </span>
      {copy && <CopyButton value={value} />}
    </span>
  );
}

/**
 * Link to the user detail page when the admin may view users; plain text otherwise. Rows that only
 * carry an email (e.g. deposits) link to a user search instead.
 */
export function UserLink({ id, email }: { id: string | null | undefined; email?: string | null }) {
  const can = useCan();
  const text = email || (id ? `User #${id}` : DASH);
  if (!can('users.read') || (!id && !email)) return <span className={id || email ? undefined : 'faint'}>{text}</span>;
  const to = id ? `/users/${id}` : `/users?q=${encodeURIComponent(email ?? '')}`;
  return (
    <Link to={to} onClick={(e) => e.stopPropagation()}>
      {text}
    </Link>
  );
}

export function Side({ side }: { side: string }) {
  const positive = side === 'BUY' || side === 'LONG';
  return <span className={cx(positive ? 'up' : 'down')} style={{ fontWeight: 600 }}>{side}</span>;
}
