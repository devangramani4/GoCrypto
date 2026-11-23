import type { UserSettingsDto } from '@gocrypto/shared-types';
import { fieldErrors, verifyEmailSchema } from '@gocrypto/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Children, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  CodeInput,
  Divider,
  Icon,
  ListRow,
  Notice,
  Screen,
  SegmentedControl,
  Sheet,
  Skeleton,
  SwitchRow,
  TabHeader,
  Txt,
} from '../../components';
import { config } from '../../config';
import { useUserSettings } from '../../hooks/useAccount';
import { useCooldown, useMe, useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { authenticate, getBiometricSupport, type BiometricSupport } from '../../lib/biometrics';
import { errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { TabScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { useSettings, type ThemeMode } from '../../store/settings';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const s = useStyles();
  const items = Children.toArray(children);
  return (
    <View style={s.section}>
      {title ? (
        <Txt variant="micro" tone="faint" style={s.sectionTitle}>
          {title.toUpperCase()}
        </Txt>
      ) : null}
      <Card padded={false}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 ? <Divider inset={62} /> : null}
            {child}
          </View>
        ))}
      </Card>
      {footer ? (
        <Txt variant="caption" tone="faint" style={s.sectionFooter}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}

export function ProfileScreen({ navigation }: TabScreenProps<'Profile'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const me = useMe();
  const user = me.data;
  const security = useQuery({ queryKey: qk.security, queryFn: () => api.auth.security() });
  const serverSettings = useUserSettings();
  const themeMode = useSettings((st) => st.themeMode);
  const biometricLock = useSettings((st) => st.biometricLock);
  const hideBalances = useSettings((st) => st.hideBalances);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);

  useEffect(() => {
    void getBiometricSupport().then(setSupport);
  }, []);

  const { refreshing, onRefresh } = useRefresh(() =>
    Promise.all([me.refetch(), security.refetch(), serverSettings.refetch()]),
  );

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<UserSettingsDto>) => api.users.updateSettings(patch),
    onSuccess: (res) => qc.setQueryData(qk.userSettings, res),
    onError: (e) => toast.error('Could not save setting', errorMessage(e)),
  });

  const setTheme = (mode: ThemeMode) => {
    useSettings.getState().setThemeMode(mode);
    // Keep the account-level preference in sync for the web/desktop apps (best effort, silent).
    api.users
      .updateSettings({ theme: mode })
      .then((res) => qc.setQueryData(qk.userSettings, res))
      .catch(() => undefined);
  };

  const toggleBiometric = async (next: boolean) => {
    const sup = support ?? (await getBiometricSupport());
    if (next && !sup.available) {
      Alert.alert(
        'Not available',
        'Set up Face ID / Touch ID, fingerprint or a device passcode in your system settings first.',
      );
      return;
    }
    const res = await authenticate(next ? `Enable ${sup.label} for GoCrypto` : 'Confirm to turn off the app lock');
    if (res.success) {
      useSettings.getState().setBiometricLock(next);
      haptics.success();
      toast.success(next ? `${sup.label} lock enabled` : 'App lock disabled');
    } else if (!res.cancelled) {
      toast.error('Authentication failed', res.message);
    }
  };

  const confirmLogout = () => {
    Alert.alert('Sign out of GoCrypto?', 'You will need your password (and 2FA code) to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void useSession.getState().signOut() },
    ]);
  };

  const copyUid = async () => {
    if (!user) return;
    await Clipboard.setStringAsync(user.uid);
    haptics.success();
    toast.success('UID copied');
  };

  const sec = security.data;
  const score = sec?.securityScore ?? 0;
  const scoreColor = score >= 80 ? t.colors.up : score >= 50 ? t.colors.warn : t.colors.down;
  const name = user?.displayName ?? user?.email.split('@')[0] ?? '';
  const biometricLabel = support?.available ? support.label : 'Biometric unlock';

  return (
    <Screen
      topInset
      bottomInset={false}
      header={<TabHeader title="Profile" />}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <Card style={s.userCard}>
        {user ? (
          <View style={s.userRow}>
            <View style={s.avatar}>
              <Txt variant="heading" weight="bold" color={t.colors.brand}>
                {name.slice(0, 2).toUpperCase()}
              </Txt>
            </View>
            <View style={s.flex}>
              <Txt variant="subtitle" numberOfLines={1}>
                {name}
              </Txt>
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {user.email}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy UID"
                onPress={() => void copyUid()}
                style={s.uid}
                hitSlop={6}
              >
                <Txt variant="caption" tone="faint" numeric>
                  UID {user.uid}
                </Txt>
                <Icon name="copy" size={13} color={t.colors.textFaint} />
              </Pressable>
              <View style={s.badges}>
                <Badge label={`VIP ${user.vipTier}`} tone="brand" />
                <Badge label={`KYC L${user.kycLevel}`} tone={user.kycLevel > 0 ? 'up' : 'neutral'} />
                {config.sandbox ? <Badge label="SANDBOX" tone="warn" /> : null}
              </View>
            </View>
          </View>
        ) : (
          <Skeleton height={64} />
        )}
      </Card>

      {sec ? (
        <Card style={s.block}>
          <View style={s.scoreHead}>
            <Txt variant="label" tone="muted">
              Security score
            </Txt>
            <Txt variant="label" weight="bold" numeric color={scoreColor}>
              {score}/100
            </Txt>
          </View>
          <View style={s.scoreTrack}>
            <View
              style={[s.scoreFill, { width: `${Math.min(100, Math.max(0, score))}%`, backgroundColor: scoreColor }]}
            />
          </View>
          {score < 80 ? (
            <Txt variant="caption" tone="muted" style={s.scoreHint}>
              Enable 2FA, set a trading PIN and verify your e-mail to protect your account.
            </Txt>
          ) : null}
        </Card>
      ) : null}

      <Section title="Security">
        <ListRow
          icon="mail"
          title="E-mail verification"
          value={sec ? (sec.emailVerified ? 'Verified' : 'Verify') : undefined}
          right={sec && !sec.emailVerified ? <Badge label="Action needed" tone="warn" /> : undefined}
          onPress={sec && !sec.emailVerified ? () => setVerifyOpen(true) : undefined}
          chevron={Boolean(sec && !sec.emailVerified)}
        />
        <ListRow
          icon="shield"
          title="Two-factor authentication"
          value={sec ? (sec.twoFactorEnabled ? 'On' : 'Off') : undefined}
          onPress={() => navigation.navigate('TwoFactorSetup')}
        />
        <ListRow
          icon="key"
          title="Trading PIN"
          subtitle="Required for withdrawals"
          value={sec ? (sec.hasTradingPin ? 'Change' : 'Set up') : undefined}
          onPress={() => navigation.navigate('SetPin')}
        />
        <ListRow
          icon="phone"
          title="Devices & sessions"
          value={sec ? `${sec.activeSessions} active` : undefined}
          onPress={() => navigation.navigate('Devices')}
        />
      </Section>

      <Section title="Preferences">
        <View style={s.appearance}>
          <View style={s.appearanceHead}>
            <Icon name={t.dark ? 'moon' : 'sun'} size={18} color={t.colors.brand} />
            <Txt variant="body" weight="medium">
              Appearance
            </Txt>
          </View>
          <SegmentedControl
            size="sm"
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
            value={themeMode}
            onChange={setTheme}
          />
        </View>
        <SwitchRow
          icon={support?.kind === 'face' ? 'face-id' : support?.kind === 'fingerprint' ? 'fingerprint' : 'lock'}
          title={`${biometricLabel} lock`}
          subtitle="Require authentication when opening the app"
          value={biometricLock}
          onValueChange={(v) => void toggleBiometric(v)}
          disabled={support !== null && !support.available && !biometricLock}
        />
        <SwitchRow
          icon="eye-off"
          title="Hide balances"
          subtitle="Mask amounts on Home and Wallet"
          value={hideBalances}
          onValueChange={() => useSettings.getState().toggleHideBalances()}
        />
        <SwitchRow
          icon="check-circle"
          title="Confirm orders"
          subtitle="Review every order before it is sent"
          value={serverSettings.data?.confirmOrders ?? true}
          disabled={!serverSettings.data || updateSettings.isPending}
          onValueChange={(v) => updateSettings.mutate({ confirmOrders: v })}
        />
        <ListRow
          icon="bell"
          title="Notifications"
          subtitle="Trading, wallet and security alerts"
          onPress={() => navigation.navigate('NotificationPrefs')}
        />
      </Section>

      <Section title="About">
        <ListRow icon="info" title="Version" value={config.appVersion} chevron={false} />
        <ListRow
          icon="zap"
          title="Environment"
          value={config.sandbox ? 'Sandbox (paper trading)' : 'Live'}
          chevron={false}
        />
        <ListRow icon="external" title="API" value={config.apiUrl.replace(/^https?:\/\//, '')} chevron={false} />
      </Section>

      <Button title="Sign out" icon="logout" variant="danger" onPress={confirmLogout} style={s.logout} />

      {user ? <VerifyEmailSheet visible={verifyOpen} onClose={() => setVerifyOpen(false)} email={user.email} /> : null}
    </Screen>
  );
}

function VerifyEmailSheet({ visible, onClose, email }: { visible: boolean; onClose: () => void; email: string }) {
  const s = useStyles();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cooldown, startCooldown] = useCooldown();

  const send = useMutation({
    mutationFn: () => api.auth.sendEmailVerification(),
    onSuccess: () => {
      setSent(true);
      startCooldown(60);
      toast.info('Code sent', `Check ${email} for a 6-digit code.`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const verify = useMutation({
    mutationFn: (c: string) => api.auth.verifyEmail(c),
    onSuccess: () => {
      haptics.success();
      toast.success('E-mail verified');
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.security });
      onClose();
    },
    onError: (e) => {
      haptics.error();
      setCode('');
      setError(errorMessage(e));
    },
  });

  const submit = (value: string) => {
    const parsed = verifyEmailSchema.safeParse({ code: value });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed.error))[0] ?? 'Enter the 6-digit code');
      return;
    }
    setError(null);
    verify.mutate(parsed.data.code);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Verify e-mail" subtitle={email}>
      {sent ? (
        <CodeInput value={code} onChange={setCode} onComplete={submit} error={Boolean(error)} />
      ) : (
        <Txt variant="body" tone="muted">
          We'll send a 6-digit code to confirm that this e-mail address belongs to you.
        </Txt>
      )}
      {error ? <Notice tone="down" message={error} style={s.block} /> : null}
      <Button
        title={sent ? (cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code') : 'Send code'}
        variant={sent ? 'ghost' : 'primary'}
        onPress={() => send.mutate()}
        loading={send.isPending}
        disabled={cooldown > 0}
        style={s.block}
      />
      {sent ? (
        <Button title="Verify" onPress={() => submit(code)} loading={verify.isPending} style={s.verifyButton} />
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  flex: {
    flex: 1,
  },
  block: {
    marginTop: 12,
  },
  userCard: {
    marginTop: 4,
  },
  userRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  scoreHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  scoreTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.border,
    overflow: 'hidden',
  },
  scoreFill: {
    height: 6,
    borderRadius: 3,
  },
  scoreHint: {
    marginTop: 8,
  },
  section: {
    marginTop: 22,
  },
  sectionTitle: {
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.6,
  },
  sectionFooter: {
    marginTop: 8,
    marginHorizontal: 4,
  },
  appearance: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  appearanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logout: {
    marginTop: 26,
  },
  verifyButton: {
    marginTop: 4,
  },
}));
