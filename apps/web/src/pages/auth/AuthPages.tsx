import { ApiError } from '@gocrypto/api-client';
import type { UserDto } from '@gocrypto/shared-types';
import { Alert, Button, Checkbox, Icon, Logo, TextInput } from '@gocrypto/ui';
import { registerSchema, resetPasswordSchema } from '@gocrypto/validation';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChangePct } from '../../components/common';
import { api, errorMessage, realtime } from '../../lib/api';
import { deviceName } from '../../lib/env';
import { fmtPrice } from '../../lib/format';
import { useTickers } from '../../lib/hooks';
import { useSession } from '../../stores/session';

function useOnAuthenticated() {
  const qc = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return (user: UserDto) => {
    qc.removeQueries({ predicate: (q) => !['markets', 'assets', 'tickers', 'system-status'].includes(String(q.queryKey[0])) });
    setUser(user);
    realtime.reconnect();
  };
}

function zodErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = String(i.path[0] ?? '_');
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { data: tickers } = useTickers('SPOT');
  const featured = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((s) => tickers?.find((t) => t.symbol === s)).filter(Boolean);
  return (
    <div className="auth">
      <aside className="auth__brand">
        <Link to="/" aria-label="GoCrypto home">
          <Logo size={30} />
        </Link>
        <div>
          <h2>Spot, perpetuals and options — one account, one risk engine.</h2>
          <p className="muted">Price-time priority matching, real-time margin checks and full audit trails. Practice risk-free in the sandbox with simulated funds.</p>
        </div>
        <div className="auth__tickers">
          {featured.map((t) => (
            <div key={t!.symbol} className="auth__ticker">
              <span className="faint">{t!.symbol.replace('USDT', '/USDT')}</span>
              <strong className="num">{fmtPrice(t!.lastPrice)}</strong>
              <ChangePct value={t!.priceChangePercent} />
            </div>
          ))}
        </div>
        <ul className="auth__points">
          <li>
            <Icon name="shield" size={15} /> Argon2id passwords, TOTP 2FA, trading PIN
          </li>
          <li>
            <Icon name="lock" size={15} /> Withdrawal allow-lists, limits and risk review
          </li>
          <li>
            <Icon name="activity" size={15} /> Real-time order book, charts and positions
          </li>
        </ul>
      </aside>
      <section className="auth__panel">
        <div className="auth__card">
          <h1>{title}</h1>
          {subtitle && <p className="muted auth__sub">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="auth__foot">{footer}</div>}
      </section>
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const onAuthed = useOnAuthenticated();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [mfa, setMfa] = useState<{ token: string } | null>(null);
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) return setError('Enter your email and password');
    setBusy(true);
    try {
      const res = await api.auth.login({ email: email.trim(), password, deviceName: deviceName() });
      if (res.status === 'MFA_REQUIRED') setMfa({ token: res.mfaToken });
      else onAuthed(res.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.auth.loginMfa(useBackup ? { mfaToken: mfa.token, backupCode: code.trim() } : { mfaToken: mfa.token, code: code.trim() });
      if (res.status === 'OK') onAuthed(res.user);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') setMfa(null);
    } finally {
      setBusy(false);
    }
  };

  if (mfa) {
    return (
      <AuthLayout title="Two-factor authentication" subtitle={useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}>
        <form onSubmit={submitMfa} className="col" style={{ gap: 14 }} noValidate>
          <TextInput
            label={useBackup ? 'Backup code' : 'Authentication code'}
            value={code}
            onChange={(e) => setCode(useBackup ? e.target.value.toUpperCase().slice(0, 9) : e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode={useBackup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            className="otp-input"
          />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={useBackup ? code.length < 8 : code.length !== 6}>
            Verify
          </Button>
          <button type="button" className="link-btn" onClick={() => (setUseBackup((b) => !b), setCode(''))}>
            {useBackup ? 'Use authenticator code' : 'Use a backup code instead'}
          </button>
          <button type="button" className="link-btn faint" onClick={() => (setMfa(null), setCode(''))}>
            ← Back to login
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Log in to GoCrypto"
      subtitle="Welcome back. Make sure you are on the official GoCrypto domain."
      footer={
        <>
          New to GoCrypto? <Link to={`/register${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
        </>
      }
    >
      <form onSubmit={submit} className="col" style={{ gap: 14 }} noValidate>
        <TextInput label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <TextInput
          label="Password"
          labelRight={<Link to="/forgot-password">Forgot password?</Link>}
          type={showPw ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          suffix={
            <button type="button" className="gc-icon-btn" aria-label={showPw ? 'Hide password' : 'Show password'} onClick={() => setShowPw((s) => !s)}>
              <Icon name={showPw ? 'eyeOff' : 'eye'} size={15} />
            </button>
          }
        />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}

function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'][score]! };
}

export function RegisterPage() {
  const [params] = useSearchParams();
  const onAuthed = useOnAuthenticated();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', confirm: '', referralCode: params.get('ref') ?? '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: '', _: '' }));
  };
  const strength = passwordStrength(form.password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      email: form.email,
      password: form.password,
      displayName: form.displayName.trim() || undefined,
      referralCode: form.referralCode.trim() || undefined,
      acceptTerms: accept as true,
    };
    const parsed = registerSchema.safeParse(input);
    const errs = parsed.success ? {} : zodErrors(parsed.error);
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match';
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    try {
      const res = await api.auth.register({ ...input, acceptTerms: true });
      onAuthed(res.user);
      navigate(params.get('next') ?? '/dashboard?welcome=1', { replace: true });
    } catch (err) {
      setErrors(err instanceof ApiError && Object.keys(err.fieldErrors()).length ? err.fieldErrors() : { _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start in the sandbox with simulated funds — no real assets are moved."
      footer={
        <>
          Already registered? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="col" style={{ gap: 12 }} noValidate>
        <TextInput label="Display name (optional)" value={form.displayName} onChange={set('displayName')} error={errors.displayName} autoComplete="nickname" />
        <TextInput label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" />
        <div>
          <TextInput label="Password" type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="new-password" />
          {form.password && (
            <div className="pw-meter" aria-live="polite">
              <div className="pw-meter__bars">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={i < strength.score ? `on s${strength.score}` : ''} />
                ))}
              </div>
              <span className="faint">{strength.label}</span>
            </div>
          )}
        </div>
        <TextInput label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        <TextInput label="Referral code (optional)" value={form.referralCode} onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))} error={errors.referralCode} />
        <Checkbox checked={accept} onChange={(v) => (setAccept(v), setErrors((x) => ({ ...x, acceptTerms: '' })))}>
          I accept the Terms of Use and Privacy Notice, and understand that crypto trading — especially with leverage — carries a high risk of loss.
        </Checkbox>
        {errors.acceptTerms && <div className="gc-field__error">{errors.acceptTerms}</div>}
        {errors._ && <Alert tone="error">{errors._}</Alert>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErrors({ email: 'Enter a valid email address' });
    setBusy(true);
    try {
      await api.auth.forgotPassword(email.trim());
      setStep('reset');
      setErrors({});
    } catch (err) {
      setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = resetPasswordSchema.safeParse({ email: email.trim(), code: code.trim(), newPassword: password });
    if (!parsed.success) return setErrors(zodErrors(parsed.error));
    setBusy(true);
    try {
      await api.auth.resetPassword(parsed.data);
      setDone(true);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setErrors({ _: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={step === 'request' ? 'Reset your password' : 'Choose a new password'}
      subtitle={step === 'request' ? 'We will email you a 6-digit verification code.' : `If an account exists for ${email}, a code is on its way. Withdrawals are locked for 24h after a reset.`}
      footer={<Link to="/login">← Back to login</Link>}
    >
      {done ? (
        <Alert tone="info">Password updated. All sessions were signed out — redirecting to login…</Alert>
      ) : step === 'request' ? (
        <form onSubmit={request} className="col" style={{ gap: 14 }} noValidate>
          <TextInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoFocus />
          {errors._ && <Alert tone="error">{errors._}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Send code
          </Button>
        </form>
      ) : (
        <form onSubmit={reset} className="col" style={{ gap: 14 }} noValidate>
          <TextInput label="Verification code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} error={errors.code} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          <TextInput label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.newPassword} autoComplete="new-password" />
          {errors._ && <Alert tone="error">{errors._}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
