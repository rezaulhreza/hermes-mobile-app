/**
 * What the app asks the host for when the link opens, so the first tap on a
 * screen finds its list there. The first answer of a host for a kind of
 * request can take seconds; a repeat takes a tenth of a second.
 *
 * One request at a time, the chat list first: requests at the same time make
 * each other slow on the host, and the user is looking at the chat list.
 */

import { loadBots } from './bots'
import { loadSchedules } from './cron'
import { $linkState } from './link'
import { loadKeys, loadProviders } from './providers'
import { refreshSessions } from './sessions'
import { loadVault } from './vault'
import { loadEngines } from './voice'

const STEPS: (() => Promise<unknown>)[] = [refreshSessions, loadBots, loadProviders, loadSchedules, loadVault, loadKeys, loadEngines]

let running = false

export async function preloadLists(): Promise<void> {
  if (running) {
    return
  }

  running = true

  try {
    for (const step of STEPS) {
      if ($linkState.get() !== 'open') {
        return
      }

      // A list that fails here loads again when its screen opens, and says the fault there.
      await step().catch(() => undefined)
    }
  } finally {
    running = false
  }
}
