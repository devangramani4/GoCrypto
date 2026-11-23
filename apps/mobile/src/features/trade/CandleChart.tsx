import type { CandleDto, Timeframe } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { ErrorState, Icon, Skeleton, Txt } from '../../components';
import { useCandles } from '../../hooks/useMarketData';
import { fmtAxisTime, fmtDateTime, formatCompact, formatPercent, formatPrice, signOf } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { makeStyles, useTheme } from '../../theme';

const TIMEFRAMES: readonly { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
];

const AXIS_W = 64;
const TIME_H = 18;
const MIN_VISIBLE = 20;
const MAX_VISIBLE = 150;
const EMPTY: CandleDto[] = [];

interface CandleChartProps {
  symbol: string;
  tickSize: string;
  height?: number;
  defaultTimeframe?: Timeframe;
}

interface Geometry {
  upWicks: string;
  downWicks: string;
  upBodies: string;
  downBodies: string;
  upVolume: string;
  downVolume: string;
  grid: { y: number; value: number }[];
  times: { x: number; label: string }[];
  yOf: (price: number) => number;
  min: number;
  max: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Candlestick + volume chart drawn with react-native-svg. Candles are batched into six SVG paths
 * (up/down wicks, bodies and volume) so live updates stay cheap.
 * Gestures: drag horizontally to scroll history, long-press to scrub, tap to inspect a candle.
 * (Pixel coordinates use floats; prices shown to the user are formatted from the decimal strings.)
 */
function CandleChartImpl({ symbol, tickSize, height = 280, defaultTimeframe = '15m' }: CandleChartProps) {
  const t = useTheme();
  const s = useStyles();
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(60);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [viewKey, setViewKey] = useState(`${symbol}:${defaultTimeframe}`);
  const query = useCandles(symbol, tf);
  const candles = query.data ?? EMPTY;

  // Reset the viewport when the market or timeframe changes.
  const key = `${symbol}:${tf}`;
  if (key !== viewKey) {
    setViewKey(key);
    setOffset(0);
    setSelected(null);
  }

  const chartW = Math.max(0, width - AXIS_W);
  const plotH = height - TIME_H;
  const priceH = Math.round(plotH * 0.78);
  const volTop = priceH + 6;
  const volH = Math.max(0, plotH - volTop);
  const count = candles.length;
  const maxOffset = Math.max(0, count - visible);
  const off = Math.min(offset, maxOffset);
  const end = count - off;
  const start = Math.max(0, end - visible);
  const slot = visible > 0 ? chartW / visible : 1;

  const live = useRef({ slot, start, end, maxOffset, offset: off });
  useLayoutEffect(() => {
    live.current = { slot, start, end, maxOffset, offset: off };
  });

  // Gesture state lives in a ref (it changes during touches, never during render).
  const gesture = useRef<{
    mode: 'idle' | 'pan' | 'scrub';
    startOffset: number;
    startX: number;
    longPress: ReturnType<typeof setTimeout> | null;
  }>({
    mode: 'idle',
    startOffset: 0,
    startX: 0,
    longPress: null,
  });
  useEffect(
    () => () => {
      if (gesture.current.longPress) clearTimeout(gesture.current.longPress);
    },
    [],
  );

  // Created once; handlers read the latest viewport from `live`.
  const [pan] = useState(() => {
    const g0 = gesture.current;
    const clearLongPress = () => {
      if (g0.longPress) clearTimeout(g0.longPress);
      g0.longPress = null;
    };
    const indexAt = (x: number) => {
      const v = live.current;
      if (v.end <= v.start) return null;
      return clamp(v.start + Math.floor(x / v.slot), v.start, v.end - 1);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => g0.mode === 'idle',
      onPanResponderGrant: (e) => {
        g0.mode = 'idle';
        g0.startX = e.nativeEvent.locationX;
        g0.startOffset = live.current.offset;
        clearLongPress();
        g0.longPress = setTimeout(() => {
          g0.mode = 'scrub';
          haptics.selection();
          setSelected(indexAt(g0.startX));
        }, 300);
      },
      onPanResponderMove: (_e, g) => {
        if (g0.mode === 'scrub') {
          setSelected(indexAt(g0.startX + g.dx));
          return;
        }
        if (g0.mode === 'idle' && Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy)) {
          g0.mode = 'pan';
          clearLongPress();
        } else if (g0.mode === 'idle' && Math.abs(g.dy) > 8) {
          clearLongPress();
        }
        if (g0.mode === 'pan') {
          const cur = live.current;
          setOffset(clamp(Math.round(g0.startOffset + g.dx / cur.slot), 0, cur.maxOffset));
        }
      },
      onPanResponderRelease: (_e, g) => {
        clearLongPress();
        if (g0.mode === 'idle' && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) {
          const i = indexAt(g0.startX);
          setSelected((cur) => (cur === i ? null : i));
        }
        g0.mode = 'idle';
      },
      onPanResponderTerminate: () => {
        clearLongPress();
        g0.mode = 'idle';
      },
    });
  });

  const geo = useMemo<Geometry | null>(() => {
    const slice = candles.slice(start, end);
    if (slice.length === 0 || chartW <= 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    let maxVol = 0;
    for (const c of slice) {
      lo = Math.min(lo, num(c.l));
      hi = Math.max(hi, num(c.h));
      maxVol = Math.max(maxVol, num(c.v));
    }
    if (hi <= lo) {
      const pad = Math.abs(hi) * 0.01 || 1;
      hi += pad;
      lo -= pad;
    }
    const padding = (hi - lo) * 0.08;
    const max = hi + padding;
    const min = Math.max(0, lo - padding);
    const yOf = (p: number) => ((max - p) / (max - min)) * priceH;
    const body = Math.max(1, slot * 0.66);
    let upWicks = '';
    let downWicks = '';
    let upBodies = '';
    let downBodies = '';
    let upVolume = '';
    let downVolume = '';
    slice.forEach((c, i) => {
      const o = num(c.o);
      const cl = num(c.c);
      const up = cl >= o;
      const cx = i * slot + slot / 2;
      const x0 = cx - body / 2;
      const wick = `M${cx.toFixed(1)} ${yOf(num(c.h)).toFixed(1)}V${yOf(num(c.l)).toFixed(1)}`;
      const top = yOf(Math.max(o, cl));
      const h = Math.max(1, yOf(Math.min(o, cl)) - top);
      const rect = `M${x0.toFixed(1)} ${top.toFixed(1)}h${body.toFixed(1)}v${h.toFixed(1)}h${(-body).toFixed(1)}Z`;
      const vh = maxVol > 0 ? Math.max(1, (num(c.v) / maxVol) * volH) : 0;
      const vol =
        vh > 0
          ? `M${x0.toFixed(1)} ${(volTop + volH - vh).toFixed(1)}h${body.toFixed(1)}v${vh.toFixed(1)}h${(-body).toFixed(1)}Z`
          : '';
      if (up) {
        upWicks += wick;
        upBodies += rect;
        upVolume += vol;
      } else {
        downWicks += wick;
        downBodies += rect;
        downVolume += vol;
      }
    });
    const grid = [0, 1, 2, 3, 4].map((k) => {
      const value = max - ((max - min) * k) / 4;
      return { y: yOf(value), value };
    });
    const every = Math.max(1, Math.ceil(slice.length / 4));
    const intraday = tf !== '1d' && tf !== '1w' && tf !== '1M';
    const times: { x: number; label: string }[] = [];
    for (let i = Math.floor(every / 2); i < slice.length; i += every) {
      const c = slice[i];
      if (c) times.push({ x: i * slot + slot / 2, label: fmtAxisTime(c.t, intraday) });
    }
    return { upWicks, downWicks, upBodies, downBodies, upVolume, downVolume, grid, times, yOf, min, max };
  }, [candles, start, end, chartW, slot, priceH, volTop, volH, tf]);

  const last = candles[count - 1];
  const focus = selected !== null ? candles[selected] : last;
  const lastClose = last ? num(last.c) : null;
  const lastUp = last ? signOf(D(last.c).minus(last.o)) >= 0 : true;
  const lastY = geo && lastClose !== null ? clamp(geo.yOf(lastClose), 0, priceH) : null;
  const selX = selected !== null && selected >= start && selected < end ? (selected - start) * slot + slot / 2 : null;
  const selC = selected !== null ? candles[selected] : undefined;
  const selY = geo && selC ? clamp(geo.yOf(num(selC.c)), 0, priceH) : null;

  const zoom = (factor: number) => {
    haptics.selection();
    setVisible((v) => clamp(Math.round(v * factor), MIN_VISIBLE, MAX_VISIBLE));
  };

  return (
    <View>
      <View style={s.toolbar}>
        <View style={s.tfs}>
          {TIMEFRAMES.map((o) => {
            const active = o.value === tf;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setTf(o.value);
                }}
                style={[s.tf, active && { backgroundColor: t.colors.raised }]}
                hitSlop={4}
              >
                <Txt variant="caption" weight="semibold" color={active ? t.colors.text : t.colors.textMuted}>
                  {o.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        <View style={s.zoom}>
          <Pressable accessibilityLabel="Zoom out" hitSlop={6} onPress={() => zoom(1.4)} style={s.zoomBtn}>
            <Icon name="minus" size={16} color={t.colors.textMuted} />
          </Pressable>
          <Pressable accessibilityLabel="Zoom in" hitSlop={6} onPress={() => zoom(1 / 1.4)} style={s.zoomBtn}>
            <Icon name="plus" size={16} color={t.colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={s.legend}>
        {focus ? (
          <>
            <Txt variant="micro" tone="faint" numeric numberOfLines={1} style={s.legendText}>
              {selected !== null ? `${fmtDateTime(focus.t)}  ` : ''}O{' '}
              <Txt variant="micro" numeric>
                {formatPrice(focus.o, tickSize)}
              </Txt>{' '}
              H{' '}
              <Txt variant="micro" numeric>
                {formatPrice(focus.h, tickSize)}
              </Txt>{' '}
              L{' '}
              <Txt variant="micro" numeric>
                {formatPrice(focus.l, tickSize)}
              </Txt>{' '}
              C{' '}
              <Txt variant="micro" numeric>
                {formatPrice(focus.c, tickSize)}
              </Txt>
            </Txt>
            <Txt variant="micro" numeric color={signOf(D(focus.c).minus(focus.o)) >= 0 ? t.colors.up : t.colors.down}>
              {D(focus.o).isZero() ? '' : formatPercent(D(focus.c).minus(focus.o).div(focus.o))}
              <Txt variant="micro" tone="faint">{`  V ${formatCompact(focus.v)}`}</Txt>
            </Txt>
          </>
        ) : (
          <Txt variant="micro" tone="faint">
            {' '}
          </Txt>
        )}
      </View>

      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        {query.isPending ? (
          <Skeleton height={height - 8} radius={t.radius.lg} />
        ) : query.isError ? (
          <ErrorState compact error={query.error} onRetry={() => void query.refetch()} style={{ height }} />
        ) : !geo ? (
          <View style={[s.empty, { height }]}>
            <Txt variant="caption" tone="muted">
              No trades in this timeframe yet
            </Txt>
          </View>
        ) : (
          <View pointerEvents="none">
            <Svg width={width} height={height}>
              {geo.grid.map((g, i) => (
                <Line key={`g${i}`} x1={0} x2={chartW} y1={g.y} y2={g.y} stroke={t.colors.chartGrid} strokeWidth={1} />
              ))}
              <Line x1={0} x2={chartW} y1={volTop - 3} y2={volTop - 3} stroke={t.colors.chartGrid} strokeWidth={1} />
              {geo.grid.map((g, i) => (
                <SvgText
                  key={`p${i}`}
                  x={width - 4}
                  y={clamp(g.y + 3.5, 9, priceH)}
                  fontSize={10}
                  fill={t.colors.textFaint}
                  textAnchor="end"
                >
                  {formatPrice(String(g.value), tickSize)}
                </SvgText>
              ))}
              <Path d={geo.upVolume} fill={t.colors.upSoft} />
              <Path d={geo.downVolume} fill={t.colors.downSoft} />
              <Path d={geo.upWicks} stroke={t.colors.up} strokeWidth={1} />
              <Path d={geo.downWicks} stroke={t.colors.down} strokeWidth={1} />
              <Path d={geo.upBodies} fill={t.colors.up} />
              <Path d={geo.downBodies} fill={t.colors.down} />
              {lastY !== null && last ? (
                <>
                  <Line
                    x1={0}
                    x2={chartW}
                    y1={lastY}
                    y2={lastY}
                    stroke={lastUp ? t.colors.up : t.colors.down}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                  />
                  <Rect
                    x={chartW + 2}
                    y={lastY - 8}
                    width={AXIS_W - 4}
                    height={16}
                    rx={3}
                    fill={lastUp ? t.colors.up : t.colors.down}
                  />
                  <SvgText
                    x={width - 5}
                    y={lastY + 3.5}
                    fontSize={10}
                    fontWeight="600"
                    fill={t.colors.onTrade}
                    textAnchor="end"
                  >
                    {formatPrice(last.c, tickSize)}
                  </SvgText>
                </>
              ) : null}
              {selX !== null && selY !== null && selC ? (
                <>
                  <Line
                    x1={selX}
                    x2={selX}
                    y1={0}
                    y2={plotH}
                    stroke={t.colors.textMuted}
                    strokeWidth={1}
                    strokeDasharray="2,3"
                  />
                  <Line
                    x1={0}
                    x2={chartW}
                    y1={selY}
                    y2={selY}
                    stroke={t.colors.textMuted}
                    strokeWidth={1}
                    strokeDasharray="2,3"
                  />
                  <Rect
                    x={chartW + 2}
                    y={selY - 8}
                    width={AXIS_W - 4}
                    height={16}
                    rx={3}
                    fill={t.colors.borderStrong}
                  />
                  <SvgText x={width - 5} y={selY + 3.5} fontSize={10} fill={t.colors.text} textAnchor="end">
                    {formatPrice(selC.c, tickSize)}
                  </SvgText>
                </>
              ) : null}
              {geo.times.map((tm, i) => (
                <SvgText
                  key={`t${i}`}
                  x={tm.x}
                  y={height - 4}
                  fontSize={10}
                  fill={t.colors.textFaint}
                  textAnchor="middle"
                >
                  {tm.label}
                </SvgText>
              ))}
            </Svg>
          </View>
        )}
        {off > 0 ? (
          <Pressable
            accessibilityLabel="Jump to latest candle"
            onPress={() => {
              haptics.selection();
              setOffset(0);
            }}
            style={[s.latest, { right: AXIS_W + 6, top: priceH / 2 - 14 }]}
          >
            <Icon name="chevron-right" size={16} color={t.colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export const CandleChart = memo(CandleChartImpl);

const useStyles = makeStyles((t) => ({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  tfs: {
    flexDirection: 'row',
    gap: 2,
  },
  tf: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: t.radius.md,
  },
  zoom: {
    flexDirection: 'row',
    gap: 4,
  },
  zoomBtn: {
    width: 28,
    height: 28,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.surfaceAlt,
  },
  legend: {
    minHeight: 32,
    marginBottom: 4,
  },
  legendText: {
    marginBottom: 1,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  latest: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.raised,
    borderWidth: t.hairline,
    borderColor: t.colors.borderStrong,
  },
}));
