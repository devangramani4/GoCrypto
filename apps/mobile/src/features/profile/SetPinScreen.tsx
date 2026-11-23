import { changePinSchema, fieldErrors, setPinSchema } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Keyboard, View } from 'react-native';
import { Button, CodeInput, Notice, Screen, TextField, Txt } from '../../components';
import { useMe } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/errors';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles } from '../../theme';

/** Set (password-confirmed) or change the 6-digit trading PIN used to authorise withdrawals. */
export function SetPinScreen({ navigation }: RootScreenProps<'SetPin'>) {
  const s = useStyles();
  const qc = useQueryClient();
  const me = useMe();
  const hasPin = me.data?.hasTradingPin ?? false;
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (
      args: { kind: 'set'; pin: string; password: string } | { kind: 'change'; currentPin: string; newPin: string },
    ) =>
      args.kind === 'set' ? api.auth.setPin(args.pin, args.password) : api.auth.changePin(args.currentPin, args.newPin),
    onSuccess: () => {
      haptics.success();
      toast.success(hasPin ? 'Trading PIN changed' : 'Trading PIN set');
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: qk.security });
      navigation.goBack();
    },
    onError: (e) => {
      haptics.error();
      const code = errorCode(e);
      if (code === 'INVALID_PIN') setCurrentPin('');
      setFormError(errorMessage(e));
    },
  });

  const submit = () => {
    Keyboard.dismiss();
    setFormError(null);
    const next: Record<string, string> = {};
    if (hasPin) {
      const parsed = changePinSchema.safeParse({ currentPin, newPin: pin });
      if (!parsed.success) Object.assign(next, fieldErrors(parsed.error));
      if (pin !== confirm) next.confirm = 'PINs do not match';
      if (parsed.success && !next.confirm) {
        setErrors({});
        save.mutate({ kind: 'change', currentPin: parsed.data.currentPin, newPin: parsed.data.newPin });
        return;
      }
    } else {
      const parsed = setPinSchema.safeParse({ pin, password });
      if (!parsed.success) Object.assign(next, fieldErrors(parsed.error));
      if (pin !== confirm) next.confirm = 'PINs do not match';
      if (parsed.success && !next.confirm) {
        setErrors({});
        save.mutate({ kind: 'set', pin: parsed.data.pin, password: parsed.data.password });
        return;
      }
    }
    haptics.warning();
    setErrors(next);
  };

  return (
    <Screen contentStyle={s.content}>
      <Txt variant="body" tone="muted" style={s.intro}>
        Your trading PIN authorises withdrawals and other sensitive actions. Avoid simple sequences like 123456.
      </Txt>
      {formError ? <Notice tone="down" message={formError} style={s.notice} /> : null}

      {hasPin ? (
        <Field label="Current PIN" error={errors.currentPin}>
          <CodeInput
            value={currentPin}
            onChange={setCurrentPin}
            secure
            oneTimeCode={false}
            autoFocus
            accessibilityLabel="Current PIN"
          />
        </Field>
      ) : null}
      <Field label={hasPin ? 'New PIN' : 'PIN'} error={errors.newPin ?? errors.pin}>
        <CodeInput
          value={pin}
          onChange={setPin}
          secure
          oneTimeCode={false}
          autoFocus={!hasPin}
          accessibilityLabel="New PIN"
        />
      </Field>
      <Field label="Confirm PIN" error={errors.confirm}>
        <CodeInput
          value={confirm}
          onChange={setConfirm}
          secure
          oneTimeCode={false}
          autoFocus={false}
          accessibilityLabel="Confirm PIN"
        />
      </Field>
      {!hasPin ? (
        <TextField
          label="Account password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          secureToggle
          autoCapitalize="none"
          textContentType="password"
          autoComplete="current-password"
        />
      ) : null}
      <Button
        title={hasPin ? 'Change PIN' : 'Set PIN'}
        size="lg"
        onPress={submit}
        loading={save.isPending}
        style={s.button}
      />
    </Screen>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.field}>
      <Txt variant="label" tone="muted" style={s.label}>
        {label}
      </Txt>
      {children}
      {error ? (
        <Txt variant="caption" tone="down" style={s.error}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  content: {
    paddingTop: 16,
  },
  intro: {
    marginBottom: 18,
  },
  notice: {
    marginBottom: 14,
  },
  field: {
    marginBottom: 18,
  },
  label: {
    marginBottom: 8,
  },
  error: {
    marginTop: 6,
  },
  button: {
    marginTop: 8,
  },
}));
