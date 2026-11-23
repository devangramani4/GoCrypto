import type { MfaMethod } from '@gocrypto/shared-types';
import { Alert, Button, Icon, IconButton, Logo, TextInput } from '@gocrypto/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useApi } from '../lib/ApiContext';
import { NotStaffError, verifyStaffAccess } from '../lib/auth';
import { ENV_LABEL } from '../lib/env';
import { errorMessage, isApiError } from '../lib/errors';
import { useSession } from '../lib/session';

type Step = { kind: 'credentials' } | { kind: 'mfa'; mfaToken: string; methods: MfaMethod[] };

// Mirrors @gocrypto/validation (email / totpCode / backupCode) without pulling zod into the entry chunk.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOTP = /^\d{6}$/;
const BACKUP = /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/;

function safeFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/';
}

/** Route element: signed-in admins are sent on to where they were heading. */
export function LoginRoute() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (status === 'authenticated') return <Navigate to={safeFrom(location.state)} replace />;
  return <LoginPage />;
}

export function LoginPage() {
  const client = useApi();
  const queryClient = useQueryClient();
  const notice = useSession((s) => s.notice);
  const clearNotice = useSession((s) => s.clearNotice);
  const signIn = useSession((s) => s.signIn);

  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Nothing cached by a previous session may leak into the next one.
  useEffect(() => {
    queryClient.clear();
  }, [queryClient]);

  const finishSignIn = async () => {
    const admin = await verifyStaffAccess(client);
    signIn(admin);
  };

  const failSignIn = (e: unknown) => {
    if (e instanceof NotStaffError) {
      setStep({ kind: 'credentials' });
      setPassword('');
      setCode('');
    }
    setError(errorMessage(e, 'Sign-in failed'));
  };

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    clearNotice();
    setError(null);
    const errs: Record<string, string> = {};
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) errs.email = 'Enter your email address';
    else if (normalizedEmail.length > 254 || !EMAIL.test(normalizedEmail)) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Enter your password';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await client.auth.login({ email: normalizedEmail, password, deviceName: 'Admin console' });
      if (res.status === 'MFA_REQUIRED') {
        setStep({ kind: 'mfa', mfaToken: res.mfaToken, methods: res.methods });
        setCode('');
        setUseBackup(false);
        return;
      }
      await finishSignIn();
    } catch (err) {
      failSignIn(err);
    } finally {
      setPending(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'mfa') return;
    setError(null);
    const value = code.trim();
    if (!(useBackup ? BACKUP : TOTP).test(value)) {
      setErrors({ code: useBackup ? 'Enter a backup code like ABCD-1234' : 'Enter the 6-digit code' });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const res = await client.auth.loginMfa(useBackup ? { mfaToken: step.mfaToken, backupCode: value } : { mfaToken: step.mfaToken, code: value });
      if (res.status !== 'OK') throw new Error('Unexpected response from the server. Try again.');
      await finishSignIn();
    } catch (err) {
      if (isApiError(err, { code: 'TOKEN_EXPIRED' }) || isApiError(err, { code: 'TOKEN_INVALID' })) {
        setStep({ kind: 'credentials' });
        setPassword('');
        setError('The verification window expired. Sign in again.');
      } else {
        failSignIn(err);
        setCode('');
      }
    } finally {
      setPending(false);
    }
  };

  const backToCredentials = () => {
    setStep({ kind: 'credentials' });
    setCode('');
    setErrors({});
    setError(null);
  };

  return (
    <div className="adm-login">
      <section className="adm-login__brand" aria-hidden="true">
        <div className="row" style={{ gap: 10 }}>
          <Logo size={30} />
          <span className="adm-sidebar__product">Back-office</span>
        </div>
        <div>
          <h2 className="adm-login__headline">Operations console for the GoCrypto exchange</h2>
          <p className="muted" style={{ maxWidth: 440, margin: 0 }}>
            Monitor markets and system health, review withdrawals, manage accounts and keep the platform safe.
          </p>
          <ul className="adm-login__points">
            <li>
              <Icon name="shield" size={16} />
              Role-based access — every screen and action is permission-checked by the API.
            </li>
            <li>
              <Icon name="file" size={16} />
              Administrative actions require a reason and are written to the audit log.
            </li>
            <li>
              <Icon name="lock" size={16} />
              Short-lived access tokens; the refresh token never leaves its httpOnly cookie.
            </li>
          </ul>
        </div>
        <div className="row faint" style={{ fontSize: 12 }}>
          <span className="adm-env">{ENV_LABEL}</span>
          Paper trading with simulated custody
        </div>
      </section>

      <section className="adm-login__panel">
        <div className="adm-login__card">
          {step.kind === 'credentials' ? (
            <form className="adm-stack" onSubmit={submitCredentials} noValidate aria-label="Sign in">
              <div>
                <h1>Sign in to Admin</h1>
                <div className="muted">Use your staff account. Customer accounts cannot access the back-office.</div>
              </div>
              {notice && <Alert tone={notice.tone === 'error' ? 'error' : 'info'}>{notice.message}</Alert>}
              <TextInput
                label="Email"
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                error={errors.email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextInput
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
                suffix={
                  <IconButton
                    icon={showPassword ? 'eyeOff' : 'eye'}
                    label={showPassword ? 'Hide password' : 'Show password'}
                    size={15}
                    style={{ width: 26, height: 26 }}
                    onClick={() => setShowPassword((v) => !v)}
                  />
                }
              />
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" variant="primary" size="lg" block loading={pending}>
                Sign in
              </Button>
            </form>
          ) : (
            <form className="adm-stack" onSubmit={submitMfa} noValidate aria-label="Two-factor verification">
              <div>
                <h1>Two-factor verification</h1>
                <div className="muted">
                  {useBackup ? 'Enter one of your one-time backup codes.' : 'Enter the 6-digit code from your authenticator app.'}
                </div>
              </div>
              <TextInput
                key={useBackup ? 'backup' : 'totp'}
                label={useBackup ? 'Backup code' : 'Authentication code'}
                className="adm-code-input"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                autoFocus
                maxLength={useBackup ? 9 : 6}
                placeholder={useBackup ? 'XXXX-XXXX' : '000000'}
                value={code}
                error={errors.code}
                onChange={(e) => setCode(useBackup ? e.target.value : e.target.value.replace(/\D/g, ''))}
              />
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" variant="primary" size="lg" block loading={pending}>
                Verify
              </Button>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <button type="button" className="adm-link-btn" onClick={backToCredentials}>
                  ← Back to sign in
                </button>
                {step.methods.includes('BACKUP_CODE') && (
                  <button
                    type="button"
                    className="adm-link-btn"
                    onClick={() => {
                      setUseBackup((v) => !v);
                      setCode('');
                      setErrors({});
                    }}
                  >
                    {useBackup ? 'Use authenticator code' : 'Use a backup code'}
                  </button>
                )}
              </div>
            </form>
          )}
          <div className="adm-login__foot">
            <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Authorized personnel only. Sign-in attempts are logged and monitored.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
