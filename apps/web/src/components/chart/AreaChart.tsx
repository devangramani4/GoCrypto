import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { usePrefs } from '../../stores/session';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Lightweight area chart for equity curves (display only — values are not used for money math). */
export function AreaChart({
  points,
  height = 220,
  tone = 'brand',
}: {
  points: { t: number; value: string }[];
  height?: number;
  tone?: 'brand' | 'up' | 'down';
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const theme = usePrefs((s) => s.theme);

  useEffect(() => {
    if (!el.current) return;
    const line = cssVar(`--c-${tone}`);
    const c = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: cssVar('--c-text-faint'),
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--c-chart-grid') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
      crosshair: { horzLine: { visible: false, labelVisible: false } },
    });
    series.current = c.addSeries(AreaSeries, {
      lineColor: line,
      topColor: withAlpha(line, 0.28),
      bottomColor: withAlpha(line, 0.01),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [theme, tone]);

  useEffect(() => {
    if (!series.current) return;
    const seen = new Set<number>();
    const data = [...points]
      .sort((a, b) => a.t - b.t)
      .map((p) => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: Number(p.value) }))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), Number.isFinite(p.value))));
    series.current.setData(data);
    chart.current?.timeScale().fitContent();
  }, [points, theme, tone]);

  return <div ref={el} className="area-chart" style={{ height }} />;
}
