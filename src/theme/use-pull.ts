import { useCallback, useState } from 'react'

/**
 * The state of a pull-to-refresh. The spinner turns only for a pull of the
 * user, never for a refresh the app starts by itself.
 *
 * A list that gave its own "loading" flag to the control showed the spinner
 * for every refresh behind the screen (an event of the host starts one). On
 * iOS the control then left the list pushed down under a spinner that never
 * went away.
 */
export function usePull(refresh: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void refresh()
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }, [refresh])

  return { refreshing, onRefresh }
}
