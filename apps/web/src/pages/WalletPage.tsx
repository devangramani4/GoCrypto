import type {
  AccountType,
  BalanceDto,
  DepositDto,
  LedgerEntryDto,
  TransferDto,
  WithdrawalDto,
} from '@gocrypto/shared-types';
import { D, formatUsd, shortAddress } from '@gocrypto/trading-utils';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DataTable,
  Icon,
  Modal,
  Progress,
  Select,
  Skeleton,
  Tabs,
  TextInput,
  useToast,
  type Column,
} from '@gocrypto/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AssetLabel, CopyButton } from '../components/common';
import { DecimalInput } from '../components/trading/controls';
import { StatusBadge } from '../components/trading/OrdersPanel';
import { api, errorMessage } from '../lib/api';
import { fmtDateTime, formatNumber, humanize, isPositive, signClass } from '../lib/format';
import { useAssets, useAuthed, useBalances } from '../lib/hooks';
import { usePrefs, useSession } from '../stores/session';

const ACCOUNTS: AccountType[] = ['SPOT', 'FUTURES', 'OPTIONS'];
const ACCOUNT_LABEL: Record<AccountType, string> = { SPOT: 'Spot', FUTURES: 'Futures (USDT-M)', OPTIONS: 'Options' };

export function WalletPage() {
  const authed = useAuthed();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const overview = useQuery({
    queryKey: ['balances', 'overview'],
    queryFn: () => api.wallet.overview(),
    enabled: authed,
  });
  const [account, setAccount] = useState<AccountType>('SPOT');
  const [q, setQ] = useState('');
  const hideSmall = usePrefs((s) => s.hideSmallBalances);
  const setHideSmall = usePrefs((s) => s.setHideSmall);
  const [history, setHistory] = useState<'deposits' | 'withdrawals' | 'transfers' | 'ledger'>('deposits');
  const transferParam = params.get('transfer');
  const [transfer, setTransfer] = useState<{ asset?: string; to?: AccountType } | null>(null);
  useEffect(() => {
    if (transferParam) {
      setTransfer({ to: ACCOUNTS.includes(transferParam as AccountType) ? (transferParam as AccountType) : undefined });
      setParams({}, { replace: true });
    }
  }, [transferParam, setParams]);

  const o = overview.data;
  const rows = useMemo(
    () =>
      (o?.accounts[account]?.balances ?? [])
        .filter((b) => !q || b.asset.includes(q.toUpperCase()))
        .filter((b) => !hideSmall || D(b.usdValue).gte(1))
        .sort((a, b) => D(b.usdValue).cmp(a.usdValue)),
    [o, account, q, hideSmall],
  );

  const columns: Column<BalanceDto>[] = [
    { key: 'a', header: 'Asset', render: (b) => <AssetLabel asset={b.asset} /> },
    {
      key: 't',
      header: 'Total',
      align: 'right',
      render: (b) => <span className="num">{formatNumber(b.total, 8, { trim: true })}</span>,
    },
    {
      key: 'v',
      header: 'Available',
      align: 'right',
      render: (b) => <span className="num">{formatNumber(b.available, 8, { trim: true })}</span>,
    },
    {
      key: 'l',
      header: account === 'SPOT' ? 'In orders' : 'Locked / margin',
      align: 'right',
      render: (b) => <span className="num muted">{formatNumber(b.locked, 8, { trim: true })}</span>,
    },
    {
      key: 'u',
      header: 'USD value',
      align: 'right',
      render: (b) => <span className="num">{formatUsd(b.usdValue)}</span>,
    },
    {
      key: 'x',
      header: '',
      align: 'right',
      render: (b) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {account === 'SPOT' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/wallet/deposit?asset=${b.asset}`)}>
                Deposit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/wallet/withdraw?asset=${b.asset}`)}>
                Withdraw
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setTransfer({ asset: b.asset })}>
            Transfer
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Wallet</h1>
          <p className="muted">Balances are held per account. Transfers between your accounts are instant and free.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/wallet/deposit" className="gc-btn gc-btn--primary">
            <Icon name="download" size={15} /> Deposit
          </Link>
          <Link to="/wallet/withdraw" className="gc-btn">
            <Icon name="upload" size={15} /> Withdraw
          </Link>
          <Button icon="swap" onClick={() => setTransfer({})}>
            Transfer
          </Button>
        </div>
      </div>

      <div className="wallet-summary">
        <Card className="wallet-summary__total">
          <span className="faint">Estimated total balance</span>
          {overview.isLoading ? (
            <Skeleton width={220} height={34} />
          ) : (
            <strong className="num wallet-summary__value">{formatUsd(o?.totalUsd ?? '0')}</strong>
          )}
        </Card>
        {ACCOUNTS.map((a) => (
          <button
            key={a}
            type="button"
            className={`wallet-acct ${account === a ? 'on' : ''}`}
            onClick={() => setAccount(a)}
          >
            <span className="faint">{ACCOUNT_LABEL[a]}</span>
            {overview.isLoading ? (
              <Skeleton width={120} height={20} />
            ) : (
              <strong className="num">{formatUsd(o?.accounts[a]?.totalUsd ?? '0')}</strong>
            )}
          </button>
        ))}
      </div>

      <Card noPadding>
        <div className="markets-toolbar">
          <Tabs
            value={account}
            onChange={setAccount}
            tabs={ACCOUNTS.map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
          />
          <span className="spacer" />
          <Checkbox checked={hideSmall} onChange={setHideSmall}>
            Hide balances &lt; $1
          </Checkbox>
          <div className="mlist__search" style={{ width: 180 }}>
            <Icon name="search" size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search asset"
              aria-label="Search assets"
            />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.asset}
          loading={overview.isLoading}
          error={overview.error}
          onRetry={() => void overview.refetch()}
          empty="No balances in this account yet"
        />
      </Card>

      <Card
        noPadding
        title={
          <Tabs
            value={history}
            onChange={setHistory}
            tabs={[
              { value: 'deposits', label: 'Deposits' },
              { value: 'withdrawals', label: 'Withdrawals' },
              { value: 'transfers', label: 'Transfers' },
              { value: 'ledger', label: 'All activity' },
            ]}
          />
        }
      >
        {history === 'deposits' ? (
          <DepositHistory />
        ) : history === 'withdrawals' ? (
          <WithdrawalHistory />
        ) : history === 'transfers' ? (
          <TransferHistory />
        ) : (
          <LedgerHistory />
        )}
      </Card>

      {transfer && (
        <TransferModal initialAsset={transfer.asset} initialTo={transfer.to} onClose={() => setTransfer(null)} />
      )}
    </div>
  );
}

// ───────────────────────────── transfer ─────────────────────────────

function TransferModal({
  initialAsset,
  initialTo,
  onClose,
}: {
  initialAsset?: string;
  initialTo?: AccountType;
  onClose: () => void;
}) {
  const user = useSession((s) => s.user);
  const [mode, setMode] = useState<'internal' | 'user'>('internal');
  const [from, setFrom] = useState<AccountType>(
    initialTo && initialTo !== 'SPOT' ? 'SPOT' : initialTo === 'SPOT' ? 'FUTURES' : 'SPOT',
  );
  const [to, setTo] = useState<AccountType>(initialTo ?? 'FUTURES');
  const [asset, setAsset] = useState(initialAsset ?? 'USDT');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const { data: balances } = useBalances(mode === 'internal' ? from : 'SPOT');
  const available = balances?.find((b) => b.asset === asset)?.available ?? '0';
  // Derivatives accounts are USDT-margined: only USDT moves in or out of them.
  const derivatives = mode === 'internal' && (from !== 'SPOT' || to !== 'SPOT');
  const assetOptions = useMemo(() => {
    if (derivatives) return ['USDT'];
    const set = new Set((balances ?? []).filter((b) => D(b.available).gt(0)).map((b) => b.asset));
    set.add(asset);
    return [...set].sort();
  }, [balances, asset, derivatives]);
  useEffect(() => {
    if (derivatives && asset !== 'USDT') setAsset('USDT');
  }, [derivatives, asset]);

  const run = useMutation({
    mutationFn: () =>
      mode === 'internal'
        ? api.wallet.transfer({ asset, amount, from, to })
        : api.wallet.internalTransfer({
            asset,
            amount,
            recipient: recipient.trim(),
            note: note.trim() || undefined,
            pin: pin || undefined,
            totpCode: totp || undefined,
          }),
    onSuccess: () => {
      toast.success(
        'Transfer complete',
        `${amount} ${asset} ${mode === 'internal' ? `${ACCOUNT_LABEL[from]} → ${ACCOUNT_LABEL[to]}` : `sent to ${recipient}`}`,
      );
      for (const k of ['balances', 'futures-account', 'options-account', 'portfolio', 'transfers', 'ledger'])
        void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (mode === 'internal' && from === to) return setError('Choose two different accounts');
    if (!isPositive(amount)) return setError('Enter an amount');
    if (D(amount).gt(available)) return setError(`Amount exceeds your available ${asset}`);
    if (mode === 'user' && recipient.trim().length < 6) return setError('Enter the recipient email or UID');
    run.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={submit}>
            Confirm transfer
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Tabs
          variant="pills"
          value={mode}
          onChange={(m) => (setMode(m), setError(null))}
          tabs={[
            { value: 'internal', label: 'Between my accounts' },
            { value: 'user', label: 'To another user' },
          ]}
        />
        {mode === 'internal' ? (
          <div className="xfer">
            <Select
              label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value as AccountType)}
              options={ACCOUNTS.map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
            />
            <button
              type="button"
              className="gc-icon-btn xfer__swap"
              aria-label="Swap accounts"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <Icon name="swap" size={16} />
            </button>
            <Select
              label="To"
              value={to}
              onChange={(e) => setTo(e.target.value as AccountType)}
              options={ACCOUNTS.map((a) => ({ value: a, label: ACCOUNT_LABEL[a] }))}
            />
          </div>
        ) : (
          <>
            <TextInput
              label="Recipient email or UID"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="off"
            />
            <Alert tone="info">
              Internal transfers are instant, free and irreversible. Double-check the recipient.
            </Alert>
          </>
        )}
        <Select
          label="Asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          options={assetOptions.map((a) => ({ value: a, label: a }))}
        />
        <DecimalInput label="Amount" unit={asset} value={amount} onChange={setAmount} decimals={8} />
        <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
          <span className="faint">
            Available: <span className="num">{formatNumber(available, 8, { trim: true })}</span> {asset}
          </span>
          <button type="button" className="link-btn" onClick={() => setAmount(D(available).toFixed())}>
            Max
          </button>
        </div>
        {mode === 'user' && (
          <>
            <TextInput label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} />
            {user?.hasTradingPin && (
              <TextInput
                label="Security PIN"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="off"
              />
            )}
            {user?.twoFactorEnabled && (
              <TextInput
                label="Authenticator code"
                inputMode="numeric"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="one-time-code"
              />
            )}
          </>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

// ───────────────────────────── history tables ─────────────────────────────

function useExplorer() {
  const { data: assets } = useAssets();
  return (asset: string, network: string, tx: string | null) => {
    const url = assets?.find((a) => a.symbol === asset)?.networks.find((n) => n.code === network)?.explorerTxUrl;
    return url && tx ? url.replace('{tx}', tx) : null;
  };
}

function TxHash({ asset, network, tx }: { asset: string; network: string; tx: string | null }) {
  const explorer = useExplorer();
  if (!tx) return <span className="faint">—</span>;
  const url = explorer(asset, network, tx);
  return (
    <span className="row num" style={{ gap: 4 }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {shortAddress(tx, 8, 6)}
        </a>
      ) : (
        shortAddress(tx, 8, 6)
      )}
      <CopyButton value={tx} label="Copy transaction hash" />
    </span>
  );
}

export function DepositHistory() {
  const authed = useAuthed();
  const q = useInfiniteQuery({
    queryKey: ['balances', 'deposits'],
    queryFn: ({ pageParam }) => api.wallet.deposits(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: authed,
    refetchInterval: (query) =>
      query.state.data?.pages.some((p) => p.items.some((d) => d.status === 'PENDING' || d.status === 'CONFIRMING'))
        ? 5000
        : false,
  });
  const columns: Column<DepositDto>[] = [
    { key: 't', header: 'Time', render: (d) => <span className="muted num">{fmtDateTime(d.createdAt)}</span> },
    { key: 'a', header: 'Asset', render: (d) => <AssetLabel asset={d.asset} sub={d.network} /> },
    {
      key: 'm',
      header: 'Amount',
      align: 'right',
      render: (d) => <span className="num up">+{formatNumber(d.amount, 8, { trim: true })}</span>,
    },
    { key: 'x', header: 'Tx hash', render: (d) => <TxHash asset={d.asset} network={d.network} tx={d.txHash} /> },
    {
      key: 'c',
      header: 'Confirmations',
      align: 'right',
      render: (d) => (
        <span className="col" style={{ gap: 3, alignItems: 'flex-end' }}>
          <span className="num">
            {Math.min(d.confirmations, d.requiredConfirmations)}/{d.requiredConfirmations}
          </span>
          <span style={{ width: 80 }}>
            <Progress
              value={(Math.min(d.confirmations, d.requiredConfirmations) / Math.max(1, d.requiredConfirmations)) * 100}
              tone="up"
            />
          </span>
        </span>
      ),
    },
    { key: 's', header: 'Status', align: 'right', render: (d) => <StatusBadge status={d.status} /> },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.pages.flatMap((p) => p.items)}
      rowKey={(d) => d.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No deposits yet"
      footer={
        q.hasNextPage ? <MoreButton onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined
      }
    />
  );
}

export function WithdrawalHistory() {
  const authed = useAuthed();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['balances', 'withdrawals'],
    queryFn: ({ pageParam }) => api.wallet.withdrawals(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: authed,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.wallet.cancelWithdrawal(id),
    onSuccess: () => {
      toast.success('Withdrawal cancelled', 'Funds were returned to your spot balance.');
      void qc.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (e) => toast.error('Cannot cancel', errorMessage(e)),
  });
  const columns: Column<WithdrawalDto>[] = [
    { key: 't', header: 'Time', render: (w) => <span className="muted num">{fmtDateTime(w.createdAt)}</span> },
    { key: 'a', header: 'Asset', render: (w) => <AssetLabel asset={w.asset} sub={w.network} /> },
    {
      key: 'm',
      header: 'Amount',
      align: 'right',
      render: (w) => <span className="num down">-{formatNumber(w.amount, 8, { trim: true })}</span>,
    },
    {
      key: 'f',
      header: 'Fee',
      align: 'right',
      render: (w) => <span className="num muted">{formatNumber(w.fee, 8, { trim: true })}</span>,
    },
    {
      key: 'd',
      header: 'Destination',
      render: (w) => (
        <span className="row num" style={{ gap: 4 }}>
          {shortAddress(w.address, 8, 6)}
          <CopyButton value={w.address} label="Copy address" />
        </span>
      ),
    },
    { key: 'x', header: 'Tx hash', render: (w) => <TxHash asset={w.asset} network={w.network} tx={w.txHash} /> },
    {
      key: 's',
      header: 'Status',
      align: 'right',
      render: (w) => (
        <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
          <StatusBadge status={w.status} />
          {w.reviewNote && (
            <span className="faint" style={{ fontSize: 10 }}>
              {w.reviewNote}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'c',
      header: '',
      align: 'right',
      render: (w) =>
        w.status === 'PENDING_REVIEW' ? (
          <Button
            size="sm"
            variant="ghost"
            loading={cancel.isPending && cancel.variables === w.id}
            onClick={() => cancel.mutate(w.id)}
          >
            Cancel
          </Button>
        ) : null,
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.pages.flatMap((p) => p.items)}
      rowKey={(w) => w.id}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No withdrawals yet"
      footer={
        q.hasNextPage ? <MoreButton onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined
      }
    />
  );
}

function TransferHistory() {
  const authed = useAuthed();
  const q = useInfiniteQuery({
    queryKey: ['transfers'],
    queryFn: ({ pageParam }) => api.wallet.transfers(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: authed,
  });
  const columns: Column<TransferDto>[] = [
    { key: 't', header: 'Time', render: (t) => <span className="muted num">{fmtDateTime(t.createdAt)}</span> },
    { key: 'a', header: 'Asset', render: (t) => <AssetLabel asset={t.asset} /> },
    {
      key: 'r',
      header: 'Route',
      render: (t) =>
        t.type === 'ACCOUNT' ? (
          <span>
            {ACCOUNT_LABEL[t.fromAccount]} → {ACCOUNT_LABEL[t.toAccount]}
          </span>
        ) : (
          <span>
            {t.direction === 'IN' ? 'From' : 'To'} {t.counterparty ?? 'user'}
          </span>
        ),
    },
    {
      key: 'm',
      header: 'Amount',
      align: 'right',
      render: (t) => (
        <span
          className={`num ${t.direction === 'IN' ? 'up' : t.direction === 'OUT' ? 'down' : ''}`}
        >{`${t.direction === 'IN' ? '+' : t.direction === 'OUT' ? '-' : ''}${formatNumber(t.amount, 8, { trim: true })}`}</span>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={q.data?.pages.flatMap((p) => p.items)}
      rowKey={(t) => `${t.id}-${t.direction}`}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      empty="No transfers yet"
      footer={
        q.hasNextPage ? <MoreButton onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} /> : undefined
      }
    />
  );
}

function LedgerHistory() {
  const authed = useAuthed();
  const [asset, setAsset] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['ledger', asset],
    queryFn: ({ pageParam }) => api.wallet.history({ cursor: pageParam, limit: 50, asset: asset || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
    enabled: authed,
  });
  const columns: Column<LedgerEntryDto>[] = [
    { key: 't', header: 'Time', render: (e) => <span className="muted num">{fmtDateTime(e.createdAt)}</span> },
    { key: 'y', header: 'Type', render: (e) => <span>{humanize(e.type)}</span> },
    {
      key: 'a',
      header: 'Asset',
      render: (e) => (
        <span className="row" style={{ gap: 6 }}>
          <strong>{e.asset}</strong>
          <span className="faint">{e.account}</span>
        </span>
      ),
    },
    {
      key: 'd',
      header: 'Available Δ',
      align: 'right',
      render: (e) => (
        <span className={`num ${signClass(e.availableDelta)}`}>
          {formatNumber(e.availableDelta, 8, { trim: true, sign: true })}
        </span>
      ),
    },
    {
      key: 'l',
      header: 'Locked Δ',
      align: 'right',
      render: (e) => (
        <span className="num muted">
          {D(e.lockedDelta).isZero() ? '—' : formatNumber(e.lockedDelta, 8, { trim: true, sign: true })}
        </span>
      ),
    },
    {
      key: 'b',
      header: 'Balance after',
      align: 'right',
      render: (e) => (
        <span className="num">{formatNumber(D(e.availableAfter).plus(e.lockedAfter), 8, { trim: true })}</span>
      ),
    },
    {
      key: 'r',
      header: 'Reference',
      render: (e) => (
        <span className="faint">{e.description ?? (e.refType ? `${humanize(e.refType)} #${e.refId}` : '—')}</span>
      ),
    },
  ];
  return (
    <>
      <div className="markets-toolbar">
        <span className="faint" style={{ fontSize: 12 }}>
          Every balance change is recorded in an append-only ledger.
        </span>
        <span className="spacer" />
        <div className="mlist__search" style={{ width: 160 }}>
          <Icon name="filter" size={14} />
          <input
            value={asset}
            onChange={(e) => setAsset(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="Asset"
            aria-label="Filter by asset"
          />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={q.data?.pages.flatMap((p) => p.items)}
        rowKey={(e) => e.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty="No activity yet"
        footer={
          q.hasNextPage ? (
            <MoreButton onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage} />
          ) : undefined
        }
      />
    </>
  );
}

function MoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
      <Button size="sm" variant="ghost" loading={loading} onClick={onClick}>
        Load more
      </Button>
    </div>
  );
}
