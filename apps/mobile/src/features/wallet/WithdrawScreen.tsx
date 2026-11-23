import { D, ROUND_DOWN } from '@gocrypto/trading-utils';
import { fieldErrors, withdrawSchema, type WithdrawInput } from '@gocrypto/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import {
  Button,
  Card,
  CodeInput,
  ErrorState,
  Icon,
  KeyValue,
  Notice,
  Screen,
  Sheet,
  Skeleton,
  TextField,
  Txt,
} from '../../components';
import { useAssets } from '../../hooks/useAccount';
import { useCooldown } from '../../hooks/useCommon';
import { api, newIdempotencyKey } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/errors';
import { formatNumber, humanize, isPositive, plain, shortAddress } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';
import { AssetSelect, NetworkSelect } from './AssetPicker';

interface AddressCheck {
  valid: boolean;
  reason?: string;
  normalized?: string;
}

export function WithdrawScreen({ navigation, route }: RootScreenProps<'Withdraw'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const user = useSession((st) => st.user);
  const assets = useAssets();
  const [assetSymbol, setAssetSymbol] = useState(route.params?.asset ?? 'USDT');
  const [networkCode, setNetworkCode] = useState<string | undefined>(undefined);
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [totp, setTotp] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  const withdrawable = useMemo(
    () => (assets.data ?? []).filter((a) => a.withdrawEnabled && a.networks.some((n) => n.withdrawEnabled)),
    [assets.data],
  );
  const asset = withdrawable.find((a) => a.symbol === assetSymbol) ?? withdrawable[0];
  const networks = asset?.networks.filter((n) => n.withdrawEnabled) ?? [];
  const network = networks.find((n) => n.code === networkCode) ?? networks[0];
  const precision = network?.withdrawalPrecision ?? 8;

  const limits = useQuery({
    queryKey: qk.withdrawalLimits(asset?.symbol ?? '', network?.code ?? ''),
    queryFn: () => api.wallet.withdrawalLimits(asset?.symbol ?? '', network?.code ?? ''),
    enabled: Boolean(asset && network),
  });

  // A different asset/network invalidates the address check.
  useEffect(() => {
    setAddressCheck(null);
    setErrors({});
  }, [asset?.symbol, network?.code]);

  const requires = limits.data?.requires ?? { pin: true, totp: Boolean(user?.twoFactorEnabled), emailCode: false };
  const fee = limits.data?.fee ?? network?.withdrawalFee ?? '0';
  const cleanAmount = amount.replace(/\.$/, '');
  const receive = isPositive(cleanAmount) ? D(cleanAmount).minus(fee) : null;
  const blocked = user?.withdrawalsEnabled === false;
  const needsPinSetup = requires.pin && user?.hasTradingPin === false;

  const validateAddress = useMutation({
    mutationFn: (args: { network: string; address: string; memo: string | null }) =>
      api.wallet.validateAddress(args.network, args.address, args.memo),
    onSuccess: (res) => setAddressCheck(res),
  });

  const checkAddress = () => {
    const a = address.trim();
    if (network && a.length >= 10)
      validateAddress.mutate({ network: network.code, address: a, memo: memo.trim() || null });
  };

  const sendCode = useMutation({
    mutationFn: () =>
      api.wallet.sendWithdrawalCode({ asset: asset?.symbol ?? '', amount: cleanAmount, address: address.trim() }),
    onSuccess: () => {
      startCooldown(60);
      toast.info('Code sent', 'Check your e-mail for the 6-digit confirmation code.');
    },
    onError: (e) => setSubmitError(errorMessage(e)),
  });

  const withdraw = useMutation({
    mutationFn: (body: WithdrawInput) => api.wallet.withdraw(body),
    onSuccess: (w) => {
      haptics.success();
      setReviewKey(null);
      toast.success(
        'Withdrawal requested',
        `${formatNumber(w.amount, 8, { trim: true })} ${w.asset} · ${humanize(w.status)}`,
      );
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void qc.invalidateQueries({ queryKey: qk.portfolio });
      navigation.replace('WalletHistory', { tab: 'withdrawals' });
    },
    onError: (e) => {
      haptics.error();
      const code = errorCode(e);
      if (code === 'INVALID_PIN') setPin('');
      if (code === 'INVALID_MFA_CODE') setTotp('');
      if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') setEmailCode('');
      setSubmitError(errorMessage(e));
    },
  });

  const baseBody = () => ({
    asset: asset?.symbol ?? '',
    network: network?.code ?? '',
    address: address.trim(),
    memo: memo.trim() || undefined,
    amount: cleanAmount,
  });

  const toReview = () => {
    Keyboard.dismiss();
    const parsed = withdrawSchema.safeParse({ ...baseBody(), idempotencyKey: newIdempotencyKey('w') });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (addressCheck && !addressCheck.valid) next.address = addressCheck.reason ?? 'Invalid address for this network';
    if (receive && receive.lte(0)) next.amount = 'Amount must be greater than the network fee';
    if (limits.data && isPositive(cleanAmount) && D(cleanAmount).gt(limits.data.available))
      next.amount = 'Amount exceeds your available balance';
    if (Object.keys(next).length) {
      haptics.warning();
      setErrors(next);
      return;
    }
    setErrors({});
    setPin('');
    setTotp('');
    setEmailCode('');
    setSubmitError(null);
    setReviewKey(newIdempotencyKey('w'));
  };

  const confirm = () => {
    if (!reviewKey) return;
    if (requires.pin && pin.length !== 6) return setSubmitError('Enter your 6-digit trading PIN');
    if (requires.totp && totp.length !== 6) return setSubmitError('Enter the 6-digit code from your authenticator app');
    if (requires.emailCode && emailCode.length !== 6) return setSubmitError('Enter the 6-digit code we e-mailed you');
    const parsed = withdrawSchema.safeParse({
      ...baseBody(),
      pin: requires.pin ? pin : undefined,
      totpCode: requires.totp ? totp : undefined,
      emailCode: requires.emailCode ? emailCode : undefined,
      idempotencyKey: reviewKey,
    });
    if (!parsed.success) {
      setSubmitError(Object.values(fieldErrors(parsed.error))[0] ?? 'Check the withdrawal details');
      return;
    }
    setSubmitError(null);
    withdraw.mutate(parsed.data);
  };

  if (assets.isPending) {
    return (
      <Screen contentStyle={s.content}>
        <Skeleton height={56} style={s.gap} />
        <Skeleton height={56} style={s.gap} />
        <Skeleton height={200} />
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
      {blocked ? (
        <Notice
          tone="down"
          title="Withdrawals disabled"
          message="Withdrawals are disabled for your account. Contact support."
          style={s.gap}
        />
      ) : null}
      {needsPinSetup ? (
        <Notice
          tone="warn"
          title="Trading PIN required"
          message="Set a 6-digit trading PIN to authorise withdrawals."
          style={s.gap}
        >
          <Button
            title="Set PIN"
            size="sm"
            variant="secondary"
            onPress={() => navigation.navigate('SetPin')}
            style={s.noticeButton}
          />
        </Notice>
      ) : null}

      <AssetSelect
        assets={withdrawable}
        value={asset?.symbol}
        onChange={(sym) => {
          setAssetSymbol(sym);
          setNetworkCode(undefined);
          setAmount('');
        }}
      />
      <NetworkSelect networks={networks} value={network?.code} onChange={setNetworkCode} />

      <TextField
        label="Recipient address"
        value={address}
        onChangeText={(v) => {
          setAddress(v.trim());
          setAddressCheck(null);
          setErrors({});
        }}
        onBlur={checkAddress}
        placeholder={network ? `${network.name} address` : 'Address'}
        autoCapitalize="none"
        autoCorrect={false}
        error={
          errors.address ?? (addressCheck && !addressCheck.valid ? (addressCheck.reason ?? 'Invalid address') : null)
        }
        hint={addressCheck?.valid ? `✓ Valid ${network?.code ?? ''} address` : undefined}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Paste address"
            hitSlop={8}
            onPress={() => {
              void Clipboard.getStringAsync().then((text) => {
                if (text) {
                  setAddress(text.trim());
                  setAddressCheck(null);
                  haptics.selection();
                }
              });
            }}
          >
            <Icon name="clipboard" size={20} color={t.colors.brand} />
          </Pressable>
        }
      />
      {network?.memoSupported ? (
        <TextField
          label="Memo / Tag (if required by the recipient)"
          value={memo}
          onChangeText={setMemo}
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.memo}
        />
      ) : null}
      <TextField
        label="Amount"
        decimal
        maxDecimals={precision}
        value={amount}
        onChangeText={(v) => {
          setAmount(v);
          setErrors({});
        }}
        suffix={asset?.symbol}
        placeholder={limits.data ? `Min ${formatNumber(limits.data.minAmount, precision, { trim: true })}` : '0'}
        error={errors.amount}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use maximum amount"
            hitSlop={8}
            style={s.max}
            onPress={() => {
              if (!limits.data) return;
              haptics.selection();
              setAmount(plain(D(limits.data.available).toDecimalPlaces(precision, ROUND_DOWN)));
              setErrors({});
            }}
          >
            <Txt variant="label" tone="brand" weight="semibold">
              MAX
            </Txt>
          </Pressable>
        }
      />

      <Card>
        {limits.isPending ? (
          <Skeleton height={80} />
        ) : limits.isError ? (
          <ErrorState compact error={limits.error} onRetry={() => void limits.refetch()} />
        ) : (
          <>
            <KeyValue
              label="Available"
              value={`${formatNumber(limits.data.available, precision, { trim: true })} ${limits.data.asset}`}
            />
            <KeyValue
              label="Network fee"
              value={`${formatNumber(fee, precision, { trim: true })} ${limits.data.asset}`}
            />
            <KeyValue
              label="Minimum"
              value={`${formatNumber(limits.data.minAmount, precision, { trim: true })} ${limits.data.asset}`}
            />
            <KeyValue label="24h limit remaining" value={`$${formatNumber(limits.data.remainingTodayUsd, 2)}`} />
            <View style={s.receive}>
              <Txt variant="label" tone="muted">
                You will receive
              </Txt>
              <Txt variant="subtitle" numeric>
                {receive && receive.gt(0)
                  ? `${formatNumber(receive, precision, { trim: true })} ${limits.data.asset}`
                  : '—'}
              </Txt>
            </View>
          </>
        )}
      </Card>

      <Notice
        tone="warn"
        message="Withdrawals to a wrong address or network cannot be reversed. Double-check the address and network before confirming."
        style={s.block}
      />

      <Button
        title="Continue"
        size="lg"
        onPress={toReview}
        disabled={blocked || needsPinSetup || !asset || !network}
        style={s.block}
      />

      <Sheet
        visible={reviewKey !== null}
        onClose={() => {
          if (!withdraw.isPending) setReviewKey(null);
        }}
        title="Confirm withdrawal"
        subtitle={asset ? `${asset.symbol} · ${network?.name ?? ''}` : undefined}
        dismissible={!withdraw.isPending}
        scroll
        footer={<Button title="Confirm withdrawal" onPress={confirm} loading={withdraw.isPending} />}
      >
        <KeyValue
          label="Amount"
          value={`${formatNumber(cleanAmount, precision, { trim: true })} ${asset?.symbol ?? ''}`}
        />
        <KeyValue
          label="Network fee"
          value={`${formatNumber(fee, precision, { trim: true })} ${asset?.symbol ?? ''}`}
        />
        <KeyValue
          label="You receive"
          value={receive ? `${formatNumber(receive, precision, { trim: true })} ${asset?.symbol ?? ''}` : '—'}
          valueTone="up"
        />
        <KeyValue label="Address" value={shortAddress(address, 10, 8)} />
        {memo ? <KeyValue label="Memo" value={memo} /> : null}

        {requires.pin ? (
          <View style={s.code}>
            <Txt variant="label" tone="muted" style={s.codeLabel}>
              Trading PIN
            </Txt>
            <CodeInput
              value={pin}
              onChange={setPin}
              secure
              oneTimeCode={false}
              autoFocus
              accessibilityLabel="Trading PIN"
            />
          </View>
        ) : null}
        {requires.totp ? (
          <View style={s.code}>
            <Txt variant="label" tone="muted" style={s.codeLabel}>
              Authenticator code
            </Txt>
            <CodeInput
              value={totp}
              onChange={setTotp}
              oneTimeCode={false}
              autoFocus={!requires.pin}
              accessibilityLabel="Authenticator code"
            />
          </View>
        ) : null}
        {requires.emailCode ? (
          <View style={s.code}>
            <View style={s.emailHead}>
              <Txt variant="label" tone="muted">
                E-mail code
              </Txt>
              <Pressable
                accessibilityRole="button"
                disabled={cooldown > 0 || sendCode.isPending}
                onPress={() => sendCode.mutate()}
                hitSlop={8}
              >
                <Txt variant="label" tone={cooldown > 0 ? 'faint' : 'brand'} weight="semibold">
                  {sendCode.isPending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send code'}
                </Txt>
              </Pressable>
            </View>
            <CodeInput value={emailCode} onChange={setEmailCode} autoFocus={false} accessibilityLabel="E-mail code" />
          </View>
        ) : null}
        {submitError ? <Notice tone="down" message={submitError} style={s.block} /> : null}
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: {
    paddingTop: 12,
  },
  gap: {
    marginBottom: 12,
  },
  block: {
    marginTop: 12,
  },
  noticeButton: {
    marginTop: 10,
  },
  max: {
    marginLeft: 10,
  },
  receive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 10,
  },
  code: {
    marginTop: 16,
  },
  codeLabel: {
    marginBottom: 8,
  },
  emailHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
}));
