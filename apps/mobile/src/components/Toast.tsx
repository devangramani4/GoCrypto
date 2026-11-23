import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useObscured } from '../store/lock';
import { useToasts, type ToastItem } from '../store/toast';
import { makeStyles, useTheme, type AppTheme } from '../theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

function look(t: AppTheme, type: ToastItem['type']): { icon: IconName; color: string } {
  switch (type) {
    case 'success':
      return { icon: 'check-circle', color: t.colors.up };
    case 'error':
      return { icon: 'alert', color: t.colors.down };
    case 'warning':
      return { icon: 'alert', color: t.colors.warn };
    case 'info':
      return { icon: 'info', color: t.colors.brand };
  }
}

/** In-app banners (order fills, realtime notifications, confirmations). Hidden while locked. */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  const obscured = useObscured();
  const insets = useSafeAreaInsets();
  if (obscured || toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 6 }]}>
      {toasts.map((item) => (
        <ToastView key={item.id} item={item} />
      ))}
    </View>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  const t = useTheme();
  const s = useStyles();
  const dismiss = useToasts((st) => st.dismiss);
  const anim = useRef(new Animated.Value(0)).current;
  const { icon, color } = look(t, item.type);

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => dismiss(item.id));
    }, item.duration);
    return () => clearTimeout(timer);
  }, [anim, dismiss, item.duration, item.id]);

  return (
    <Animated.View
      style={[
        s.wrap,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
      ]}
    >
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        onPress={() => {
          item.onPress?.();
          dismiss(item.id);
        }}
        style={s.toast}
      >
        <View style={[s.accent, { backgroundColor: color }]} />
        <Icon name={icon} size={20} color={color} />
        <View style={s.body}>
          <Txt variant="label" weight="semibold" numberOfLines={1}>
            {item.title}
          </Txt>
          {item.message ? (
            <Txt variant="caption" tone="muted" numberOfLines={2}>
              {item.message}
            </Txt>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: t.radius.xl,
    backgroundColor: t.colors.raised,
    borderWidth: t.hairline,
    borderColor: t.colors.borderStrong,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: t.dark ? 0.4 : 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  body: {
    flex: 1,
  },
}));
