import { draftFrom, sendRequest, sendWays } from '../drafts'
import { parseMarkdown } from '../markdown'

const EMAIL = `Here's the draft. It goes to Alex only, as a reply in the same thread:

> **To:** Alex Morgan <alex@agents.example>
> **Cc:** Sam <sam@mail.example>
> **Thread:** Re: 12 Example Street - Tenancy
> **Subject:** Re: 12 Example Street - Tenancy
>
> Hi Alex,
>
> Thanks for getting back to me so quickly.
>
> Thanks,
> Reza

I haven't sent anything.`

describe('a draft in an answer', () => {
  it('reads an email with its fields and its words', () => {
    const blocks = parseMarkdown(EMAIL)

    expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'draft', 'paragraph'])
    expect(blocks[1]).toEqual({
      kind: 'draft',
      draft: {
        channel: 'email',
        to: 'Alex Morgan <alex@agents.example>',
        cc: 'Sam <sam@mail.example>',
        thread: 'Re: 12 Example Street - Tenancy',
        subject: 'Re: 12 Example Street - Tenancy',
        body: 'Hi Alex,\n\nThanks for getting back to me so quickly.\n\nThanks,\nReza'
      }
    })
  })

  it('reads a draft with only a subject, as Hermes writes it today', () => {
    const [, block] = parseMarkdown("Here's the draft:\n\n> **Subject:** Rent\n>\n> Hi Alex,\n> Thanks.")

    expect(block).toMatchObject({ kind: 'draft', draft: { channel: 'email', subject: 'Rent', body: 'Hi Alex,\nThanks.' } })
  })

  it('names the channel from the words before the quote', () => {
    const channel = (lead: string) => draftFrom(lead, [[{ kind: 'text', text: 'Running late, there in ten.' }]])?.channel

    expect(channel("Here's a draft SMS for Mum:")).toBe('sms')
    expect(channel('I drafted the WhatsApp message:')).toBe('whatsapp')
    expect(channel('Draft for the Telegram group:')).toBe('telegram')
    expect(channel("Here's a draft:")).toBe('message')
  })

  it('leaves the words of another person as a quote', () => {
    const blocks = parseMarkdown('You were right, they accepted. Alex replied at 13:31:\n\n> The owner would accept your counter offer.\n\nSo your rent goes up.')

    expect(blocks.map(block => block.kind)).toEqual(['paragraph', 'quote', 'paragraph'])
  })
})

describe('the ways to send a draft', () => {
  const draft = { channel: 'email', to: 'Alex Morgan <alex@agents.example>', cc: 'Sam <s@mail.example>', subject: 'Rent & dates', body: 'Hi Alex,\nThanks.' } as const

  it('fills an email of the phone with the addresses, the subject and the words', () => {
    expect(sendWays(draft)[0]).toEqual({
      label: 'Mail',
      url: 'mailto:alex%40agents.example?subject=Rent%20%26%20dates&body=Hi%20Alex%2C%0AThanks.&cc=s%40mail.example'
    })
    expect(sendWays(draft).map(way => way.label)).toEqual(['Mail', 'Gmail'])
  })

  it('gives a text the number and the words', () => {
    expect(sendWays({ channel: 'sms', to: 'Mum (+44 7700 900123)', body: 'There in ten.' })).toEqual([{ label: 'Messages', url: 'sms:+447700900123&body=There%20in%20ten.' }])
    expect(sendWays({ channel: 'whatsapp', to: '+44 7700 900123', body: 'Hi' })[0].url).toBe('https://wa.me/447700900123?text=Hi')
  })

  it('asks Hermes to send the draft as it is, or with the changes of the user', () => {
    expect(sendRequest(draft, null)).toBe('Send it.')
    expect(sendRequest(draft, { ...draft, body: 'Hi Alex,\nThank you.' })).toBe('Send it with my changes. Use this text and change nothing else.\n\nHi Alex,\nThank you.')
    // A new recipient, and the copy taken away.
    expect(sendRequest(draft, { channel: 'email', to: 'alex@agents.example, sam@agents.example', subject: 'Rent & dates', body: 'Hi both.' })).toBe(
      'Send it with my changes. Use this text and change nothing else.\n\nTo: alex@agents.example, sam@agents.example\nCc: (none)\n\nHi both.'
    )
  })
})
