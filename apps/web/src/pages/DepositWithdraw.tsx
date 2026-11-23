import { randomId } from '@gocrypto/api-client';
import type { AssetDto, NetworkDto } from '@gocrypto/shared-types';
import { D, formatUsd } from '@gocrypto/trading-utils';
import { Alert, Button, Card, Checkbox, Icon, KeyValue, Modal, Skeleton, TextInput, cx, useToast } from '@gocrypto/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AssetIcon, CopyButton, QrCode } from '../components/common';
import { DecimalInput } from '../components/trading/controls';
import { api, errorMessage } from '../lib/api';
import { formatNumber, isPositive } from '../lib/format';
import { useAssets, useAuthed, useSystemStatus } from '../lib/hooks';
import { useSession } from '../stores/session';
import { DepositHistory, WithdrawalHistory } from './WalletPage';

function AssetPicker({ assets, value, onChange, filter }: { assets: AssetDto[]; value: string; onChange: (a: string) => void; filter: (a: AssetDto) => boolean }) {
  const [q, setQ] = useState('');
  const list = assets.filter(filter).filter((a) => !q || a.symbol.includes(q.toUpperCase()) || a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="asset-picker">
      <div className="mlist__search">
        <Icon name="search" size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coin" aria-label="Search coin" />
      </div>
      <div className="asset-picker__grid">
        {list.map((a) => (
          <button key={a.symbol} type="button" className={cx('asset-chip', value === a.symbol && 'on')} onClick={() => onChange(a.symbol)} aria-pressed={value === a.symbol}>
            <AssetIcon asset={a.symbol} size={22} />
            <span className="col" style={{ gap: 0, alignItems: 'flex-start' }}>
              <strong>{a.symbol}</strong>
              <span className="faint" style={{ fontSize: 11 }}>
                {a.name}
              </span>
            </span>
          </button>
        ))}
        {list.length === 0 && <span className="faint">No matching coins</span>}
      </div>
    </div>
  );
}

function NetworkPicker({ networks, value, onChange, kind }: { networks: NetworkDto[]; value: string | null; onChange: (n: string) => void; kind: 'deposit' | 'withdraw' }) {
  return (
    <div className="net-picker" role="radiogroup" aria-label="Network">
      {networks.map((n) => {
        const enabled = kind === 'deposit' ? n.depositEnabled : n.withdrawEnabled;
        return (
          <button key={n.code} type="button" role="radio" aria-checked={value === n.code} disabled={!enabled} className={cx('net-opt', value === n.code && 'on')} onClick={() => onChange(n.code)}>
            <span className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{n.code}</strong>
              {!enabled && <span className="gc-badge gc-badge--down">Suspended</span>}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {n.name}
            </span>
            <span className="faint" style={{ fontSize: 11 }}>
              {kind === 'deposit' ? `${n.confirmations} confirmations · min ${formatNumber(n.minDeposit, 8, { trim: true })}` : `Fee ${formatNumber(n.withdrawalFee, 8, { trim: true })} · min ${formatNumber(n.minWithdrawal, 8, { trim: true })}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className={cx('step', done && 'done')}>
      <header className="step__head">
        <span className="step__num">{done ? <Icon name="check" size={13} /> : n}</span>
        <h3>{title}</h3>
      </header>
      <div className="step__body">{children}</div>
    </section>
  );
}

// ───────────────────────────── deposit ─────────────────────────────

export function DepositPage() {
  const [params, setParams] = useSearchParams();
  const { data: assets, isLoading } = useAssets();
  const { data: status } = useSystemStatus();
  const asset = params.get('asset')?.toUpperCase() ?? 'USDT';
  const assetDto = assets?.find((a) => a.symbol === asset);
  const networks = useMemo(() => assetDto?.networks ?? [], [assetDto]);
  const [network, setNetwork] = useState<string | null>(null);
  useEffect(() => {
    const first = networks.find((n) => n.depositEnabled);
    setNetwork((cur) => (cur && networks.some((n) => n.code === cur && n.depositEnabled) ? cur : (first?.code ?? null)));
  }, [asset, networks]);
  const net = networks.find((n) => n.code === network);
  const address = useQuery({ queryKey: ['deposit-address', asset, network], queryFn: () => api.wallet.depositAddress(asset, network!), enabled: Boolean(network && net?.depositEnabled), staleTime: Infinity });

  return (
    <div className="page page--narrow-wide">
      <div className="page__head">
        <div>
          <Link to="/wallet" className="faint">
            ← Wallet
          </Link>
          <h1>Deposit crypto</h1>
        </div>
      </div>
      <div className="flow-grid">
        <Card className="flow">
          <Step n={1} title="Select coin" done={Boolean(assetDto)}>
            {isLoading ? <Skeleton height={80} /> : <AssetPicker assets={assets ?? []} value={asset} onChange={(a) => setParams({ asset: a }, { replace: true })} filter={(a) => a.depositEnabled} />}
          </Step>
          <Step n={2} title="Select network" done={Boolean(net)}>
            {networks.length ? <NetworkPicker networks={networks} value={network} onChange={setNetwork} kind="deposit" /> : <span className="faint">Select a coin first</span>}
            {networks.length > 1 && <Alert tone="warn">Make sure the network matches the one used by the sending platform, or the funds may be lost.</Alert>}
          </Step>
          <Step n={3} title="Deposit address">
            {!net ? (
              <span className="faint">Select a network</span>
            ) : address.isLoading ? (
              <Skeleton height={170} />
            ) : address.error ? (
              <Alert tone="error">{errorMessage(address.error)}</Alert>
            ) : address.data ? (
              <div className="deposit-addr">
                <QrCode value={address.data.address} />
                <div className="col" style={{ gap: 10, minWidth: 0, flex: 1 }}>
                  <div>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {asset} address ({net.code})
                    </span>
                    <div className="addr-box">
                      <code className="mono">{address.data.address}</code>
                      <CopyButton value={address.data.address} label="Copy address" />
                    </div>
                  </div>
                  {address.data.memo && (
                    <div>
                      <span className="faint" style={{ fontSize: 12 }}>
                        Memo / tag (required)
                      </span>
                      <div className="addr-box">
                        <code className="mono">{address.data.memo}</code>
                        <CopyButton value={address.data.memo} label="Copy memo" />
                      </div>
                      <Alert tone="warn">Both the address and the memo are required, otherwise your deposit cannot be credited.</Alert>
                    </div>
                  )}
                  <KeyValue
                    items={[
                      ['Minimum deposit', `${formatNumber(net.minDeposit, 8, { trim: true })} ${asset}`],
                      ['Credited after', `${net.confirmations} network confirmations`],
                      ['Send only', `${asset} via ${net.name}`],
                    ]}
                  />
                </div>
              </div>
            ) : null}
          </Step>
          {status?.simulatedDeposits && net && address.data && <SimulateDeposit asset={asset} network={net} />}
        </Card>
        <Card title="FAQ" className="flow-aside">
          <ul className="faq">
            <li>
              <strong>When will my deposit arrive?</strong>
              <span className="muted">After the required number of network confirmations. Progress is shown in the history below.</span>
            </li>
            <li>
              <strong>Sent to the wrong network?</strong>
              <span className="muted">Deposits sent over an unsupported network or without a required memo may not be recoverable.</span>
            </li>
            <li>
              <strong>Sandbox mode</strong>
              <span className="muted">Addresses are generated by the sandbox custody provider. Use the simulator to credit test funds.</span>
            </li>
          </ul>
        </Card>
      </div>
      <Card title="Recent deposits" noPadding>
        <DepositHistory />
      </Card>
    </div>
  );
}

function SimulateDeposit({ asset, network }: { asset: string; network: NetworkDto }) {
  const [amount, setAmount] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.wallet.simulateDeposit({ asset, network: network.code, amount }),
    onSuccess: (d) => {
      toast.success('Simulated deposit detected', `${formatNumber(d.amount, 8, { trim: true })} ${d.asset} — waiting for ${d.requiredConfirmations} confirmations`);
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (e) => toast.error('Simulation failed', errorMessage(e)),
  });
  const tooSmall = isPositive(amount) && D(amount).lt(network.minDeposit);
  return (
    <div className="simulate">
      <div className="row" style={{ gap: 8 }}>
        <Icon name="bolt" size={15} />
        <strong>Sandbox deposit simulator</strong>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Creates an on-chain style deposit to your address. It is confirmed by the deposit worker like a real transfer.
      </p>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <DecimalInput label="Amount" unit={asset} value={amount} onChange={setAmount} decimals={8} error={tooSmall ? `Minimum ${network.minDeposit}` : null} />
        </div>
        <Button variant="primary" loading={run.isPending} disabled={!isPositive(amount) || tooSmall} onClick={() => run.mutate()} style={{ height: 40 }}>
          Simulate
        </Button>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {(asset === 'USDT' || asset === 'USDC' ? ['1000', '10000', '50000'] : asset === 'BTC' ? ['0.1', '0.5', '1'] : ['1', '5', '25']).map((v) => (
          <Button key={v} size="sm" variant="ghost" onClick={() => setAmount(v)}>
            {v} {asset}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── withdraw ─────────────────────────────

export function WithdrawPage() {
  const authed = useAuthed();
  const user = useSession((s) => s.user);
  const [params, setParams] = useSearchParams();
  const { data: assets, isLoading } = useAssets();
  const asset = params.get('asset')?.toUpperCase() ?? 'USDT';
  const assetDto = assets?.find((a) => a.symbol === asset);
  const networks = useMemo(() => assetDto?.networks ?? [], [assetDto]);
  const [network, setNetwork] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [save, setSave] = useState(false);
  const [label, setLabel] = useState('');
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const first = networks.find((n) => n.withdrawEnabled);
    setNetwork((cur) => (cur && networks.some((n) => n.code === cur && n.withdrawEnabled) ? cur : (first?.code ?? null)));
    setAmount('');
  }, [asset, networks]);
  const net = networks.find((n) => n.code === network);
  const limits = useQuery({ queryKey: ['balances', 'withdraw-limits', asset, network], queryFn: () => api.wallet.withdrawalLimits(asset, network!), enabled: Boolean(authed && network) });
  const book = useQuery({ queryKey: ['address-book'], queryFn: () => api.wallet.addressBook(), enabled: authed });
  const security = useQuery({ queryKey: ['security'], queryFn: () => api.auth.security(), enabled: authed });

  // Debounced server-side address validation (format + checksum per network).
  const [check, setCheck] = useState<{ valid: boolean; reason?: string } | null>(null);
  useEffect(() => {
    setCheck(null);
    if (!network || address.trim().length < 10) return;
    const t = setTimeout(() => {
      api.wallet
        .validateAddress(network, address.trim(), memo || null)
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 400);
    return () => clearTimeout(t);
  }, [network, address, memo]);

  const l = limits.data;
  const decimals = net?.withdrawalPrecision ?? 8;
  const receive = isPositive(amount) && l ? D(amount).minus(l.fee) : null;
  const lockUntil = security.data?.withdrawalLockUntil && security.data.withdrawalLockUntil > Date.now() ? security.data.withdrawalLockUntil : null;
  const blocked = !user?.withdrawalsEnabled ? 'Withdrawals are disabled for this account. Contact support.' : !user?.emailVerified ? 'Verify your email address before withdrawing.' : lockUntil ? `Withdrawals are temporarily locked after a security change until ${new Date(lockUntil).toLocaleString()}.` : null;

  const validate = (): string | null => {
    if (!net) return 'Select a network';
    if (!address.trim()) return 'Enter a destination address';
    if (check && !check.valid) return check.reason ?? 'Invalid address for this network';
    if (!isPositive(amount)) return 'Enter an amount';
    if (!l) return 'Loading limits…';
    if (D(amount).decimalPlaces() > decimals) return `Maximum ${decimals} decimal places`;
    if (D(amount).lt(l.minAmount)) return `Minimum withdrawal is ${formatNumber(l.minAmount, 8, { trim: true })} ${asset}`;
    if (D(amount).gt(l.available)) return `Amount exceeds your available balance (${formatNumber(l.available, 8, { trim: true })} ${asset})`;
    if (receive && receive.lte(0)) return 'Amount must be larger than the network fee';
    if (save && !label.trim()) return 'Enter a label for the address book entry';
    return null;
  };

  return (
    <div className="page page--narrow-wide">
      <div className="page__head">
        <div>
          <Link to="/wallet" className="faint">
            ← Wallet
          </Link>
          <h1>Withdraw crypto</h1>
        </div>
      </div>
      {blocked && <Alert tone="warn">{blocked}</Alert>}
      <div className="flow-grid">
        <Card className="flow">
          <Step n={1} title="Select coin" done={Boolean(assetDto)}>
            {isLoading ? <Skeleton height={80} /> : <AssetPicker assets={assets ?? []} value={asset} onChange={(a) => setParams({ asset: a }, { replace: true })} filter={(a) => a.withdrawEnabled} />}
          </Step>
          <Step n={2} title="Destination" done={Boolean(check?.valid)}>
            <NetworkPicker networks={networks} value={network} onChange={setNetwork} kind="withdraw" />
            <TextInput
              label="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder={`${asset} address on ${network ?? '…'}`}
              autoComplete="off"
              spellCheck={false}
              error={check && !check.valid ? (check.reason ?? 'Invalid address for this network') : null}
              hint={check?.valid ? <span className="up">✓ Valid {network} address</span> : undefined}
            />
            {(book.data ?? []).filter((b) => b.network === network).length > 0 && (
              <div className="book-chips">
                <span className="faint" style={{ fontSize: 12 }}>
                  Address book:
                </span>
                {(book.data ?? [])
                  .filter((b) => b.network === network)
                  .map((b) => (
                    <button key={b.id} type="button" className="gc-badge" onClick={() => (setAddress(b.address), setMemo(b.memo ?? ''))}>
                      {b.label}
                    </button>
                  ))}
              </div>
            )}
            {net?.memoSupported && <TextInput label="Memo / tag (if required by the recipient)" value={memo} onChange={(e) => setMemo(e.target.value)} autoComplete="off" />}
          </Step>
          <Step n={3} title="Amount" done={Boolean(receive && receive.gt(0))}>
            <DecimalInput label="Amount" unit={asset} value={amount} onChange={(v) => (setAmount(v), setError(null))} decimals={decimals} />
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span className="faint">
                Available: <span className="num">{l ? formatNumber(l.available, 8, { trim: true }) : '—'}</span> {asset}
              </span>
              <button type="button" className="link-btn" disabled={!l} onClick={() => l && setAmount(D(l.available).toDecimalPlaces(decimals, 1).toFixed())}>
                Max
              </button>
            </div>
            <KeyValue
              items={[
                ['Network fee', l ? `${formatNumber(l.fee, 8, { trim: true })} ${asset}` : '—'],
                ['Minimum', l ? `${formatNumber(l.minAmount, 8, { trim: true })} ${asset}` : '—'],
                ['24h limit remaining', l ? `${formatUsd(l.remainingTodayUsd)} of ${formatUsd(l.dailyLimitUsd)}` : '—'],
                ['You will receive', <strong key="r" className="num">{receive && receive.gt(0) ? `${formatNumber(receive, decimals, { trim: true })} ${asset}` : '—'}</strong>],
              ]}
            />
            <Checkbox checked={save} onChange={setSave}>
              Save this address to my address book
            </Checkbox>
            {save && <TextInput label="Label" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 50))} />}
            {error && <Alert tone="error">{error}</Alert>}
            <Button
              variant="primary"
              size="lg"
              block
              disabled={Boolean(blocked)}
              onClick={() => {
                const e = validate();
                setError(e);
                if (!e) setVerify(true);
              }}
            >
              Withdraw
            </Button>
          </Step>
        </Card>
        <Card title="Before you withdraw" className="flow-aside">
          <ul className="faq">
            <li>
              <strong>Irreversible</strong>
              <span className="muted">Blockchain transfers cannot be reversed. Double-check the address and network.</span>
            </li>
            <li>
              <strong>Risk review</strong>
              <span className="muted">Large, unusual or first-time withdrawals may be held for manual review. Funds stay locked until a decision.</span>
            </li>
            <li>
              <strong>Security checks</strong>
              <span className="muted">Depending on your settings you will be asked for your PIN, 2FA code and an email code.</span>
            </li>
          </ul>
        </Card>
      </div>
      <Card title="Recent withdrawals" noPadding>
        <WithdrawalHistory />
      </Card>
      {verify && l && net && (
        <WithdrawVerifyModal
          payload={{ asset, network: net.code, address: address.trim(), memo: memo || null, amount, saveToAddressBook: save || undefined, label: save ? label.trim() : undefined }}
          requires={l.requires}
          fee={l.fee}
          receive={receive?.toFixed() ?? '0'}
          onClose={() => setVerify(false)}
          onDone={() => {
            setVerify(false);
            setAmount('');
            setAddress('');
            setMemo('');
          }}
        />
      )}
    </div>
  );
}

function WithdrawVerifyModal({
  payload,
  requires,
  fee,
  receive,
  onClose,
  onDone,
}: {
  payload: { asset: string; network: string; address: string; memo: string | null; amount: string; saveToAddressBook?: boolean; label?: string };
  requires: { pin: boolean; totp: boolean; emailCode: boolean };
  fee: string;
  receive: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  // One idempotency key per confirmation dialog: retries after a network error can never create a second withdrawal.
  const key = useRef(randomId('w'));
  const sendCode = useMutation({
    mutationFn: () => api.wallet.sendWithdrawalCode({ asset: payload.asset, amount: payload.amount, address: payload.address }),
    onSuccess: () => {
      setSent(Date.now());
      toast.info('Verification code sent', 'Check your email inbox.');
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = useMutation({
    mutationFn: () =>
      api.wallet.withdraw({
        ...payload,
        idempotencyKey: key.current,
        ...(requires.pin ? { pin } : {}),
        ...(requires.totp ? { totpCode: totp } : {}),
        ...(requires.emailCode ? { emailCode } : {}),
      }),
    onSuccess: (w) => {
      toast.success(w.status === 'PENDING_REVIEW' ? 'Withdrawal submitted for review' : 'Withdrawal submitted', `${formatNumber(w.amount, 8, { trim: true })} ${w.asset} to ${w.address.slice(0, 10)}…`);
      void qc.invalidateQueries({ queryKey: ['balances'] });
      void qc.invalidateQueries({ queryKey: ['address-book'] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const ready = (!requires.pin || /^\d{6}$/.test(pin)) && (!requires.totp || /^\d{6}$/.test(totp)) && (!requires.emailCode || /^\d{6}$/.test(emailCode));
  const cooldown = sent && Date.now() - sent < 60_000;
  return (
    <Modal
      open
      onClose={onClose}
      title="Security verification"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={submit.isPending} disabled={!ready} onClick={() => submit.mutate()}>
            Confirm withdrawal
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <KeyValue
          items={[
            ['Amount', `${payload.amount} ${payload.asset}`],
            ['Network fee', `${fee} ${payload.asset}`],
            ['You receive', `${formatNumber(receive, 8, { trim: true })} ${payload.asset}`],
            ['Network', payload.network],
            ['Address', <code key="a" className="mono" style={{ wordBreak: 'break-all' }}>{payload.address}</code>],
            ...(payload.memo ? ([['Memo', payload.memo]] as [string, string][]) : []),
          ]}
        />
        {requires.pin && <TextInput label="Security PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
        {requires.totp && <TextInput label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} />}
        {requires.emailCode && (
          <TextInput
            label="Email verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            suffix={
              <button type="button" className="link-btn" disabled={Boolean(cooldown) || sendCode.isPending} onClick={() => sendCode.mutate()}>
                {sent ? 'Resend' : 'Send code'}
              </button>
            }
          />
        )}
        {!requires.pin && !requires.totp && <Alert tone="warn">Protect withdrawals: enable 2FA and set a security PIN in Account → Security.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

