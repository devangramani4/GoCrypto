import { ApiError } from '@gocrypto/api-client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../stores/session';
import { USER, fakeRealtime, mockApi, resetMockApi } from '../../test/mockApi';
import { renderRoute, signOut } from '../../test/render';
import { LoginPage, RegisterPage } from './AuthPages';

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  const m = await import('../../test/mockApi');
  return { ...actual, api: m.mockApi, realtime: m.fakeRealtime };
});

const tokens = { accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: 0, refreshTokenExpiresAt: 0, sessionId: 's' };

describe('Login', () => {
  beforeEach(() => {
    resetMockApi();
    signOut();
  });

  it('logs in with email and password and opens an authenticated session', async () => {
    mockApi.auth.login.mockResolvedValue({ status: 'OK', user: USER, tokens });
    renderRoute(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'trader@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3rSecretPass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useSession.getState().status).toBe('authenticated'));
    expect(mockApi.auth.login).toHaveBeenCalledWith({ email: 'trader@example.com', password: 'Sup3rSecretPass', deviceName: expect.any(String) });
    expect(useSession.getState().user?.id).toBe('42');
    expect(fakeRealtime.reconnect).toHaveBeenCalled();
  });

  it('asks for the authenticator code when 2FA is enabled', async () => {
    mockApi.auth.login.mockResolvedValue({ status: 'MFA_REQUIRED', mfaToken: 'mfa-token', methods: ['TOTP', 'BACKUP_CODE'] });
    mockApi.auth.loginMfa.mockResolvedValue({ status: 'OK', user: USER, tokens });
    renderRoute(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'trader@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Sup3rSecretPass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Two-factor authentication')).toBeInTheDocument();
    expect(useSession.getState().status).toBe('anonymous');
    await userEvent.type(screen.getByLabelText('Authentication code'), '12a3456');
    expect(screen.getByLabelText('Authentication code')).toHaveValue('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(mockApi.auth.loginMfa).toHaveBeenCalledWith({ mfaToken: 'mfa-token', code: '123456' }));
    await waitFor(() => expect(useSession.getState().status).toBe('authenticated'));
  });

  it('shows the server error for bad credentials', async () => {
    mockApi.auth.login.mockRejectedValue(new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }));
    renderRoute(<LoginPage />, { route: '/login', path: '/login' });
    await userEvent.type(screen.getByLabelText('Email'), 'trader@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(useSession.getState().status).toBe('anonymous');
  });
});

describe('Register', () => {
  beforeEach(() => {
    resetMockApi();
    signOut();
  });

  it('validates the password policy and terms before calling the API', async () => {
    renderRoute(<RegisterPage />, { route: '/register', path: '/register' });
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms')).toBeInTheDocument();
    expect(mockApi.auth.register).not.toHaveBeenCalled();
  });

  it('registers a valid account', async () => {
    mockApi.auth.register.mockResolvedValue({ user: { ...USER, email: 'new@example.com' }, tokens });
    renderRoute(<RegisterPage />, { route: '/register', path: '/register' });
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Str0ngPassw0rd');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockApi.auth.register).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', password: 'Str0ngPassw0rd', acceptTerms: true })));
    await waitFor(() => expect(useSession.getState().status).toBe('authenticated'));
  });
});
