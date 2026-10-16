/**
 * A thing in an answer that the user acts on with the phone: a call to make,
 * an event, a place, a reminder, a payment, a contact, a booking, a service
 * to connect. Hermes writes it as a
 * quote. The first line names the kind and the title ("Call: Alex Morgan
 * (+44 …)"), the next lines are fields ("When: Friday 3 pm"), and the rest
 * is notes. The chat shows it as a card with the buttons that fit its kind.
 */

import type { Span } from './markdown'

export type InfoKind = 'call' | 'event' | 'place' | 'reminder' | 'payment' | 'contact' | 'booking' | 'connect'

export interface InfoRow {
  label: string
  value: string
  /** The web address of a field that is a link. */
  url?: string
}

export interface InfoCard {
  kind: InfoKind
  /** The name of the kind as the answer wrote it: "Flight" for a booking. */
  label: string
  title: string
  rows: InfoRow[]
  notes: string
}

const KIND_WORDS: Record<string, InfoKind> = {
  call: 'call',
  phone: 'call',
  event: 'event',
  meeting: 'event',
  appointment: 'event',
  place: 'place',
  address: 'place',
  reminder: 'reminder',
  task: 'reminder',
  payment: 'payment',
  transfer: 'payment',
  'bank details': 'payment',
  contact: 'contact',
  booking: 'booking',
  flight: 'booking',
  train: 'booking',
  hotel: 'booking',
  trip: 'booking',
  order: 'booking',
  delivery: 'booking',
  parcel: 'booking',
  connect: 'connect',
  connection: 'connect',
  'set up': 'connect'
}

const ROW = /^([A-Z][A-Za-z ]{0,23}?)\s*:\s+(\S.*)$/
const PHONE = /\+?\d[\d\s().-]{6,}\d/
const EMAIL = /[^\s<>,;()]+@[^\s<>,;()]+\.[a-z]{2,}/i

function lineText(spans: readonly Span[]): string {
  return spans
    .map(span => span.text)
    .join('')
    .trim()
}

/**
 * The card in a quote, or null when the quote is not one. A quote is a card
 * when its first line is the name of a kind and a title. A call needs a
 * telephone number: without one there is nothing to dial.
 */
export function infoCardFrom(lines: readonly (readonly Span[])[]): InfoCard | null {
  const first = ROW.exec(lineText(lines[0] ?? []))
  const kind = first ? KIND_WORDS[first[1].toLowerCase()] : undefined

  if (!first || !kind) {
    return null
  }

  const rows: InfoRow[] = []
  let at = 1

  for (; at < lines.length; at++) {
    const row = ROW.exec(lineText(lines[at]))

    if (!row) {
      break
    }

    const url = urlOf(lines[at])

    rows.push({ label: row[1], value: row[2].trim(), ...(url ? { url } : {}) })
  }

  const card: InfoCard = {
    kind,
    label: first[1].charAt(0).toUpperCase() + first[1].slice(1).toLowerCase(),
    title: first[2].trim(),
    rows,
    notes: lines
      .slice(at)
      .map(lineText)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return kind === 'call' && !phoneOf(card) ? null : card
}

function urlOf(spans: readonly Span[]): string {
  for (const span of spans) {
    if (span.kind === 'link') {
      return span.url
    }

    if (span.kind === 'source') {
      return span.links[0]?.url ?? ''
    }
  }

  return ''
}

function everyValue(card: InfoCard): string[] {
  return [card.title, ...card.rows.map(row => row.value)]
}

/** The first telephone number of a card, as a telephone takes it: digits, with `+` for the country. */
export function phoneOf(card: InfoCard): string {
  for (const value of everyValue(card)) {
    const number = PHONE.exec(value)?.[0]

    if (number) {
      return number.replace(/[^\d+]/g, '')
    }
  }

  return ''
}

function emailOf(card: InfoCard): string {
  return everyValue(card).map(value => EMAIL.exec(value)?.[0]).find(Boolean) ?? ''
}

/** Where the thing is: the row for the place, or the title of a place. */
function placeOf(card: InfoCard): string {
  return card.rows.find(row => /^(where|address|location|place)$/i.test(row.label))?.value ?? (card.kind === 'place' ? card.title : '')
}

/** The title with no telephone number in it: the name of the person or the place. */
export function titleName(card: InfoCard): string {
  const number = PHONE.exec(card.title)?.[0]
  const name = number ? card.title.replace(number, '').replace(/^[\s(),:-]+|[\s(),:-]+$/g, '') : card.title

  return name || card.title
}

export interface CardAction {
  label: string
  icon: 'phone' | 'message-circle' | 'mail' | 'map-pin' | 'calendar' | 'bell' | 'external-link' | 'link'
  /** An address that an app of the phone opens. */
  url?: string
  /** A line to say to the agent, as a message of the user. */
  say?: string
}

/**
 * What the user can do with a card. The first one is the wide button. The
 * phone has no way to make an event or a reminder from a link, so Hermes
 * does those: it has the calendar.
 */
export function cardActions(card: InfoCard): CardAction[] {
  const phone = phoneOf(card)
  const email = emailOf(card)
  const place = placeOf(card)
  const call: CardAction[] = phone ? [{ label: 'Call', icon: 'phone', url: `tel:${phone}` }] : []
  const text: CardAction[] = phone ? [{ label: 'Text', icon: 'message-circle', url: `sms:${phone}` }] : []
  const mail: CardAction[] = email ? [{ label: 'Email', icon: 'mail', url: `mailto:${email}` }] : []
  const map: CardAction[] = place ? [{ label: 'Maps', icon: 'map-pin', url: `https://maps.apple.com/?q=${encodeURIComponent(place)}` }] : []
  const page = card.rows.find(row => row.url)
  const open: CardAction[] = page?.url ? [{ label: `Open ${page.label.toLowerCase()}`, icon: 'external-link', url: page.url }] : []

  switch (card.kind) {
    case 'call':
    case 'contact':
      return [...call, ...text, ...mail, ...map, ...open]
    case 'event':
      return [{ label: 'Add to my calendar', icon: 'calendar', say: `Add this to my calendar: ${card.title}.` }, ...map, ...call, ...open]
    case 'reminder':
      return [{ label: 'Set the reminder', icon: 'bell', say: `Set this reminder: ${card.title}.` }]
    case 'place':
      return [...map, ...call, ...open]
    case 'booking':
      return [...open, ...map, ...call]
    case 'connect':
      // With a page to sign in on, the phone opens it. With none, Hermes starts the connection.
      return page?.url ? [{ label: 'Connect', icon: 'link', url: page.url }] : [{ label: 'Connect', icon: 'link', say: `Connect ${card.title}.` }]
    case 'payment':
      return open
  }
}

/** A card as text, for the clipboard: the title, each field on a line, the notes. */
export function cardText(card: InfoCard): string {
  return [card.title, ...card.rows.map(row => `${row.label}: ${row.value}`), card.notes].filter(Boolean).join('\n')
}
