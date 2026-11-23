import { HapticFeedbackTypes, trigger, type HapticOptions } from 'react-native-haptic-feedback';

/** Respect the user's system haptics setting; no vibration fallback on devices without a haptic engine. */
const OPTIONS: HapticOptions = { enableVibrateFallback: false, ignoreAndroidSystemSettings: false };

function fire(type: HapticFeedbackTypes): void {
  try {
    trigger(type, OPTIONS);
  } catch {
    // Unsupported hardware / simulators simply do nothing.
  }
}

/** Fire-and-forget haptics. */
export const haptics = {
  selection: () => fire(HapticFeedbackTypes.selection),
  light: () => fire(HapticFeedbackTypes.impactLight),
  medium: () => fire(HapticFeedbackTypes.impactMedium),
  heavy: () => fire(HapticFeedbackTypes.impactHeavy),
  success: () => fire(HapticFeedbackTypes.notificationSuccess),
  warning: () => fire(HapticFeedbackTypes.notificationWarning),
  error: () => fire(HapticFeedbackTypes.notificationError),
};
