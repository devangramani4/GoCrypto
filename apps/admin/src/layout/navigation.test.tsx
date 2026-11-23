import { ALL_PERMISSIONS } from '@gocrypto/shared-types';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { resetSession } from '../lib/session';
import { alice, page, SUPPORT_PERMISSIONS } from '../test/fixtures';
import { createMockClient, renderWithProviders, signInAs, signedOut } from '../test/utils';
import { Sidebar } from './Sidebar';

const ALL_AREAS = [
  'Dashboard',
  'System health',
  'Users',
  'Markets',
  'Orders & trades',
  'Fees',
  'Wallet',
  'Reports',
  'Security',
  'Audit logs',
  'Roles & permissions',
  'Settings',
];

function shellClient(extra: Parameters<typeof createMockClient>[0] = {}) {
  return createMockClient({
    ...extra,
    users: { me: vi.fn().mockResolvedValue({ email: 'agent@gocrypto.local', displayName: 'Support Agent' }), ...extra.users },
    admin: {
      withdrawals: vi.fn().mockResolvedValue(page([], 3)),
      alerts: vi.fn().mockResolvedValue(page([], 0)),
      ...extra.admin,
    },
  });
}

const link = (nav: HTMLElement, label: string) => within(nav).queryByRole('link', { name: new RegExp(`^${label.replace(/[&]/g, '\\$&')}`) });

describe('permission-gated navigation', () => {
  beforeEach(() => resetSession());

  it('shows only the areas a support agent may open, with work-queue counters', async () => {
    signInAs('SUPPORT', SUPPORT_PERMISSIONS);
    renderWithProviders(<Sidebar />, { client: shellClient() });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });

    for (const label of ['Dashboard', 'Users', 'Orders & trades', 'Wallet', 'Security']) expect(link(nav, label)).toBeInTheDocument();
    for (const label of ['System health', 'Markets', 'Fees', 'Reports', 'Audit logs', 'Roles & permissions', 'Settings']) expect(link(nav, label)).not.toBeInTheDocument();
    expect(within(nav).queryByText('Administration')).not.toBeInTheDocument();
    expect(within(nav).getAllByRole('link')).toHaveLength(5);

    // Pending withdrawal reviews surface next to Wallet (alerts count is 0, so no badge).
    expect(await within(nav).findByLabelText('3 pending')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(await screen.findByText('Support Agent')).toBeInTheDocument();
  });

  it('shows every area to a super admin', () => {
    signInAs('SUPER_ADMIN', ALL_PERMISSIONS);
    renderWithProviders(<Sidebar />, { client: shellClient() });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ALL_AREAS) expect(link(nav, label)).toBeInTheDocument();
  });

  it('blocks direct navigation to a page the role cannot open', async () => {
    signInAs('SUPPORT', SUPPORT_PERMISSIONS);
    const settings = vi.fn();
    renderWithProviders(<AppRoutes />, { client: shellClient({ admin: { settings } }), route: '/settings' });

    expect(await screen.findByText('You don’t have access to this area')).toBeInTheDocument();
    expect(screen.getByText('settings.read')).toBeInTheDocument();
    expect(settings).not.toHaveBeenCalled();
  });

  it('lands on the first permitted page', async () => {
    signInAs('VIEW_ONLY', ['users.read']);
    const users = vi.fn().mockResolvedValue(page([alice]));
    renderWithProviders(<AppRoutes />, { client: shellClient({ admin: { users } }), route: '/' });

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Dashboard/ })).not.toBeInTheDocument();
  });

  it('applies role changes made by a super admin without a re-login', async () => {
    signInAs('SUPPORT', SUPPORT_PERMISSIONS);
    const me = vi.fn().mockResolvedValue({ userId: '1', role: 'SUPPORT', permissions: [...SUPPORT_PERMISSIONS, 'audit.read'] });
    const users = vi.fn().mockResolvedValue(page([alice]));
    renderWithProviders(<AppRoutes />, { client: shellClient({ admin: { me, users } }), route: '/users' });

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(link(nav, 'Audit logs')).not.toBeInTheDocument();
    expect(await within(nav).findByRole('link', { name: /^Audit logs/ })).toBeInTheDocument();
    expect(me).toHaveBeenCalled();
  });

  it('sends signed-out visitors to the login screen', async () => {
    signedOut();
    renderWithProviders(<AppRoutes />, { route: '/wallet' });
    expect(await screen.findByRole('heading', { name: 'Sign in to Admin' })).toBeInTheDocument();
  });
});
