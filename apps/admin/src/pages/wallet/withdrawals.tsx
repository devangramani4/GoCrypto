import type { WithdrawalDto } from '@gocrypto/shared-types';
import { Badge, Button, type Column, KeyValue, Progress } from '@gocrypto/ui';
import type { ReactNode } from 'react';
import { ActionDialog } from '../../components/ActionDialog';
import { Amount, DateTime, Mono, StatusBadge, Usd, UserLink } from '../../components/cells';
import { useApi } from '../../lib/ApiContext';
import { errorMessage } from '../../lib/errors';
import { fmtAmount, fmtRelative, fmtUsd } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { WITHDRAWAL_STATUS_TONE, humanize, riskTone } from '../../lib/status';
import { useAction } from '../../lib/useAction';

export type AdminWithdrawal = WithdrawalDto & { userId: string; userEmail: string; riskScore: number; amountUsd: string };

export type ReviewDecision = 'APPROVE' | 'REJECT';

const FLAG_HELP: Record<string, string> = {
  LARGE_AMOUNT: 'At or above the manual review threshold',
  NEW_ADDRESS: 'First withdrawal to this address',
  NEW_ACCOUNT: 'Account younger than 7 days',
  NO_2FA: 'Two-factor authentication disabled',
  FULL_BALANCE: 'Withdrawing ≥ 90% of the balance',
  VELOCITY: '5+ withdrawals in 24 hours',
  LOW_KYC: 'KYC level 0 withdrawing ≥ $1,000',
};

export function RiskScore({ score }: { score: number }) {
  const tone = riskTone(score);
  return (
    <span className="adm-risk" title={`Risk score ${score} (≥ 50 requires manual review)`}>
      <strong className={`num ${tone ?? ''}`} style={{ minWidth: 24 }}>
        {score}
      </strong>
      <Progress value={Math.min(score, 100) / 100} tone={tone === 'brand' ? undefined : tone} />
    </span>
  );
}

export function RiskFlags({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="faint">None</span>;
  return (
    <span className="adm-chip-row">
      {flags.map((f) => (
        <span key={f} title={FLAG_HELP[f] ?? f}>
          <Badge tone={f === 'LARGE_AMOUNT' || f === 'VELOCITY' ? 'down' : 'warn'}>{humanize(f)}</Badge>
        </span>
      ))}
    </span>
  );
}

export function withdrawalColumns(opts: { queue: boolean; canReview: boolean; onReview: (w: AdminWithdrawal, d: ReviewDecision) => void }): Column<AdminWithdrawal>[] {
  const cols: Column<AdminWithdrawal>[] = [
    {
      key: 'time',
      header: 'Requested',
      render: (w) => <DateTime value={w.createdAt} relative={opts.queue} />,
    },
    {
      key: 'user',
      header: 'User',
      render: (w) => (
        <span>
          <UserLink id={w.userId} email={w.userEmail} />
          <span className="adm-cell-sub">#{w.userId}</span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (w) => (
        <span>
          <Amount value={w.amount} asset={w.asset} />
          <span className="adm-cell-sub num">{fmtUsd(w.amountUsd)}</span>
        </span>
      ),
    },
    {
      key: 'dest',
      header: 'Destination',
      render: (w) => (
        <span>
          <span className="row" style={{ gap: 6 }}>
            <Badge>{w.network}</Badge>
            <Mono value={w.address} short copy />
          </span>
          {w.memo && <span className="adm-cell-sub">memo {w.memo}</span>}
        </span>
      ),
    },
    { key: 'risk', header: 'Risk', render: (w) => <RiskScore score={w.riskScore} /> },
    { key: 'flags', header: 'Risk flags', render: (w) => <RiskFlags flags={w.riskFlags} /> },
  ];
  if (!opts.queue) {
    cols.push(
      { key: 'status', header: 'Status', render: (w) => <StatusBadge value={w.status} tones={WITHDRAWAL_STATUS_TONE} /> },
      { key: 'tx', header: 'Tx hash', render: (w) => <Mono value={w.txHash} short copy /> },
    );
  }
  cols.push({
    key: 'actions',
    header: '',
    align: 'right',
    className: 'adm-col-sticky',
    render: (w) =>
      w.status === 'PENDING_REVIEW' || w.status === 'APPROVED' ? (
        <span className="adm-table-actions">
          {w.status === 'PENDING_REVIEW' && (
            <Button size="sm" variant="buy" disabled={!opts.canReview} title={opts.canReview ? undefined : 'Requires permission: withdrawals.review'} onClick={() => opts.onReview(w, 'APPROVE')}>
              Approve
            </Button>
          )}
          <Button size="sm" variant="danger" disabled={!opts.canReview} title={opts.canReview ? undefined : 'Requires permission: withdrawals.review'} onClick={() => opts.onReview(w, 'REJECT')}>
            Reject
          </Button>
        </span>
      ) : null,
  });
  return cols;
}

export function ReviewDialog({ review, onClose }: { review: { withdrawal: AdminWithdrawal; decision: ReviewDecision } | null; onClose: () => void }) {
  const client = useApi();
  const action = useAction<{ id: string; decision: ReviewDecision; note?: string }, WithdrawalDto>({
    mutationFn: ({ id, decision, note }) => client.admin.reviewWithdrawal(id, decision, note),
    success: (_d, v) => (v.decision === 'APPROVE' ? 'Withdrawal approved — queued for broadcast' : 'Withdrawal rejected — funds returned to the user'),
    invalidate: [qk.withdrawalsAll, qk.dashboard, qk.balances],
    errorToast: false,
    onSuccess: onClose,
  });
  const w = review?.withdrawal;
  const approve = review?.decision === 'APPROVE';
  const items: [ReactNode, ReactNode][] = w
    ? [
        ['User', <UserLink key="u" id={w.userId} email={w.userEmail} />],
        ['Amount', <Amount key="a" value={w.amount} asset={w.asset} />],
        ['USD value', <Usd key="usd" value={w.amountUsd} />],
        ['Network fee', <Amount key="f" value={w.fee} asset={w.asset} />],
        ['User receives', <Amount key="r" value={w.receiveAmount} asset={w.asset} />],
        ['Network', w.network],
        ['Address', <Mono key="ad" value={w.address} copy />],
        ...(w.memo ? ([['Memo', w.memo]] as [ReactNode, ReactNode][]) : []),
        ['Requested', `${fmtRelative(w.createdAt)}`],
        ['Risk score', <RiskScore key="rs" score={w.riskScore} />],
      ]
    : [];
  return (
    <ActionDialog
      open={review !== null}
      wide
      title={approve ? 'Approve withdrawal' : 'Reject withdrawal'}
      tone={approve ? 'primary' : 'danger'}
      confirmLabel={approve ? `Approve ${w ? `${fmtAmount(w.amount)} ${w.asset}` : ''}` : 'Reject withdrawal'}
      description={
        approve
          ? 'The withdrawal is queued for broadcast immediately and cannot be recalled once processed.'
          : 'The locked amount (including the fee) is returned to the user’s available balance.'
      }
      reason={{
        label: approve ? 'Review note (optional)' : 'Rejection note',
        required: !approve,
        placeholder: approve ? 'e.g. Verified with the user by phone' : 'e.g. Destination flagged by compliance screening',
        hint: 'Stored on the withdrawal and visible to the user in their history.',
      }}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(note) => w && review && action.mutate({ id: w.id, decision: review.decision, note: note || undefined })}
      onClose={() => {
        action.reset();
        onClose();
      }}
    >
      {w && (
        <div className="adm-stack" style={{ gap: 10 }}>
          <div className="adm-muted-box adm-kv-card">
            <KeyValue items={items} />
          </div>
          <div>
            <div className="gc-field__label" style={{ marginBottom: 6 }}>
              Risk flags
            </div>
            <RiskFlags flags={w.riskFlags} />
          </div>
        </div>
      )}
    </ActionDialog>
  );
}
