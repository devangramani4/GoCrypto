import { fieldErrors, simulateDepositSchema } from '@gocrypto/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import {
  Button,
  Card,
  ErrorState,
  Icon,
  KeyValue,
  ListRow,
  Notice,
  QrCode,
  Screen,
  Skeleton,
  TextField,
  Txt,
} from '../../components';
import { config } from '../../config';
import { useAssets } from '../../hooks/useAccount';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatNumber, humanize } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';
import { AssetSelect, NetworkSelect } from './AssetPicker';

async function copy(value: string, what: string): Promise<void> {
  await Clipboard.setStringAsync(value);
  haptics.success();
  toast.success(`${what} copied`);
}

export function DepositScreen({ navigation, route }: RootScreenProps<'Deposit'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const assets = useAssets();
  const [assetSymbol, setAssetSymbol] = useState(route.params?.asset ?? 'USDT');
  const [networkCode, setNetworkCode] = useState<string | undefined>(undefined);
  const [simAmount, setSimAmount] = useState('');
  const [simError, setSimError] = useState<string | null>(null);

  const depositable = useMemo(
    () => (assets.data ?? []).filter((a) => a.depositEnabled && a.networks.some((n) => n.depositEnabled)),
    [assets.data],
  );
  const asset = depositable.find((a) => a.symbol === assetSymbol) ?? depositable[0];
  const networks = asset?.networks.filter((n) => n.depositEnabled) ?? [];
  const network = networks.find((n) => n.code === networkCode) ?? networks[0];

  const address = useQuery({
    queryKey: qk.depositAddress(asset?.symbol ?? '', network?.code ?? ''),
    queryFn: () => api.wallet.depositAddress(asset?.symbol ?? '', network?.code ?? ''),
    enabled: Boolean(asset && network),
    staleTime: Infinity,
  });

  const simulate = useMutation({
    mutationFn: (body: { asset: string; network: string; amount: string }) => api.wallet.simulateDeposit(body),
    onSuccess: (dep) => {
      haptics.success();
      setSimAmount('');
      toast.success(
        dep.status === 'COMPLETED' ? 'Deposit credited' : 'Deposit detected',
        `${formatNumber(dep.amount, 8, { trim: true })} ${dep.asset} · ${humanize(dep.status)}`,
      );
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void qc.invalidateQueries({ queryKey: qk.portfolio });
    },
    onError: (e) => {
      haptics.error();
      setSimError(errorMessage(e));
    },
  });

  const runSimulation = () => {
    if (!asset || !network) return;
    const parsed = simulateDepositSchema.safeParse({
      asset: asset.symbol,
      network: network.code,
      amount: simAmount.replace(/\.$/, ''),
    });
    if (!parsed.success) {
      setSimError(Object.values(fieldErrors(parsed.error))[0] ?? 'Enter an amount');
      return;
    }
    setSimError(null);
    simulate.mutate(parsed.data);
  };

  if (assets.isPending) {
    return (
      <Screen contentStyle={s.content}>
        <Skeleton height={56} style={s.gap} />
        <Skeleton height={56} style={s.gap} />
        <Skeleton height={160} />
      </Screen>
    );
  }
  if (assets.isError) {
    return (
      <Screen>
        <ErrorState error={assets.error} onRetry={() => void assets.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={s.content}>
      <AssetSelect
        assets={depositable}
        value={asset?.symbol}
        onChange={(sym) => {
          setAssetSymbol(sym);
          setNetworkCode(undefined);
        }}
      />
      <NetworkSelect networks={networks} value={network?.code} onChange={setNetworkCode} />

      {asset && network ? (
        <>
          <Card>
            <Txt variant="label" tone="muted">
              Deposit address
            </Txt>
            {address.isPending ? (
              <Skeleton height={44} style={s.addressSkeleton} />
            ) : address.isError ? (
              <ErrorState compact error={address.error} onRetry={() => void address.refetch()} />
            ) : (
              <>
                <View style={s.qr}>
                  <QrCode value={address.data.address} label={`${asset.symbol} deposit address QR code`} />
                </View>
                <Txt variant="body" mono selectable style={s.address}>
                  {address.data.address}
                </Txt>
                <View style={s.addressActions}>
                  <Button
                    title="Copy address"
                    icon="copy"
                    size="sm"
                    onPress={() => void copy(address.data.address, 'Address')}
                    block
                    style={s.flex}
                  />
                  <Button
                    title="Share"
                    icon="share"
                    size="sm"
                    variant="secondary"
                    onPress={() => void Share.share({ message: address.data.address }).catch(() => undefined)}
                    block
                    style={s.flex}
                  />
                </View>
              </>
            )}
          </Card>

          {address.data?.memo ? (
            <Card style={s.block}>
              <View style={s.memoHead}>
                <Txt variant="label" tone="muted">
                  Memo / Tag
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy memo"
                  hitSlop={8}
                  onPress={() => void copy(address.data.memo ?? '', 'Memo')}
                >
                  <Icon name="copy" size={18} color={t.colors.brand} />
                </Pressable>
              </View>
              <Txt variant="subtitle" mono selectable style={s.memo}>
                {address.data.memo}
              </Txt>
              <Notice
                tone="warn"
                message="Both the address and the memo are required, otherwise your deposit will be lost."
              />
            </Card>
          ) : null}

          <Card style={s.block}>
            <KeyValue label="Network" value={network.name} />
            <KeyValue
              label="Minimum deposit"
              value={`${formatNumber(network.minDeposit, 8, { trim: true })} ${asset.symbol}`}
            />
            <KeyValue label="Confirmations" value={String(network.confirmations)} />
          </Card>
          <Notice
            tone="warn"
            message={`Send only ${asset.symbol} on the ${network.name} network to this address. Other assets or networks may be lost permanently.`}
            style={s.block}
          />

          {config.sandbox ? (
            <Card style={s.block}>
              <Txt variant="subtitle">Simulate a deposit</Txt>
              <Txt variant="caption" tone="muted" style={s.simText}>
                Sandbox only: credit test {asset.symbol} to your spot wallet as if it arrived on-chain.
              </Txt>
              <TextField
                label="Amount"
                dense
                decimal
                maxDecimals={network.withdrawalPrecision || 8}
                value={simAmount}
                onChangeText={(v) => {
                  setSimAmount(v);
                  setSimError(null);
                }}
                suffix={asset.symbol}
                placeholder="1000"
                error={simError}
              />
              <Button
                title="Simulate deposit"
                icon="zap"
                variant="secondary"
                onPress={runSimulation}
                loading={simulate.isPending}
              />
            </Card>
          ) : null}
        </>
      ) : (
        <Notice tone="info" message="Deposits are currently unavailable for this asset." />
      )}

      <Card padded={false} style={s.block}>
        <ListRow
          icon="history"
          title="Deposit history"
          onPress={() => navigation.navigate('WalletHistory', { tab: 'deposits' })}
        />
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  qr: { alignItems: 'center', marginTop: 12, marginBottom: 4 },
  content: {
    paddingTop: 12,
  },
  gap: {
    marginBottom: 12,
  },
  flex: {
    flex: 1,
  },
  block: {
    marginTop: 12,
  },
  addressSkeleton: {
    marginTop: 10,
  },
  address: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
  },
  addressActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  memoHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  memo: {
    marginTop: 6,
    marginBottom: 12,
  },
  simText: {
    marginTop: 4,
    marginBottom: 12,
  },
}));
