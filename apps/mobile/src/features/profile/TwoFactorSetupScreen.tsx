import type { TwoFactorSetupDto } from '@gocrypto/shared-types';
import { disableTwoFactorSchema, enableTwoFactorSchema, fieldErrors } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clipboard } from '../../lib/clipboard';
import { useState } from 'react';
import { Keyboard, Linking, View } from 'react-native';
import { Button, Card, CodeInput, Icon, Notice, QrCode, Screen, TextField, Txt } from '../../components';
import { useMe } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Enable TOTP 2FA (secret + otpauth link → verify → backup codes) or disable it. */
export function TwoFactorSetupScreen({ navigation }: RootScreenProps<'TwoFactorSetup'>) {
  const s = useStyles();
  const me = useMe();
  const enabled = me.data?.twoFactorEnabled ?? false;
  return (
    <Screen contentStyle={s.content}>
      {enabled ? (
        <DisableTwoFactor onDone={() => navigation.goBack()} />
      ) : (
        <EnableTwoFactor onDone={() => navigation.goBack()} />
      )}
    </Screen>
  );
}

function EnableTwoFactor({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const start = useMutation({
    mutationFn: () => api.auth.setup2fa(),
    onSuccess: (res) => {
      setSetup(res);
      setError(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const enable = useMutation({
    mutationFn: (c: string) => api.auth.enable2fa(c),
    onSuccess: (res) => {
      haptics.success();
      setBackupCodes(res.backupCodes);
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.security });
    },
    onError: (e) => {
      haptics.error();
      setCode('');
      setError(errorMessage(e));
    },
  });

  const verify = (value: string) => {
    const parsed = enableTwoFactorSchema.safeParse({ code: value });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed.error))[0] ?? 'Enter the 6-digit code');
      return;
    }
    setError(null);
    enable.mutate(parsed.data.code);
  };

  const copy = (value: string, what: string) => {
    clipboard.copy(value);
    haptics.success();
    toast.success(`${what} copied`);
  };

  const openAuthenticator = async () => {
    if (!setup) return;
    try {
      await Linking.openURL(setup.otpauthUrl);
    } catch {
      toast.warning('No authenticator app found', 'Install an authenticator app, or copy the setup key manually.');
    }
  };

  if (backupCodes) {
    return (
      <View>
        <View style={s.hero}>
          <View style={[s.heroIcon, { backgroundColor: t.colors.upSoft }]}>
            <Icon name="check-circle" size={30} color={t.colors.up} />
          </View>
          <Txt variant="heading">Two-factor authentication is on</Txt>
        </View>
        <Notice
          tone="warn"
          title="Save your backup codes"
          message="Each code can be used once if you lose access to your authenticator. Store them somewhere safe and offline."
        />
        <Card style={s.block}>
          <View style={s.codes}>
            {backupCodes.map((c) => (
              <Txt key={c} variant="body" mono style={s.code}>
                {c}
              </Txt>
            ))}
          </View>
        </Card>
        <Button
          title="Copy backup codes"
          icon="copy"
          variant="secondary"
          onPress={() => copy(backupCodes.join('\n'), 'Backup codes')}
          style={s.block}
        />
        <Button title="Done" onPress={onDone} style={s.block} />
      </View>
    );
  }

  if (!setup) {
    return (
      <View>
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Icon name="shield" size={30} color={t.colors.brand} />
          </View>
          <Txt variant="heading" align="center">
            Protect your account with 2FA
          </Txt>
          <Txt variant="body" tone="muted" align="center" style={s.heroText}>
            Use an authenticator app (Google Authenticator, 1Password, Authy…) to generate a 6-digit code at sign-in and
            for withdrawals.
          </Txt>
        </View>
        {error ? <Notice tone="down" message={error} style={s.gap} /> : null}
        <Button title="Set up authenticator" size="lg" onPress={() => start.mutate()} loading={start.isPending} />
      </View>
    );
  }

  return (
    <View>
      <Txt variant="subtitle">1. Add GoCrypto to your authenticator</Txt>
      <Txt variant="caption" tone="muted" style={s.stepText}>
        Open the link in your authenticator app on this phone, or enter the setup key manually.
      </Txt>
      <Button
        title="Open authenticator app"
        icon="external"
        variant="secondary"
        onPress={() => void openAuthenticator()}
      />
      <Card style={s.block}>
        <Txt variant="caption" tone="muted" style={s.stepText}>
          Setting up on another device? Scan this code with its authenticator app.
        </Txt>
        <View style={s.qr}>
          <QrCode value={setup.otpauthUrl} label="Authenticator setup QR code" />
        </View>
        <Txt variant="label" tone="muted">
          Setup key
        </Txt>
        <Txt variant="subtitle" mono selectable style={s.secret}>
          {groupSecret(setup.secret)}
        </Txt>
        <Button
          title="Copy key"
          icon="copy"
          size="sm"
          variant="ghost"
          onPress={() => copy(setup.secret, 'Setup key')}
        />
      </Card>

      <Txt variant="subtitle" style={s.step2}>
        2. Enter the 6-digit code
      </Txt>
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={verify}
        error={Boolean(error)}
        oneTimeCode={false}
        autoFocus={false}
      />
      {error ? <Notice tone="down" message={error} style={s.block} /> : null}
      <Button
        title="Enable 2FA"
        size="lg"
        onPress={() => {
          Keyboard.dismiss();
          verify(code);
        }}
        loading={enable.isPending}
        style={s.block}
      />
    </View>
  );
}

function DisableTwoFactor({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const disable = useMutation({
    mutationFn: (args: { code: string; password: string }) => api.auth.disable2fa(args.code, args.password),
    onSuccess: () => {
      haptics.success();
      toast.success('Two-factor authentication disabled');
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.security });
      onDone();
    },
    onError: (e) => {
      haptics.error();
      setCode('');
      setError(errorMessage(e));
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const parsed = disableTwoFactorSchema.safeParse({ code, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setError(null);
    disable.mutate(parsed.data);
  };

  return (
    <View>
      <View style={s.hero}>
        <View style={[s.heroIcon, { backgroundColor: t.colors.upSoft }]}>
          <Icon name="shield" size={30} color={t.colors.up} />
        </View>
        <Txt variant="heading">2FA is enabled</Txt>
        <Txt variant="body" tone="muted" align="center" style={s.heroText}>
          Turning it off makes your account easier to compromise. Withdrawals may be locked for a period afterwards.
        </Txt>
      </View>
      {error ? <Notice tone="down" message={error} style={s.gap} /> : null}
      <Txt variant="label" tone="muted" style={s.label}>
        Authenticator code
      </Txt>
      <CodeInput value={code} onChange={setCode} error={Boolean(errors.code)} oneTimeCode={false} autoFocus={false} />
      {errors.code ? (
        <Txt variant="caption" tone="down" style={s.fieldError}>
          {errors.code}
        </Txt>
      ) : null}
      <TextField
        label="Account password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureToggle
        autoCapitalize="none"
        textContentType="password"
        containerStyle={s.block}
      />
      <Button title="Disable 2FA" variant="danger" size="lg" onPress={submit} loading={disable.isPending} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  qr: { alignItems: 'center', marginVertical: 12 },
  content: {
    paddingTop: 16,
  },
  hero: {
    alignItems: 'center',
    marginVertical: 20,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroText: {
    marginTop: 6,
    maxWidth: 320,
  },
  gap: {
    marginBottom: 14,
  },
  block: {
    marginTop: 14,
  },
  stepText: {
    marginTop: 4,
    marginBottom: 12,
  },
  secret: {
    marginVertical: 8,
    letterSpacing: 1,
  },
  step2: {
    marginTop: 24,
    marginBottom: 12,
  },
  codes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  code: {
    width: '48%',
    paddingVertical: 6,
    textAlign: 'center',
  },
  label: {
    marginBottom: 8,
  },
  fieldError: {
    marginTop: 6,
  },
}));
