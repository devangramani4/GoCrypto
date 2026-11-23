import { coinColor } from '../../lib/format';

export interface DonutItem {
  label: string;
  /** Share in percent (0-100); display only. */
  percent: number;
}

/** Allocation ring drawn with stroke-dasharray segments. */
export function Donut({
  items,
  size = 168,
  thickness = 20,
  center,
}: {
  items: DonutItem[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const lengths = items.map((it) => (Math.max(0, it.percent) / 100) * c);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Allocation chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-raised)" strokeWidth={thickness} />
        {items.map((it, i) => {
          const len = lengths[i]!;
          return (
            <circle
              key={it.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={coinColor(it.label)}
              strokeWidth={thickness}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
              strokeDashoffset={-offsets[i]!}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${it.label} ${it.percent.toFixed(2)}%`}</title>
            </circle>
          );
        })}
      </svg>
      {center && <div className="donut__center">{center}</div>}
    </div>
  );
}
