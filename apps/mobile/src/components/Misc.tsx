import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles, useTheme } from '../theme';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Round letter avatar for an asset symbol (no remote images needed). */
export function AssetIcon({ symbol, size = 34 }: { symbol: string; size?: number }) {
  const t = useTheme();
  const label = symbol.slice(0, 4);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.colors.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt
        variant="micro"
        weight="bold"
        color={t.colors.brand}
        style={{ fontSize: label.length > 3 ? size * 0.26 : size * 0.32 }}
      >
        {label}
      </Txt>
    </View>
  );
}

interface TabHeaderProps {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Large-title header for tab roots (the native header is hidden on tabs). */
export function TabHeader({ title, subtitle, right, left, style }: TabHeaderProps) {
  const s = useStyles();
  return (
    <View style={[s.header, style]}>
      {left}
      <View style={s.titles}>
        <Txt variant="title" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      <View style={s.actions}>{right}</View>
    </View>
  );
}

interface StatProps {
  label: string;
  value?: string;
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  style?: StyleProp<ViewStyle>;
}

/** Small label-over-value statistic. */
export function Stat({ label, value, children, align = 'left', style }: StatProps) {
  const s = useStyles();
  const alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  return (
    <View style={[s.stat, { alignItems }, style]}>
      <Txt variant="micro" tone="faint" numberOfLines={1}>
        {label}
      </Txt>
      {children ?? (
        <Txt variant="label" weight="semibold" numeric numberOfLines={1} style={s.statValue}>
          {value ?? '—'}
        </Txt>
      )}
    </View>
  );
}

interface ChipProps {
  label: string;
  onPress?: () => void;
  active?: boolean;
  icon?: 'chevron-down' | 'sliders' | 'swap-vertical';
  style?: StyleProp<ViewStyle>;
}

/** Compact pill button (e.g. "Cross ▾", "20x ▾", filters). */
export function Chip({ label, onPress, active = false, icon, style }: ChipProps) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={!onPress}
      hitSlop={4}
      style={({ pressed }) => [
        s.chip,
        active && { backgroundColor: t.colors.brandSoft, borderColor: t.colors.brand },
        pressed && s.pressed,
        style,
      ]}
    >
      <Txt variant="caption" weight="semibold" color={active ? t.colors.brand : t.colors.text}>
        {label}
      </Txt>
      {icon ? <Icon name={icon} size={14} color={active ? t.colors.brand : t.colors.textMuted} /> : null}
    </Pressable>
  );
}

/** Inline notice box (info / warning / error) used in forms. */
export function Notice({
  tone = 'info',
  title,
  message,
  children,
  style,
}: {
  tone?: 'info' | 'warn' | 'down' | 'up';
  title?: string;
  message?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const s = useStyles();
  const fg =
    tone === 'warn' ? t.colors.warn : tone === 'down' ? t.colors.down : tone === 'up' ? t.colors.up : t.colors.brand;
  const bg =
    tone === 'warn'
      ? t.colors.warnSoft
      : tone === 'down'
        ? t.colors.downSoft
        : tone === 'up'
          ? t.colors.upSoft
          : t.colors.brandSoft;
  return (
    <View style={[s.notice, { backgroundColor: bg }, style]}>
      <Icon name={tone === 'info' ? 'info' : tone === 'up' ? 'check-circle' : 'alert'} size={18} color={fg} />
      <View style={s.noticeBody}>
        {title ? (
          <Txt variant="label" weight="semibold" color={fg}>
            {title}
          </Txt>
        ) : null}
        {message ? (
          <Txt variant="caption" tone="muted" style={title ? s.noticeMsg : undefined}>
            {message}
          </Txt>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
  },
  titles: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surfaceAlt,
  },
  pressed: {
    opacity: 0.7,
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: t.radius.lg,
    alignItems: 'flex-start',
  },
  noticeBody: {
    flex: 1,
  },
  noticeMsg: {
    marginTop: 2,
  },
}));
