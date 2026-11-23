import { logo } from '@gocrypto/ui/brand';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Txt } from './Txt';

const glyphStroke = {
  fill: 'none',
  strokeWidth: logo.glyph.width,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Brand mark: blue shield with a white "G". Same geometry as the web logo and the app icons. */
export function LogoMark({ size = 56 }: { size?: number }) {
  const { shield, glyph } = logo;
  const gradient = shield.gradient;
  return (
    <Svg width={size} height={size} viewBox={logo.markViewBox}>
      <Defs>
        <LinearGradient
          id="gc-shield"
          gradientUnits="userSpaceOnUse"
          x1={gradient.x1}
          y1={gradient.y1}
          x2={gradient.x2}
          y2={gradient.y2}
        >
          {gradient.stops.map(([offset, color]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Path d={shield.path} fill="url(#gc-shield)" />
      <Path d={shield.shade.path} fill={shield.shade.color} fillOpacity={shield.shade.opacity} />
      <Path
        d={shield.highlight.path}
        fill="none"
        stroke={shield.highlight.color}
        strokeOpacity={shield.highlight.opacity}
        strokeWidth={shield.highlight.width}
        strokeLinecap="round"
      />
      <Path
        d={glyph.path}
        {...glyphStroke}
        stroke={glyph.shadow.color}
        strokeOpacity={glyph.shadow.opacity}
        transform={`translate(${glyph.shadow.dx} ${glyph.shadow.dy})`}
      />
      <Path d={glyph.path} {...glyphStroke} stroke={glyph.color} />
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
