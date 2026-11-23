import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme } from '../theme';
import { Txt } from './Txt';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Fill color of the active pill (e.g. green for Buy / red for Sell). */
  activeColor?: string;
  activeTextColor?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/** iOS-style segmented control with an animated sliding indicator. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  style,
}: SegmentedControlProps<T>) {
  const t = useTheme();
  const s = useStyles();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segment = options.length ? (width - 4) / options.length : 0;
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(x, { toValue: index * segment, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
  }, [index, segment, x]);

  const active = options[index];
  const height = size === 'sm' ? 32 : 40;

  return (
    <View
      style={[s.track, { height }, style]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {width > 0 ? (
        <Animated.View
          style={[
            s.indicator,
            {
              width: segment,
              height: height - 4,
              backgroundColor: active?.activeColor ?? t.colors.raised,
              transform: [{ translateX: x }],
            },
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              haptics.selection();
              onChange(o.value);
            }}
            style={s.segment}
          >
            <Txt
              variant={size === 'sm' ? 'caption' : 'label'}
              weight="semibold"
              numberOfLines={1}
              color={
                selected
                  ? (o.activeTextColor ?? (o.activeColor ? t.colors.onTrade : t.colors.text))
                  : t.colors.textMuted
              }
            >
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

interface TabsProps<T extends string> {
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Underlined text tabs (section switchers inside a screen). */
export function Tabs<T extends string>({ options, value, onChange, scrollable = false, style }: TabsProps<T>) {
  const t = useTheme();
  const s = useStyles();
  const items = options.map((o) => {
    const selected = o.value === value;
    return (
      <Pressable
        key={o.value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => {
          if (selected) return;
          haptics.selection();
          onChange(o.value);
        }}
        style={s.tab}
        hitSlop={6}
      >
        <Txt
          variant="label"
          weight={selected ? 'semibold' : 'medium'}
          color={selected ? t.colors.text : t.colors.textMuted}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 ? ` (${o.count})` : ''}
        </Txt>
        <View style={[s.underline, selected && { backgroundColor: t.colors.brand }]} />
      </Pressable>
    );
  });
  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={s.tabsRow}>
        {items}
      </ScrollView>
    );
  }
  return <View style={[s.tabsRow, style]}>{items}</View>;
}

const useStyles = makeStyles((t) => ({
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.surfaceAlt,
    borderRadius: t.radius.lg,
    borderWidth: t.hairline,
    borderColor: t.colors.border,
    padding: 2,
  },
  indicator: {
    position: 'absolute',
    left: 2,
    top: 2,
    borderRadius: t.radius.md + 2,
  },
  segment: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 20,
  },
  tab: {
    paddingTop: 6,
  },
  underline: {
    marginTop: 7,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
}));
