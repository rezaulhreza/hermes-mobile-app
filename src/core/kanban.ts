/**
 * The Kanban board of the host: cards of work that the bots take, do and
 * hand back. The phone shows one column at a time and one card at a time, so
 * it keeps a short row for each card and reads the whole card when it opens.
 */

export interface Board {
  slug: string
  name: string
  description: string
  total: number
  /** The board the host works on now. */
  current: boolean
}

export function boardRows(result: unknown): Board[] {
  const boards = (result as { boards?: unknown } | null)?.boards

  return Array.isArray(boards)
    ? boards.flatMap((item: { slug?: unknown; name?: unknown; description?: unknown; total?: unknown; is_current?: unknown; archived?: unknown }) =>
        typeof item?.slug === 'string' && item.archived !== true
          ? [{ slug: item.slug, name: typeof item.name === 'string' && item.name ? item.name : item.slug, description: typeof item.description === 'string' ? item.description : '', total: typeof item.total === 'number' ? item.total : 0, current: item.is_current === true }]
          : []
      )
    : []
}

/** A card as a row of a column. The text of the card is not in it. */
export interface Card {
  id: string
  title: string
  /** The profile that has the card. Empty: nobody. */
  assignee: string
  priority: number
  /** What the worker said last, in a line. */
  summary: string
}

export interface Column {
  /** The key of the column on the host: `ready`, `running`, ... */
  key: string
  cards: Card[]
}

const COLUMN_NAMES: Readonly<Record<string, string>> = {
  triage: 'To sort',
  todo: 'To do',
  scheduled: 'Scheduled',
  ready: 'Ready',
  running: 'In work',
  blocked: 'Blocked',
  review: 'In review',
  done: 'Done'
}

/** The name of a column for a person. A column the app does not know shows its own name. */
export function columnName(key: string): string {
  return COLUMN_NAMES[key] ?? key.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The columns of a board with a short row a card. The highest priority is first in a column. */
export function boardColumns(result: unknown): Column[] {
  const columns = (result as { columns?: unknown } | null)?.columns

  return Array.isArray(columns)
    ? columns.flatMap((column: { name?: unknown; tasks?: unknown }) =>
        typeof column?.name === 'string'
          ? [
              {
                key: column.name,
                cards: (Array.isArray(column.tasks) ? column.tasks : [])
                  .flatMap((task: Record<string, unknown>): Card[] =>
                    typeof task?.id === 'string'
                      ? [{ id: task.id, title: text(task.title) || 'A card with no title', assignee: text(task.assignee), priority: typeof task.priority === 'number' ? task.priority : 0, summary: text(task.latest_summary).replace(/\s+/g, ' ').trim().slice(0, 160) }]
                      : []
                  )
                  .sort((a, b) => b.priority - a.priority)
              }
            ]
          : []
      )
    : []
}

/** The column to show when a board opens: where work waits for a person or runs, else the first with cards. */
export function firstColumn(columns: readonly Column[]): string {
  const order = ['blocked', 'review', 'running', 'ready', 'triage', 'todo']

  return order.find(key => columns.find(column => column.key === key)?.cards.length) ?? columns.find(column => column.cards.length)?.key ?? columns[0]?.key ?? ''
}

export interface CardComment {
  id: string
  author: string
  body: string
  /** Unix seconds. */
  at: number
}

export interface CardDetail {
  id: string
  title: string
  body: string
  status: string
  assignee: string
  /** Why the card is blocked, or the result of a card that is done. */
  note: string
  comments: CardComment[]
}

export function cardDetail(result: unknown): CardDetail | null {
  const { task, comments } = (result ?? {}) as { task?: Record<string, unknown>; comments?: unknown }

  if (!task || typeof task.id !== 'string') {
    return null
  }

  return {
    id: task.id,
    title: text(task.title),
    body: text(task.body),
    status: text(task.status),
    assignee: text(task.assignee),
    note: text(task.last_failure_error) || text(task.result) || text(task.latest_summary),
    comments: (Array.isArray(comments) ? comments : []).flatMap((item: Record<string, unknown>): CardComment[] =>
      typeof item?.body === 'string' && item.body.trim()
        ? [{ id: String(item.id ?? ''), author: text(item.author), body: item.body, at: typeof item.created_at === 'number' ? item.created_at : 0 }]
        : []
    )
  }
}

/** The columns a person can put a card in. Only the host puts a card in work, when a bot takes it. */
export function moveChoices(columns: readonly string[], current: string): string[] {
  return columns.filter(key => key !== 'running' || key === current)
}

/** What a move does, said under the name of the column. Empty: the name says it. */
export function moveDetail(key: string): string {
  return key === 'ready' ? 'The bot that has the card starts on it' : key === 'done' ? 'Asks what was done' : key === 'blocked' ? 'Asks what it waits for' : ''
}

export interface MoveQuestion {
  /** The field of the host that takes the answer. */
  field: 'summary' | 'block_reason'
  label: string
  placeholder: string
  /** The host refuses the move without an answer. */
  required: boolean
}

/** What the host wants to know before a card goes to this column. Null: nothing. */
export function moveQuestion(key: string): MoveQuestion | null {
  if (key === 'done') {
    return { field: 'summary', label: 'What was done', placeholder: 'A line for the record of the card', required: true }
  }

  return key === 'blocked' ? { field: 'block_reason', label: 'What it waits for', placeholder: 'A person, a key, another card', required: false } : null
}

/** The host's refusal of a change, in words for a person. Words the app does not know stay as they are. */
export function cardFault(words: string): string {
  if (/no result or summary evidence/i.test(words)) {
    return 'The host closes a card only with a line about what was done.'
  }

  if (/running.*directly|dispatcher\/claim/i.test(words)) {
    return 'Only a bot puts a card in work. Move it to Ready and the bot takes it.'
  }

  if (/not valid from current state/i.test(words)) {
    return 'The host does not allow this move from the column the card is in.'
  }

  const waits = /(?:blocked by|open parent)[^:]*:\s*(.+)$/i.exec(words)

  return waits ? `This card waits for another card: ${waits[1]}` : words
}
