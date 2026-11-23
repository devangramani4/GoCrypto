import { memo, type ReactElement } from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { useTheme } from '../theme';

export type IconName =
  | 'home'
  | 'markets'
  | 'trade'
  | 'futures'
  | 'wallet'
  | 'user'
  | 'search'
  | 'bell'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'close'
  | 'copy'
  | 'star'
  | 'star-filled'
  | 'eye'
  | 'eye-off'
  | 'check'
  | 'check-circle'
  | 'alert'
  | 'info'
  | 'deposit'
  | 'withdraw'
  | 'transfer'
  | 'shield'
  | 'lock'
  | 'face-id'
  | 'fingerprint'
  | 'sliders'
  | 'logout'
  | 'history'
  | 'plus'
  | 'minus'
  | 'external'
  | 'trash'
  | 'phone'
  | 'moon'
  | 'sun'
  | 'refresh'
  | 'key'
  | 'mail'
  | 'clipboard'
  | 'share'
  | 'swap-vertical'
  | 'list'
  | 'zap';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

type Draw = (c: string) => ReactElement;

/** 24×24 stroke icons drawn with react-native-svg (no icon font / asset dependency). */
const ICONS: Record<IconName, Draw> = {
  home: () => (
    <>
      <Path d="M3 10.5 12 3l9 7.5" />
      <Path d="M5.5 9v11a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9" />
    </>
  ),
  markets: () => (
    <>
      <Path d="M4 20h16" />
      <Path d="M7 16v-5" />
      <Path d="M12 16V6" />
      <Path d="M17 16v-8" />
    </>
  ),
  trade: () => (
    <>
      <Path d="M8 3v3M8 15v6" />
      <Rect x={5} y={6} width={6} height={9} rx={1} />
      <Path d="M16 4v5M16 17v3" />
      <Rect x={13} y={9} width={6} height={8} rx={1} />
    </>
  ),
  futures: () => (
    <>
      <Polyline points="3 17 9 11 13 15 21 7" />
      <Polyline points="15 7 21 7 21 13" />
    </>
  ),
  wallet: () => (
    <>
      <Rect x={3} y={6} width={18} height={14} rx={2.5} />
      <Path d="M6 6 16.5 3.2a1 1 0 0 1 1.25.97V6" />
      <Path d="M21 11h-4a2 2 0 0 0 0 4h4" />
    </>
  ),
  user: () => (
    <>
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  search: () => (
    <>
      <Circle cx={11} cy={11} r={7} />
      <Line x1={21} y1={21} x2={16.2} y2={16.2} />
    </>
  ),
  bell: () => (
    <>
      <Path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-3 8.5-3 8.5h18s-3-2-3-8.5" />
      <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  'chevron-right': () => <Polyline points="9 6 15 12 9 18" />,
  'chevron-left': () => <Polyline points="15 6 9 12 15 18" />,
  'chevron-down': () => <Polyline points="6 9 12 15 18 9" />,
  'chevron-up': () => <Polyline points="6 15 12 9 18 15" />,
  close: () => <Path d="M6 6l12 12M18 6 6 18" />,
  copy: () => (
    <>
      <Rect x={9} y={9} width={12} height={12} rx={2} />
      <Path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </>
  ),
  star: () => (
    <Polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7" />
  ),
  'star-filled': (c) => (
    <Polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7" fill={c} />
  ),
  eye: () => (
    <>
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
    </>
  ),
  'eye-off': () => (
    <>
      <Path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6C3.6 8.5 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <Line x1={3} y1={3} x2={21} y2={21} />
    </>
  ),
  check: () => <Polyline points="4.5 12.5 9.5 17.5 19.5 7" />,
  'check-circle': () => (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Polyline points="8 12.3 10.8 15 16 9.5" />
    </>
  ),
  alert: () => (
    <>
      <Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <Path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: () => (
    <>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 16v-4.5M12 8h.01" />
    </>
  ),
  deposit: () => (
    <>
      <Path d="M12 4v12" />
      <Polyline points="6.5 10.5 12 16 17.5 10.5" />
      <Path d="M5 20h14" />
    </>
  ),
  withdraw: () => (
    <>
      <Path d="M12 16V4" />
      <Polyline points="6.5 9.5 12 4 17.5 9.5" />
      <Path d="M5 20h14" />
    </>
  ),
  transfer: () => (
    <>
      <Polyline points="7 3.5 3 7.5 7 11.5" />
      <Path d="M3 7.5h14" />
      <Polyline points="17 12.5 21 16.5 17 20.5" />
      <Path d="M21 16.5H7" />
    </>
  ),
  shield: () => (
    <>
      <Path d="M12 2.5 19.5 5.5v6c0 4.7-3.2 8.8-7.5 10-4.3-1.2-7.5-5.3-7.5-10v-6L12 2.5z" />
      <Polyline points="9 12 11.2 14.2 15.5 9.8" />
    </>
  ),
  lock: () => (
    <>
      <Rect x={4.5} y={11} width={15} height={10} rx={2} />
      <Path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </>
  ),
  'face-id': () => (
    <>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1" />
      <Path d="M9 15.5s1 1.2 3 1.2 3-1.2 3-1.2" />
    </>
  ),
  fingerprint: () => (
    <>
      <Path d="M6.8 5.3A8 8 0 0 1 20 11.5c0 1.4-.1 2.8-.4 4.1" />
      <Path d="M4.3 9.2A8 8 0 0 0 4 11.5c0 2 .4 3.9 1.1 5.6" />
      <Path d="M8 11.5a4 4 0 0 1 8 0c0 3.3-.6 6.4-1.8 9.1" />
      <Path d="M12 11.5c0 3.6-.8 7-2.4 9.9" />
      <Path d="M8.1 14.5a15 15 0 0 1-.9 4.8" />
    </>
  ),
  sliders: () => (
    <>
      <Path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <Path d="M1.5 14h5M9.5 8h5M17.5 16h5" />
    </>
  ),
  logout: () => (
    <>
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1={21} y1={12} x2={9} y2={12} />
    </>
  ),
  history: () => (
    <>
      <Path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <Polyline points="3 3.5 3.5 8 8 7.5" />
      <Polyline points="12 7.5 12 12 15 14" />
    </>
  ),
  plus: () => <Path d="M12 5v14M5 12h14" />,
  minus: () => <Path d="M5 12h14" />,
  external: () => (
    <>
      <Path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" />
      <Polyline points="15 3 21 3 21 9" />
      <Line x1={10} y1={14} x2={21} y2={3} />
    </>
  ),
  trash: () => (
    <>
      <Path d="M3 6h18" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <Path d="M10 11v6M14 11v6" />
      <Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </>
  ),
  phone: () => (
    <>
      <Rect x={6.5} y={2} width={11} height={20} rx={2.5} />
      <Path d="M11 18h2" />
    </>
  ),
  moon: () => <Path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" />,
  sun: () => (
    <>
      <Circle cx={12} cy={12} r={4} />
      <Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  refresh: () => (
    <>
      <Path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <Polyline points="21 3.5 20.5 8 16 7.5" />
    </>
  ),
  key: () => (
    <>
      <Circle cx={7.5} cy={15.5} r={4.5} />
      <Path d="M10.7 12.3 20 3M16.5 6.5l3 3M14 9l2 2" />
    </>
  ),
  mail: () => (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Polyline points="3.5 6.5 12 13 20.5 6.5" />
    </>
  ),
  clipboard: () => (
    <>
      <Rect x={8} y={2.5} width={8} height={4} rx={1} />
      <Path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" />
    </>
  ),
  share: () => (
    <>
      <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <Polyline points="16 6 12 2 8 6" />
      <Line x1={12} y1={2} x2={12} y2={15} />
    </>
  ),
  'swap-vertical': () => (
    <>
      <Polyline points="7 20 7 4 3.5 7.5" />
      <Polyline points="17 4 17 20 20.5 16.5" />
    </>
  ),
  list: () => <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  zap: () => <Polygon points="13 2 4 14 12 14 11 22 20 10 12 10 13 2" />,
};

function IconImpl({ name, size = 22, color, strokeWidth = 1.8 }: IconProps) {
  const theme = useTheme();
  const c = color ?? theme.colors.text;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name](c)}
    </Svg>
  );
}

export const Icon = memo(IconImpl);
