import type { AccountType, BalanceDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  AssetIcon,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  ListRow,
  PnLText,
  Screen,
  SegmentedControl,
  Sheet,
  Skeleton,
  SkeletonRows,
  Stat,
  TabHeader,
  Txt,
} from '../../components';
import { useLastNonNull, useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { formatNumber, formatUsd } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { TabScreenProps } from '../../navigation/types';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';

const ACCOUNTS: { value: AccountType; label: string }[] = [
  { value: 'SPOT', label: 'Spot' },
  { value: 'FUTURES', label: 'Futures' },
  { value: 'OPTIONS', label: 'Options' },
];

const HIDDEN = '••••••';

export function WalletScreen({ navigation }: TabScreenProps<'Wallet'>) {
  const t = useTheme();
  const s = useStyles();
  const hide = useSettings((st) => st.hideBalances);
  const [account, setAccount] = useState<AccountType>('SPOT');
  const [selected, setSelected] = useState<BalanceDto | null>(null);
  const sheetBalance = useLastNonNull(selected);

  const overview = useQuery({ queryKey: qk.walletOverview, queryFn: () => api.wallet.overview() });
  const futures = useQuery({
    queryKey: qk.futuresAccount,
    queryFn: () => api.futures.account(),
    enabled: account === 'FUTURES',
  });
  const options = useQuery({
    queryKey: qk.optionsAccount,
    queryFn: () => api.options.account(),
    enabled: account === 'OPTIONS',
  });

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([
      overview.refetch(),
      account === 'FUTURES' ? futures.refetch() : account === 'OPTIONS' ? options.refetch() : null,
    ]),
  );

  const balances = useMemo(() => {
    const list = overview.data?.accounts[account]?.balances ?? [];
    return list.filter((b) => !D(b.total).isZero()).sort((a, b) => D(b.usdValue).comparedTo(D(a.usdValue)));
  }, [overview.data, account]);

  const money = (v: string | undefined) => (hide ? HIDDEN : formatUsd(v));
  const o = overview.data;

  const header = (
    <TabHeader
      title="Wallet"
      right={
        <IconButton
          icon="history"
          accessibilityLabel="Transaction history"
          onPress={() => navigation.navigate('WalletHistory')}
        />
      }
    />
  );

  return (
    <Screen topInset bottomInset={false} header={header} refreshing={refreshing} onRefresh={onRefresh}>
      <Card style={s.total}>
        <View style={s.totalHead}>
          <Txt variant="label" tone="muted">
            Estimated total value
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hide ? 'Show balances' : 'Hide balances'}
            hitSlop={10}
            onPress={() => {
              haptics.selection();
              useSettings.getState().toggleHideBalances();
            }}
          >
            <Icon name={hide ? 'eye-off' : 'eye'} size={18} color={t.colors.textMuted} />
          </Pressable>
        </View>
        {o ? (
          <>
            <Txt variant="display" numeric numberOfLines={1} adjustsFontSizeToFit>
              {money(o.totalUsd)}
            </Txt>
            <View style={s.split}>
              {ACCOUNTS.map((a) => (
                <Stat key={a.value} label={a.label} value={money(o.accounts[a.value]?.totalUsd)} />
              ))}
            </View>
          </>
        ) : overview.isError ? (
          <ErrorState compact error={overview.error} onRetry={() => void overview.refetch()} />
        ) : (
          <Skeleton width={200} height={36} />
        )}
      </Card>

      <View style={s.actions}>
        <Button title="Deposit" icon="deposit" onPress={() => navigation.navigate('Deposit')} style={s.flex} />
        <Button
          title="Withdraw"
          icon="withdraw"
          variant="secondary"
          onPress={() => navigation.navigate('Withdraw')}
          style={s.flex}
        />
        <Button
          title="Transfer"
          icon="transfer"
          variant="secondary"
          onPress={() => navigation.navigate('Transfer')}
          style={s.flex}
        />
      </View>

      <SegmentedControl options={ACCOUNTS} value={account} onChange={setAccount} style={s.segment} />

      {account === 'FUTURES' && futures.data ? (
        <Card style={s.summary}>
          <View style={s.row}>
            <Stat label="Margin balance" value={hide ? HIDDEN : formatNumber(futures.data.marginBalance, 2)} />
            <Stat label="Available" value={hide ? HIDDEN : formatNumber(futures.data.availableBalance, 2)} />
            <Stat label="Unrealized PnL" align="right">
              {hide ? (
                <Txt variant="label">{HIDDEN}</Txt>
              ) : (
                <PnLText value={futures.data.unrealizedPnl} variant="label" weight="semibold" />
              )}
            </Stat>
          </View>
        </Card>
      ) : null}
      {account === 'OPTIONS' && options.data ? (
        <Card style={s.summary}>
          <View style={s.row}>
            <Stat label="Equity" value={hide ? HIDDEN : formatNumber(options.data.equity, 2)} />
            <Stat label="Available" value={hide ? HIDDEN : formatNumber(options.data.availableBalance, 2)} />
            <Stat label="Unrealized PnL" align="right">
              {hide ? (
                <Txt variant="label">{HIDDEN}</Txt>
              ) : (
                <PnLText value={options.data.unrealizedPnl} variant="label" weight="semibold" />
              )}
            </Stat>
          </View>
        </Card>
      ) : null}

      <Card padded={false} style={s.list}>
        {overview.isPending ? (
          <View style={s.pad}>
            <SkeletonRows count={5} />
          </View>
        ) : balances.length === 0 ? (
          <EmptyState
            compact
            icon="wallet"
            title="No assets in this account"
            message={
              account === 'SPOT' ? 'Deposit crypto to start trading.' : 'Transfer funds from your spot wallet to trade.'
            }
            actionLabel={account === 'SPOT' ? 'Deposit' : 'Transfer'}
            onAction={() =>
              account === 'SPOT' ? navigation.navigate('Deposit') : navigation.navigate('Transfer', { to: account })
            }
          />
        ) : (
          balances.map((b, i) => (
            <View key={`${b.account}:${b.asset}`}>
              {i > 0 ? <Divider inset={62} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${b.asset} balance`}
                onPress={() => {
                  haptics.selection();
                  setSelected(b);
                }}
                style={({ pressed }) => [s.balance, pressed && { backgroundColor: t.colors.hover }]}
              >
                <AssetIcon symbol={b.asset} />
                <View style={s.flex}>
                  <Txt variant="body" weight="semibold">
                    {b.asset}
                  </Txt>
                  <Txt variant="caption" tone="muted" numeric numberOfLines={1}>
                    {hide ? HIDDEN : `Avail ${formatNumber(b.available, 8, { trim: true })}`}
                    {!hide && !D(b.locked).isZero() ? ` · Locked ${formatNumber(b.locked, 8, { trim: true })}` : ''}
                  </Txt>
                </View>
                <View style={s.amount}>
                  <Txt variant="body" weight="semibold" numeric>
                    {hide ? HIDDEN : formatNumber(b.total, 8, { trim: true })}
                  </Txt>
                  <Txt variant="caption" tone="muted" numeric>
                    {money(b.usdValue)}
                  </Txt>
                </View>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Sheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={sheetBalance?.asset}
        subtitle={sheetBalance ? `${ACCOUNTS.find((a) => a.value === sheetBalance.account)?.label} account` : undefined}
      >
        {sheetBalance ? (
          <View style={s.sheetBody}>
            <ListRow
              icon="deposit"
              title={`Deposit ${sheetBalance.asset}`}
              onPress={() => {
                setSelected(null);
                navigation.navigate('Deposit', { asset: sheetBalance.asset });
              }}
            />
            <ListRow
              icon="withdraw"
              title={`Withdraw ${sheetBalance.asset}`}
              onPress={() => {
                setSelected(null);
                navigation.navigate('Withdraw', { asset: sheetBalance.asset });
              }}
            />
            <ListRow
              icon="transfer"
              title="Transfer between accounts"
              onPress={() => {
                setSelected(null);
                navigation.navigate('Transfer', { asset: sheetBalance.asset, from: sheetBalance.account });
              }}
            />
            {sheetBalance.asset !== 'USDT' ? (
              <ListRow
                icon="trade"
                title={`Trade ${sheetBalance.asset}/USDT`}
                onPress={() => {
                  setSelected(null);
                  navigation.navigate('Trade', { symbol: `${sheetBalance.asset}USDT` });
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  total: {
    marginTop: 6,
    padding: 18,
  },
  totalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  split: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: t.hairline,
    borderTopColor: t.colors.border,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  flex: {
    flex: 1,
  },
  segment: {
    marginTop: 20,
  },
  summary: {
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  list: {
    marginTop: 12,
  },
  pad: {
    paddingHorizontal: 16,
  },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  amount: {
    alignItems: 'flex-end',
  },
  sheetBody: {
    marginHorizontal: -16,
  },
}));
