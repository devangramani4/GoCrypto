import { Icon, type IconName, Stat, cx } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function StatCard({
  label,
  value,
  sub,
  subTone,
  icon,
  loading,
  to,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: 'up' | 'down';
  icon?: IconName;
  loading?: boolean;
  /** Drill-down link (only pass when the admin can open the target). */
  to?: string;
  /** Highlight the card border (e.g. pending reviews, open alerts). */
  tone?: 'warn' | 'down';
}) {
  const body = <Stat label={label} value={value} sub={sub} subTone={subTone} icon={icon} loading={loading} />;
  const className = cx('adm-stat', tone && `adm-stat--${tone}`);
  if (to) {
    return (
      <Link className={className} to={to}>
        {body}
        <Icon className="adm-stat__arrow" name="arrowUpRight" size={14} />
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
