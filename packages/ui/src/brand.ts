/**
 * GoCrypto logo: a blue shield carrying a white "G".
 *
 * Plain data on a 100 × 100 canvas, shared by every rendering of the logo: the React DOM mark
 * (web, admin, desktop), the React Native mark, and the generator in tools/brand that writes the
 * favicons and the iOS, Android and desktop app icons. Change the logo here, then run
 * `pnpm --filter @gocrypto/brand generate` to refresh the image files.
 */

type Stop = readonly [offset: number, color: string];

/** A linear gradient in canvas units (SVG `gradientUnits="userSpaceOnUse"`). */
export interface LogoGradient {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: readonly Stop[];
}

/** The G is one stroked path: an arc that opens at the upper right, then a bar back toward the centre. */
const glyph = { cx: 50, cy: 49, r: 13, startDeg: -42, endDeg: 8, barX: 51.5, width: 7.2 } as const;

const round = (v: number): number => Math.round(v * 100) / 100;
const point = (r: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  return `${round(glyph.cx + r * Math.cos(a))} ${round(glyph.cy + r * Math.sin(a))}`;
};

/** Centre line of the G, drawn with a round-capped stroke of `logo.glyph.width`. */
function glyphStroke(): string {
  const { r, startDeg, endDeg, barX } = glyph;
  const endY = round(glyph.cy + r * Math.sin((endDeg * Math.PI) / 180));
  return `M${point(r, startDeg)}A${r} ${r} 0 1 0 ${point(r, endDeg)}L${barX} ${endY}`;
}

/**
 * Outline of that stroke as a closed shape, for one-colour versions of the logo that cut the G out
 * of the shield (Android notification and themed icons), where a white stroke cannot be used.
 */
function glyphOutline(): string {
  const { r, startDeg, endDeg, barX, width } = glyph;
  const h = width / 2;
  const outer = r + h;
  const inner = r - h;
  const endRad = (endDeg * Math.PI) / 180;
  const ex = round(glyph.cx + r * Math.cos(endRad));
  const ey = glyph.cy + r * Math.sin(endRad);
  const top = round(ey - h);
  const bottom = round(ey + h);
  // Where the bottom edge of the bar meets the inside of the bowl.
  const meetX = round(glyph.cx + Math.sqrt(inner * inner - (ey + h - glyph.cy) ** 2));
  return [
    `M${point(outer, startDeg)}`,
    `A${round(outer)} ${round(outer)} 0 1 0 ${point(outer, endDeg)}`, // outside of the bowl
    `A${h} ${h} 0 0 0 ${ex} ${top}`, // round corner into the top of the bar
    `L${barX} ${top}`,
    `A${h} ${h} 0 0 0 ${barX} ${bottom}`, // round end of the bar
    `L${meetX} ${bottom}`,
    `A${round(inner)} ${round(inner)} 0 1 1 ${point(inner, startDeg)}`, // inside of the bowl
    `A${h} ${h} 0 0 0 ${point(outer, startDeg)}`, // round end at the top right
    'Z',
  ].join('');
}

export const logo = {
  /** App-icon tile: the full 100 × 100 canvas. */
  tileViewBox: '0 0 100 100',
  /** The shield alone, framed tightly (for in-app marks and favicons). */
  markViewBox: '10.5 11 79 79',
  /** Brand blue: the middle of the shield gradient. */
  blue: '#2D7BF6',
  tile: {
    gradient: {
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 100,
      stops: [
        [0, '#0A2152'],
        [1, '#020816'],
      ],
    },
    glow: { cx: 50, cy: 50, r: 46, color: '#2D7BF6', opacity: 0.32 },
  },
  shield: {
    path: 'M50 12L80 23V47C80 67 67 81 50 89C33 81 20 67 20 47V23Z',
    gradient: {
      x1: 20,
      y1: 12,
      x2: 80,
      y2: 89,
      stops: [
        [0, '#8CC8FF'],
        [0.55, '#2D7BF6'],
        [1, '#0B3FA8'],
      ],
    },
    /** Darker right half, for a folded, three-dimensional look. */
    shade: { path: 'M50 12L80 23V47C80 67 67 81 50 89Z', color: '#001033', opacity: 0.16 },
    /** Light catching the top-left edge. */
    highlight: { path: 'M23.5 25.5L50 15.8', color: '#FFFFFF', opacity: 0.55, width: 1.6 },
  },
  glyph: {
    path: glyphStroke(),
    outline: glyphOutline(),
    color: '#FFFFFF',
    width: glyph.width,
    shadow: { color: '#0A2F80', opacity: 0.45, dx: 0.8, dy: 1.2 },
  },
} as const;
