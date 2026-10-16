/**
 * A message that Hermes wrote for the user to send: an email, a text, a
 * message in a named app. Hermes writes a draft as a quote, with the fields
 * it knows ("Subject:", "To:") on the first lines. The chat shows it as a
 * card that can be copied, changed and sent.
 */

import type { Span } from './markdown'

export type DraftChannel = 'email' | 'sms' | 'whatsapp' | 'telegram' | 'imessage' | 'signal' | 'slack' | 'discord' | 'message'

export interface Draft {
  channel: DraftChannel
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  /** The conversation the draft answers, when Hermes named it. */
  thread?: string
  body: string
}

export const CHANNEL_LABEL: Record<DraftChannel, string> = {
  email: 'Email',
  sms: 'Message',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  imessage: 'iMessage',
  signal: 'Signal',
  slack: 'Slack',
  discord: 'Discord',
  message: 'Message'
}

type Field = 'to' | 'cc' | 'bcc' | 'subject' | 'thread' | 'channel' | 'from'

const FIELD = /^(to|recipients?|cc|bcc|subject|from|thread|in reply to|reply to|channel|via)\s*:\s*(.*)$/i
const FIELD_NAME: Record<string, Field> = {
  to: 'to',
  recipient: 'to',
  recipients: 'to',
  cc: 'cc',
  bcc: 'bcc',
  subject: 'subject',
  from: 'from',
  thread: 'thread',
  'in reply to': 'thread',
  'reply to': 'thread',
  channel: 'channel',
  via: 'channel'
}

// The first name that matches wins: "text message" before "message".
const CHANNEL_WORDS: readonly (readonly [RegExp, DraftChannel])[] = [
  [/\bwhats\s?app\b/i, 'whatsapp'],
  [/\btelegram\b/i, 'telegram'],
  [/\bimessage\b/i, 'imessage'],
  [/\bsignal\b/i, 'signal'],
  [/\bslack\b/i, 'slack'],
  [/\bdiscord\b/i, 'discord'],
  [/\b(sms|text message|a text)\b/i, 'sms'],
  [/\b(e-?mail|mail|inbox|thread)\b/i, 'email']
]

/** The words before the quote say that Hermes wrote it, and did not quote what another person wrote. */
const SAYS_DRAFT = /\bdraft|\b(here'?s|here is) (the|a|an|your|my) [\w\s]{0,24}(e-?mail|message|text|sms|reply|note)\b/i

function channelOf(words: string): DraftChannel | null {
  return CHANNEL_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? null
}

function lineText(spans: readonly Span[]): string {
  return spans
    .map(span => span.text)
    .join('')
    .trim()
}

/**
 * The draft in a quote, or null when the quote is not one. `lead` is the text
 * of the paragraph before the quote. A quote is a draft when it starts with
 * a field (a subject, a recipient), or when the lead says it is one.
 */
export function draftFrom(lead: string, lines: readonly (readonly Span[])[]): Draft | null {
  const fields: Partial<Record<Field, string>> = {}
  let at = 0

  // The fields come first, one to a line. The first line that is no field starts the body.
  for (; at < lines.length; at++) {
    const words = lineText(lines[at])
    const field = FIELD.exec(words)

    if (!words && Object.keys(fields).length) {
      continue
    }

    if (!field) {
      break
    }

    fields[FIELD_NAME[field[1].toLowerCase()]] = field[2].trim()
  }

  const body = lines
    .slice(at)
    .map(lineText)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!body || !(fields.subject || fields.to || SAYS_DRAFT.test(lead))) {
    return null
  }

  const channel = channelOf(fields.channel ?? '') ?? (fields.subject || fields.cc || fields.bcc ? 'email' : (channelOf(lead) ?? 'message'))

  return {
    channel,
    body,
    ...(fields.to ? { to: fields.to } : {}),
    ...(fields.cc ? { cc: fields.cc } : {}),
    ...(fields.bcc ? { bcc: fields.bcc } : {}),
    ...(fields.subject ? { subject: fields.subject } : {}),
    ...(fields.thread ? { thread: fields.thread } : {})
  }
}

export interface SendWay {
  /** The app that opens: "Mail". */
  label: string
  url: string
}

/** The addresses in a list of recipients. A name with no address is left out: the app that opens cannot use it. */
function addresses(list: string | undefined): string {
  return (list?.match(/[^\s<>,;()]+@[^\s<>,;()]+/g) ?? []).join(',')
}

function phone(list: string | undefined): string {
  return /\+?\d[\d\s().-]{6,}\d/.exec(list ?? '')?.[0].replace(/[^\d+]/g, '') ?? ''
}

/**
 * The apps of the phone that can take a draft, with the draft filled in. A
 * draft that answers a thread loses the thread in another app: Hermes sends
 * that one itself.
 */
export function sendWays(draft: Draft): SendWay[] {
  const body = encodeURIComponent(draft.body)
  const subject = encodeURIComponent(draft.subject ?? '')

  switch (draft.channel) {
    case 'email': {
      const extra = [draft.cc && `cc=${encodeURIComponent(addresses(draft.cc))}`, draft.bcc && `bcc=${encodeURIComponent(addresses(draft.bcc))}`].filter(Boolean).join('&')

      return [
        { label: 'Mail', url: `mailto:${encodeURIComponent(addresses(draft.to))}?subject=${subject}&body=${body}${extra ? `&${extra}` : ''}` },
        { label: 'Gmail', url: `googlegmail://co?to=${encodeURIComponent(addresses(draft.to))}&subject=${subject}&body=${body}${extra ? `&${extra}` : ''}` }
      ]
    }

    case 'sms':
    case 'imessage':
    case 'message':
      return [{ label: 'Messages', url: `sms:${phone(draft.to)}&body=${body}` }]

    case 'whatsapp':
      return [{ label: 'WhatsApp', url: `https://wa.me/${phone(draft.to).replace('+', '')}?text=${body}` }]

    case 'telegram':
      return [{ label: 'Telegram', url: `tg://msg?text=${body}` }]

    default:
      return []
  }
}

/** What the user says to Hermes to send a draft: the draft as it is, or with the changes made on the phone. */
export function sendRequest(draft: Draft, changed: Draft | null): string {
  if (!changed) {
    return 'Send it.'
  }

  const subject = changed.subject && changed.subject !== draft.subject ? `Subject: ${changed.subject}\n\n` : ''

  return `Send it with my changes. Use this text and change nothing else.\n\n${subject}${changed.body}`
}
