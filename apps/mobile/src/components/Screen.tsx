import type { ReactNode, Ref } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '../theme';

interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (default). */
  scroll?: boolean;
  /** 16pt horizontal gutter (default). */
  padded?: boolean;
  /** Pad below the status bar (tab screens that draw their own header). */
  topInset?: boolean;
  /** Pad above the home indicator (screens without a tab bar). */
  bottomInset?: boolean;
  /** Fixed content above the scroll area (custom headers, toolbars). */
  header?: ReactNode;
  /** Sticky bottom area (actions). */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  scrollRef?: Ref<ScrollViewInstance>;
}

/**
 * Base screen: themed background, safe areas, pull-to-refresh and keyboard handling (iOS adjusts
 * scroll insets natively, Android resizes the window — `softwareKeyboardLayoutMode: resize`).
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  topInset = false,
  bottomInset = true,
  header,
  footer,
  refreshing = false,
  onRefresh,
  contentStyle,
  style,
  scrollRef,
}: ScreenProps) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const gutter = padded ? 16 : 0;
  const bottom = bottomInset && !footer ? insets.bottom : 0;

  return (
    <View style={[s.root, topInset && { paddingTop: insets.top }, style]}>
      {header}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={s.flex}
          contentContainerStyle={[{ paddingHorizontal: gutter, paddingBottom: bottom + 28 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={t.colors.textMuted}
                colors={[t.colors.brand]}
                progressBackgroundColor={t.colors.surface}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.flex, { paddingHorizontal: gutter, paddingBottom: bottom }, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[s.footer, { paddingBottom: (bottomInset ? insets.bottom : 0) + 12 }]}>{footer}</View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  flex: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: t.colors.bg,
    borderTopWidth: t.hairline,
    borderTopColor: t.colors.border,
  },
}));
