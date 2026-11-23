import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type AppTheme } from '../theme';
import { Txt } from './Txt';

export type BadgeTone = 'neutral' | 'brand' | 'up' | 'down' | 'warn' | 'info';

function colors(t: AppTheme, tone: BadgeTone): { bg: string; fg: string } {
  const c = t.colors;
  switch (tone) {
    case 'neutral':
      return { bg: c.raised, fg: c.textMuted };
    case 'brand':
      return { bg: c.brandSoft, fg: c.brand };
    case 'up':
      return { bg: c.upSoft, fg: c.up };
    case 'down':
      return { bg: c.downSoft, fg: c.down };
    case 'warn':
      return { bg: c.warnSoft, fg: c.warn };
    case 'info':
      return { bg: c.brandSoft, fg: c.info };
  }
}

export function Badge({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const c = colors(t, tone);
  return (
    <View
      style={[
        {
          backgroundColor: c.bg,
          borderRadius: t.radius.sm,
          paddingHorizontal: 6,
          paddingVertical: 2,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <Txt variant="micro" color={c.fg} weight="semibold" numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}
