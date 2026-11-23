import { fieldErrors, forgotPasswordSchema, resetPasswordSchema, type ResetPasswordInput } from '@gocrypto/validation';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Keyboard, Pressable } from 'react-native';
import { Button, CodeInput, Notice, TextField, Txt } from '../../components';
import { useCooldown } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { apiFieldErrors, errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles } from '../../theme';
import { AuthLayout } from './AuthLayout';
import { PasswordRules } from './RegisterScreen';

export function ForgotPasswordScreen({ navigation, route }: RootScreenProps<'ForgotPassword'>) {
  const s = useStyles();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  const request = useMutation({
    mutationFn: (address: string) => api.auth.forgotPassword(address),
    onSuccess: () => {
      startCooldown(60);
      setStep('reset');
      toast.info('Check your inbox', 'If an account exists for this e-mail, we sent a 6-digit code.');
    },
    onError: (e) => {
      haptics.error();
      setFormError(errorMessage(e));
    },
  });

  const reset = useMutation({
    mutationFn: (body: ResetPasswordInput) => api.auth.resetPassword(body),
    onSuccess: () => {
      haptics.success();
      toast.success('Password updated', 'Sign in with your new password.');
      navigation.goBack();
    },
    onError: (e) => {
      haptics.error();
      setErrors(apiFieldErrors(e));
      setFormError(errorMessage(e));
    },
  });

  const sendCode = () => {
    Keyboard.dismiss();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setEmail(parsed.data.email);
    request.mutate(parsed.data.email);
  };

  const submitReset = () => {
    Keyboard.dismiss();
    const parsed = resetPasswordSchema.safeParse({ email, code, newPassword: password });
    const next = parsed.success ? {} : fieldErrors(parsed.error);
    if (password !== confirm) next.confirm = 'Passwords do not match';
    if (!parsed.success || next.confirm) {
      setErrors(next);
      return;
    }
    setErrors({});
    setFormError(null);
    reset.mutate(parsed.data);
  };

  if (step === 'request') {
    return (
      <AuthLayout
        onBack={() => navigation.goBack()}
        title="Reset password"
        subtitle="We'll e-mail you a 6-digit code to set a new password."
      >
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
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={sendCode}
          autoFocus
        />
        <Button title="Send code" onPress={sendCode} loading={request.isPending} size="lg" style={s.button} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout onBack={() => setStep('request')} title="Enter the code" subtitle={`We sent a code to ${email}.`}>
      {formError ? <Notice tone="down" message={formError} style={s.notice} /> : null}
      <CodeInput value={code} onChange={setCode} error={Boolean(errors.code)} />
      {errors.code ? (
        <Txt variant="caption" tone="down" style={s.codeError}>
          {errors.code}
        </Txt>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={cooldown > 0 || request.isPending}
        onPress={() => request.mutate(email)}
        hitSlop={8}
        style={s.resend}
      >
        <Txt variant="label" tone={cooldown > 0 ? 'faint' : 'brand'}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </Txt>
      </Pressable>
      <TextField
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={errors.newPassword}
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <PasswordRules password={password} />
      <TextField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureToggle
        autoCapitalize="none"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submitReset}
      />
      <Button title="Update password" onPress={submitReset} loading={reset.isPending} size="lg" style={s.button} />
    </AuthLayout>
  );
}

const useStyles = makeStyles(() => ({
  notice: {
    marginBottom: 16,
  },
  button: {
    marginTop: 12,
  },
  codeError: {
    marginTop: 8,
  },
  resend: {
    alignSelf: 'flex-start',
    marginTop: 14,
    marginBottom: 18,
  },
}));
