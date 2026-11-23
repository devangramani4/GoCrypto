import { fieldErrors, registerSchema, type RegisterInput } from '@gocrypto/validation';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Keyboard, View, type TextInputInstance } from 'react-native';
import { Button, Checkbox, Icon, Notice, TextField, Txt } from '../../components';
import { api } from '../../lib/api';
import { apiFieldErrors, errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import type { RootScreenProps } from '../../navigation/types';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';
import { AuthLayout } from './AuthLayout';

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p) => /\d/.test(p) },
];

export function PasswordRules({ password }: { password: string }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.rules}>
      {RULES.map((r) => {
        const ok = r.test(password);
        return (
          <View key={r.label} style={s.rule}>
            <Icon name={ok ? 'check-circle' : 'info'} size={14} color={ok ? t.colors.up : t.colors.textFaint} />
            <Txt variant="caption" color={ok ? t.colors.up : t.colors.textMuted}>
              {r.label}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

export function RegisterScreen({ navigation }: RootScreenProps<'Register'>) {
  const s = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const nameRef = useRef<TextInputInstance>(null);

  const register = useMutation({
    mutationFn: (d: RegisterInput) =>
      api.auth.register({
        email: d.email,
        password: d.password,
        displayName: d.displayName,
        referralCode: d.referralCode,
        acceptTerms: d.acceptTerms,
      }),
    onSuccess: (res) => {
      haptics.success();
      useSession.getState().completeSignIn(res.user);
      toast.success('Welcome to GoCrypto', 'Your sandbox account is ready to trade.');
    },
    onError: (e) => {
      haptics.error();
      setErrors(apiFieldErrors(e));
      setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    const parsed = registerSchema.safeParse({
      email,
      password,
      displayName: displayName.trim() || undefined,
      referralCode: referralCode.trim().toUpperCase() || undefined,
      acceptTerms,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    register.mutate(parsed.data);
  };

  return (
    <AuthLayout
      onBack={() => navigation.goBack()}
      title="Create your account"
      subtitle="Start with a funded paper-trading wallet."
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
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        placeholder="Create a strong password"
        secureToggle
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => nameRef.current?.focus()}
      />
      <PasswordRules password={password} />
      <TextField
        ref={nameRef}
        label="Display name (optional)"
        value={displayName}
        onChangeText={setDisplayName}
        error={errors.displayName}
        placeholder="How should we call you?"
        autoComplete="name"
        textContentType="nickname"
        returnKeyType="next"
      />
      <TextField
        label="Referral code (optional)"
        value={referralCode}
        onChangeText={(v) => setReferralCode(v.toUpperCase())}
        error={errors.referralCode}
        placeholder="ABCD1234"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Checkbox checked={acceptTerms} onChange={setAcceptTerms} style={s.terms}>
        <Txt variant="caption" tone="muted">
          I accept the Terms of Service and Privacy Policy and understand this is a sandbox environment.
        </Txt>
      </Checkbox>
      {errors.acceptTerms ? (
        <Txt variant="caption" tone="down" style={s.termsError}>
          {errors.acceptTerms}
        </Txt>
      ) : null}
      <Button title="Create account" onPress={submit} loading={register.isPending} size="lg" style={s.button} />
    </AuthLayout>
  );
}

const useStyles = makeStyles(() => ({
  notice: {
    marginBottom: 16,
  },
  rules: {
    marginTop: -6,
    marginBottom: 16,
    gap: 4,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  terms: {
    marginTop: 4,
  },
  termsError: {
    marginTop: 6,
  },
  button: {
    marginTop: 24,
  },
}));
