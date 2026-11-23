import { ColorType, HistogramSeries, type IChartApi, type ISeriesApi, type Time, createChart } from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import { type VolumePoint, hourlyBuckets } from '../lib/series';
import { cssVar, useTheme } from '../lib/theme';

const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, '0');

function timeLabel(time: Time, withDate: boolean): string {
  if (typeof time !== 'number') return String(time);
  const d = new Date(time * 1000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}` : hm;
}

/** Hourly USD volume histogram (lightweight-charts v5; local-time axis; follows the active theme). */
export function VolumeChart({ series }: { series: readonly VolumePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const theme = useTheme((s) => s.theme);
  const data = useMemo(() => hourlyBuckets(series), [series]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const text = cssVar('--c-text-muted', '#8b95a7');
    const grid = cssVar('--c-chart-grid', 'rgba(139, 149, 167, 0.08)');
    const border = cssVar('--c-border', '#1f2632');
    const brand = cssVar('--c-brand', '#2d7bf6');
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border, scaleMargins: { top: 0.12, bottom: 0 } },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        tickMarkFormatter: (time: Time) => timeLabel(time, false),
      },
      localization: { priceFormatter: (p: number) => compactUsd.format(p), timeFormatter: (time: Time) => timeLabel(time, true) },
      crosshair: { vertLine: { color: border, labelBackgroundColor: brand }, horzLine: { color: border, labelBackgroundColor: brand } },
      handleScroll: false,
      handleScale: false,
    });
    const histogram = chart.addSeries(HistogramSeries, {
      color: brand,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', formatter: (p: number) => compactUsd.format(p), minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = histogram;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    seriesRef.current?.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [data, theme]);

  return <div ref={containerRef} className="adm-chart" role="img" aria-label="Hourly trading volume in USD over the last 24 hours" />;
}
