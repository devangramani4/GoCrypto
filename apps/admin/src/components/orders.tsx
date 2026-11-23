import { OPEN_ORDER_STATUSES, type OrderDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { Button, type Column } from '@gocrypto/ui';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { dec, fmtAmount } from '../lib/format';
import { ORDER_STATUS_TONE, humanize } from '../lib/status';
import { useAction } from '../lib/useAction';
import { ActionDialog } from './ActionDialog';
import { Amount, DateTimeStacked, Side, StatusBadge, UserLink } from './cells';

export type AdminOrder = OrderDto & { userId?: string; userEmail?: string };

export function isOpenOrder(o: OrderDto): boolean {
  return OPEN_ORDER_STATUSES.includes(o.status);
}

function filledPercent(o: OrderDto): string | null {
  const qty = dec(o.quantity);
  const filled = dec(o.filledQuantity);
  if (!qty || !filled || qty.isZero()) return null;
  return `${D(filled).div(qty).mul(100).toDecimalPlaces(1).toFixed(1)}%`;
}

export function orderColumns(opts: { showUser: boolean; canCancel: boolean; onCancel: (o: AdminOrder) => void }): Column<AdminOrder>[] {
  const cols: Column<AdminOrder>[] = [
    { key: 'time', header: 'Created', render: (o) => <DateTimeStacked value={o.createdAt} /> },
  ];
  if (opts.showUser) {
    cols.push({
      key: 'user',
      header: 'User',
      render: (o) => (
        <span className="adm-user-cell" title={o.userEmail}>
          <UserLink id={o.userId} email={o.userEmail} />
        </span>
      ),
    });
  }
  cols.push(
    {
      key: 'symbol',
      header: 'Market / order',
      render: (o) => (
        <span title={`Order ${o.id} · client id ${o.clientOrderId}`}>
          <strong style={{ fontWeight: 600 }}>{o.symbol}</strong>
          <span className="adm-cell-sub">
            {humanize(o.marketType)} · <span className="adm-mono">#{o.id}</span> · {o.source.toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Side / type',
      render: (o) => (
        <span>
          <Side side={o.side} /> {humanize(o.type)}
          <span className="adm-cell-sub">
            {[o.timeInForce, o.reduceOnly && 'reduce-only', o.postOnly && 'post-only', o.leverage && `${o.leverage}x`].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (o) => (
        <span title={o.rejectReason ?? undefined}>
          <StatusBadge value={o.status} tones={ORDER_STATUS_TONE} />
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (o) => (
        <span>
          {o.price ? <Amount value={o.price} /> : <span className="muted">Market</span>}
          {o.stopPrice && <span className="adm-cell-sub num">stop {fmtAmount(o.stopPrice)}</span>}
        </span>
      ),
    },
    {
      key: 'filled',
      header: 'Filled / qty',
      align: 'right',
      render: (o) => (
        <span>
          <span className="num">
            {fmtAmount(o.filledQuantity)} <span className="faint">/</span>{' '}
            {o.quantity ? fmtAmount(o.quantity) : <>{fmtAmount(o.quoteQuantity)} <span className="faint">quote</span></>}
          </span>
          {filledPercent(o) && <span className="adm-cell-sub num">{filledPercent(o)}</span>}
        </span>
      ),
    },
    {
      key: 'avg',
      header: 'Avg / fee',
      align: 'right',
      render: (o) => (
        <span>
          <Amount value={o.avgPrice} />
          {dec(o.feeTotal)?.isZero() === false && (
            <span className="adm-cell-sub num">
              fee {fmtAmount(o.feeTotal)} {o.feeAsset ?? ''}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'adm-col-sticky',
      render: (o) =>
        isOpenOrder(o) ? (
          <Button
            size="sm"
            variant="danger"
            disabled={!opts.canCancel}
            title={opts.canCancel ? 'Cancel this order' : 'Requires permission: orders.cancel'}
            onClick={(e) => {
              e.stopPropagation();
              opts.onCancel(o);
            }}
          >
            Cancel
          </Button>
        ) : null,
    },
  );
  return cols;
}

/** Admin cancel with a mandatory reason (audited). */
export function CancelOrderDialog({ order, onClose }: { order: AdminOrder | null; onClose: () => void }) {
  const client = useApi();
  const action = useAction<{ id: string; reason: string }, OrderDto>({
    mutationFn: ({ id, reason }) => client.admin.cancelOrder(id, reason),
    success: (o) => `Order ${o.id} cancelled`,
    invalidate: [['admin', 'orders'], ['admin', 'user']],
    errorToast: false,
    onSuccess: onClose,
  });
  return (
    <ActionDialog
      open={order !== null}
      title="Cancel order"
      tone="danger"
      confirmLabel="Cancel order"
      description={
        order && (
          <>
            Cancel {order.side.toLowerCase()} {humanize(order.type).toLowerCase()} order <span className="adm-mono">{order.id}</span> on{' '}
            <strong>{order.symbol}</strong>
            {order.userEmail ? <> for {order.userEmail}</> : null}. Locked funds are released to the user.
          </>
        )
      }
      reason={{ required: true, placeholder: 'e.g. Stale order after market halt (ticket #1234)' }}
      pending={action.isPending}
      error={action.error ? errorMessage(action.error) : null}
      onConfirm={(reason) => order && action.mutate({ id: order.id, reason })}
      onClose={() => {
        action.reset();
        onClose();
      }}
    />
  );
}
