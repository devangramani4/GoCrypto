import * as Haptics from 'expo-haptics';

const ignore = () => undefined;

/** Fire-and-forget haptics (unsupported hardware / simulators simply do nothing). */
export const haptics = {
  selection: () => void Haptics.selectionAsync().catch(ignore),
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore),
  medium: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(ignore),
  heavy: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(ignore),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore),
  error: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(ignore),
};
