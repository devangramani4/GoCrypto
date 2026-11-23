import type { AccountType } from '@gocrypto/shared-types';
import { ACCOUNT_TYPES } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { accountTransferSchema, fieldErrors, type AccountTransferInput } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { Button, Card, Icon, Notice, OptionSheet, Screen, TextField, Txt } from '../../components';
import { availableOf, useAssets, useBalances } from '../../hooks/useAccount';
import { api } from '../../lib/api';
import { apiFieldErrors, errorMessage } from '../../lib/errors';
import { formatNumber, isPositive, plain } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';
import { AssetSelect } from './AssetPicker';

const LABEL: Record<AccountType, string> = { SPOT: 'Spot', FUTURES: 'Futures', OPTIONS: 'Options' };

/** Moves funds between the user's own spot / futures / options accounts. */
export function TransferScreen({ navigation, route }: RootScreenProps<'Transfer'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [from, setFrom] = useState<AccountType>(route.params?.from ?? 'SPOT');
  const [to, setTo] = useState<AccountType>(
    route.params?.to ?? (route.params?.from === 'FUTURES' ? 'SPOT' : 'FUTURES'),
  );
  const [assetSymbol, setAssetSymbol] = useState(route.params?.asset ?? 'USDT');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const assets = useAssets();
  const balances = useBalances(from);
  const available = availableOf(balances.data, assetSymbol);

  // Assets held in the source account first, then the rest of the catalogue.
  const assetList = useMemo(() => {
    const held = new Set((balances.data ?? []).filter((b) => isPositive(b.available)).map((b) => b.asset));
    return [...(assets.data ?? [])].sort((a, b) => Number(held.has(b.symbol)) - Number(held.has(a.symbol)));
  }, [assets.data, balances.data]);

  const transfer = useMutation({
    mutationFn: (body: AccountTransferInput) => api.wallet.transfer(body),
    onSuccess: (res) => {
      haptics.success();
      toast.success(
        'Transfer complete',
        `${formatNumber(res.amount, 8, { trim: true })} ${res.asset} · ${LABEL[res.fromAccount]} → ${LABEL[res.toAccount]}`,
      );
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void qc.invalidateQueries({ queryKey: qk.futures });
      void qc.invalidateQueries({ queryKey: qk.optionsAccount });
      void qc.invalidateQueries({ queryKey: qk.portfolio });
      navigation.goBack();
    },
    onError: (e) => {
      haptics.error();
      setErrors(apiFieldErrors(e));
      setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const parsed = accountTransferSchema.safeParse({ asset: assetSymbol, amount: amount.replace(/\.$/, ''), from, to });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (parsed.success && D(parsed.data.amount).gt(available)) next.amount = 'Amount exceeds the available balance';
    if (!parsed.success || Object.keys(next).length) {
      haptics.warning();
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    transfer.mutate(parsed.data);
  };

  const swap = () => {
    haptics.selection();
    setFrom(to);
    setTo(from);
    setAmount('');
    setErrors({});
  };

  const accountOptions = ACCOUNT_TYPES.map((a) => ({ value: a, label: `${LABEL[a]} account` }));

  return (
    <Screen contentStyle={s.content}>
      <Card style={s.route}>
        <View style={s.routeFields}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="From account"
            onPress={() => setPicking('from')}
            style={s.routeRow}
          >
            <Txt variant="caption" tone="muted" style={s.routeLabel}>
              From
            </Txt>
            <Txt variant="body" weight="semibold" style={s.flex}>
              {LABEL[from]}
            </Txt>
            <Icon name="chevron-down" size={16} color={t.colors.textMuted} />
          </Pressable>
          <View style={s.routeDivider} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="To account"
            onPress={() => setPicking('to')}
            style={s.routeRow}
          >
            <Txt variant="caption" tone="muted" style={s.routeLabel}>
              To
            </Txt>
            <Txt variant="body" weight="semibold" style={s.flex}>
              {LABEL[to]}
            </Txt>
            <Icon name="chevron-down" size={16} color={t.colors.textMuted} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Swap accounts"
          onPress={swap}
          style={s.swap}
          hitSlop={6}
        >
          <Icon name="swap-vertical" size={20} color={t.colors.brand} />
        </Pressable>
      </Card>
      {errors.to ? (
        <Txt variant="caption" tone="down" style={s.routeError}>
          {errors.to}
        </Txt>
      ) : null}

      <View style={s.block}>
        <AssetSelect
          assets={assetList}
          value={assetSymbol}
          onChange={(sym) => {
            setAssetSymbol(sym);
            setAmount('');
          }}
          describe={(a) => {
            const v = availableOf(balances.data, a.symbol);
            return isPositive(v) ? formatNumber(v, 8, { trim: true }) : undefined;
          }}
        />
      </View>

      <TextField
        label="Amount"
        decimal
        maxDecimals={8}
        value={amount}
        onChangeText={(v) => {
          setAmount(v);
          setErrors({});
        }}
        suffix={assetSymbol}
        placeholder="0"
        error={errors.amount}
        hint={`Available: ${formatNumber(available, 8, { trim: true })} ${assetSymbol}`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Transfer maximum"
            hitSlop={8}
            style={s.max}
            onPress={() => {
              haptics.selection();
              setAmount(plain(available));
              setErrors({});
            }}
          >
            <Txt variant="label" tone="brand" weight="semibold">
              MAX
            </Txt>
          </Pressable>
        }
      />

      {formError ? <Notice tone="down" message={formError} style={s.notice} /> : null}

      <Button title="Transfer" size="lg" onPress={submit} loading={transfer.isPending} style={s.block} />

      <OptionSheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'from' ? 'Transfer from' : 'Transfer to'}
        items={accountOptions}
        selected={picking === 'from' ? from : to}
        onSelect={(v) => {
          if (picking === 'from') {
            if (v === to) setTo(from);
            setFrom(v);
            setAmount('');
          } else {
            if (v === from) setFrom(to);
            setTo(v);
          }
          setErrors({});
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    paddingTop: 12,
  },
  flex: {
    flex: 1,
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  routeFields: {
    flex: 1,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  routeLabel: {
    width: 44,
  },
  routeDivider: {
    height: t.hairline,
    backgroundColor: t.colors.border,
  },
  routeError: {
    marginTop: 6,
  },
  swap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 12,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: {
    marginTop: 14,
  },
  max: {
    marginLeft: 10,
  },
  notice: {
    marginTop: 4,
  },
}));
