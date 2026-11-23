import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useObscured } from '../store/lock';
import { makeStyles, useTheme } from '../theme';
import { IconButton } from './Button';
import { Txt } from './Txt';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Sticky actions under the content. */
  footer?: ReactNode;
  /** Wrap content in a ScrollView (forms / long content). */
  scroll?: boolean;
  /** Allow backdrop tap / swipe-down / back button to close (default true). */
  dismissible?: boolean;
}

/**
 * Bottom sheet built on RN Modal: slide-up animation, swipe-to-dismiss on the handle, keyboard
 * avoidance and safe-area padding. Hidden while the app is locked or covered (privacy).
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scroll = false,
  dismissible = true,
}: SheetProps) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const obscured = useObscured();
  const show = visible && !obscured;

  const [mounted, setMounted] = useState(show);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (show) {
      setMounted(true);
      drag.setValue(0);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [show, progress, drag]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => dismissibleRef.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 110 || g.vy > 1.1) onCloseRef.current();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [drag],
  );

  if (!mounted) return null;

  const translateY = Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }), drag);
  const requestClose = () => {
    if (dismissible) onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
    >
      {/* The modal root starts at the window origin, so 'padding' self-corrects on both platforms
          (no extra padding when Android already resized the dialog window). */}
      <KeyboardAvoidingView behavior="padding" style={s.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay, opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={requestClose}
            accessibilityLabel="Dismiss"
            accessibilityRole="button"
          />
        </Animated.View>
        <View style={s.flex} pointerEvents="box-none" />
        <Animated.View
          style={[
            s.sheet,
            { maxHeight: height * 0.92, paddingBottom: insets.bottom + 12, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View {...pan.panHandlers} style={s.handleArea}>
            <View style={s.handle} />
            {title ? (
              <View style={s.titleRow}>
                <View style={s.flex}>
                  <Txt variant="subtitle">{title}</Txt>
                  {subtitle ? (
                    <Txt variant="caption" tone="muted" style={s.subtitle}>
                      {subtitle}
                    </Txt>
                  ) : null}
                </View>
                {dismissible ? (
                  <IconButton icon="close" size={18} filled onPress={onClose} accessibilityLabel="Close" />
                ) : null}
              </View>
            ) : null}
          </View>
          {scroll ? (
            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={s.body}>{children}</View>
          )}
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  flex: {
    flex: 1,
  },
  sheet: {
    flexShrink: 1,
    backgroundColor: t.colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: t.hairline,
    borderColor: t.colors.border,
  },
  handleArea: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: t.colors.borderStrong,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
  },
  subtitle: {
    marginTop: 2,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
}));
