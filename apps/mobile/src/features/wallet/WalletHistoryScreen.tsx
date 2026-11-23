import type {
  CursorPage,
  DepositDto,
  DepositStatus,
  TransferDto,
  WithdrawalDto,
  WithdrawalStatus,
} from '@gocrypto/shared-types';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clipboard } from '../../lib/clipboard';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, View } from 'react-native';
import {
  AssetIcon,
  Badge,
  Button,
  Divider,
  EmptyState,
  ErrorState,
  KeyValue,
  Sheet,
  SkeletonRows,
  Tabs,
  Txt,
  type BadgeTone,
} from '../../components';
import { Screen } from '../../components/Screen';
import { useLastNonNull, useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fmtDateTime, formatNumber, humanize, shortAddress } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps, WalletHistoryTab } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

type Entry =
  | { kind: 'deposit'; item: DepositDto }
  | { kind: 'withdrawal'; item: WithdrawalDto }
  | { kind: 'transfer'; item: TransferDto };

function depositTone(s: DepositStatus): BadgeTone {
  return s === 'COMPLETED' ? 'up' : s === 'FAILED' ? 'down' : 'warn';
}

function withdrawalTone(s: WithdrawalStatus): BadgeTone {
  if (s === 'COMPLETED') return 'up';
  if (s === 'REJECTED' || s === 'FAILED') return 'down';
  if (s === 'CANCELLED') return 'neutral';
  return 'warn';
}

const CANCELLABLE: readonly WithdrawalStatus[] = ['PENDING_REVIEW', 'APPROVED'];

function Separator() {
  return <Divider inset={62} />;
}

function useHistory<T>(
  key: readonly unknown[],
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export function WalletHistoryScreen({ route }: RootScreenProps<'WalletHistory'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [tab, setTab] = useState<WalletHistoryTab>(route.params?.tab ?? 'deposits');
  const [detail, setDetail] = useState<Entry | null>(null);
  const shown = useLastNonNull(detail);

  const deposits = useHistory(qk.deposits, (c) => api.wallet.deposits(c), tab === 'deposits');
  const withdrawals = useHistory(qk.withdrawals, (c) => api.wallet.withdrawals(c), tab === 'withdrawals');
  const transfers = useHistory(qk.transfers, (c) => api.wallet.transfers(c), tab === 'transfers');

  const cancel = useMutation({
    mutationFn: (id: string) => api.wallet.cancelWithdrawal(id),
    onSuccess: () => {
      haptics.success();
      toast.success('Withdrawal cancelled', 'The funds are back in your spot wallet.');
      setDetail(null);
      void qc.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (e) => {
      haptics.error();
      toast.error('Could not cancel', errorMessage(e));
    },
  });

  const entries: Entry[] =
    tab === 'deposits'
      ? (deposits.data?.pages.flatMap((p) => p.items).map((item) => ({ kind: 'deposit' as const, item })) ?? [])
      : tab === 'withdrawals'
        ? (withdrawals.data?.pages.flatMap((p) => p.items).map((item) => ({ kind: 'withdrawal' as const, item })) ?? [])
        : (transfers.data?.pages.flatMap((p) => p.items).map((item) => ({ kind: 'transfer' as const, item })) ?? []);

  const q = tab === 'deposits' ? deposits : tab === 'withdrawals' ? withdrawals : transfers;
  const { refreshing, onRefresh } = useRefresh(() => q.refetch());

  const confirmCancel = (w: WithdrawalDto) => {
    Alert.alert(
      'Cancel withdrawal?',
      `${formatNumber(w.amount, 8, { trim: true })} ${w.asset} to ${shortAddress(w.address)}`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel withdrawal', style: 'destructive', onPress: () => cancel.mutate(w.id) },
      ],
    );
  };

  const renderEntry = ({ item: e }: { item: Entry }) => {
    let title: string;
    let subtitle: string;
    let amount: string;
    let badge: { label: string; tone: BadgeTone } | null = null;
    let asset: string;
    let positive = true;
    if (e.kind === 'deposit') {
      const d = e.item;
      asset = d.asset;
      title = `Deposit ${d.asset}`;
      subtitle = `${d.network} · ${fmtDateTime(d.createdAt)}`;
      amount = `+${formatNumber(d.amount, 8, { trim: true })}`;
      badge = {
        label: d.status === 'CONFIRMING' ? `${d.confirmations}/${d.requiredConfirmations}` : humanize(d.status),
        tone: depositTone(d.status),
      };
    } else if (e.kind === 'withdrawal') {
      const w = e.item;
      asset = w.asset;
      positive = false;
      title = `Withdraw ${w.asset}`;
      subtitle = `${shortAddress(w.address)} · ${fmtDateTime(w.createdAt)}`;
      amount = `-${formatNumber(w.amount, 8, { trim: true })}`;
      badge = { label: humanize(w.status), tone: withdrawalTone(w.status) };
    } else {
      const tr = e.item;
      asset = tr.asset;
      positive = tr.direction !== 'OUT';
      title =
        tr.type === 'USER'
          ? tr.direction === 'IN'
            ? `Received ${tr.asset}`
            : `Sent ${tr.asset}`
          : `${humanize(tr.fromAccount)} → ${humanize(tr.toAccount)}`;
      subtitle = `${tr.counterparty ? `${tr.counterparty} · ` : ''}${fmtDateTime(tr.createdAt)}`;
      amount = `${tr.direction === 'OUT' ? '-' : tr.direction === 'IN' ? '+' : ''}${formatNumber(tr.amount, 8, { trim: true })}`;
    }
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          haptics.selection();
          setDetail(e);
        }}
        style={({ pressed }) => [s.row, pressed && { backgroundColor: t.colors.hover }]}
      >
        <AssetIcon symbol={asset} />
        <View style={s.flex}>
          <Txt variant="body" weight="semibold" numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        </View>
        <View style={s.right}>
          <Txt
            variant="body"
            weight="semibold"
            numeric
            color={
              e.kind === 'transfer' && e.item.direction === 'INTERNAL'
                ? t.colors.text
                : positive
                  ? t.colors.up
                  : t.colors.text
            }
          >
            {amount} {asset}
          </Txt>
          {badge ? <Badge label={badge.label} tone={badge.tone} style={s.badge} /> : null}
        </View>
      </Pressable>
    );
  };

  const copyHash = (hash: string) => {
    clipboard.copy(hash);
    haptics.success();
    toast.success('Transaction hash copied');
  };

  return (
    <Screen scroll={false} padded={false}>
      <View style={s.tabs}>
        <Tabs
          options={[
            { value: 'deposits', label: 'Deposits' },
            { value: 'withdrawals', label: 'Withdrawals' },
            { value: 'transfers', label: 'Transfers' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <Divider />
      <FlatList
        data={entries}
        keyExtractor={(e) => `${e.kind}:${e.item.id}`}
        renderItem={renderEntry}
        ItemSeparatorComponent={Separator}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        ListFooterComponent={
          q.isFetchingNextPage ? <ActivityIndicator color={t.colors.brand} style={s.footer} /> : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.textMuted}
            colors={[t.colors.brand]}
          />
        }
        ListEmptyComponent={
          q.isPending ? (
            <View style={s.pad}>
              <SkeletonRows count={8} />
            </View>
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <EmptyState icon="history" title={`No ${tab} yet`} />
          )
        }
        contentContainerStyle={s.list}
      />

      <Sheet
        visible={detail !== null}
        onClose={() => setDetail(null)}
        title={
          shown
            ? shown.kind === 'deposit'
              ? 'Deposit'
              : shown.kind === 'withdrawal'
                ? 'Withdrawal'
                : 'Transfer'
            : undefined
        }
        scroll
      >
        {shown?.kind === 'deposit' ? (
          <>
            <KeyValue
              label="Amount"
              value={`${formatNumber(shown.item.amount, 8, { trim: true })} ${shown.item.asset}`}
            />
            <KeyValue label="Status" value={humanize(shown.item.status)} />
            <KeyValue label="Network" value={shown.item.network} />
            <KeyValue
              label="Confirmations"
              value={`${shown.item.confirmations} / ${shown.item.requiredConfirmations}`}
            />
            <KeyValue label="Address" value={shortAddress(shown.item.address, 10, 8)} />
            <KeyValue label="Created" value={fmtDateTime(shown.item.createdAt)} />
            {shown.item.creditedAt ? <KeyValue label="Credited" value={fmtDateTime(shown.item.creditedAt)} /> : null}
            <KeyValue label="Tx hash" value={shortAddress(shown.item.txHash, 10, 8)} />
            <Button
              title="Copy transaction hash"
              icon="copy"
              variant="secondary"
              onPress={() => copyHash(shown.item.txHash)}
              style={s.sheetButton}
            />
          </>
        ) : null}
        {shown?.kind === 'withdrawal' ? (
          <>
            <KeyValue
              label="Amount"
              value={`${formatNumber(shown.item.amount, 8, { trim: true })} ${shown.item.asset}`}
            />
            <KeyValue label="Fee" value={`${formatNumber(shown.item.fee, 8, { trim: true })} ${shown.item.asset}`} />
            <KeyValue
              label="Receive"
              value={`${formatNumber(shown.item.receiveAmount, 8, { trim: true })} ${shown.item.asset}`}
            />
            <KeyValue label="Status" value={humanize(shown.item.status)} />
            <KeyValue label="Network" value={shown.item.network} />
            <KeyValue label="Address" value={shortAddress(shown.item.address, 10, 8)} />
            {shown.item.memo ? <KeyValue label="Memo" value={shown.item.memo} /> : null}
            <KeyValue label="Created" value={fmtDateTime(shown.item.createdAt)} />
            {shown.item.reviewNote ? <KeyValue label="Note" value={shown.item.reviewNote} /> : null}
            {shown.item.txHash ? (
              <Button
                title="Copy transaction hash"
                icon="copy"
                variant="secondary"
                onPress={() => copyHash(shown.item.txHash ?? '')}
                style={s.sheetButton}
              />
            ) : null}
            {CANCELLABLE.includes(shown.item.status) ? (
              <Button
                title="Cancel withdrawal"
                variant="danger"
                loading={cancel.isPending}
                onPress={() => confirmCancel(shown.item)}
                style={s.sheetButton}
              />
            ) : null}
          </>
        ) : null}
        {shown?.kind === 'transfer' ? (
          <>
            <KeyValue
              label="Amount"
              value={`${formatNumber(shown.item.amount, 8, { trim: true })} ${shown.item.asset}`}
            />
            <KeyValue label="From" value={humanize(shown.item.fromAccount)} />
            <KeyValue label="To" value={humanize(shown.item.toAccount)} />
            {shown.item.counterparty ? <KeyValue label="Counterparty" value={shown.item.counterparty} /> : null}
            <KeyValue label="Date" value={fmtDateTime(shown.item.createdAt)} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  tabs: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  list: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  flex: {
    flex: 1,
  },
  right: {
    alignItems: 'flex-end',
  },
  badge: {
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  footer: {
    marginVertical: 16,
  },
  pad: {
    paddingHorizontal: 16,
  },
  sheetButton: {
    marginTop: 14,
  },
}));
