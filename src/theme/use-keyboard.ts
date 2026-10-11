import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/** Is the keyboard on screen? A bar above it then needs no room for the tab bar. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // iOS says "will", so the layout moves with the keyboard. Android only says "did".
    const [show, hide] = Platform.OS === 'ios' ? (['keyboardWillShow', 'keyboardWillHide'] as const) : (['keyboardDidShow', 'keyboardDidHide'] as const)
    const subscriptions = [Keyboard.addListener(show, () => setOpen(true)), Keyboard.addListener(hide, () => setOpen(false))]

    return () => subscriptions.forEach(subscription => subscription.remove())
  }, [])

  return open
}
