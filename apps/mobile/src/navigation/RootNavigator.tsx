import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ForgotPasswordScreen } from '../features/auth/ForgotPasswordScreen';
import { LoginScreen } from '../features/auth/LoginScreen';
import { RegisterScreen } from '../features/auth/RegisterScreen';
import { TwoFactorScreen } from '../features/auth/TwoFactorScreen';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { DevicesScreen } from '../features/profile/DevicesScreen';
import { NotificationPrefsScreen } from '../features/profile/NotificationPrefsScreen';
import { SetPinScreen } from '../features/profile/SetPinScreen';
import { TwoFactorSetupScreen } from '../features/profile/TwoFactorSetupScreen';
import { DepositScreen } from '../features/wallet/DepositScreen';
import { TransferScreen } from '../features/wallet/TransferScreen';
import { WalletHistoryScreen } from '../features/wallet/WalletHistoryScreen';
import { WithdrawScreen } from '../features/wallet/WithdrawScreen';
import { useSession } from '../store/session';
import { useTheme } from '../theme';
import { AppTabs } from './AppTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Auth flow vs. app: screens are registered conditionally on the session status, so signing in or
 * out swaps the whole stack (no way back to the login screen with the back gesture, and vice versa).
 */
export function RootNavigator() {
  const t = useTheme();
  const status = useSession((s) => s.status);
  const signedIn = status === 'signedIn';

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.bg },
        headerTintColor: t.colors.text,
        headerTitleStyle: { fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.colors.bg },
      }}
    >
      {signedIn ? (
        <Stack.Group>
          <Stack.Screen name="Tabs" component={AppTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
          <Stack.Screen name="Deposit" component={DepositScreen} options={{ title: 'Deposit' }} />
          <Stack.Screen name="Withdraw" component={WithdrawScreen} options={{ title: 'Withdraw' }} />
          <Stack.Screen name="Transfer" component={TransferScreen} options={{ title: 'Transfer' }} />
          <Stack.Screen name="WalletHistory" component={WalletHistoryScreen} options={{ title: 'History' }} />
          <Stack.Screen name="SetPin" component={SetPinScreen} options={{ title: 'Trading PIN' }} />
          <Stack.Screen
            name="TwoFactorSetup"
            component={TwoFactorSetupScreen}
            options={{ title: 'Two-factor authentication' }}
          />
          <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Devices & sessions' }} />
          <Stack.Screen
            name="NotificationPrefs"
            component={NotificationPrefsScreen}
            options={{ title: 'Notifications' }}
          />
        </Stack.Group>
      ) : (
        <Stack.Group screenOptions={{ headerShown: false, animationTypeForReplace: 'pop' }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="TwoFactor" component={TwoFactorScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
