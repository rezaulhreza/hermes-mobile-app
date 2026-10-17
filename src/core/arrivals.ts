/**
 * What comes into a chat and is not from the user. The host gives the agent
 * the message of another bot, the output of a schedule and the end of a
 * background task as a message with the role of the user, because the agent
 * must answer it. On screen it is not the user who said it, so the chat draws
 * each one as what it is.
 *
 * The forms are the forms of the host: `tools/bot_mode_dm.py` (a bot),
 * `cron/scheduler_delivery.py` (a schedule) and
 * `tools/process_registry_notifications.py` (a background task).
 */

export type Arrival =
  /** Another bot wrote to the bot of this chat. */
  | { kind: 'bot'; /** What the host calls the sender after "@". */ handle: string; /** The name the sender gave itself. */ name: string; text: string }
  /** A schedule ran and gave its output to the bot. */
  | { kind: 'schedule'; name: string; text: string }
  /** Something the host did in the background ended, or said how far it is. `detail` is the raw record, for a person who asks for it. */
  | { kind: 'event'; title: string; tone: 'done' | 'failed' | 'info'; detail: string }

const FROM_BOT = /^Message from 🤖 (.+?) \(@([A-Za-z0-9_.-]+)\): ([\s\S]*)$/
const SCHEDULE = /^\[Cronjob "([\s\S]+?)" output — scheduled job, not the user\.[^\]]*\]\s*([\s\S]*)$/
const PROCESS_END = /^\[IMPORTANT: Background process \S+ (.+?) \(exit code (-?\d+|\?)[^)]*\)\.\n([\s\S]*?)\]?$/
const PROCESS_COUNT = /^\[IMPORTANT: (\d+) background processes completed\./
const PROCESS_WATCH = /^\[IMPORTANT: Background process \S+ matched watch pattern "([\s\S]*?)"\.\n([\s\S]*?)\]?$/
const PROCESS_BEAT = /^\[Background process \S+ heartbeat #\d+ — still running after ([^(]+?) \(/
const SUBAGENT = /^(?:\[ASYNC (?:DELEGATION )?(?:BATCH )?COMPLETE\b|A background (?:fan-out of \d+ subagent\(s\)|subagent) you dispatched earlier has finished\.)/
/** The task that carries a message of this bot to another bot: its end says if the message arrived. */
const DELIVERY = /bot_mode_dm\.py --run-delivery[\s\S]*? -p (\S+) chat /

/**
 * What a stored message of the "user" is, when the user did not write it.
 * Null for the words of the user. `title` is the short line the host wrote
 * for a screen (`display_metadata.display_text`), when it gave one.
 */
export function arrivalOf(stored: string, title?: string | null): Arrival | null {
  const text = stored.trim()
  const fromBot = FROM_BOT.exec(text)

  if (fromBot) {
    return { kind: 'bot', name: fromBot[1].trim(), handle: fromBot[2], text: fromBot[3].trim() }
  }

  const schedule = SCHEDULE.exec(text)

  if (schedule) {
    return { kind: 'schedule', name: schedule[1].trim(), text: schedule[2].trim() }
  }

  const ended = PROCESS_END.exec(text)

  if (ended) {
    const ok = ended[2] === '0'
    const to = DELIVERY.exec(ended[3])?.[1]

    return {
      kind: 'event',
      // The command is a line of the host's machine. A person reads who the message was for.
      title: to ? (ok ? `Message delivered to @${to}` : `Message to @${to} was not delivered`) : title?.trim() || (ok ? 'Background task finished' : `Background task ${ended[1]}`),
      tone: ok ? 'done' : 'failed',
      detail: ended[3].trim()
    }
  }

  const watch = PROCESS_WATCH.exec(text)

  if (watch) {
    return { kind: 'event', title: `Background task wrote "${watch[1]}"`, tone: 'info', detail: watch[2].trim() }
  }

  const beat = PROCESS_BEAT.exec(text)

  if (beat) {
    return { kind: 'event', title: `Background task still runs after ${beat[1].trim()}`, tone: 'info', detail: text.replace(/^\[|\]$/g, '') }
  }

  const count = PROCESS_COUNT.exec(text)

  if (count) {
    return { kind: 'event', title: title?.trim() || `${count[1]} background tasks finished`, tone: 'done', detail: text.replace(/^\[|\]$/g, '') }
  }

  if (SUBAGENT.test(text)) {
    return { kind: 'event', title: title?.trim() || 'A helper finished its task', tone: 'done', detail: text }
  }

  return null
}

/** One line for a list: what arrived, in the words of the row. */
export function arrivalLine(arrival: Arrival): string {
  return arrival.kind === 'bot' ? `${arrival.name}: ${arrival.text}` : arrival.kind === 'schedule' ? `Schedule ${arrival.name}: ${arrival.text}` : arrival.title
}
