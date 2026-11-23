import type { ConnectionStatus } from '@gocrypto/api-client';
import { Icon, Logo, Spinner, cx, useToast } from '@gocrypto/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api, realtime } from '../../lib/api';
import { isDesktop } from '../../lib/env';
import { useSystemStatus, useUnreadCount, useUserStream } from '../../lib/hooks';
import { usePrefs, useSession } from '../../stores/session';
import { SandboxBanner } from '../common';

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.dataset.theme = theme;
}

export async function logout(): Promise<void> {
  try {
    await api.auth.logout();
  } finally {
    useSession.getState().setUser(null);
    realtime.reconnect();
  }
}

function useConnection(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(realtime.connectionStatus);
  useEffect(() => realtime.onStatus(setStatus), []);
  return status;
}

type NavItem = { to: string; label: string; match?: string };

const NAV: NavItem[] = [
  { to: '/markets', label: 'Markets' },
  { to: '/trade', label: 'Spot', match: '/trade' },
  { to: '/futures', label: 'Futures', match: '/futures' },
  { to: '/options', label: 'Options' },
];

const NAV_AUTH: NavItem[] = [
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/orders', label: 'Orders' },
];

export function AppShell() {
  useUserStream();
  const { data: status } = useSystemStatus();
  return (
    <div className={cx('app', isDesktop && 'app--desktop')}>
      {status?.mode !== 'LIVE' && <SandboxBanner />}
      <TopNav />
      <main className="app__main">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

function TopNav() {
  const user = useSession((s) => s.user);
  const status = useSession((s) => s.status);
  const lastSpot = usePrefs((s) => s.lastSpot);
  const lastFutures = usePrefs((s) => s.lastFutures);
  const [menuOpen, setMenuOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenuOpen(false), [loc.pathname]);
  const target = (to: string) => (to === '/trade' ? `/trade/${lastSpot}` : to === '/futures' ? `/futures/${lastFutures}` : to);
  const links = [...NAV, ...(user ? NAV_AUTH : [])];
  return (
    <header className="topnav">
      <button type="button" className="gc-icon-btn topnav__burger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
        <Icon name={menuOpen ? 'x' : 'grid'} size={18} />
      </button>
      <Link to="/" className="topnav__logo" aria-label="GoCrypto home">
        <Logo size={26} />
      </Link>
      <nav className={cx('topnav__links', menuOpen && 'open')} aria-label="Primary">
        {links.map((l) => (
          <NavLink key={l.to} to={target(l.to)} className={({ isActive }) => cx('topnav__link', (isActive || (l.match && loc.pathname.startsWith(l.match))) && 'active')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <span className="spacer" />
      <div className="topnav__right">
        {user && (
          <Link to="/wallet/deposit" className="gc-btn gc-btn--primary gc-btn--sm topnav__deposit">
            <Icon name="download" size={14} /> Deposit
          </Link>
        )}
        <ThemeToggle />
        {status === 'authenticated' && user ? (
          <>
            <NotificationsBell />
            <UserMenu />
          </>
        ) : status === 'anonymous' ? (
          <>
            <Link to="/login" className="gc-btn gc-btn--ghost gc-btn--sm">
              Log in
            </Link>
            <Link to="/register" className="gc-btn gc-btn--primary gc-btn--sm">
              Sign up
            </Link>
          </>
        ) : null}
      </div>
    </header>
  );
}

function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <button type="button" className="gc-icon-btn" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

function NotificationsBell() {
  const { data } = useUnreadCount();
  const count = data?.count ?? 0;
  return (
    <Link to="/notifications" className="gc-icon-btn topnav__bell" aria-label={`Notifications${count ? ` (${count} unread)` : ''}`}>
      <Icon name="bell" size={17} />
      {count > 0 && <span className="topnav__badge">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}

function UserMenu() {
  const user = useSession((s) => s.user)!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const initials = (user.displayName ?? user.email).slice(0, 2).toUpperCase();
  const item = (to: string, icon: Parameters<typeof Icon>[0]['name'], label: string) => (
    <Link to={to} className="menu__item" onClick={() => setOpen(false)}>
      <Icon name={icon} size={15} /> {label}
    </Link>
  );
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        {initials}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu__head">
            <strong className="truncate">{user.displayName ?? user.email}</strong>
            <span className="faint" style={{ fontSize: 11 }}>
              UID {user.uid} · VIP {user.vipTier}
            </span>
          </div>
          {item('/dashboard', 'home', 'Dashboard')}
          {item('/portfolio', 'pie', 'Portfolio')}
          {item('/wallet', 'wallet', 'Wallet')}
          {item('/orders', 'list', 'Orders & trades')}
          <div className="gc-divider" />
          {item('/account/security', 'shield', 'Security')}
          {item('/account/api-keys', 'key', 'API keys')}
          {item('/account/preferences', 'settings', 'Preferences')}
          <div className="gc-divider" />
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              void logout().then(() => {
                qc.clear();
                toast.info('Logged out');
                navigate('/');
              });
            }}
          >
            <Icon name="logout" size={15} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBar() {
  const conn = useConnection();
  const { data: status } = useSystemStatus();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <footer className="statusbar">
      <span className={cx('statusbar__conn', conn)}>
        <i /> {conn === 'connected' ? 'Live' : conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </span>
      <span className="faint">{status?.mode === 'LIVE' ? 'Live trading' : 'Sandbox · paper trading'}</span>
      <span className="spacer" />
      <Link to="/fees" className="faint">
        Fees
      </Link>
      <span className="faint">API v1</span>
      <span className="faint num">{now.toISOString().slice(11, 19)} UTC</span>
    </footer>
  );
}

/** Route guard for private pages: waits for session restore, then redirects anonymous users to login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const loc = useLocation();
  if (status === 'unknown') {
    return (
      <div className="page-center">
        <Spinner size={22} />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Inverse guard for login/register pages. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const loc = useLocation();
  if (status === 'authenticated') {
    const next = new URLSearchParams(loc.search).get('next');
    return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'} replace />;
  }
  return <>{children}</>;
}
