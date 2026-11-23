import { Spinner, ToastProvider } from '@gocrypto/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { AppShell, RedirectIfAuthed, RequireAuth } from './components/layout/AppShell';
import { queryClient, realtime, setSessionExpiredHandler } from './lib/api';
import { isDesktop } from './lib/env';
import { ForgotPasswordPage, LoginPage, RegisterPage } from './pages/auth/AuthPages';
import { HomePage } from './pages/HomePages';
import { MarketsPage } from './pages/MarketsPage';
import { FeesPage, NotFoundPage, NotificationsPage, OrdersPage } from './pages/MiscPages';
import { usePrefs, useSession } from './stores/session';

// Route-level code splitting: charts and heavy screens load on demand.
const TradePage = lazy(() => import('./pages/TradePage').then((m) => ({ default: m.TradePage })));
const OptionsPage = lazy(() => import('./pages/OptionsPage').then((m) => ({ default: m.OptionsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage').then((m) => ({ default: m.PortfolioPage })));
const WalletPage = lazy(() => import('./pages/WalletPage').then((m) => ({ default: m.WalletPage })));
const DepositPage = lazy(() => import('./pages/DepositWithdraw').then((m) => ({ default: m.DepositPage })));
const WithdrawPage = lazy(() => import('./pages/DepositWithdraw').then((m) => ({ default: m.WithdrawPage })));
const AccountPage = lazy(() => import('./pages/account/AccountPage').then((m) => ({ default: m.AccountPage })));

function Loading() {
  return (
    <div className="page-center">
      <Spinner size={22} />
    </div>
  );
}

function Private({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </RequireAuth>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function SessionExpiry() {
  const navigate = useNavigate();
  useEffect(() => {
    setSessionExpiredHandler(() => {
      if (useSession.getState().status !== 'authenticated') return;
      useSession.getState().setUser(null);
      queryClient.clear();
      realtime.reconnect();
      navigate(`/login?next=${encodeURIComponent(window.location.pathname)}&expired=1`);
    });
  }, [navigate]);
  return null;
}

function LastMarketRedirect({ kind }: { kind: 'spot' | 'futures' }) {
  const lastSpot = usePrefs((s) => s.lastSpot);
  const lastFutures = usePrefs((s) => s.lastFutures);
  return <Navigate to={kind === 'spot' ? `/trade/${lastSpot}` : `/futures/${lastFutures}`} replace />;
}

export function AppRoutes() {
  return (
    <>
      <SessionExpiry />
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthed>
              <RegisterPage />
            </RedirectIfAuthed>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="markets" element={<MarketsPage />} />
          <Route path="trade" element={<LastMarketRedirect kind="spot" />} />
          <Route
            path="trade/:symbol"
            element={
              <Lazy>
                <TradePage kind="spot" />
              </Lazy>
            }
          />
          <Route path="futures" element={<LastMarketRedirect kind="futures" />} />
          <Route
            path="futures/:symbol"
            element={
              <Lazy>
                <TradePage kind="futures" />
              </Lazy>
            }
          />
          <Route
            path="options"
            element={
              <Lazy>
                <OptionsPage />
              </Lazy>
            }
          />
          <Route path="fees" element={<FeesPage />} />
          <Route
            path="dashboard"
            element={
              <Private>
                <DashboardPage />
              </Private>
            }
          />
          <Route
            path="portfolio"
            element={
              <Private>
                <PortfolioPage />
              </Private>
            }
          />
          <Route
            path="wallet"
            element={
              <Private>
                <WalletPage />
              </Private>
            }
          />
          <Route
            path="wallet/deposit"
            element={
              <Private>
                <DepositPage />
              </Private>
            }
          />
          <Route
            path="wallet/withdraw"
            element={
              <Private>
                <WithdrawPage />
              </Private>
            }
          />
          <Route
            path="orders"
            element={
              <Private>
                <OrdersPage />
              </Private>
            }
          />
          <Route
            path="notifications"
            element={
              <Private>
                <NotificationsPage />
              </Private>
            }
          />
          <Route path="account" element={<Navigate to="/account/profile" replace />} />
          <Route
            path="account/:tab"
            element={
              <Private>
                <AccountPage />
              </Private>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  // The desktop app loads from file:// — hash routing keeps deep links working there.
  const Router = isDesktop ? HashRouter : BrowserRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <AppRoutes />
        </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}
