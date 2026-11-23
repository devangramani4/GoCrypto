import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import { Txt } from './Txt';

/** Brand mark: indigo tile with a rising chart line. */
export function LogoMark({ size = 56 }: { size?: number }) {
  const t = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="gc-logo" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={t.colors.brandHover} />
          <Stop offset="1" stopColor={t.colors.brand} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={64} height={64} rx={18} fill="url(#gc-logo)" />
      <Polyline
        points="14 42 26 30 34 37 50 21"
        fill="none"
        stroke={t.colors.onBrand}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="41 21 50 21 50 30"
        fill="none"
        stroke={t.colors.onBrand}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Logo({ size = 56, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <LogoMark size={size} />
      {showName ? (
        <Txt variant="heading" weight="bold" style={{ marginTop: 12, letterSpacing: -0.3 }}>
          GoCrypto
        </Txt>
      ) : null}
    </View>
  );
}
