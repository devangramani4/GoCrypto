import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme } from '../theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  children?: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Checkbox({ checked, onChange, label, children, disabled, style }: CheckboxProps) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptics.selection();
        onChange(!checked);
      }}
      style={[s.row, disabled && s.disabled, style]}
    >
      <View style={[s.box, checked && { backgroundColor: t.colors.brand, borderColor: t.colors.brand }]}>
        {checked ? <Icon name="check" size={14} color={t.colors.onBrand} strokeWidth={3} /> : null}
      </View>
      {label ? (
        <Txt variant="label" tone="muted" style={s.label}>
          {label}
        </Txt>
      ) : (
        <View style={s.label}>{children}</View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: t.radius.sm,
    borderWidth: 1.5,
    borderColor: t.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginLeft: 10,
    flexShrink: 1,
  },
}));
