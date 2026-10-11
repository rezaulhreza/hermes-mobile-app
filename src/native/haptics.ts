/**
 * A short tap of the phone under the finger, for an action that has no other
 * sign at once: a message sent, a text copied, a long press taken. A phone
 * with no haptics, or a fault of the module, changes nothing.
 */

import * as Haptics from 'expo-haptics'

export function tap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

/** A stronger sign, for a stop or a refusal. */
export function thud(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined)
}
