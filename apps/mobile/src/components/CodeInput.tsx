import { useEffect, useRef } from 'react';
import { Platform, Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import { makeStyles, useTheme } from '../theme';
import { Txt } from './Txt';

interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Called once all digits are entered. */
  onComplete?: (code: string) => void;
  length?: number;
  autoFocus?: boolean;
  /** Mask digits (PINs). */
  secure?: boolean;
  error?: boolean;
  /** SMS / e-mail one-time codes get OS autofill hints. */
  oneTimeCode?: boolean;
  accessibilityLabel?: string;
}

/** Segmented numeric code entry backed by one hidden TextInput (works with OS code autofill). */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus = true,
  secure = false,
  error = false,
  oneTimeCode = true,
  accessibilityLabel = 'Verification code',
}: CodeInputProps) {
  const t = useTheme();
  const s = useStyles();
  const ref = useRef<TextInputInstance>(null);
  const lastCompleted = useRef<string | null>(null);

  useEffect(() => {
    if (value.length === length && lastCompleted.current !== value) {
      lastCompleted.current = value;
      onComplete?.(value);
    }
    if (value.length < length) lastCompleted.current = null;
  }, [value, length, onComplete]);

  const cells = Array.from({ length }, (_, i) => value[i] ?? '');
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={() => ref.current?.focus()} style={s.row}>
      {cells.map((ch, i) => (
        <View
          key={i}
          style={[s.cell, { borderColor: error ? t.colors.down : i === active ? t.colors.brand : t.colors.border }]}
        >
          <Txt variant="heading" numeric>
            {ch ? (secure ? '•' : ch) : ''}
          </Txt>
        </View>
      ))}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        keyboardAppearance={t.dark ? 'dark' : 'light'}
        maxLength={length}
        autoFocus={autoFocus}
        textContentType={oneTimeCode ? 'oneTimeCode' : 'none'}
        autoComplete={oneTimeCode ? (Platform.OS === 'android' ? 'sms-otp' : 'one-time-code') : 'off'}
        secureTextEntry={secure}
        caretHidden
        style={s.hidden}
      />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  cell: {
    flex: 1,
    aspectRatio: 0.86,
    maxHeight: 58,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    backgroundColor: t.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
}));
