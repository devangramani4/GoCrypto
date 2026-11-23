import { fieldErrors, loginMfaSchema } from '@gocrypto/validation';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Button, CodeInput, Notice, TextField, Txt } from '../../components';
import { api } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/errors';
import { maskEmail } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import type { RootScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { makeStyles } from '../../theme';
import { AuthLayout } from './AuthLayout';

type MfaBody = { mfaToken: string; code?: string; backupCode?: string };

export function TwoFactorScreen({ navigation, route }: RootScreenProps<'TwoFactor'>) {
  const s = useStyles();
  const { mfaToken, methods, email } = route.params;
  const backupAllowed = methods.includes('BACKUP_CODE');
  const [mode, setMode] = useState<'code' | 'backup'>('code');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: (body: MfaBody) => api.auth.loginMfa(body),
    onSuccess: (res) => {
      if (res.status === 'OK') {
        haptics.success();
        useSession.getState().completeSignIn(res.user);
      } else {
        setError('Additional verification is required. Please sign in again.');
      }
    },
    onError: (e) => {
      haptics.error();
      const c = errorCode(e);
      if (c === 'TOKEN_EXPIRED' || c === 'TOKEN_INVALID') {
        toast.error('Sign-in expired', 'Please enter your password again.');
        navigation.goBack();
        return;
      }
      setError(errorMessage(e));
      setCode('');
    },
  });

  const submit = (value?: string) => {
    const body: MfaBody =
      mode === 'code' ? { mfaToken, code: value ?? code } : { mfaToken, backupCode: backupCode.trim() };
    const parsed = loginMfaSchema.safeParse(body);
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed.error))[0] ?? 'Enter a valid code');
      return;
    }
    setError(null);
    verify.mutate(parsed.data);
  };

  return (
    <AuthLayout
      onBack={() => navigation.goBack()}
      title="Two-factor authentication"
      subtitle={
        mode === 'code'
          ? `Enter the 6-digit code from your authenticator app for ${maskEmail(email)}.`
          : 'Enter one of the backup codes you saved when enabling 2FA.'
      }
    >
      {error ? <Notice tone="down" message={error} style={s.notice} /> : null}
      {mode === 'code' ? (
        <CodeInput
          value={code}
          onChange={setCode}
          onComplete={(c) => submit(c)}
          error={Boolean(error)}
          oneTimeCode={false}
        />
      ) : (
        <TextField
          label="Backup code"
          value={backupCode}
          onChangeText={setBackupCode}
          placeholder="XXXX-XXXX"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => submit()}
        />
      )}
      <Button title="Verify" onPress={() => submit()} loading={verify.isPending} size="lg" style={s.button} />
      {backupAllowed ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          style={s.switch}
          onPress={() => {
            setError(null);
            setMode((m) => (m === 'code' ? 'backup' : 'code'));
          }}
        >
          <Txt variant="label" tone="brand" align="center">
            {mode === 'code' ? 'Use a backup code instead' : 'Use authenticator code'}
          </Txt>
        </Pressable>
      ) : null}
    </AuthLayout>
  );
}

const useStyles = makeStyles(() => ({
  notice: {
    marginBottom: 16,
  },
  button: {
    marginTop: 24,
  },
  switch: {
    marginTop: 20,
    alignSelf: 'center',
  },
}));
