import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Badge, IconButton, Screen, Txt } from '../../components';
import { Logo } from '../../components/Logo';
import { config } from '../../config';
import { makeStyles } from '../../theme';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  showLogo?: boolean;
}

/** Shared chrome for the signed-out flow (no native header; custom back button). */
export function AuthLayout({ title, subtitle, children, onBack, showLogo = false }: AuthLayoutProps) {
  const s = useStyles();
  return (
    <Screen topInset bottomInset contentStyle={s.content}>
      {onBack ? <IconButton icon="chevron-left" onPress={onBack} accessibilityLabel="Back" style={s.back} /> : null}
      {showLogo ? (
        <View style={s.logo}>
          <Logo size={64} />
          {config.sandbox ? <Badge label="SANDBOX · PAPER TRADING" tone="warn" style={s.badge} /> : null}
        </View>
      ) : null}
      <Txt variant="title" style={s.title}>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="body" tone="muted" style={s.subtitle}>
          {subtitle}
        </Txt>
      ) : null}
      {children}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  back: {
    marginLeft: -10,
    marginBottom: 8,
  },
  logo: {
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 28,
  },
  badge: {
    alignSelf: 'center',
    marginTop: 10,
  },
  title: {
    marginBottom: 6,
  },
  subtitle: {
    marginBottom: 24,
  },
}));
