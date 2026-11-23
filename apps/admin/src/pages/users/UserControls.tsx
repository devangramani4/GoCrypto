import { ACCOUNT_TYPES, type AccountType, type AdminUserDetailDto, USER_ROLES, type UserRole } from '@gocrypto/shared-types';
import { Alert, Button, Select, Switch, TextInput } from '@gocrypto/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { ActionDialog } from '../../components/ActionDialog';
import { AppModal } from '../../components/AppModal';
import { GuardedButton } from '../../components/GuardedButton';
import { Panel } from '../../components/PageHeader';
import { useApi } from '../../lib/ApiContext';
import { IS_LIVE_ENV } from '../../lib/env';
import { errorMessage } from '../../lib/errors';
import { useOpenEffect } from '../../lib/hooks';
import { dec, fmtAmount, fmtSigned } from '../../lib/format';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { useSession } from '../../lib/session';
import { humanize } from '../../lib/status';
import { useAction } from '../../lib/useAction';

type DialogKind = 'freeze' | 'unfreeze' | 'disable' | 'trading' | 'reset' | 'revoke' | 'edit' | 'adjust';

function userKeys(id: string) {
  return [qk.user(id), qk.usersAll, qk.dashboard];
}

function ControlRow({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <div className="adm-control-row">
      <div className="adm-control-row__text">
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <div className="adm-control-row__actions">{children}</div>
    </div>
  );
}

export function UserControls({ user }: { user: AdminUserDetailDto }) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const close = () => setDialog(null);
  return (
    <>
      <Panel title="Account controls">
        <div className="adm-panel__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ControlRow
            title="Account status"
            description={user.status === 'ACTIVE' ? 'Active — full access' : user.status === 'FROZEN' ? 'Frozen — no trading or withdrawals' : 'Disabled — sign-in blocked'}
          >
            {user.status === 'ACTIVE' ? (
              <GuardedButton perm="users.freeze" size="sm" onClick={() => setDialog('freeze')}>
                Freeze
              </GuardedButton>
            ) : (
              <GuardedButton perm="users.freeze" size="sm" onClick={() => setDialog('unfreeze')}>
                {user.status === 'DISABLED' ? 'Reactivate' : 'Unfreeze'}
              </GuardedButton>
            )}
            {user.status !== 'DISABLED' && (
              <GuardedButton perm="users.freeze" size="sm" variant="danger" onClick={() => setDialog('disable')}>
                Disable
              </GuardedButton>
            )}
          </ControlRow>
          <ControlRow title="Trading" description={user.tradingEnabled ? 'Order placement allowed' : 'Order placement blocked'}>
            <GuardedButton perm="users.trading" size="sm" variant={user.tradingEnabled ? 'danger' : 'default'} onClick={() => setDialog('trading')}>
              {user.tradingEnabled ? 'Disable trading' : 'Enable trading'}
            </GuardedButton>
          </ControlRow>
          <ControlRow title="Security" description="2FA / PIN reset, sessions">
            <GuardedButton perm="users.security" size="sm" onClick={() => setDialog('reset')}>
              Reset…
            </GuardedButton>
            <GuardedButton perm="users.security" size="sm" onClick={() => setDialog('revoke')}>
              Revoke sessions
            </GuardedButton>
          </ControlRow>
          <ControlRow title="Account settings" description="Role, VIP tier, KYC level, withdrawals">
            <GuardedButton perm="users.write" size="sm" icon="pen" onClick={() => setDialog('edit')}>
              Edit
            </GuardedButton>
          </ControlRow>
          <ControlRow title="Balance adjustment" description="Sandbox only · fully ledgered">
            <GuardedButton perm="wallet.adjust" size="sm" disabled={IS_LIVE_ENV} onClick={() => setDialog('adjust')}>
              Adjust…
            </GuardedButton>
          </ControlRow>
        </div>
      </Panel>

      <StatusDialog user={user} kind={dialog === 'freeze' || dialog === 'unfreeze' || dialog === 'disable' ? dialog : null} onClose={close} />
      <TradingDialog user={user} open={dialog === 'trading'} onClose={close} />
      <ResetSecurityDialog user={user} open={dialog === 'reset'} onClose={close} />
      <RevokeSessionsDialog user={user} open={dialog === 'revoke'} onClose={close} />
      <EditAccountDialog user={user} open={dialog === 'edit'} onClose={close} />
      <AdjustBalanceDialog user={user} open={dialog === 'adjust'} onClose={close} />
    </>
  );
}

// ───────────────────────────── status ─────────────────────────────

function StatusDialog({ user, kind, onClose }: { user: AdminUserDetailDto; kind: 'freeze' | 'unfreeze' | 'disable' | null; onClose: () => void }) {
  const client = useApi();
  const action = useAction<{ kind: 'freeze' | 'unfreeze' | 'disable'; reason: string }>({
    mutationFn: ({ kind: k, reason }) => (k === 'freeze' ? client.admin.freeze(user.id, reason) : k === 'unfreeze' ? client.admin.unfreeze(user.id, reason) : client.admin.disable(user.id, reason)),
    success: (_d, v) => (v.kind === 'freeze' ? 'Account frozen' : v.kind === 'disable' ? 'Account disabled' : 'Account reactivated'),
    invalidate: userKeys(user.id),
    errorToast: false,
    onSuccess: onClose,
  });
  const copy = {
    freeze: {
      title: 'Freeze account',
      confirm: 'Freeze account',
      description: 'Blocks trading and withdrawals and signs the user out of every session. They can still sign in to view the account. Open orders stay on the book.',
    },
    unfreeze: {
      title: user.status === 'DISABLED' ? 'Reactivate account' : 'Unfreeze account',
      confirm: user.status === 'DISABLED' ? 'Reactivate' : 'Unfreeze',
      description: 'Restores normal access (status becomes Active). Trading and withdrawal flags are unchanged.',
    },
    disable: {
      title: 'Disable account',
      confirm: 'Disable account',
      description: 'Blocks sign-in, trading and withdrawals and revokes all sessions. Use for closed or compromised accounts.',
    },
  };
  const c = kind ? copy[kind] : copy.freeze;
  return (
    <ActionDialog
      open={kind !== null}
      title={c.title}
      confirmLabel={c.confirm}
      tone={kind === 'unfreeze' ? 'primary' : 'danger'}
      description={
        <>
          <strong style={{ color: 'var(--c-text)' }}>{user.email}</strong> — {c.description}
        </>
      }
      reason={{ required: true }}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(reason) => kind && action.mutate({ kind, reason })}
      onClose={() => {
        action.reset();
        onClose();
      }}
    />
  );
}

function TradingDialog({ user, open, onClose }: { user: AdminUserDetailDto; open: boolean; onClose: () => void }) {
  const client = useApi();
  const enable = !user.tradingEnabled;
  const action = useAction<string>({
    mutationFn: (reason) => client.admin.setTrading(user.id, enable, reason),
    success: enable ? 'Trading enabled' : 'Trading disabled',
    invalidate: [...userKeys(user.id), qk.ordersAll],
    errorToast: false,
    onSuccess: onClose,
  });
  return (
    <ActionDialog
      open={open}
      title={enable ? 'Enable trading' : 'Disable trading'}
      confirmLabel={enable ? 'Enable trading' : 'Disable trading'}
      tone={enable ? 'primary' : 'danger'}
      description={
        enable
          ? 'The user will be able to place orders again (subject to account status).'
          : `Blocks order placement for ${user.email} and cancels all of their open orders (${user.openOrders} open).`
      }
      reason={{ required: true }}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(reason) => action.mutate(reason)}
      onClose={() => {
        action.reset();
        onClose();
      }}
    />
  );
}

// ───────────────────────────── security ─────────────────────────────

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="adm-switch-row">
      <span className="adm-switch-row__label">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function ResetSecurityDialog({ user, open, onClose }: { user: AdminUserDetailDto; open: boolean; onClose: () => void }) {
  const client = useApi();
  const [opts, setOpts] = useState({ resetTwoFactor: true, resetPin: true, revokeSessions: true });
  useOpenEffect(open, () => setOpts({ resetTwoFactor: user.twoFactorEnabled, resetPin: user.hasTradingPin, revokeSessions: true }));
  const action = useAction<string>({
    mutationFn: (reason) => client.admin.resetSecurity(user.id, { reason, ...opts }),
    success: 'Security reset — withdrawals paused for 24h',
    invalidate: userKeys(user.id),
    errorToast: false,
    onSuccess: onClose,
  });
  return (
    <ActionDialog
      open={open}
      title="Reset account security"
      confirmLabel="Reset security"
      tone="danger"
      description="Always clears failed sign-in lockouts and pauses withdrawals for 24 hours. The user is notified."
      reason={{ required: true, placeholder: 'e.g. Lost authenticator — identity verified via ticket #1234' }}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(reason) => action.mutate(reason)}
      onClose={() => {
        action.reset();
        onClose();
      }}
    >
      <div>
        <SwitchRow
          label="Reset two-factor authentication"
          hint={user.twoFactorEnabled ? 'Removes the authenticator and backup codes' : '2FA is not enabled'}
          checked={opts.resetTwoFactor}
          onChange={(v) => setOpts((o) => ({ ...o, resetTwoFactor: v }))}
        />
        <SwitchRow
          label="Reset trading PIN"
          hint={user.hasTradingPin ? 'User must set a new PIN' : 'No PIN set'}
          checked={opts.resetPin}
          onChange={(v) => setOpts((o) => ({ ...o, resetPin: v }))}
        />
        <SwitchRow
          label="Revoke all sessions"
          hint={`${user.sessions.length} active session(s)`}
          checked={opts.revokeSessions}
          onChange={(v) => setOpts((o) => ({ ...o, revokeSessions: v }))}
        />
      </div>
    </ActionDialog>
  );
}

function RevokeSessionsDialog({ user, open, onClose }: { user: AdminUserDetailDto; open: boolean; onClose: () => void }) {
  const client = useApi();
  const action = useAction<void, { revoked: number }>({
    mutationFn: () => client.admin.revokeSessions(user.id),
    success: (d) => `Revoked ${d.revoked} session${d.revoked === 1 ? '' : 's'}`,
    invalidate: userKeys(user.id),
    errorToast: false,
    onSuccess: onClose,
  });
  return (
    <ActionDialog
      open={open}
      title="Revoke all sessions"
      confirmLabel="Revoke sessions"
      tone="danger"
      description={`Signs ${user.email} out everywhere (${user.sessions.length} active session${user.sessions.length === 1 ? '' : 's'}). They can sign in again unless the account is disabled.`}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={() => action.mutate()}
      onClose={() => {
        action.reset();
        onClose();
      }}
    />
  );
}

// ───────────────────────────── edit ─────────────────────────────

interface EditForm {
  displayName: string;
  role: UserRole;
  vipTier: string;
  kycLevel: string;
  withdrawalsEnabled: boolean;
}

function editInitial(user: AdminUserDetailDto): EditForm {
  return {
    displayName: user.displayName ?? '',
    role: user.role,
    vipTier: String(user.vipTier),
    kycLevel: String(user.kycLevel),
    withdrawalsEnabled: user.withdrawalsEnabled,
  };
}

const VIP_OPTIONS = Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: `VIP ${i}` }));
const KYC_OPTIONS = [
  { value: '0', label: 'Level 0 — unverified' },
  { value: '1', label: 'Level 1 — basic' },
  { value: '2', label: 'Level 2 — verified' },
  { value: '3', label: 'Level 3 — enhanced' },
];

function EditAccountDialog({ user, open, onClose }: { user: AdminUserDetailDto; open: boolean; onClose: () => void }) {
  const client = useApi();
  const qc = useQueryClient();
  const can = useCan();
  const admin = useSession((s) => s.admin);
  const formId = useId();
  const [form, setForm] = useState<EditForm>(() => editInitial(user));
  const [submitted, setSubmitted] = useState(false);

  useOpenEffect(open, () => {
    setForm(editInitial(user));
    setSubmitted(false);
  });

  const canRoles = can('users.roles');
  const isSuper = admin?.role === 'SUPER_ADMIN';
  const roleOptions = USER_ROLES.filter((r) => r !== 'SUPER_ADMIN' || isSuper || user.role === 'SUPER_ADMIN').map((r) => ({ value: r, label: humanize(r) }));

  const patch: Record<string, unknown> = {};
  const name = form.displayName.trim();
  if (name !== (user.displayName ?? '') && name) patch.displayName = name;
  if (form.role !== user.role) patch.role = form.role;
  if (Number(form.vipTier) !== user.vipTier) patch.vipTier = Number(form.vipTier);
  if (Number(form.kycLevel) !== user.kycLevel) patch.kycLevel = Number(form.kycLevel);
  if (form.withdrawalsEnabled !== user.withdrawalsEnabled) patch.withdrawalsEnabled = form.withdrawalsEnabled;

  let nameError: string | null = null;
  if (!name && user.displayName) nameError = 'A display name cannot be removed, only changed';
  else if (name && (name.length < 2 || name.length > 50)) nameError = 'Display name must be 2–50 characters';

  const action = useAction<Record<string, unknown>, AdminUserDetailDto>({
    mutationFn: (body) => client.admin.updateUser(user.id, body),
    success: 'Account updated',
    invalidate: [qk.usersAll],
    errorToast: false,
    onSuccess: (data) => {
      qc.setQueryData(qk.user(user.id), data);
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (nameError || !Object.keys(patch).length) return;
    action.mutate(patch);
  };

  const roleChanged = form.role !== user.role;
  const grantsStaff = roleChanged && user.role === 'USER';
  const revokesStaff = roleChanged && form.role === 'USER';
  const self = admin?.userId === user.id;

  return (
    <AppModal
      open={open}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      title="Edit account"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={action.isPending} disabled={!Object.keys(patch).length}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-form-grid" onSubmit={submit} noValidate>
        <div className="adm-span-all">
          <TextInput label="Display name" value={form.displayName} error={submitted ? nameError : null} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
        </div>
        <Select label="VIP tier" value={form.vipTier} options={VIP_OPTIONS} onChange={(e) => setForm((f) => ({ ...f, vipTier: e.target.value }))} />
        <Select label="KYC level" value={form.kycLevel} options={KYC_OPTIONS} onChange={(e) => setForm((f) => ({ ...f, kycLevel: e.target.value }))} />
        <div className="adm-span-all">
          <Select
            label={canRoles ? 'Role' : 'Role (requires users.roles)'}
            value={form.role}
            options={roleOptions}
            disabled={!canRoles}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
          />
        </div>
        <div className="adm-span-all">
          <SwitchRow
            label="Withdrawals enabled"
            hint="When off, the user cannot request withdrawals"
            checked={form.withdrawalsEnabled}
            onChange={(v) => setForm((f) => ({ ...f, withdrawalsEnabled: v }))}
          />
        </div>
        {roleChanged && (
          <div className="adm-span-all">
            <Alert tone={self || form.role === 'SUPER_ADMIN' ? 'error' : 'warn'}>
              {self
                ? 'You are changing your own role — you may lose access to this console.'
                : grantsStaff
                  ? `Grants back-office access with the ${humanize(form.role)} permission set.`
                  : revokesStaff
                    ? 'Removes all back-office access from this account.'
                    : `Changes back-office permissions to the ${humanize(form.role)} role.`}
            </Alert>
          </div>
        )}
        {action.error ? (
          <div className="adm-span-all">
            <Alert tone="error">{errorMessage(action.error)}</Alert>
          </div>
        ) : null}
      </form>
    </AppModal>
  );
}

// ───────────────────────────── sandbox adjustment ─────────────────────────────

const SIGNED_DECIMAL = /^-?\d+(\.\d+)?$/;

function AdjustBalanceDialog({ user, open, onClose }: { user: AdminUserDetailDto; open: boolean; onClose: () => void }) {
  const client = useApi();
  const assets = useQuery({ queryKey: qk.assets, queryFn: () => client.assets.list(), enabled: open, staleTime: 5 * 60_000 });
  const [asset, setAsset] = useState('USDT');
  const [account, setAccount] = useState<AccountType>('SPOT');
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);

  useOpenEffect(open, () => {
    setAmount('');
    setTouched(false);
  });

  const value = amount.trim();
  const parsed = SIGNED_DECIMAL.test(value) ? dec(value) : null;
  const amountError = !value ? 'Enter an amount' : !parsed ? 'Use a plain decimal, e.g. 100 or -2.5' : parsed.isZero() ? 'Amount cannot be zero' : null;
  const current = user.balances.find((b) => b.asset === asset && b.account === account);
  const overdraw = parsed && parsed.isNegative() && dec(current?.available ?? '0')?.lt(parsed.abs());

  const action = useAction<{ asset: string; account: AccountType; amount: string; reason: string }>({
    mutationFn: (body) => client.admin.adjustBalance(user.id, body),
    success: (_d, v) => `Balance adjusted: ${fmtSigned(v.amount)} ${v.asset} (${v.account})`,
    invalidate: [qk.user(user.id)],
    errorToast: false,
    onSuccess: onClose,
  });

  const assetOptions = (assets.data?.map((a) => a.symbol) ?? [asset]).map((s) => ({ value: s, label: s }));

  return (
    <ActionDialog
      open={open}
      title="Adjust balance (sandbox)"
      confirmLabel={parsed && !amountError ? `${parsed.isNegative() ? 'Debit' : 'Credit'} ${fmtAmount(parsed.abs().toFixed())} ${asset}` : 'Apply adjustment'}
      tone={parsed?.isNegative() ? 'danger' : 'primary'}
      description="Creates an ADJUSTMENT ledger entry on the user's wallet. Available only while the platform runs in sandbox mode."
      reason={{ required: true, placeholder: 'e.g. Test funding for QA scenario' }}
      confirmDisabled={touched && Boolean(amountError)}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(reason) => {
        setTouched(true);
        if (amountError || !parsed) return;
        action.mutate({ asset, account, amount: value, reason });
      }}
      onClose={() => {
        action.reset();
        onClose();
      }}
    >
      <div className="adm-form-grid">
        <Select label="Asset" value={asset} options={assetOptions} onChange={(e) => setAsset(e.target.value)} />
        <Select label="Account" value={account} options={ACCOUNT_TYPES.map((a) => ({ value: a, label: humanize(a) }))} onChange={(e) => setAccount(e.target.value as AccountType)} />
        <div className="adm-span-all">
          <TextInput
            label="Amount"
            inputMode="decimal"
            placeholder="100 to credit, -100 to debit"
            value={amount}
            suffix={asset}
            error={touched ? amountError : null}
            hint={`Current available: ${fmtAmount(current?.available ?? '0')} ${asset}`}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </div>
        {overdraw && (
          <div className="adm-span-all">
            <Alert tone="warn">The debit exceeds the available balance and will be rejected.</Alert>
          </div>
        )}
      </div>
    </ActionDialog>
  );
}
