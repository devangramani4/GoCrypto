import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Icon, type IconName } from '../components';
import { FuturesScreen } from '../features/futures/FuturesScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { MarketsScreen } from '../features/markets/MarketsScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { TradeScreen } from '../features/trade/TradeScreen';
import { WalletScreen } from '../features/wallet/WalletScreen';
import { useUnreadCount } from '../hooks/useCommon';
import { useTheme } from '../theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const TAB_ICONS: Record<keyof TabParamList, IconName> = {
  Home: 'home',
  Markets: 'markets',
  Trade: 'trade',
  Futures: 'futures',
  Wallet: 'wallet',
  Profile: 'user',
};

/** Bottom tabs: Home · Markets · Trade · Futures · Wallet · Profile. */
export function AppTabs() {
  const t = useTheme();
  const unread = useUnreadCount();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        lazy: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: t.colors.brand,
        tabBarInactiveTintColor: t.colors.textFaint,
        tabBarStyle: {
          backgroundColor: t.colors.surface,
          borderTopColor: t.colors.border,
          borderTopWidth: t.hairline,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color, size }) => <Icon name={TAB_ICONS[route.name]} size={size - 2} color={color} />,
        sceneStyle: { backgroundColor: t.colors.bg },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarBadge: unread.data ? (unread.data > 99 ? '99+' : unread.data) : undefined,
          tabBarBadgeStyle: { backgroundColor: t.colors.down, fontSize: 10 },
        }}
      />
      <Tab.Screen name="Markets" component={MarketsScreen} />
      <Tab.Screen name="Trade" component={TradeScreen} />
      <Tab.Screen name="Futures" component={FuturesScreen} />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
