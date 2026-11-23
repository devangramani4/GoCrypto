import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles } from '../theme';
import { Txt } from './Txt';

interface CardProps {
  children: ReactNode;
  padded?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Slightly raised surface (used for nested cards / sheets). */
  raised?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, padded = true, onPress, style, raised = false, accessibilityLabel }: CardProps) {
  const s = useStyles();
  const base = [s.card, raised && s.raised, padded && s.padded, style];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && s.pressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Section title row with an optional trailing action ("See all"). */
export function SectionHeader({ title, action, onAction, right, style }: SectionHeaderProps) {
  const s = useStyles();
  return (
    <View style={[s.sectionHeader, style]}>
      <Txt variant="subtitle">{title}</Txt>
      {right}
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          <Txt variant="label" tone="brand">
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider({ inset = 0, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.divider, { marginLeft: inset }, style]} />;
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.xl,
    borderWidth: t.hairline,
    borderColor: t.colors.border,
    overflow: 'hidden',
  },
  raised: {
    backgroundColor: t.colors.raised,
  },
  padded: {
    padding: 16,
  },
  pressed: {
    opacity: 0.85,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  divider: {
    height: t.hairline,
    backgroundColor: t.colors.border,
  },
}));
