import { coinColor } from '../../lib/format';

export interface DonutItem {
  label: string;
  /** Share in percent (0-100); display only. */
  percent: number;
}

/** Allocation ring drawn with stroke-dasharray segments. */
export function Donut({ items, size = 168, thickness = 20, center }: { items: DonutItem[]; size?: number; thickness?: number; center?: React.ReactNode }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Allocation chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-raised)" strokeWidth={thickness} />
        {items.map((it) => {
          const len = (Math.max(0, it.percent) / 100) * c;
          const seg = (
            <circle
              key={it.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={coinColor(it.label)}
              strokeWidth={thickness}
              strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${it.label} ${it.percent.toFixed(2)}%`}</title>
            </circle>
          );
          offset += len;
          return seg;
        })}
      </svg>
      {center && <div className="donut__center">{center}</div>}
    </div>
  );
}
