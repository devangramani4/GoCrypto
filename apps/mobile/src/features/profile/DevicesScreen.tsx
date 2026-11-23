import type { DeviceDto, Platform as ApiPlatform, SessionDto } from '@gocrypto/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  Screen,
  SkeletonRows,
  Txt,
  type IconName,
} from '../../components';
import { useRefresh } from '../../hooks/useCommon';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { qk } from '../../lib/queryKeys';
import { toast } from '../../store/toast';
import { makeStyles, useTheme } from '../../theme';

const PLATFORM_LABEL: Record<ApiPlatform, string> = {
  WEB: 'Web',
  IOS: 'iOS',
  ANDROID: 'Android',
  DESKTOP: 'Desktop',
  API: 'API',
};

function platformIcon(p: ApiPlatform | null): IconName {
  return p === 'IOS' || p === 'ANDROID' ? 'phone' : p === 'API' ? 'key' : 'external';
}

/** Active sessions (revocable) and known devices. */
export function DevicesScreen() {
  const t = useTheme();
  const s = useStyles();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => api.auth.sessions() });
  const devices = useQuery({ queryKey: qk.devices, queryFn: () => api.auth.devices() });
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([sessions.refetch(), devices.refetch()]));

  const onDone = (title: string) => {
    haptics.success();
    toast.success(title);
    void qc.invalidateQueries({ queryKey: qk.sessions });
    void qc.invalidateQueries({ queryKey: qk.devices });
    void qc.invalidateQueries({ queryKey: qk.security });
  };
  const onFail = (e: unknown) => {
    haptics.error();
    toast.error('Action failed', errorMessage(e));
  };

  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => onDone('Session signed out'),
    onError: onFail,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.auth.revokeOtherSessions(),
    onSuccess: (r) => onDone(`${r.revoked} other session${r.revoked === 1 ? '' : 's'} signed out`),
    onError: onFail,
  });
  const removeDevice = useMutation({
    mutationFn: (id: string) => api.auth.removeDevice(id),
    onSuccess: () => onDone('Device removed'),
    onError: onFail,
  });

  const confirmRevoke = (sess: SessionDto) =>
    Alert.alert(
      'Sign out this session?',
      `${sess.deviceName ?? PLATFORM_LABEL[sess.platform]} will need to sign in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => revoke.mutate(sess.id) },
      ],
    );

  const confirmRevokeOthers = () =>
    Alert.alert('Sign out all other sessions?', 'Every device except this one will be signed out.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out others', style: 'destructive', onPress: () => revokeOthers.mutate() },
    ]);

  const confirmRemove = (d: DeviceDto) =>
    Alert.alert(
      'Remove device?',
      `${d.name ?? 'This device'} will be forgotten and treated as new at its next sign-in.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeDevice.mutate(d.id) },
      ],
    );

  const others = (sessions.data ?? []).filter((x) => !x.current).length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} contentStyle={s.content}>
      <Txt variant="micro" tone="faint" style={s.sectionTitle}>
        ACTIVE SESSIONS
      </Txt>
      <Card padded={false}>
        {sessions.isPending ? (
          <View style={s.pad}>
            <SkeletonRows count={3} />
          </View>
        ) : sessions.isError ? (
          <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : sessions.data.length === 0 ? (
          <EmptyState compact title="No active sessions" />
        ) : (
          sessions.data.map((sess, i) => (
            <View key={sess.id}>
              {i > 0 ? <Divider inset={62} /> : null}
              <View style={s.row}>
                <View style={s.icon}>
                  <Icon name={platformIcon(sess.platform)} size={18} color={t.colors.brand} />
                </View>
                <View style={s.flex}>
                  <View style={s.titleRow}>
                    <Txt variant="body" weight="semibold" numberOfLines={1} style={s.shrink}>
                      {sess.deviceName ?? PLATFORM_LABEL[sess.platform]}
                    </Txt>
                    {sess.current ? <Badge label="This device" tone="up" /> : null}
                  </View>
                  <Txt variant="caption" tone="muted" numberOfLines={1}>
                    {PLATFORM_LABEL[sess.platform]}
                    {sess.ip ? ` · ${sess.ip}` : ''} · active {fmtRelative(sess.lastUsedAt)}
                  </Txt>
                  <Txt variant="micro" tone="faint">
                    Signed in {fmtDateTime(sess.createdAt)}
                  </Txt>
                </View>
                {!sess.current ? (
                  <Button
                    title="Sign out"
                    size="sm"
                    variant="outline"
                    loading={revoke.isPending && revoke.variables === sess.id}
                    onPress={() => confirmRevoke(sess)}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
      </Card>
      {others > 0 ? (
        <Button
          title="Sign out all other sessions"
          variant="danger"
          onPress={confirmRevokeOthers}
          loading={revokeOthers.isPending}
          style={s.block}
        />
      ) : null}

      <Txt variant="micro" tone="faint" style={[s.sectionTitle, s.section]}>
        DEVICES
      </Txt>
      <Card padded={false}>
        {devices.isPending ? (
          <View style={s.pad}>
            <SkeletonRows count={3} />
          </View>
        ) : devices.isError ? (
          <ErrorState compact error={devices.error} onRetry={() => void devices.refetch()} />
        ) : devices.data.length === 0 ? (
          <EmptyState compact title="No devices" />
        ) : (
          devices.data.map((d, i) => (
            <View key={d.id}>
              {i > 0 ? <Divider inset={62} /> : null}
              <View style={s.row}>
                <View style={s.icon}>
                  <Icon name={platformIcon(d.platform)} size={18} color={t.colors.brand} />
                </View>
                <View style={s.flex}>
                  <View style={s.titleRow}>
                    <Txt variant="body" weight="semibold" numberOfLines={1} style={s.shrink}>
                      {d.name ?? PLATFORM_LABEL[d.platform]}
                    </Txt>
                    {d.current ? <Badge label="This device" tone="up" /> : null}
                  </View>
                  <View style={s.badges}>
                    <Badge label={PLATFORM_LABEL[d.platform]} />
                    {d.trusted ? <Badge label="Trusted" tone="brand" /> : null}
                    {d.pushEnabled ? <Badge label="Push" tone="info" /> : null}
                  </View>
                  <Txt variant="micro" tone="faint" style={s.lastSeen}>
                    Last seen {fmtRelative(d.lastSeenAt)}
                    {d.lastIp ? ` · ${d.lastIp}` : ''}
                  </Txt>
                </View>
                {!d.current ? (
                  <Button
                    title="Remove"
                    size="sm"
                    variant="outline"
                    loading={removeDevice.isPending && removeDevice.variables === d.id}
                    onPress={() => confirmRemove(d)}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    paddingTop: 16,
  },
  sectionTitle: {
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 0.6,
  },
  section: {
    marginTop: 24,
  },
  pad: {
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  shrink: {
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  lastSeen: {
    marginTop: 4,
  },
  block: {
    marginTop: 12,
  },
}));
