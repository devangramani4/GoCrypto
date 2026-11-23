import { fieldErrors, loginSchema } from '@gocrypto/validation';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Keyboard, Pressable, View, type TextInputInstance } from 'react-native';
import { Button, Notice, TextField, Txt } from '../../components';
import { DEMO_EMAIL } from '../../config';
import { api, device } from '../../lib/api';
import { apiFieldErrors, errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import type { RootScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { makeStyles } from '../../theme';
import { AuthLayout } from './AuthLayout';

export function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const s = useStyles();
  const notice = useSession((st) => st.notice);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) => api.auth.login({ ...input, deviceName: device.name }),
    onSuccess: (res, input) => {
      setPassword('');
      if (res.status === 'MFA_REQUIRED') {
        navigation.navigate('TwoFactor', { mfaToken: res.mfaToken, methods: res.methods, email: input.email });
        return;
      }
      haptics.success();
      useSession.getState().completeSignIn(res.user);
    },
    onError: (e) => {
      haptics.error();
      setErrors(apiFieldErrors(e));
      setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    useSession.getState().clearNotice();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    login.mutate({ email: parsed.data.email, password: parsed.data.password });
  };

  return (
    <AuthLayout showLogo title="Welcome back" subtitle="Sign in to trade spot and perpetual futures.">
      {notice ? <Notice tone="warn" message={notice} style={s.notice} /> : null}
      {formError ? <Notice tone="down" message={formError} style={s.notice} /> : null}
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        placeholder="Your password"
        secureToggle
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Pressable
        accessibilityRole="link"
        onPress={() => navigation.navigate('ForgotPassword', { email: email.trim() || undefined })}
        hitSlop={8}
        style={s.forgot}
      >
        <Txt variant="label" tone="brand">
          Forgot password?
        </Txt>
      </Pressable>
      <Button title="Sign in" onPress={submit} loading={login.isPending} size="lg" />
      {DEMO_EMAIL ? (
        <Button
          title="Use demo account"
          variant="ghost"
          onPress={() => {
            setEmail(DEMO_EMAIL ?? '');
            passwordRef.current?.focus();
          }}
          style={s.demo}
        />
      ) : null}
      <View style={s.footer}>
        <Txt variant="body" tone="muted">
          New to GoCrypto?{' '}
        </Txt>
        <Pressable accessibilityRole="link" onPress={() => navigation.navigate('Register')} hitSlop={8}>
          <Txt variant="body" tone="brand" weight="semibold">
            Create account
          </Txt>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

const useStyles = makeStyles(() => ({
  notice: {
    marginBottom: 16,
  },
  forgot: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: 20,
  },
  demo: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
}));
