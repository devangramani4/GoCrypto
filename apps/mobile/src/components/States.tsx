import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { errorMessage, isNetworkError } from '../lib/errors';
import { makeStyles, useTheme } from '../theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon = 'list',
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
  style,
}: EmptyStateProps) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={[s.center, compact ? s.compact : s.full, style]}>
      <View style={[s.iconCircle, compact && s.iconCircleSmall]}>
        <Icon name={icon} size={compact ? 20 : 26} color={t.colors.textMuted} />
      </View>
      <Txt variant={compact ? 'label' : 'subtitle'} align="center" style={s.title}>
        {title}
      </Txt>
      {message ? (
        <Txt variant="caption" tone="muted" align="center" style={s.message}>
          {message}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} size="sm" variant="secondary" style={s.action} />
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({ error, onRetry, title, compact = false, style }: ErrorStateProps) {
  const t = useTheme();
  const s = useStyles();
  const offline = isNetworkError(error);
  return (
    <View style={[s.center, compact ? s.compact : s.full, style]}>
      <View style={[s.iconCircle, compact && s.iconCircleSmall, { backgroundColor: t.colors.downSoft }]}>
        <Icon name={offline ? 'refresh' : 'alert'} size={compact ? 20 : 26} color={t.colors.down} />
      </View>
      <Txt variant={compact ? 'label' : 'subtitle'} align="center" style={s.title}>
        {title ?? (offline ? "You're offline" : "Couldn't load this")}
      </Txt>
      <Txt variant="caption" tone="muted" align="center" style={s.message}>
        {errorMessage(error)}
      </Txt>
      {onRetry ? (
        <Button title="Try again" icon="refresh" onPress={onRetry} size="sm" variant="secondary" style={s.action} />
      ) : null}
    </View>
  );
}

export function LoadingView({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={[s.center, s.full, style]}>
      <ActivityIndicator color={t.colors.brand} />
    </View>
  );
}

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Pulsing placeholder block. */
export function Skeleton({ width = '100%', height = 14, radius, style }: SkeletonProps) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius ?? t.radius.md, backgroundColor: t.colors.skeleton, opacity },
        style,
      ]}
    />
  );
}

/** Placeholder list rows (avatar + two lines + trailing value). */
export function SkeletonRows({ count = 6, avatar = true }: { count?: number; avatar?: boolean }) {
  const s = useStyles();
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={s.skeletonRow}>
          {avatar ? <Skeleton width={34} height={34} radius={17} /> : null}
          <View style={s.skeletonBody}>
            <Skeleton width="45%" height={13} />
            <Skeleton width="28%" height={11} style={s.skeletonLine} />
          </View>
          <View style={s.skeletonRight}>
            <Skeleton width={72} height={13} />
            <Skeleton width={48} height={11} style={s.skeletonLine} />
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: {
    flex: 1,
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  compact: {
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  iconCircleSmall: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginBottom: 10,
  },
  title: {
    marginBottom: 4,
  },
  message: {
    maxWidth: 300,
  },
  action: {
    marginTop: 16,
    alignSelf: 'center',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  skeletonBody: {
    flex: 1,
  },
  skeletonRight: {
    alignItems: 'flex-end',
  },
  skeletonLine: {
    marginTop: 6,
  },
}));
