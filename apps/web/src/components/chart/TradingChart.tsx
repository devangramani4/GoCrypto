import type { CandleDto, Timeframe } from '@gocrypto/shared-types';
import { atr, bollingerBands, ema, heikinAshi, macd, type OhlcvBar, rsi, sma, stochastic, vwap } from '@gocrypto/trading-utils';
import { Icon, type IconName, Skeleton, cx } from '@gocrypto/ui';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCandles } from '../../lib/hooks';
import { usePrefs } from '../../stores/session';
import { type ChartPoint, type Drawing, TrendLinePrimitive, loadDrawings, saveDrawings } from './drawings';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1H' },
  { value: '2h', label: '2H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
  { value: '1M', label: '1M' },
];

type ChartType = 'candles' | 'heikin' | 'line' | 'area';
type Indicator = 'VOL' | 'SMA' | 'EMA' | 'BB' | 'VWAP' | 'RSI' | 'MACD' | 'STOCH' | 'ATR';
type Tool = 'cursor' | 'trend' | 'hline';

const INDICATORS: { id: Indicator; label: string; pane: boolean }[] = [
  { id: 'VOL', label: 'Volume', pane: false },
  { id: 'SMA', label: 'SMA (20)', pane: false },
  { id: 'EMA', label: 'EMA (50)', pane: false },
  { id: 'BB', label: 'Bollinger Bands (20, 2)', pane: false },
  { id: 'VWAP', label: 'VWAP', pane: false },
  { id: 'RSI', label: 'RSI (14)', pane: true },
  { id: 'MACD', label: 'MACD (12, 26, 9)', pane: true },
  { id: 'STOCH', label: 'Stochastic (14, 3, 3)', pane: true },
  { id: 'ATR', label: 'ATR (14)', pane: true },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function toBars(candles: CandleDto[]): OhlcvBar[] {
  return candles.map((c) => ({ time: c.t / 1000, open: +c.o, high: +c.h, low: +c.l, close: +c.c, volume: +c.v }));
}

function lineData(bars: OhlcvBar[], values: (number | null)[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) out.push({ time: bars[i]!.time as UTCTimestamp, value: v });
  });
  return out;
}

interface SeriesSet {
  main: ISeriesApi<SeriesType> | null;
  volume: ISeriesApi<'Histogram'> | null;
  lines: { series: ISeriesApi<SeriesType>; compute: (bars: OhlcvBar[]) => unknown[] }[];
}

export interface TradingChartProps {
  symbol: string;
  pricePrecision: number;
  tickSize: string;
  defaultInterval?: Timeframe;
  compact?: boolean;
}

/** Professional candlestick chart with indicators, multiple panes and drawing tools. */
export function TradingChart({ symbol, pricePrecision, tickSize, defaultInterval = '15m', compact }: TradingChartProps) {
  const theme = usePrefs((s) => s.theme);
  const [interval, setInterval_] = useState<Timeframe>(() => (localStorage.getItem('gc.chart.tf') as Timeframe) || defaultInterval);
  const [chartType, setChartType] = useState<ChartType>(() => (localStorage.getItem('gc.chart.type') as ChartType) || 'candles');
  const [indicators, setIndicators] = useState<Indicator[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('gc.chart.ind') ?? '["VOL","EMA"]') as Indicator[];
    } catch {
      return ['VOL', 'EMA'];
    }
  });
  const [tool, setTool] = useState<Tool>('cursor');
  const [menu, setMenu] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(symbol));
  const [legend, setLegend] = useState<OhlcvBar | null>(null);
  const pending = useRef<ChartPoint | null>(null);
  const [pendingHint, setPendingHint] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<SeriesSet>({ main: null, volume: null, lines: [] });
  const primitives = useRef<{ trend: TrendLinePrimitive[]; lines: IPriceLine[] }>({ trend: [], lines: [] });
  const { candles, loading, error } = useCandles(symbol, interval);
  const bars = useMemo(() => (candles ? toBars(candles) : []), [candles]);
  const barsRef = useRef<OhlcvBar[]>([]);
  barsRef.current = bars;

  useEffect(() => localStorage.setItem('gc.chart.tf', interval), [interval]);
  useEffect(() => localStorage.setItem('gc.chart.type', chartType), [chartType]);
  useEffect(() => localStorage.setItem('gc.chart.ind', JSON.stringify(indicators)), [indicators]);
  useEffect(() => setDrawings(loadDrawings(symbol)), [symbol]);

  // Create the chart once.
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--c-text-muted'), fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, panes: { separatorColor: cssVar('--c-border'), separatorHoverColor: cssVar('--c-border-strong') } },
      grid: { vertLines: { color: cssVar('--c-chart-grid') }, horzLines: { color: cssVar('--c-chart-grid') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssVar('--c-border') },
      timeScale: { borderColor: cssVar('--c-border'), timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      localization: { priceFormatter: (p: number) => p.toFixed(pricePrecision) },
    });
    chartRef.current = chart;
    const onMove = (param: MouseEventParams<Time>) => {
      if (!param.time) return setLegend(null);
      const t = Number(param.time);
      setLegend(barsRef.current.find((b) => b.time === t) ?? null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = { main: null, volume: null, lines: [] };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)build series when structure changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const set = seriesRef.current;
    for (const s of [set.main, set.volume, ...set.lines.map((l) => l.series)]) if (s) chart.removeSeries(s);
    while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1);
    primitives.current = { trend: [], lines: [] };
    const up = cssVar('--c-up');
    const down = cssVar('--c-down');
    const brand = cssVar('--c-brand');
    chart.applyOptions({
      layout: { textColor: cssVar('--c-text-muted') },
      grid: { vertLines: { color: cssVar('--c-chart-grid') }, horzLines: { color: cssVar('--c-chart-grid') } },
      rightPriceScale: { borderColor: cssVar('--c-border') },
      timeScale: { borderColor: cssVar('--c-border') },
      localization: { priceFormatter: (p: number) => p.toFixed(pricePrecision) },
    });
    const priceFormat = { type: 'price' as const, precision: pricePrecision, minMove: Number(tickSize) };
    let main: ISeriesApi<SeriesType>;
    if (chartType === 'line') main = chart.addSeries(LineSeries, { color: brand, lineWidth: 2, priceFormat });
    else if (chartType === 'area') {
      main = chart.addSeries(AreaSeries, { lineColor: brand, topColor: `${brand}55`, bottomColor: `${brand}05`, lineWidth: 2, priceFormat });
    } else {
      main = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceFormat,
      });
    }
    const next: SeriesSet = { main, volume: null, lines: [] };
    if (indicators.includes('VOL')) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      next.volume = vol;
    }
    const overlay = (color: string, compute: (b: OhlcvBar[]) => unknown[], pane = 0, width: 1 | 2 = 1, style?: LineStyle) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      next.lines.push({ series: s, compute });
      return s;
    };
    const closes = (b: OhlcvBar[]) => b.map((x) => x.close);
    if (indicators.includes('SMA')) overlay('#f5b544', (b) => lineData(b, sma(closes(b), 20)));
    if (indicators.includes('EMA')) overlay('#38bdf8', (b) => lineData(b, ema(closes(b), 50)));
    if (indicators.includes('BB')) {
      overlay('#a78bfa', (b) => lineData(b, bollingerBands(closes(b)).upper));
      overlay('#a78bfa88', (b) => lineData(b, bollingerBands(closes(b)).middle), 0, 1, LineStyle.Dashed);
      overlay('#a78bfa', (b) => lineData(b, bollingerBands(closes(b)).lower));
    }
    if (indicators.includes('VWAP')) overlay('#f472b6', (b) => lineData(b, vwap(b)), 0, 2);
    let pane = 1;
    if (indicators.includes('RSI')) {
      const s = overlay('#a78bfa', (b) => lineData(b, rsi(closes(b), 14)), pane, 2);
      s.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' });
      s.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' });
      pane += 1;
    }
    if (indicators.includes('MACD')) {
      const p = pane;
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, p);
      next.lines.push({
        series: hist,
        compute: (b) =>
          lineData(b, macd(closes(b)).histogram).map((d) => ({ ...d, color: d.value >= 0 ? `${up}99` : `${down}99` })),
      });
      overlay(brand, (b) => lineData(b, macd(closes(b)).macd), p, 2);
      overlay('#f5b544', (b) => lineData(b, macd(closes(b)).signal), p);
      pane += 1;
    }
    if (indicators.includes('STOCH')) {
      overlay(brand, (b) => lineData(b, stochastic(b).k), pane, 2);
      overlay('#f5b544', (b) => lineData(b, stochastic(b).d), pane);
      pane += 1;
    }
    if (indicators.includes('ATR')) {
      overlay('#22d3ee', (b) => lineData(b, atr(b, 14)), pane, 2);
      pane += 1;
    }
    for (const p of chart.panes().slice(1)) p.setHeight(compact ? 70 : 96);
    seriesRef.current = next;
    applyData(true);
    attachDrawings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, indicators, theme, pricePrecision, tickSize, symbol, interval]);

  function applyData(fit: boolean) {
    const set = seriesRef.current;
    const b = barsRef.current;
    if (!set.main) return;
    const source = chartType === 'heikin' ? heikinAshi(b) : b;
    if (chartType === 'line' || chartType === 'area') {
      set.main.setData(source.map((x) => ({ time: x.time as UTCTimestamp, value: x.close })));
    } else {
      set.main.setData(source.map((x) => ({ time: x.time as UTCTimestamp, open: x.open, high: x.high, low: x.low, close: x.close })));
    }
    if (set.volume) {
      const up = cssVar('--c-up-soft');
      const down = cssVar('--c-down-soft');
      set.volume.setData(b.map((x) => ({ time: x.time as UTCTimestamp, value: x.volume, color: x.close >= x.open ? up : down })));
    }
    for (const l of set.lines) l.series.setData(l.compute(b) as never);
    if (fit && b.length) chartRef.current?.timeScale().fitContent();
  }

  // Push data updates (initial load + live candles), batched per animation frame.
  const frame = useRef<number | null>(null);
  const firstLoad = useRef(true);
  useEffect(() => {
    firstLoad.current = true;
  }, [symbol, interval]);
  useEffect(() => {
    if (!bars.length) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const fit = firstLoad.current;
      firstLoad.current = false;
      applyData(fit);
      if (fit) chartRef.current?.timeScale().scrollToRealTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  // Drawings
  function attachDrawings() {
    const main = seriesRef.current.main;
    if (!main) return;
    for (const t of primitives.current.trend) main.detachPrimitive(t);
    for (const l of primitives.current.lines) main.removePriceLine(l);
    primitives.current = { trend: [], lines: [] };
    const color = cssVar('--c-warn');
    for (const d of drawings) {
      if (d.kind === 'trend' && d.points.length === 2) {
        const prim = new TrendLinePrimitive(d.points[0]!, d.points[1]!, color);
        main.attachPrimitive(prim);
        primitives.current.trend.push(prim);
      } else if (d.kind === 'hline' && d.points[0]) {
        primitives.current.lines.push(
          main.createPriceLine({ price: d.points[0].price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'S/R' }),
        );
      }
    }
  }
  useEffect(() => {
    attachDrawings();
    saveDrawings(symbol, drawings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawings]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onClick = (param: MouseEventParams<Time>) => {
      if (tool === 'cursor' || !param.point || !seriesRef.current.main) return;
      const price = seriesRef.current.main.coordinateToPrice(param.point.y);
      const time = param.time ? Number(param.time) : barsRef.current[barsRef.current.length - 1]?.time;
      if (price === null || time === undefined) return;
      const pt = { time, price: Number(price) };
      if (tool === 'hline') {
        setDrawings((d) => [...d, { id: crypto.randomUUID(), kind: 'hline', points: [pt] }]);
        setTool('cursor');
      } else if (tool === 'trend') {
        if (!pending.current) {
          pending.current = pt;
          setPendingHint(true);
        } else {
          const a = pending.current;
          pending.current = null;
          setPendingHint(false);
          setDrawings((d) => [...d, { id: crypto.randomUUID(), kind: 'trend', points: [a, pt] }]);
          setTool('cursor');
        }
      }
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [tool]);

  const toggle = (id: Indicator) => setIndicators((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const last = legend ?? bars[bars.length - 1] ?? null;
  const change = last ? last.close - last.open : 0;
  const tools: { id: Tool; icon: IconName; label: string }[] = [
    { id: 'cursor', icon: 'activity', label: 'Crosshair' },
    { id: 'trend', icon: 'trendline', label: 'Trend line' },
    { id: 'hline', icon: 'hline', label: 'Horizontal line / support & resistance' },
  ];

  return (
    <div className="chart">
      <div className="chart__toolbar">
        <div className="chart__tfs" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t.value} type="button" aria-pressed={interval === t.value} onClick={() => setInterval_(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="chart__sep" />
        <div className="chart__tfs" role="group" aria-label="Chart type">
          {(
            [
              ['candles', 'Candles'],
              ['heikin', 'Heikin Ashi'],
              ['line', 'Line'],
              ['area', 'Area'],
            ] as [ChartType, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={chartType === v} onClick={() => setChartType(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="chart__sep" />
        <div className="chart__menu-wrap">
          <button type="button" className="chart__btn" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Icon name="activity" size={14} /> Indicators{indicators.length ? ` (${indicators.length})` : ''}
          </button>
          {menu && (
            <div className="chart__menu" onMouseLeave={() => setMenu(false)}>
              {INDICATORS.map((i) => (
                <label key={i.id} className="chart__menu-item">
                  <input type="checkbox" checked={indicators.includes(i.id)} onChange={() => toggle(i.id)} />
                  <span>{i.label}</span>
                  {i.pane && <span className="faint">pane</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="spacer" />
        {tools.map((t) => (
          <button key={t.id} type="button" className={cx('chart__icon', tool === t.id && 'active')} onClick={() => setTool(t.id)} data-tip={t.label} aria-label={t.label}>
            <Icon name={t.icon} size={15} />
          </button>
        ))}
        <button type="button" className="chart__icon" onClick={() => setDrawings([])} data-tip="Remove drawings" aria-label="Remove drawings" disabled={!drawings.length}>
          <Icon name="trash" size={15} />
        </button>
        <button type="button" className="chart__icon" onClick={() => chartRef.current?.timeScale().fitContent()} data-tip="Fit" aria-label="Fit chart">
          <Icon name="maximize" size={15} />
        </button>
      </div>
      <div className="chart__body">
        {last && (
          <div className="chart__legend num">
            <span className="muted">O</span> <span className={change >= 0 ? 'up' : 'down'}>{last.open.toFixed(pricePrecision)}</span>{' '}
            <span className="muted">H</span> <span className={change >= 0 ? 'up' : 'down'}>{last.high.toFixed(pricePrecision)}</span>{' '}
            <span className="muted">L</span> <span className={change >= 0 ? 'up' : 'down'}>{last.low.toFixed(pricePrecision)}</span>{' '}
            <span className="muted">C</span> <span className={change >= 0 ? 'up' : 'down'}>{last.close.toFixed(pricePrecision)}</span>{' '}
            <span className="muted">V</span> <span>{last.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
        )}
        {pendingHint && <div className="chart__hint">Click the second point of the trend line</div>}
        {tool !== 'cursor' && !pendingHint && <div className="chart__hint">Click on the chart to place the {tool === 'trend' ? 'first point' : 'line'}</div>}
        {loading && (
          <div className="chart__overlay">
            <Skeleton width="100%" height="100%" />
          </div>
        )}
        {Boolean(error) && <div className="chart__overlay chart__error">Chart data unavailable</div>}
        <div ref={container} className="chart__canvas" style={{ cursor: tool === 'cursor' ? 'crosshair' : 'copy' }} />
      </div>
    </div>
  );
}
