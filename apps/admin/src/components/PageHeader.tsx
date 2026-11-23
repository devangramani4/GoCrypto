import { Icon } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <header className="adm-page-head">
      <div className="adm-page-head__text">
        {back && (
          <Link className="adm-back" to={back.to}>
            <Icon name="chevronLeft" size={14} />
            {back.label}
          </Link>
        )}
        <h1 className="adm-page-title">{title}</h1>
        {subtitle && <div className="adm-page-sub">{subtitle}</div>}
      </div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </header>
  );
}

/** Bordered surface used for every table / form block. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `adm-panel ${className}` : 'adm-panel'}>
      {(title || actions) && (
        <header className="adm-panel__head">
          {typeof title === 'string' ? <h2 className="adm-panel__title">{title}</h2> : title}
          <span className="spacer" />
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="adm-toolbar">{children}</div>;
}
