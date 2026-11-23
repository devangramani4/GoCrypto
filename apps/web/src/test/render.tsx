import type { UserDto } from '@gocrypto/shared-types';
import { ToastProvider } from '@gocrypto/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useSession } from '../stores/session';
import { USER } from './mockApi';

export function signIn(user: Partial<UserDto> = {}): UserDto {
  const u = { ...USER, ...user };
  useSession.setState({ status: 'authenticated', user: u });
  return u;
}

export function signOut(): void {
  useSession.setState({ status: 'anonymous', user: null });
}

export function renderRoute(ui: ReactElement, { route = '/', path = '/' }: { route?: string; path?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
