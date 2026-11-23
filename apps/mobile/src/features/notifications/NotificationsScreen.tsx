import type { NotificationCategory, NotificationDto } from '@gocrypto/shared-types';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CursorPage } from '@gocrypto/shared-types';
import { useLayoutEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Divider, EmptyState, ErrorState, Icon, SkeletonRows, Txt, type IconName } from '../../components';
import { Screen } from '../../components/Screen';
import { useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fmtRelative } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { openNotificationTarget } from '../../navigation/navigationRef';
import type { RootScreenProps } from '../../navigation/types';
import { toast } from '../../store/toast';
import { makeStyles, useTheme, type AppTheme } from '../../theme';

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  TRADING: 'trade',
  WALLET: 'wallet',
  SECURITY: 'shield',
  SYSTEM: 'info',
};

function categoryColor(t: AppTheme, n: NotificationDto): string {
  if (n.type === 'LIQUIDATION' || n.type === 'WITHDRAWAL_REJECTED') return t.colors.down;
  if (n.type === 'LIQUIDATION_WARNING' || n.category === 'SECURITY') return t.colors.warn;
  if (n.category === 'WALLET') return t.colors.up;
  return t.colors.brand;
}

type Pages = InfiniteData<CursorPage<NotificationDto>, string | undefined>;

function Separator() {
  return <Divider inset={68} />;
}

export function NotificationsScreen({ navigation }: RootScreenProps<'Notifications'>) {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: qk.notificationList,
    queryFn: ({ pageParam }) => api.notifications.list({ cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const setRead = (id: string | 'all') =>
    qc.setQueryData<Pages>(qk.notificationList, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              items: p.items.map((n) => (id === 'all' || n.id === id ? { ...n, read: true } : n)),
            })),
          }
        : old,
    );

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onMutate: (id) => setRead(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.unreadCount }),
  });

  const { mutate: markAllRead, isPending: markingAll } = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      haptics.success();
      setRead('all');
      void qc.invalidateQueries({ queryKey: qk.unreadCount });
    },
    onError: (e) => toast.error('Could not update notifications', errorMessage(e)),
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const hasUnread = items.some((n) => !n.read);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        hasUnread ? (
          <Pressable accessibilityRole="button" onPress={() => markAllRead()} hitSlop={10} disabled={markingAll}>
            <Txt variant="label" tone="brand" weight="semibold">
              Mark all read
            </Txt>
          </Pressable>
        ) : null,
    });
  }, [navigation, hasUnread, markAllRead, markingAll]);

  const { refreshing, onRefresh } = useRefresh(() => list.refetch());

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        ItemSeparatorComponent={Separator}
        renderItem={({ item: n }) => {
          const color = categoryColor(t, n);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!n.read) markRead.mutate(n.id);
                openNotificationTarget({ ...(n.data ?? {}), type: n.type });
              }}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: t.colors.hover }]}
            >
              <View style={[s.icon, { backgroundColor: t.colors.raised }]}>
                <Icon name={CATEGORY_ICON[n.category]} size={18} color={color} />
              </View>
              <View style={s.body}>
                <View style={s.titleRow}>
                  <Txt variant="label" weight={n.read ? 'medium' : 'bold'} numberOfLines={1} style={s.title}>
                    {n.title}
                  </Txt>
                  <Txt variant="micro" tone="faint">
                    {fmtRelative(n.createdAt)}
                  </Txt>
                </View>
                <Txt variant="caption" tone="muted" numberOfLines={3}>
                  {n.body}
                </Txt>
              </View>
              {!n.read ? <View style={s.dot} /> : null}
            </Pressable>
          );
        }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListFooterComponent={
          list.isFetchingNextPage ? <ActivityIndicator color={t.colors.brand} style={s.footer} /> : undefined
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.textMuted}
            colors={[t.colors.brand]}
          />
        }
        ListEmptyComponent={
          list.isPending ? (
            <View style={s.pad}>
              <SkeletonRows count={8} />
            </View>
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState
              icon="bell"
              title="You're all caught up"
              message="Order fills, deposits and security alerts will show up here."
            />
          )
        }
        contentContainerStyle={s.list}
      />
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  list: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  title: {
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.brand,
    marginTop: 6,
  },
  footer: {
    marginVertical: 16,
  },
  pad: {
    paddingHorizontal: 16,
  },
}));
