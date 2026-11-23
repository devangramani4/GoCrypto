import { useState, type ReactNode, type Ref } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { sanitizeDecimal } from '../lib/format';
import { makeStyles, useTheme } from '../theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'onChangeText'> {
  label?: string;
  error?: string | null;
  hint?: string;
  /** Short unit shown inside the field on the right (e.g. "USDT"). */
  suffix?: string;
  left?: ReactNode;
  right?: ReactNode;
  /** Adds a show/hide toggle for password fields. */
  secureToggle?: boolean;
  /** Decimal keypad, sanitised input and tabular figures. */
  decimal?: boolean;
  /** Max fractional digits for `decimal` fields. */
  maxDecimals?: number;
  dense?: boolean;
  onChangeText?: (text: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  ref?: Ref<TextInputInstance>;
}

export function TextField({
  label,
  error,
  hint,
  suffix,
  left,
  right,
  secureToggle,
  secureTextEntry,
  decimal,
  maxDecimals,
  dense,
  onChangeText,
  containerStyle,
  inputStyle,
  editable = true,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TextFieldProps) {
  const t = useTheme();
  const s = useStyles();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const borderColor = error ? t.colors.down : focused ? t.colors.brand : t.colors.border;

  return (
    <View style={[s.container, containerStyle]}>
      {label ? (
        <Txt variant="label" tone="muted" style={s.label}>
          {label}
        </Txt>
      ) : null}
      <View style={[s.field, dense && s.dense, { borderColor }, !editable && s.disabled]}>
        {left}
        <TextInput
          ref={ref}
          {...rest}
          editable={editable}
          placeholderTextColor={t.colors.textFaint}
          selectionColor={t.colors.brand}
          cursorColor={t.colors.brand}
          keyboardAppearance={t.dark ? 'dark' : 'light'}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          keyboardType={decimal ? 'decimal-pad' : rest.keyboardType}
          autoCorrect={decimal || secureToggle || secureTextEntry ? false : rest.autoCorrect}
          onChangeText={(text) => onChangeText?.(decimal ? sanitizeDecimal(text, maxDecimals) : text)}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[s.input, dense && s.inputDense, decimal && s.numeric, inputStyle]}
        />
        {suffix ? (
          <Txt variant="label" tone="muted" style={s.suffix}>
            {suffix}
          </Txt>
        ) : null}
        {right}
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={10}
            onPress={() => setHidden((h) => !h)}
            style={s.toggle}
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} size={20} color={t.colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Txt variant="caption" tone="down" style={s.message}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="caption" tone="faint" style={s.message}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    marginBottom: 14,
  },
  label: {
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderWidth: 1,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceAlt,
    paddingHorizontal: 14,
  },
  dense: {
    minHeight: 42,
    paddingHorizontal: 12,
  },
  disabled: {
    opacity: 0.6,
  },
  input: {
    flex: 1,
    color: t.colors.text,
    fontSize: t.fontSize.lg,
    paddingVertical: 12,
  },
  inputDense: {
    fontSize: t.fontSize.base + 1,
    paddingVertical: 9,
  },
  numeric: {
    fontVariant: ['tabular-nums'],
  },
  suffix: {
    marginLeft: 8,
  },
  toggle: {
    marginLeft: 10,
  },
  message: {
    marginTop: 6,
  },
}));
