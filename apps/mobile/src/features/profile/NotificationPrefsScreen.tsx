import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPrefs,
  UserSettingsDto,
} from '@gocrypto/shared-types';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from '@gocrypto/shared-types';
import { userSettingsSchema } from '@gocrypto/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { ErrorState, Screen, Skeleton, SwitchRow, type IconName } from '../../components';
import { useUserSettings } from '../../hooks/useAccount';
import { useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles } from '../../theme';
import { Section } from './ProfileScreen';

const CATEGORY: Record<NotificationCategory, { title: string; footer: string }> = {
  TRADING: { title: 'Trading', footer: 'Order fills, stop triggers, funding and liquidation warnings.' },
  WALLET: { title: 'Wallet', footer: 'Deposits, withdrawals and incoming transfers.' },
  SECURITY: { title: 'Security', footer: 'New sign-ins and security changes are always sent in-app and by e-mail.' },
  SYSTEM: { title: 'System', footer: 'Maintenance windows and product announcements.' },
};

const CHANNEL: Record<NotificationChannel, { title: string; icon: IconName }> = {
  IN_APP: { title: 'In-app', icon: 'bell' },
  EMAIL: { title: 'E-mail', icon: 'mail' },
  PUSH: { title: 'Push', icon: 'phone' },
};

/** Category × channel notification matrix (`PUT /users/me/settings`), saved optimistically. */
export function NotificationPrefsScreen() {
  const s = useStyles();
  const qc = useQueryClient();
  const settings = useUserSettings();
  const { refreshing, onRefresh } = useRefresh(() => settings.refetch());

  const save = useMutation({
    mutationFn: (prefs: NotificationPrefs) => api.users.updateSettings({ notificationPrefs: prefs }),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: qk.userSettings });
      const previous = qc.getQueryData<UserSettingsDto>(qk.userSettings);
      if (previous) qc.setQueryData<UserSettingsDto>(qk.userSettings, { ...previous, notificationPrefs: prefs });
      return { previous };
    },
    onError: (e, _prefs, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.userSettings, ctx.previous);
      toast.error('Could not save preference', errorMessage(e));
    },
    onSuccess: (res) => qc.setQueryData(qk.userSettings, res),
  });

  const toggle = (category: NotificationCategory, channel: NotificationChannel, value: boolean) => {
    const current = settings.data?.notificationPrefs;
    if (!current) return;
    const next: NotificationPrefs = { ...current, [category]: { ...current[category], [channel]: value } };
    if (!userSettingsSchema.safeParse({ notificationPrefs: next }).success) return;
    save.mutate(next);
  };

  if (settings.isPending) {
    return (
      <Screen contentStyle={s.content}>
        {NOTIFICATION_CATEGORIES.map((c) => (
          <Skeleton key={c} height={150} radius={14} style={s.skeleton} />
        ))}
      </Screen>
    );
  }
  if (settings.isError) {
    return (
      <Screen>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </Screen>
    );
  }

  const prefs = settings.data.notificationPrefs;
  return (
    <Screen contentStyle={s.content} refreshing={refreshing} onRefresh={onRefresh}>
      {NOTIFICATION_CATEGORIES.map((category) => (
        <View key={category}>
          <Section title={CATEGORY[category].title} footer={CATEGORY[category].footer}>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const locked = category === 'SECURITY' && channel !== 'PUSH';
              return (
                <SwitchRow
                  key={channel}
                  icon={CHANNEL[channel].icon}
                  title={CHANNEL[channel].title}
                  value={locked ? true : prefs[category][channel]}
                  disabled={locked}
                  onValueChange={(v) => toggle(category, channel, v)}
                />
              );
            })}
          </Section>
        </View>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  content: {
    paddingTop: 0,
  },
  skeleton: {
    marginTop: 22,
  },
}));
