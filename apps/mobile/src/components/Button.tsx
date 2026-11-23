import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme, type AppTheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'buy' | 'sell';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width (default true for md/lg). */
  block?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

function palette(t: AppTheme, v: ButtonVariant): { bg: string; fg: string; border: string } {
  const c = t.colors;
  switch (v) {
    case 'primary':
      return { bg: c.brand, fg: c.onBrand, border: c.brand };
    case 'secondary':
      return { bg: c.raised, fg: c.text, border: c.raised };
    case 'outline':
      return { bg: 'transparent', fg: c.text, border: c.borderStrong };
    case 'ghost':
      return { bg: 'transparent', fg: c.brand, border: 'transparent' };
    case 'danger':
      return { bg: c.downSoft, fg: c.down, border: c.downSoft };
    case 'buy':
      return { bg: c.up, fg: c.onTrade, border: c.up };
    case 'sell':
      return { bg: c.down, fg: c.onTrade, border: c.down };
  }
}

const HEIGHT: Record<ButtonSize, number> = { sm: 34, md: 46, lg: 52 };

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  block,
  haptic = true,
  style,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const s = useStyles();
  const p = palette(t, variant);
  const inactive = disabled || loading;
  const stretch = block ?? size !== 'sm';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={() => {
        if (haptic) haptics.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? 12 : 18,
          backgroundColor: p.bg,
          borderColor: p.border,
          borderRadius: size === 'sm' ? t.radius.md : t.radius.lg,
          alignSelf: stretch ? 'stretch' : 'flex-start',
          opacity: disabled && !loading ? 0.45 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} size="small" />
      ) : (
        <View style={s.row}>
          {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 19} color={p.fg} /> : null}
          <Txt
            variant={size === 'sm' ? 'label' : 'subtitle'}
            color={p.fg}
            weight="semibold"
            numberOfLines={1}
            style={icon ? s.labelWithIcon : undefined}
          >
            {title}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

interface IconButtonProps {
  icon: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  /** Filled circular background. */
  filled?: boolean;
  badge?: number;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  size = 22,
  color,
  filled = false,
  badge,
  accessibilityLabel,
  disabled,
  style,
}: IconButtonProps) {
  const t = useTheme();
  const s = useStyles();
  const box = size + 18;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      disabled={disabled}
      onPress={() => {
        haptics.selection();
        onPress?.();
      }}
      style={({ pressed }) => [
        s.iconButton,
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          backgroundColor: filled ? t.colors.raised : 'transparent',
          opacity: pressed ? 0.6 : disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color ?? t.colors.text} />
      {badge !== undefined && badge > 0 ? (
        <View style={s.badge}>
          <Txt variant="micro" color={t.colors.onTrade} weight="bold" numeric>
            {badge > 99 ? '99+' : String(badge)}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWithIcon: {
    marginLeft: 8,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: t.colors.down,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colors.bg,
  },
}));
