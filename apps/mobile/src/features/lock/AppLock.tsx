import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Txt } from '../../components';
import { Logo } from '../../components/Logo';
import { authenticate, getBiometricSupport, type BiometricSupport } from '../../lib/biometrics';
import { maskEmail } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { useLock } from '../../store/lock';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { makeStyles, useTheme } from '../../theme';

/**
 * Biometric app lock.
 *  - Launch: the session bootstrap locks the app when a stored session is restored.
 *  - Foreground: returning from the background re-locks.
 *  - App switcher: an opaque cover hides balances while the app is inactive/backgrounded.
 */
export function AppLockGate() {
  const enabled = useSettings((s) => s.biometricLock);
  const signedIn = useSession((s) => s.status === 'signedIn');
  const locked = useLock((s) => s.locked);
  const covered = useLock((s) => s.covered);

  useEffect(() => {
    let wentToBackground = false;
    const sub = AppState.addEventListener('change', (state) => {
      const lock = useLock.getState();
      const protectedSession = useSettings.getState().biometricLock && useSession.getState().status === 'signedIn';
      if (!protectedSession) {
        wentToBackground = false;
        if (lock.covered) lock.setCovered(false);
        return;
      }
      if (state === 'active') {
        if (wentToBackground) lock.lock();
        wentToBackground = false;
        lock.setCovered(false);
      } else if (state === 'background') {
        wentToBackground = true;
        lock.setCovered(true);
      } else if (state === 'inactive' && !lock.authenticating) {
        // App switcher / control centre — but not our own Face ID prompt.
        lock.setCovered(true);
      }
    });
    return () => sub.remove();
  }, []);

  if (!enabled || !signedIn) return null;
  if (locked) return <LockScreen />;
  if (covered) return <PrivacyCover />;
  return null;
}

function PrivacyCover() {
  const s = useStyles();
  return (
    <View style={s.overlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Logo />
    </View>
  );
}

function LockScreen() {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const user = useSession((st) => st.user);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const unlock = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await authenticate('Unlock GoCrypto');
      if (res.success) {
        haptics.success();
        useLock.getState().unlock();
      } else if (!res.cancelled) {
        haptics.error();
        setError(res.message);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void getBiometricSupport().then(setSupport);
  }, []);

  // Prompt right away, and again whenever the user comes back from the background while locked
  // (not after dismissing the prompt itself, which only toggles active/inactive).
  useEffect(() => {
    let fromBackground = false;
    const first = setTimeout(() => {
      if (AppState.currentState === 'active') void unlock();
    }, 350);
    let again: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') fromBackground = true;
      if (state === 'active' && fromBackground) {
        fromBackground = false;
        again = setTimeout(() => void unlock(), 350);
      }
    });
    return () => {
      clearTimeout(first);
      if (again) clearTimeout(again);
      sub.remove();
    };
  }, [unlock]);

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need your password (and 2FA code) to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void useSession.getState().signOut() },
    ]);
  };

  const icon = support?.kind === 'face' ? 'face-id' : support?.kind === 'fingerprint' ? 'fingerprint' : 'lock';

  return (
    <View
      style={[s.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      accessibilityViewIsModal
    >
      <View style={s.center}>
        <Logo />
        <Txt variant="subtitle" style={s.title}>
          GoCrypto is locked
        </Txt>
        {user?.email ? (
          <Txt variant="caption" tone="muted">
            {maskEmail(user.email)}
          </Txt>
        ) : null}
        <View style={s.iconCircle}>
          {busy ? <ActivityIndicator color={t.colors.brand} /> : <Icon name={icon} size={34} color={t.colors.brand} />}
        </View>
        {error ? (
          <Txt variant="caption" tone="down" align="center" style={s.error}>
            {error}
          </Txt>
        ) : null}
      </View>
      <View style={s.actions}>
        <Button
          title={support ? `Unlock with ${support.label}` : 'Unlock'}
          icon={icon}
          onPress={() => void unlock()}
          loading={busy}
        />
        <Button title="Sign out" variant="ghost" onPress={confirmSignOut} style={s.signOut} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    zIndex: 1000,
    elevation: 1000,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 28,
    marginBottom: 4,
  },
  iconCircle: {
    marginTop: 36,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    marginTop: 18,
    maxWidth: 300,
  },
  actions: {
    alignSelf: 'stretch',
  },
  signOut: {
    marginTop: 8,
  },
}));
