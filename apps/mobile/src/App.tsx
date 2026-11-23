import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { ToastHost } from './components';
import { Logo } from './components/Logo';
import { AppLockGate } from './features/lock/AppLock';
import { SignedInEffects, useRealtimeLifecycle } from './hooks/useSessionEffects';
import { queryClient } from './lib/queryClient';
import { linking } from './navigation/linking';
import { markNavigationReady, navigationRef } from './navigation/navigationRef';
import { RootNavigator } from './navigation/RootNavigator';
import { useSession } from './store/session';
import { useSettingsHydrated } from './store/settings';
import { ThemeProvider, makeStyles, useTheme } from './theme';

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const t = useTheme();
  const s = useStyles();
  const hydrated = useSettingsHydrated();
  const status = useSession((st) => st.status);
  useRealtimeLifecycle();

  useEffect(() => {
    void useSession.getState().bootstrap();
  }, []);

  const ready = hydrated && status !== 'booting';

  return (
    <View style={s.root}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {ready ? (
        <NavigationContainer ref={navigationRef} theme={t.navigation} linking={linking} onReady={markNavigationReady}>
          <RootNavigator />
          {status === 'signedIn' ? <SignedInEffects /> : null}
        </NavigationContainer>
      ) : (
        <BootScreen />
      )}
      <AppLockGate />
      <ToastHost />
    </View>
  );
}

function BootScreen() {
  const t = useTheme();
  const s = useStyles();
  return (
    <View style={s.boot}>
      <Logo />
      <ActivityIndicator color={t.colors.brand} style={s.spinner} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    backgroundColor: t.colors.bg,
  },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg,
  },
  spinner: {
    marginTop: 28,
  },
}));
