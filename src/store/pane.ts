/** The chat that is open beside the list on a wide screen. A phone opens a chat as a screen of its own. */

import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { atom } from 'nanostores'
import { Dimensions, useWindowDimensions } from 'react-native'

import { isWide } from '@/core/layout'

export interface ChatTarget {
  /** The stored id of the conversation. */
  id: string
  title?: string
  /** The conversation was just made and is in the store already. */
  live?: boolean
  profile?: string
}

export const $pane = atom<ChatTarget | null>(null)
/** Development builds: the driver sets it to check the split on a phone. Null: the width decides. */
export const $wideOverride = atom<boolean | null>(null)

const wideNow = (width: number) => $wideOverride.get() ?? isWide(width)

/** Whether the window shows the list and the open chat side by side. */
export function useWide(): boolean {
  const { width } = useWindowDimensions()

  return useStore($wideOverride) ?? isWide(width)
}

/** Open a chat: beside the list on a wide screen, else as a screen. */
export function openChat(target: ChatTarget): void {
  if (wideNow(Dimensions.get('window').width)) {
    $pane.set(target)
  } else {
    router.push({ pathname: '/chat/[id]', params: { id: target.id, ...(target.title ? { title: target.title } : {}), ...(target.live ? { live: '1' } : {}), ...(target.profile ? { profile: target.profile } : {}) } })
  }
}

export function closePane(): void {
  $pane.set(null)
}
