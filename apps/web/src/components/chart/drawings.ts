import type { ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';

export interface ChartPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: 'trend' | 'hline';
  points: ChartPoint[];
}

/** Trend line between two (time, price) anchors, rendered as a series primitive. */
export class TrendLinePrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null;

  constructor(
    private readonly a: ChartPoint,
    private readonly b: ChartPoint,
    private readonly color: string,
  ) {}

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param;
  }

  detached(): void {
    this.param = null;
  }

  paneViews() {
    return [
      {
        renderer: () => ({
          draw: (target: {
            useBitmapCoordinateSpace: <T>(
              f: (s: {
                context: CanvasRenderingContext2D;
                horizontalPixelRatio: number;
                verticalPixelRatio: number;
              }) => T,
            ) => T;
          }) => {
            const p = this.param;
            if (!p) return;
            const ts = p.chart.timeScale();
            const x1 = ts.timeToCoordinate(this.a.time as UTCTimestamp);
            const x2 = ts.timeToCoordinate(this.b.time as UTCTimestamp);
            const y1 = p.series.priceToCoordinate(this.a.price);
            const y2 = p.series.priceToCoordinate(this.b.price);
            if (x1 === null || x2 === null || y1 === null || y2 === null) return;
            target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
              ctx.save();
              ctx.strokeStyle = this.color;
              ctx.lineWidth = Math.max(1, Math.round(1.6 * hr));
              ctx.beginPath();
              ctx.moveTo(x1 * hr, y1 * vr);
              ctx.lineTo(x2 * hr, y2 * vr);
              ctx.stroke();
              ctx.fillStyle = this.color;
              for (const [x, y] of [
                [x1, y1],
                [x2, y2],
              ] as const) {
                ctx.beginPath();
                ctx.arc(x * hr, y * vr, 3 * hr, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            });
          },
        }),
      },
    ];
  }
}

export function loadDrawings(symbol: string): Drawing[] {
  try {
    return JSON.parse(localStorage.getItem(`gc.drawings.${symbol}`) ?? '[]') as Drawing[];
  } catch {
    return [];
  }
}

export function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    localStorage.setItem(`gc.drawings.${symbol}`, JSON.stringify(drawings));
  } catch {
    // storage unavailable: drawings stay session-only
  }
}
