export function greeting(now: Date): string {
  const hour = now.getHours()

  if (hour < 5) {
    return 'Good night'
  }

  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** A short age for a list row: "now", "12m", "3h", "5d", then a date. `at` is Unix seconds. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - at))

  if (seconds < 60) {
    return 'now'
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h`
  }

  if (seconds < 7 * 86_400) {
    return `${Math.floor(seconds / 86_400)}d`
  }

  return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "0.4s", "12s", "2m 5s" for a tool row. */
export function duration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
