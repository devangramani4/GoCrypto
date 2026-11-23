import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { haptics } from '../lib/haptics';
import { makeStyles, useTheme } from '../theme';
import { Txt } from './Txt';

interface PercentSliderProps {
  /** 0–100 */
  value: number;
  onChange: (percent: number) => void;
  color?: string;
  disabled?: boolean;
  marks?: readonly number[];
}

const THUMB = 18;

/** Amount slider with 25/50/75/100 % detents (magnetic snapping + haptic ticks). */
export function PercentSlider({
  value,
  onChange,
  color,
  disabled = false,
  marks = [0, 25, 50, 75, 100],
}: PercentSliderProps) {
  const t = useTheme();
  const s = useStyles();
  const fill = color ?? t.colors.brand;
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startX = useRef(0);
  const last = useRef(value);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const marksRef = useRef(marks);
  useEffect(() => {
    onChangeRef.current = onChange;
    disabledRef.current = disabled;
    marksRef.current = marks;
    last.current = value;
  });

  // Created once; handlers read the latest props through refs.
  const [pan] = useState(() => {
    const update = (x: number) => {
      const w = widthRef.current;
      if (w <= 0) return;
      let pct = Math.round((Math.min(Math.max(x, 0), w) / w) * 100);
      const near = marksRef.current.find((m) => Math.abs(m - pct) <= 2);
      if (near !== undefined) pct = near;
      if (pct !== last.current) {
        if (marksRef.current.includes(pct)) haptics.selection();
        last.current = pct;
        onChangeRef.current(pct);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX - THUMB / 2;
        update(startX.current);
      },
      onPanResponderMove: (_e, g) => update(startX.current + g.dx),
    });
  });

  const pct = Math.min(Math.max(value, 0), 100);
  const x = (pct / 100) * width;

  return (
    <View style={[s.root, disabled && s.disabled]}>
      <View
        {...pan.panHandlers}
        style={s.touch}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width - THUMB;
          widthRef.current = w;
          setWidth(w);
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Amount percentage"
        accessibilityValue={{ min: 0, max: 100, now: pct, text: `${pct}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const next = e.nativeEvent.actionName === 'increment' ? Math.min(100, pct + 25) : Math.max(0, pct - 25);
          onChange(next - (next % 25));
        }}
      >
        <View pointerEvents="none" style={s.track}>
          <View style={[s.fill, { width: x, backgroundColor: fill }]} />
        </View>
        {marks.map((m) => (
          <View
            key={m}
            pointerEvents="none"
            style={[
              s.mark,
              {
                left: (m / 100) * width + THUMB / 2 - 5,
                backgroundColor: m <= pct ? fill : t.colors.surface,
                borderColor: m <= pct ? fill : t.colors.borderStrong,
              },
            ]}
          />
        ))}
        <View pointerEvents="none" style={[s.thumb, { left: x, borderColor: fill }]} />
      </View>
      <View style={s.labels}>
        {marks.map((m) => (
          <Pressable
            key={m}
            hitSlop={6}
            disabled={disabled}
            onPress={() => {
              haptics.selection();
              onChange(m);
            }}
          >
            <Txt variant="micro" numeric color={m === pct ? fill : t.colors.textFaint}>
              {m}%
            </Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    paddingVertical: 4,
  },
  disabled: {
    opacity: 0.45,
  },
  touch: {
    height: 30,
    justifyContent: 'center',
  },
  track: {
    marginHorizontal: THUMB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
  },
  mark: {
    position: 'absolute',
    top: 10,
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 2,
    transform: [{ rotate: '45deg' }],
  },
  thumb: {
    position: 'absolute',
    top: 6,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    backgroundColor: t.colors.surface,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
}));
