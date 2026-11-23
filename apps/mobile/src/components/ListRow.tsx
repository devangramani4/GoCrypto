import type { ReactNode } from 'react';
import { Pressable, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  left?: ReactNode;
  /** Trailing text value. */
  value?: string;
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** Settings-style row: icon, title/subtitle, trailing value/accessory. */
export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  left,
  value,
  right,
  chevron,
  onPress,
  destructive,
  disabled,
  style,
  accessibilityLabel,
}: ListRowProps) {
  const t = useTheme();
  const s = useStyles();
  const color = destructive ? t.colors.down : t.colors.text;
  const content = (
    <>
      {left ??
        (icon ? (
          <View style={[s.iconWrap, destructive && { backgroundColor: t.colors.downSoft }]}>
            <Icon name={icon} size={18} color={iconColor ?? (destructive ? t.colors.down : t.colors.brand)} />
          </View>
        ) : null)}
      <View style={s.body}>
        <Txt variant="body" weight="medium" color={color} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" numberOfLines={2} style={s.subtitle}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="label" tone="muted" numberOfLines={1} style={s.value}>
          {value}
        </Txt>
      ) : null}
      {right}
      {(chevron ?? Boolean(onPress)) ? <Icon name="chevron-right" size={18} color={t.colors.textFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={[s.row, style]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.colors.hover }, disabled && s.disabled, style]}
    >
      {content}
    </Pressable>
  );
}

interface SwitchRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ title, subtitle, icon, value, onValueChange, disabled }: SwitchRowProps) {
  const t = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      icon={icon}
      chevron={false}
      right={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            haptics.selection();
            onValueChange(v);
          }}
          trackColor={{ false: t.colors.borderStrong, true: t.colors.brand }}
          thumbColor="#FFFFFF"
          ios_backgroundColor={t.colors.borderStrong}
          accessibilityLabel={title}
        />
      }
    />
  );
}

interface KeyValueProps {
  label: string;
  value?: string;
  children?: ReactNode;
  valueTone?: 'default' | 'muted' | 'up' | 'down' | 'warn' | 'brand';
  style?: StyleProp<ViewStyle>;
}

/** Compact "label ……… value" line for summaries. */
export function KeyValue({ label, value, children, valueTone = 'default', style }: KeyValueProps) {
  const s = useStyles();
  return (
    <View style={[s.kv, style]}>
      <Txt variant="label" tone="muted" style={s.kvLabel}>
        {label}
      </Txt>
      {children ?? (
        <Txt variant="label" tone={valueTone} weight="medium" numeric align="right" style={s.kvValue}>
          {value ?? '—'}
        </Txt>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  subtitle: {
    marginTop: 2,
  },
  value: {
    maxWidth: '45%',
  },
  kv: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
    gap: 12,
  },
  kvLabel: {
    flexShrink: 0,
  },
  kvValue: {
    flexShrink: 1,
  },
}));
