import type { GoCryptoClient } from '@gocrypto/api-client';
import { EmptyState, ToastProvider } from '@gocrypto/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ComponentType, type ReactNode, lazy } from 'react';
import { Link, Route, Routes } from 'react-router';
import { AppShell } from './layout/AppShell';
import { HomeRedirect, RequireAuth, RequirePermission, SessionBootstrap } from './layout/guards';
import { ApiProvider } from './lib/ApiContext';
import type { PermissionRequirement } from './lib/permissions';
import { NAV_ITEMS } from './navigation';
import { LoginRoute } from './pages/LoginPage';

/** Code-split page modules (named exports). */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const DashboardPage = page(() => import('./pages/DashboardPage'), 'DashboardPage');
const UsersPage = page(() => import('./pages/users/UsersPage'), 'UsersPage');
const UserDetailPage = page(() => import('./pages/users/UserDetailPage'), 'UserDetailPage');
const MarketsPage = page(() => import('./pages/markets/MarketsPage'), 'MarketsPage');
const FeesPage = page(() => import('./pages/FeesPage'), 'FeesPage');
const OrdersPage = page(() => import('./pages/OrdersPage'), 'OrdersPage');
const WalletPage = page(() => import('./pages/wallet/WalletPage'), 'WalletPage');
const ReportsPage = page(() => import('./pages/ReportsPage'), 'ReportsPage');
const SecurityPage = page(() => import('./pages/SecurityPage'), 'SecurityPage');
const RolesPage = page(() => import('./pages/RolesPage'), 'RolesPage');
const AuditLogsPage = page(() => import('./pages/AuditLogsPage'), 'AuditLogsPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const SystemHealthPage = page(() => import('./pages/SystemHealthPage'), 'SystemHealthPage');

function permFor(path: string): PermissionRequirement {
  const item = NAV_ITEMS.find((i) => i.path === path);
  if (!item) throw new Error(`No navigation entry for ${path}`);
  return item.perm;
}

function guarded(path: string, element: ReactNode) {
  return <RequirePermission perm={permFor(path)}>{element}</RequirePermission>;
}

function NotFound() {
  return (
    <div className="adm-panel">
      <EmptyState icon="search" title="Page not found" description="The page you requested does not exist." action={<Link to="/">Go to the start page</Link>} />
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={guarded('/dashboard', <DashboardPage />)} />
        <Route path="users" element={guarded('/users', <UsersPage />)} />
        <Route path="users/:id" element={guarded('/users', <UserDetailPage />)} />
        <Route path="markets" element={guarded('/markets', <MarketsPage />)} />
        <Route path="orders" element={guarded('/orders', <OrdersPage />)} />
        <Route path="fees" element={guarded('/fees', <FeesPage />)} />
        <Route path="wallet" element={guarded('/wallet', <WalletPage />)} />
        <Route path="reports" element={guarded('/reports', <ReportsPage />)} />
        <Route path="security" element={guarded('/security', <SecurityPage />)} />
        <Route path="audit" element={guarded('/audit', <AuditLogsPage />)} />
        <Route path="roles" element={guarded('/roles', <RolesPage />)} />
        <Route path="settings" element={guarded('/settings', <SettingsPage />)} />
        <Route path="system" element={guarded('/system', <SystemHealthPage />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** Providers + routes. The router itself is supplied by the caller (BrowserRouter / MemoryRouter). */
export function App({ client, queryClient }: { client: GoCryptoClient; queryClient: QueryClient }) {
  return (
    <ApiProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionBootstrap>
            <AppRoutes />
          </SessionBootstrap>
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}
