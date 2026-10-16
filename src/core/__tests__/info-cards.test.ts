import { cardActions, cardText, phoneOf, titleName } from '../info-cards'
import { parseMarkdown } from '../markdown'

const card = (text: string) => {
  const block = parseMarkdown(text).find(candidate => candidate.kind === 'info')

  if (block?.kind !== 'info') {
    throw new Error('no card')
  }

  return block.card
}

describe('a card in an answer', () => {
  it('reads a call: who, the number, the fields and the notes', () => {
    const call = card("Here's the call to make:\n\n> **Call:** Alex Morgan (+44 20 7946 0123)\n> **When:** Today before 5 pm\n>\n> Confirm the new rent of £1,500.\n> Ask for a reminder in November.")

    expect(call).toEqual({
      kind: 'call',
      label: 'Call',
      title: 'Alex Morgan (+44 20 7946 0123)',
      rows: [{ label: 'When', value: 'Today before 5 pm' }],
      notes: 'Confirm the new rent of £1,500.\nAsk for a reminder in November.'
    })
    expect(titleName(call)).toBe('Alex Morgan')
    expect(phoneOf(call)).toBe('+442079460123')
    expect(cardActions(call).map(action => action.url)).toEqual(['tel:+442079460123', 'sms:+442079460123'])
  })

  it('lets Hermes make an event and a reminder, and opens the place of an event in a map', () => {
    const event = card('> **Event:** Viewing at 12 Example Street\n> **When:** Friday 16 October, 3 pm\n> **Where:** 12 Example Street, London AB1 2CD')

    expect(cardActions(event)).toEqual([
      { label: 'Add to my calendar', icon: 'calendar', say: 'Add this to my calendar: Viewing at 12 Example Street.' },
      { label: 'Maps', icon: 'map-pin', url: 'https://maps.apple.com/?q=12%20Example%20Street%2C%20London%20AB1%202CD' }
    ])
    expect(cardActions(card('> **Reminder:** Update the standing order\n> **When:** 20 November'))[0].say).toBe('Set this reminder: Update the standing order.')
  })

  it('gives a payment as lines to copy, with no button', () => {
    const payment = card('> **Payment:** Rent for December\n> **Amount:** £1,500\n> **Sort code:** 12-34-56\n> **Account:** 12345678\n> **Reference:** 12 Example Street')

    expect(payment.rows.map(row => row.label)).toEqual(['Amount', 'Sort code', 'Account', 'Reference'])
    expect(cardActions(payment)).toEqual([])
    expect(cardText(payment)).toContain('Sort code: 12-34-56')
  })

  it('opens the page of a booking, and connects a service with a page or with Hermes', () => {
    const flight = card('> **Flight:** BA 117 London to New York\n> **When:** 12 November, 08:25\n> **Manage:** [ba.com](https://www.ba.com/manage/ABC123)')

    expect(flight).toMatchObject({ kind: 'booking', label: 'Flight' })
    expect(cardActions(flight)[0]).toEqual({ label: 'Open manage', icon: 'external-link', url: 'https://www.ba.com/manage/ABC123' })
    expect(cardActions(card('> **Connect:** Google Calendar\n> **Why:** I cannot read your events yet\n> **Link:** https://hermes.example/connect/gcal'))[0]).toEqual({
      label: 'Connect',
      icon: 'link',
      url: 'https://hermes.example/connect/gcal'
    })
    expect(cardActions(card('> **Connect:** Gmail\n> **Why:** The connection ended'))[0]).toEqual({ label: 'Connect', icon: 'link', say: 'Connect Gmail.' })
  })

  it('is not a card with no kind on its first line, and a call needs a number', () => {
    expect(parseMarkdown('> He said this.\n> Call: 020 7946 0123')[0].kind).toBe('quote')
    expect(parseMarkdown('> **Call:** Alex when you can')[0].kind).toBe('quote')
    expect(parseMarkdown('> Note: the event is on Friday.')[0].kind).toBe('quote')
  })
})
