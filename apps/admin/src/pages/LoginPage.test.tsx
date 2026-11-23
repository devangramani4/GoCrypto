import { ApiError } from '@gocrypto/api-client';
import { ALL_PERMISSIONS, type AuthTokens, type UserDto } from '@gocrypto/shared-types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOT_STAFF_MESSAGE } from '../lib/auth';
import { useSession } from '../lib/session';
import { createMockClient, renderWithProviders, signedOut } from '../test/utils';
import { LoginRoute } from './LoginPage';

const tokens: AuthTokens = {
  accessToken: 'access',
  refreshToken: '',
  accessTokenExpiresAt: Date.now() + 900_000,
  refreshTokenExpiresAt: Date.now() + 86_400_000,
  sessionId: 's1',
};

const staffUser: UserDto = {
  id: '1',
  uid: 'GC00000001',
  email: 'admin@gocrypto.local',
  emailVerified: true,
  phone: null,
  phoneVerified: false,
  displayName: 'Ops Admin',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  tradingEnabled: true,
  withdrawalsEnabled: true,
  twoFactorEnabled: true,
  hasTradingPin: false,
  kycLevel: 3,
  vipTier: 0,
  permissions: [...ALL_PERMISSIONS],
  createdAt: Date.now(),
  lastLoginAt: null,
};

function renderLogin(client = createMockClient()) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/" element={<div>Console home</div>} />
    </Routes>,
    { client, route: '/login' },
  );
}

async function submitCredentials(email = 'Admin@GoCrypto.local', password = 'AdminPassw0rd!2026') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('LoginPage', () => {
  beforeEach(() => signedOut());

  it('submits credentials, shows the 2FA step and signs in after a valid code', async () => {
    const login = vi.fn().mockResolvedValue({ status: 'MFA_REQUIRED', mfaToken: 'mfa-token-0123456789abcdef', methods: ['TOTP', 'BACKUP_CODE'] });
    const loginMfa = vi.fn().mockResolvedValue({ status: 'OK', user: staffUser, tokens });
    const me = vi.fn().mockResolvedValue({ userId: '1', role: 'SUPER_ADMIN', permissions: ALL_PERMISSIONS });
    renderLogin(createMockClient({ auth: { login, loginMfa }, admin: { me } }));

    const user = await submitCredentials();
    expect(login).toHaveBeenCalledWith({ email: 'admin@gocrypto.local', password: 'AdminPassw0rd!2026', deviceName: 'Admin console' });
    expect(await screen.findByRole('heading', { name: 'Two-factor verification' })).toBeInTheDocument();
    expect(me).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(loginMfa).toHaveBeenCalledWith({ mfaToken: 'mfa-token-0123456789abcdef', code: '123456' }));
    expect(await screen.findByText('Console home')).toBeInTheDocument();
    expect(useSession.getState().status).toBe('authenticated');
    expect(useSession.getState().admin).toMatchObject({ userId: '1', role: 'SUPER_ADMIN' });
  });

  it('can switch the 2FA step to a backup code', async () => {
    const login = vi.fn().mockResolvedValue({ status: 'MFA_REQUIRED', mfaToken: 'mfa-token-0123456789abcdef', methods: ['TOTP', 'BACKUP_CODE'] });
    const loginMfa = vi.fn().mockResolvedValue({ status: 'OK', user: staffUser, tokens });
    const me = vi.fn().mockResolvedValue({ userId: '1', role: 'ADMIN', permissions: ['dashboard.read'] });
    renderLogin(createMockClient({ auth: { login, loginMfa }, admin: { me } }));

    const user = await submitCredentials();
    await user.click(await screen.findByRole('button', { name: 'Use a backup code' }));
    await user.type(screen.getByLabelText('Backup code'), 'ABCD-1234');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(loginMfa).toHaveBeenCalledWith({ mfaToken: 'mfa-token-0123456789abcdef', backupCode: 'ABCD-1234' }));
    expect(await screen.findByText('Console home')).toBeInTheDocument();
  });

  it('validates the form before calling the API', async () => {
    const login = vi.fn();
    renderLogin(createMockClient({ auth: { login } }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('shows the server error for invalid credentials', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }));
    renderLogin(createMockClient({ auth: { login } }));

    await submitCredentials('admin@gocrypto.local', 'wrong-password');
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to Admin' })).toBeInTheDocument();
    expect(useSession.getState().status).toBe('anonymous');
  });

  it('rejects an invalid 2FA code and stays on the verification step', async () => {
    const login = vi.fn().mockResolvedValue({ status: 'MFA_REQUIRED', mfaToken: 'mfa-token-0123456789abcdef', methods: ['TOTP'] });
    const loginMfa = vi.fn().mockRejectedValue(new ApiError(401, { error: { code: 'INVALID_MFA_CODE', message: 'Invalid code' } }));
    renderLogin(createMockClient({ auth: { login, loginMfa } }));

    const user = await submitCredentials();
    await user.type(await screen.findByLabelText('Authentication code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText(/That code is not valid/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Two-factor verification' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use a backup code' })).not.toBeInTheDocument();
  });

  it('logs out and explains when the account is not staff (403 from /admin/me)', async () => {
    const login = vi.fn().mockResolvedValue({ status: 'OK', user: { ...staffUser, role: 'USER' }, tokens });
    const me = vi.fn().mockRejectedValue(new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Admin access required' } }));
    const logout = vi.fn().mockResolvedValue(undefined);
    renderLogin(createMockClient({ auth: { login, logout }, admin: { me } }));

    await submitCredentials('trader@example.com', 'Password123!');
    expect(await screen.findByText(NOT_STAFF_MESSAGE)).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(useSession.getState().status).toBe('anonymous');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('shows the session notice (e.g. expiry) above the form', () => {
    useSession.setState({ status: 'anonymous', admin: null, notice: { tone: 'info', message: 'Your session has expired. Sign in again to continue.' } });
    renderLogin();
    expect(screen.getByText('Your session has expired. Sign in again to continue.')).toBeInTheDocument();
  });
});
