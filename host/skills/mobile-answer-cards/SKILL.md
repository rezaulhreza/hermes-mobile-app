---
name: mobile-answer-cards
description: "Use when you write a draft for the user to send (an email, a reply, an SMS, a WhatsApp, Telegram, Slack or other message), when you list results that have a picture (products, hotels, listings), or when you cite web pages. Gives the exact Markdown shapes that the Hermes phone app draws as cards."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [draft, email, sms, whatsapp, telegram, message, reply, sources, citations, results, cards, mobile, formatting]
    category: productivity
    related_skills: [voice-conversation-handling]
---

# Mobile answer cards

The Hermes phone app reads an answer as Markdown and draws three shapes as cards: a draft
to send, a result with a picture, and a source. Each card appears only when the answer has
the exact shape below. Any other shape is drawn as plain text, so nothing breaks, but the
user gets no card. These shapes are also good plain Markdown on every other surface.

## When to Use

- You wrote a message for the user to send or approve: an email, a reply in a thread, an
  SMS, a WhatsApp, Telegram, Slack, Discord, Signal or iMessage message.
- You list things that each have a picture: products, hotels, flats, flights, places.
- You state a fact that comes from a web page.

These shapes hold in a spoken conversation too. The rule "no Markdown in a spoken reply"
does not apply to a draft: write the draft as the quote below, and say one plain sentence
before it.

## A draft to send

Write one sentence that has the word "draft" and names the channel. Then write the draft as
one quote. Put the fields first, one to a line, each with a bold label. Leave one empty
quote line, then the words of the message. Put nothing else in the quote.

```markdown
Here's the draft email. It goes to Alex only, as a reply in the same thread:

> **To:** Alex Morgan <alex@agents.example>
> **Cc:** Sam Lee <sam@mail.example>
> **Thread:** Re: 12 Example Street - Tenancy
> **Subject:** Re: 12 Example Street - Tenancy
>
> Hi Alex,
>
> Thanks for getting back to me so quickly.
>
> Thanks,
> Reza

I haven't sent anything. Say "send it" to send now.
```

The fields, in this order. Write a field only when you know its value. Never write a
placeholder such as "[Landlord's name]" in a field: leave the field out.

| Field | Use |
|---|---|
| `**To:**` | The recipients. For an email: `Name <address>`, with commas between people. For a text or a WhatsApp: the name, and the number in international form if you know it, such as `Mum (+44 7700 900123)`. For a group or a channel: its name. |
| `**Cc:**`, `**Bcc:**` | Email only, same form as To. |
| `**Thread:**` | Only when the draft answers an existing conversation that you have confirmed: the subject or the name of that thread. |
| `**Subject:**` | Email only. For a reply, keep the subject of the thread. |
| `**Channel:**` | Only when the sentence before the quote does not name the channel: `Email`, `SMS`, `WhatsApp`, `Telegram`, `iMessage`, `Signal`, `Slack`, `Discord`. |

A short message has no subject. The sentence before it names the channel:

```markdown
Here's the draft WhatsApp message for the landlord:

> **To:** Alex Morgan (+44 7700 900123)
>
> Hi Alex, thank you for your understanding. I'm happy to accept the new rent.
```

Rules:

- One draft, one quote. For two drafts, write a sentence and a quote for each.
- Do not quote the words of another person with a field label on the first line. A quote
  that starts with `**Subject:**` or `**To:**` is drawn as a draft the user can send.
- The card has a Send button. A tap sends the user's message "Send it." or "Send it with my
  changes. Use this text and change nothing else." followed by the new text. Treat both as
  the user's approval of that draft and of nothing else. Send through the account and the
  thread you named. All the usual rules for sending still hold.
- After a change, do not rewrite the user's text. Send exactly what the message gives.

## A result with a picture

Write each result as one paragraph. The picture is the first line. Then the title in bold on
a line of its own, then the price on a line of its own, then an optional short status in
italics, then one or two sentences, with the link at the end. Leave an empty line between
results. Use a direct `https` link to an image file for the picture.

```markdown
![Hotel Aurora](https://images.example.com/aurora.jpg)
**Hotel Aurora**
£129
*Lowest fare found*
Near the station, breakfast included. [See the rooms](https://www.example.com/aurora)
```

- The price line is only the price: `£129`, `$1,200`, `from £95`, `£40 pp`.
- The status is at most four words, and is true: `*Lowest fare found*`, `*2 left*`.
- A result with no picture is an ordinary list item. Do not invent a picture.

## A source

- Put the source after the sentence it supports, in round brackets, as a link whose words
  are the name of the site: `Rail fares fell in May ([Reuters](https://www.reuters.com/...)).`
- Two sources for one sentence go in the same brackets with a comma between them.
- A link that the user is meant to follow has words that say where it goes:
  `[See the rooms](https://...)`. Do not use "here" or the bare address as the words.
- Do not add a list of sources at the end. The app makes that list from the links.

## Common Pitfalls

1. A draft as a code block or as plain paragraphs. The app then draws no card.
2. The recipient only in the sentence before the quote. The card then shows "Recipients"
   with no name. Put the recipient in `**To:**` when you know it.
3. A closing line inside the quote, such as "Shall I send it?". The user would send it.
4. A picture address that is a web page, not an image file. The card shows an empty box.
