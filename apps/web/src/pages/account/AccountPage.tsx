import type {
  ApiKeyCreatedDto,
  ApiKeyPermission,
  DeviceDto,
  LoginHistoryDto,
  NotificationCategory,
  NotificationChannel,
  NotificationPrefs,
  SessionDto,
} from '@gocrypto/shared-types';
import { API_KEY_PERMISSIONS, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '@gocrypto/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Icon,
  KeyValue,
  Modal,
  Progress,
  Segmented,
  Skeleton,
  Switch,
  Tabs,
  TextInput,
  useToast,
} from '@gocrypto/ui';
import { changePasswordSchema, pinCode } from '@gocrypto/validation';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { CopyButton, QrCode } from '../../components/common';
import { api, errorMessage } from '../../lib/api';
import { fmtDateTime, humanize } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { usePrefs, useSession } from '../../stores/session';

type Tab = 'profile' | 'security' | 'devices' | 'api-keys' | 'preferences';
const TABS: { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'security', label: 'Security' },
  { value: 'devices', label: 'Devices & sessions' },
  { value: 'api-keys', label: 'API keys' },
  { value: 'preferences', label: 'Preferences' },
];

function useRefreshUser() {
  const setUser = useSession((s) => s.setUser);
  const qc = useQueryClient();
  return async () => {
    setUser(await api.users.me());
    void qc.invalidateQueries({ queryKey: ['security'] });
  };
}

function Section({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="setting__control">{children}</div>
      {aside}
    </div>
  );
}

export function AccountPage() {
  const { tab = 'profile' } = useParams();
  const navigate = useNavigate();
  if (!TABS.some((t) => t.value === tab)) return <Navigate to="/account/profile" replace />;
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Account</h1>
          <p className="muted">Manage your profile, security, devices and API access.</p>
        </div>
      </div>
      <div className="account">
        <nav className="account__nav" aria-label="Account sections">
          <Tabs value={tab as Tab} onChange={(t) => navigate(`/account/${t}`)} tabs={TABS} />
        </nav>
        <div className="account__body">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'api-keys' && <ApiKeysTab />}
          {tab === 'preferences' && <PreferencesTab />}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── profile ─────────────────────────────

function ProfileTab() {
  const user = useSession((s) => s.user)!;
  const refresh = useRefreshUser();
  const toast = useToast();
  const [name, setName] = useState(user.displayName ?? '');
  const [phish, setPhish] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneSent, setPhoneSent] = useState(false);
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) => async () => {
    try {
      await fn();
      toast.success(ok);
      after?.();
      await refresh();
    } catch (e) {
      toast.error('Not saved', errorMessage(e));
    }
  };
  return (
    <Card>
      <KeyValue
        items={[
          [
            'UID',
            <span key="u" className="row num" style={{ gap: 4 }}>
              {user.uid}
              <CopyButton value={user.uid} label="Copy UID" />
            </span>,
          ],
          [
            'Email',
            <span key="e" className="row" style={{ gap: 6 }}>
              {user.email}{' '}
              {user.emailVerified ? <Badge tone="up">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
            </span>,
          ],
          [
            'Phone',
            user.phone ? (
              <span key="p" className="row" style={{ gap: 6 }}>
                {user.phone}{' '}
                {user.phoneVerified ? <Badge tone="up">Verified</Badge> : <Badge tone="warn">Unverified</Badge>}
              </span>
            ) : (
              '—'
            ),
          ],
          ['Verification (KYC) level', `Level ${user.kycLevel}`],
          ['VIP tier', `VIP ${user.vipTier}`],
          ['Member since', fmtDateTime(user.createdAt)],
        ]}
      />
      <div className="gc-divider" />
      <Section title="Display name" description="Shown in your account menu and internal transfers.">
        <div className="row" style={{ gap: 8 }}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
          <Button
            onClick={run(() => api.users.update({ displayName: name.trim() }), 'Display name updated')}
            disabled={name.trim().length < 2}
          >
            Save
          </Button>
        </div>
      </Section>
      {!user.emailVerified && (
        <Section title="Verify email" description="Required before withdrawals. We send a 6-digit code.">
          <div className="row" style={{ gap: 8 }}>
            {emailSent && (
              <TextInput
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Code"
                inputMode="numeric"
                aria-label="Email code"
              />
            )}
            {emailSent ? (
              <Button
                variant="primary"
                disabled={emailCode.length !== 6}
                onClick={run(() => api.auth.verifyEmail(emailCode), 'Email verified')}
              >
                Verify
              </Button>
            ) : (
              <Button
                onClick={run(
                  () => api.auth.sendEmailVerification(),
                  'Code sent',
                  () => setEmailSent(true),
                )}
              >
                Send code
              </Button>
            )}
          </div>
        </Section>
      )}
      <Section title="Phone number" description="Used for SMS security codes. International format, e.g. +14155550123.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <TextInput
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
            placeholder="+1…"
            aria-label="Phone"
          />
          {phoneSent && (
            <TextInput
              value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Code"
              inputMode="numeric"
              aria-label="SMS code"
            />
          )}
          {phoneSent ? (
            <Button
              variant="primary"
              disabled={phoneCode.length !== 6}
              onClick={run(
                () => api.auth.verifyPhone(phone, phoneCode),
                'Phone verified',
                () => setPhoneSent(false),
              )}
            >
              Verify
            </Button>
          ) : (
            <Button
              disabled={phone.length < 8}
              onClick={run(
                () => api.auth.sendPhoneOtp(phone),
                'Code sent',
                () => setPhoneSent(true),
              )}
            >
              Send code
            </Button>
          )}
        </div>
      </Section>
      <Section
        title="Anti-phishing code"
        description="Included in every email we send, so you can recognise genuine GoCrypto messages. 4-20 letters or digits."
      >
        <div className="row" style={{ gap: 8 }}>
          <TextInput
            value={phish}
            onChange={(e) => setPhish(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 20))}
            placeholder="e.g. Blue42Fox"
            aria-label="Anti-phishing code"
          />
          <Button
            onClick={run(
              () => api.users.update({ antiPhishingCode: phish }),
              'Anti-phishing code saved',
              () => setPhish(''),
            )}
            disabled={phish.length < 4}
          >
            Save
          </Button>
        </div>
      </Section>
    </Card>
  );
}

// ───────────────────────────── security ─────────────────────────────

function SecurityTab() {
  const user = useSession((s) => s.user)!;
  const security = useQuery({ queryKey: ['security'], queryFn: () => api.auth.security() });
  const [modal, setModal] = useState<'password' | 'enable2fa' | 'disable2fa' | 'pin' | null>(null);
  const now = useNow(60_000);
  const s = security.data;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        {s ? (
          <div className="sec-score">
            <div>
              <span className="faint">Security score</span>
              <strong className="num">{s.securityScore}/100</strong>
            </div>
            <Progress
              value={s.securityScore}
              tone={s.securityScore >= 70 ? 'up' : s.securityScore >= 40 ? 'warn' : 'down'}
            />
            {s.withdrawalLockUntil && s.withdrawalLockUntil > now && (
              <Alert tone="warn">
                Withdrawals are locked until {fmtDateTime(s.withdrawalLockUntil)} after a recent security change.
              </Alert>
            )}
          </div>
        ) : (
          <Skeleton height={60} />
        )}
      </Card>
      <Card>
        <Section
          title="Password"
          description={
            s?.passwordChangedAt
              ? `Last changed ${fmtDateTime(s.passwordChangedAt)}`
              : 'Use a unique password of at least 10 characters.'
          }
        >
          <Button onClick={() => setModal('password')}>Change password</Button>
        </Section>
        <Section
          title="Authenticator app (2FA)"
          description="Time-based one-time codes from Google Authenticator, 1Password, Authy… Required for API keys and recommended for withdrawals."
        >
          {user.twoFactorEnabled ? (
            <span className="row" style={{ gap: 8 }}>
              <Badge tone="up">Enabled</Badge>
              <Button variant="ghost" onClick={() => setModal('disable2fa')}>
                Disable
              </Button>
            </span>
          ) : (
            <Button variant="primary" onClick={() => setModal('enable2fa')}>
              Enable 2FA
            </Button>
          )}
        </Section>
        <Section
          title="Security PIN"
          description="6-digit PIN confirming withdrawals and transfers to other users. Locked after repeated wrong attempts."
        >
          <span className="row" style={{ gap: 8 }}>
            {user.hasTradingPin && <Badge tone="up">Set</Badge>}
            <Button onClick={() => setModal('pin')}>{user.hasTradingPin ? 'Change PIN' : 'Set PIN'}</Button>
          </span>
        </Section>
      </Card>
      <LoginHistory />
      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} />}
      {modal === 'enable2fa' && <Enable2faModal onClose={() => setModal(null)} />}
      {modal === 'disable2fa' && <Disable2faModal onClose={() => setModal(null)} />}
      {modal === 'pin' && <PinModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user)!;
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '', totpCode: '' });
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () =>
      api.auth.changePassword({
        currentPassword: f.currentPassword,
        newPassword: f.newPassword,
        totpCode: f.totpCode || undefined,
      }),
    onSuccess: () => {
      toast.success('Password changed', 'Other sessions were signed out. Withdrawals are paused for 24 hours.');
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: f.currentPassword,
      newPassword: f.newPassword,
      totpCode: f.totpCode || undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid input');
    if (f.newPassword !== f.confirm) return setError('Passwords do not match');
    setError(null);
    run.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Change password"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={submit}>
            Update password
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <TextInput
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={f.currentPassword}
          onChange={(e) => setF({ ...f, currentPassword: e.target.value })}
        />
        <TextInput
          label="New password"
          type="password"
          autoComplete="new-password"
          value={f.newPassword}
          onChange={(e) => setF({ ...f, newPassword: e.target.value })}
          hint="10+ characters with upper- and lowercase letters and a number"
        />
        <TextInput
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={f.confirm}
          onChange={(e) => setF({ ...f, confirm: e.target.value })}
        />
        {user.twoFactorEnabled && (
          <TextInput
            label="Authenticator code"
            inputMode="numeric"
            value={f.totpCode}
            onChange={(e) => setF({ ...f, totpCode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          />
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Enable2faModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshUser();
  const toast = useToast();
  const setup = useQuery({
    queryKey: ['2fa-setup'],
    queryFn: () => api.auth.setup2fa(),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enable = useMutation({
    mutationFn: () => api.auth.enable2fa(code),
    onSuccess: async (r) => {
      setBackup(r.backupCodes);
      toast.success('Two-factor authentication enabled');
      await refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={backup ? 'Save your backup codes' : 'Enable two-factor authentication'}
      footer={
        backup ? (
          <Button variant="primary" onClick={onClose}>
            I have saved my codes
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={enable.isPending}
              disabled={code.length !== 6}
              onClick={() => enable.mutate()}
            >
              Enable
            </Button>
          </>
        )
      }
    >
      {backup ? (
        <div className="col" style={{ gap: 12 }}>
          <Alert tone="warn">
            Each code can be used once if you lose access to your authenticator. They will not be shown again.
          </Alert>
          <div className="backup-codes mono">
            {backup.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <span className="row" style={{ gap: 8 }}>
            <CopyButton value={backup.join('\n')} label="Copy backup codes" />
            <span className="faint">Copy all codes</span>
          </span>
        </div>
      ) : setup.isLoading ? (
        <Skeleton height={200} />
      ) : setup.error ? (
        <Alert tone="error">{errorMessage(setup.error)}</Alert>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          <ol className="steps-list">
            <li>Scan the QR code with your authenticator app, or enter the key manually.</li>
            <li>Enter the 6-digit code shown in the app to confirm.</li>
          </ol>
          <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <QrCode value={setup.data!.otpauthUrl} size={156} />
            <div className="col" style={{ gap: 6, minWidth: 0 }}>
              <span className="faint" style={{ fontSize: 12 }}>
                Setup key
              </span>
              <span className="addr-box">
                <code className="mono">{setup.data!.secret}</code>
                <CopyButton value={setup.data!.secret} label="Copy key" />
              </span>
            </div>
          </div>
          <TextInput
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {error && <Alert tone="error">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

function Disable2faModal({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshUser();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.auth.disable2fa(code, password),
    onSuccess: async () => {
      toast.success('Two-factor authentication disabled', 'Withdrawals are paused for 24 hours.');
      await refresh();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Disable two-factor authentication"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={run.isPending}
            disabled={code.length !== 6 || !password}
            onClick={() => run.mutate()}
          >
            Disable 2FA
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Alert tone="warn">Your account will be less secure. Withdrawals will be locked for 24 hours.</Alert>
        <TextInput
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <TextInput
          label="Authenticator code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function PinModal({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user)!;
  const refresh = useRefreshUser();
  const toast = useToast();
  const [f, setF] = useState({ current: '', pin: '', confirm: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => (user.hasTradingPin ? api.auth.changePin(f.current, f.pin) : api.auth.setPin(f.pin, f.password)),
    onSuccess: async () => {
      toast.success(user.hasTradingPin ? 'PIN changed' : 'PIN set');
      await refresh();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    const parsed = pinCode.safeParse(f.pin);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid PIN');
    if (f.pin !== f.confirm) return setError('PINs do not match');
    setError(null);
    run.mutate();
  };
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <Modal
      open
      onClose={onClose}
      title={user.hasTradingPin ? 'Change security PIN' : 'Set security PIN'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={submit}>
            Save PIN
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        {user.hasTradingPin ? (
          <TextInput
            label="Current PIN"
            type="password"
            inputMode="numeric"
            value={f.current}
            onChange={(e) => setF({ ...f, current: digits(e.target.value) })}
            autoComplete="off"
          />
        ) : (
          <TextInput
            label="Account password"
            type="password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            autoComplete="current-password"
          />
        )}
        <TextInput
          label="New PIN (6 digits)"
          type="password"
          inputMode="numeric"
          value={f.pin}
          onChange={(e) => setF({ ...f, pin: digits(e.target.value) })}
          autoComplete="off"
        />
        <TextInput
          label="Confirm PIN"
          type="password"
          inputMode="numeric"
          value={f.confirm}
          onChange={(e) => setF({ ...f, confirm: digits(e.target.value) })}
          autoComplete="off"
        />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

function LoginHistory() {
  const q = useInfiniteQuery({
    queryKey: ['login-history'],
    queryFn: ({ pageParam }) => api.auth.loginHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  return (
    <Card title="Login history" noPadding>
      <DataTable<LoginHistoryDto>
        rows={q.data?.pages.flatMap((p) => p.items)}
        rowKey={(l) => l.id}
        loading={q.isLoading}
        error={q.error}
        empty="No logins recorded"
        columns={[
          { key: 't', header: 'Time', render: (l) => <span className="num muted">{fmtDateTime(l.createdAt)}</span> },
          {
            key: 'r',
            header: 'Result',
            render: (l) =>
              l.success ? (
                <Badge tone="up">Success</Badge>
              ) : (
                <Badge tone="down">{l.reason ? humanize(l.reason) : 'Failed'}</Badge>
              ),
          },
          { key: 'd', header: 'Device', render: (l) => <span>{l.deviceName ?? l.platform ?? '—'}</span> },
          { key: 'i', header: 'IP address', render: (l) => <span className="num">{l.ip ?? '—'}</span> },
        ]}
        footer={
          q.hasNextPage ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
              <Button size="sm" variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : undefined
        }
      />
    </Card>
  );
}

// ───────────────────────────── devices & sessions ─────────────────────────────

function platformIcon(p: string): Parameters<typeof Icon>[0]['name'] {
  return p === 'IOS' || p === 'ANDROID' ? 'smartphone' : p === 'DESKTOP' ? 'monitor' : p === 'API' ? 'key' : 'globe';
}

function DevicesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.auth.sessions() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.auth.devices() });
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (e) => toast.error('Action failed', errorMessage(e)),
  });
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Active sessions"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act.mutate(() =>
                api.auth.revokeOtherSessions().then((r) => toast.success(`Signed out ${r.revoked} other session(s)`)),
              )
            }
          >
            Sign out all other sessions
          </Button>
        }
        noPadding
      >
        <DataTable<SessionDto>
          rows={sessions.data}
          rowKey={(s) => s.id}
          loading={sessions.isLoading}
          error={sessions.error}
          columns={[
            {
              key: 'd',
              header: 'Device',
              render: (s) => (
                <span className="row" style={{ gap: 8 }}>
                  <Icon name={platformIcon(s.platform)} size={16} />
                  <span>{s.deviceName ?? humanize(s.platform)}</span>
                  {s.current && <Badge tone="brand">This device</Badge>}
                </span>
              ),
            },
            { key: 'i', header: 'IP', render: (s) => <span className="num">{s.ip ?? '—'}</span> },
            {
              key: 'c',
              header: 'Signed in',
              render: (s) => <span className="num muted">{fmtDateTime(s.createdAt)}</span>,
            },
            {
              key: 'l',
              header: 'Last active',
              render: (s) => <span className="num muted">{fmtDateTime(s.lastUsedAt)}</span>,
            },
            {
              key: 'x',
              header: '',
              align: 'right',
              render: (s) =>
                s.current ? null : (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.auth.revokeSession(s.id))}>
                    Sign out
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Card title="Devices" noPadding>
        <DataTable<DeviceDto>
          rows={devices.data}
          rowKey={(d) => d.id}
          loading={devices.isLoading}
          error={devices.error}
          columns={[
            {
              key: 'd',
              header: 'Device',
              render: (d) => (
                <span className="row" style={{ gap: 8 }}>
                  <Icon name={platformIcon(d.platform)} size={16} />
                  <span>{d.name ?? d.deviceId.slice(0, 12)}</span>
                  {d.current && <Badge tone="brand">This device</Badge>}
                </span>
              ),
            },
            { key: 'p', header: 'Platform', render: (d) => humanize(d.platform) },
            { key: 'i', header: 'Last IP', render: (d) => <span className="num">{d.lastIp ?? '—'}</span> },
            {
              key: 's',
              header: 'Last seen',
              render: (d) => <span className="num muted">{fmtDateTime(d.lastSeenAt)}</span>,
            },
            {
              key: 't',
              header: 'Trusted',
              render: (d) => (
                <Switch
                  checked={d.trusted}
                  label={`Trust ${d.name ?? 'device'}`}
                  onChange={(v) => act.mutate(() => api.auth.updateDevice(d.id, { trusted: v }))}
                />
              ),
            },
            {
              key: 'x',
              header: '',
              align: 'right',
              render: (d) =>
                d.current ? null : (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api.auth.removeDevice(d.id))}>
                    Remove
                  </Button>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

// ───────────────────────────── API keys ─────────────────────────────

function ApiKeysTab() {
  const user = useSession((s) => s.user)!;
  const qc = useQueryClient();
  const toast = useToast();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.users.apiKeys() });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreatedDto | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => api.users.revokeApiKey(id),
    onSuccess: () => {
      toast.success('API key revoked');
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (e) => toast.error('Revoke failed', errorMessage(e)),
  });
  return (
    <div className="col" style={{ gap: 16 }}>
      <Alert tone="info">
        API requests are signed with HMAC-SHA256 (headers <code>X-GC-APIKEY</code>, <code>X-GC-TIMESTAMP</code>,{' '}
        <code>X-GC-SIGNATURE</code>). Never share your secret; restrict keys by IP whenever possible.
      </Alert>
      <Card
        title="API keys"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon="plus"
            onClick={() => setCreating(true)}
            disabled={!user.twoFactorEnabled}
          >
            Create API key
          </Button>
        }
        noPadding
      >
        {!user.twoFactorEnabled && (
          <div style={{ padding: 12 }}>
            <Alert tone="warn">Enable two-factor authentication before creating API keys.</Alert>
          </div>
        )}
        <DataTable
          rows={keys.data}
          rowKey={(k) => k.id}
          loading={keys.isLoading}
          error={keys.error}
          empty="No API keys"
          columns={[
            { key: 'l', header: 'Label', render: (k) => <strong>{k.label}</strong> },
            {
              key: 'k',
              header: 'Key',
              render: (k) => (
                <span className="row num" style={{ gap: 4 }}>
                  {k.keyId}
                  <CopyButton value={k.keyId} label="Copy key" />
                </span>
              ),
            },
            {
              key: 'p',
              header: 'Permissions',
              render: (k) => (
                <span className="row" style={{ gap: 4 }}>
                  {k.permissions.map((p) => (
                    <Badge key={p} tone={p === 'WITHDRAW' ? 'warn' : p === 'TRADE' ? 'brand' : undefined}>
                      {p}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'i',
              header: 'IP allow-list',
              render: (k) => (
                <span className="faint">{k.ipWhitelist.length ? k.ipWhitelist.join(', ') : 'Unrestricted'}</span>
              ),
            },
            {
              key: 'u',
              header: 'Last used',
              render: (k) => <span className="num muted">{fmtDateTime(k.lastUsedAt)}</span>,
            },
            {
              key: 'e',
              header: 'Expires',
              render: (k) => <span className="num muted">{k.expiresAt ? fmtDateTime(k.expiresAt) : 'Never'}</span>,
            },
            {
              key: 'x',
              header: '',
              align: 'right',
              render: (k) => (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={revoke.isPending && revoke.variables === k.id}
                  onClick={() => revoke.mutate(k.id)}
                >
                  Revoke
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {creating && (
        <CreateApiKeyModal
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
            void qc.invalidateQueries({ queryKey: ['api-keys'] });
          }}
        />
      )}
      {created && (
        <Modal
          open
          onClose={() => setCreated(null)}
          title="API key created"
          footer={
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          }
        >
          <div className="col" style={{ gap: 12 }}>
            <Alert tone="warn">Copy the secret now — for your security it will never be shown again.</Alert>
            <div>
              <span className="faint" style={{ fontSize: 12 }}>
                API key
              </span>
              <div className="addr-box">
                <code className="mono">{created.keyId}</code>
                <CopyButton value={created.keyId} label="Copy key" />
              </div>
            </div>
            <div>
              <span className="faint" style={{ fontSize: 12 }}>
                Secret
              </span>
              <div className="addr-box">
                <code className="mono">{created.secret}</code>
                <CopyButton value={created.secret} label="Copy secret" />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateApiKeyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (k: ApiKeyCreatedDto) => void }) {
  const [label, setLabel] = useState('');
  const [perms, setPerms] = useState<ApiKeyPermission[]>(['READ']);
  const [ips, setIps] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () =>
      api.users.createApiKey({
        label: label.trim(),
        permissions: perms,
        ipWhitelist: ips
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        totpCode: totp,
      }),
    onSuccess: onCreated,
    onError: (e) => setError(errorMessage(e)),
  });
  const toggle = (p: ApiKeyPermission, on: boolean) =>
    setPerms((xs) => (on ? [...new Set([...xs, p])] : xs.filter((x) => x !== p)));
  return (
    <Modal
      open
      onClose={onClose}
      title="Create API key"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={run.isPending}
            disabled={!label.trim() || perms.length === 0 || totp.length !== 6}
            onClick={() => run.mutate()}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <TextInput
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 50))}
          placeholder="e.g. Trading bot"
        />
        <div className="col" style={{ gap: 8 }}>
          <span className="gc-field__label">Permissions</span>
          {API_KEY_PERMISSIONS.map((p) => (
            <Checkbox key={p} checked={perms.includes(p)} onChange={(v) => toggle(p, v)}>
              <strong>{p}</strong>{' '}
              <span className="faint">
                —{' '}
                {p === 'READ'
                  ? 'balances, orders and history'
                  : p === 'TRADE'
                    ? 'place and cancel orders'
                    : 'request withdrawals (requires an IP allow-list)'}
              </span>
            </Checkbox>
          ))}
        </div>
        <TextInput
          label="IP allow-list (optional)"
          value={ips}
          onChange={(e) => setIps(e.target.value)}
          placeholder="203.0.113.10, 2001:db8::1"
          hint="Comma or space separated. Strongly recommended."
        />
        <TextInput
          label="Authenticator code"
          inputMode="numeric"
          value={totp}
          onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ───────────────────────────── preferences ─────────────────────────────

function PreferencesTab() {
  const prefs = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['user-settings'], queryFn: () => api.users.settings() });
  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.users.updateSettings>[0]) => api.users.updateSettings(body),
    onSuccess: (s) => qc.setQueryData(['user-settings'], s),
    onError: (e) => toast.error('Not saved', errorMessage(e)),
  });
  const setPref = (cat: NotificationCategory, ch: NotificationChannel, v: boolean) => {
    const current = settings.data?.notificationPrefs;
    if (!current) return;
    const next: NotificationPrefs = { ...current, [cat]: { ...current[cat], [ch]: v } };
    save.mutate({ notificationPrefs: next });
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Display">
        <Section title="Theme" description="Dark is optimised for long trading sessions.">
          <Segmented
            value={prefs.theme}
            onChange={(t) => {
              prefs.setTheme(t);
              save.mutate({ theme: t });
            }}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Section>
        <Section
          title="Pro trading layout"
          description="Resizable multi-panel workspace on wide screens (always available in the desktop app)."
        >
          <Switch checked={prefs.proLayout} onChange={prefs.setProLayout} label="Pro layout" />
        </Section>
        <Section title="Hide small balances" description="Hide wallet balances worth less than $1.">
          <Switch checked={prefs.hideSmallBalances} onChange={prefs.setHideSmall} label="Hide small balances" />
        </Section>
      </Card>
      <Card title="Trading">
        <Section title="Order confirmations" description="Show a summary dialog before every order is sent.">
          <Switch
            checked={prefs.confirmOrders}
            onChange={(v) => {
              prefs.setConfirmOrders(v);
              save.mutate({ confirmOrders: v });
            }}
            label="Confirm orders"
          />
        </Section>
      </Card>
      <Card title="Notifications" noPadding>
        {settings.isLoading || !settings.data ? (
          <div style={{ padding: 16 }}>
            <Skeleton height={140} />
          </div>
        ) : (
          <table className="gc-table pref-matrix">
            <thead>
              <tr>
                <th>Category</th>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th key={c} className="right">
                    {c === 'IN_APP' ? 'In-app' : humanize(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((cat) => (
                <tr key={cat}>
                  <td>
                    <strong>{humanize(cat)}</strong>
                    {cat === 'SECURITY' && (
                      <div className="faint" style={{ fontSize: 11 }}>
                        Security emails are always sent.
                      </div>
                    )}
                  </td>
                  {NOTIFICATION_CHANNELS.map((ch) => (
                    <td key={ch} className="right">
                      <Switch
                        checked={settings.data!.notificationPrefs[cat]?.[ch] ?? true}
                        disabled={cat === 'SECURITY' && ch === 'EMAIL'}
                        onChange={(v) => setPref(cat, ch, v)}
                        label={`${cat} ${ch}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
