/**
 * The web pages an answer points to, and the parts of a result that has a
 * picture. Hermes writes an answer as Markdown; this reads the links of that
 * Markdown as sources, so the chat can name the site of each one and list
 * them all in one place.
 */

import type { Block, Span } from './markdown'

export interface Source {
  url: string
  /** The site without `www.`: "bbc.co.uk". */
  site: string
  /** The words of the link, or the site when the link had no words of its own. */
  title: string
}

function host(url: string): string {
  return /^https?:\/\/([^/?#:@\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? ''
}

/** The site of a web address, as a person names it: no scheme, no `www.`. */
export function siteName(url: string): string {
  return host(url).replace(/^www\./, '')
}

/** Where the icon of a site is. The request goes to the site itself, and to no other service. */
export function siteIconUrl(url: string): string {
  return `https://${host(url)}/favicon.ico`
}

function spanSources(span: Span): Source[] {
  if (span.kind === 'link') {
    return [{ url: span.url, site: siteName(span.url), title: span.text }]
  }

  if (span.kind === 'source') {
    return span.links.map(link => ({ url: link.url, site: siteName(link.url), title: link.text }))
  }

  return []
}

function blockSpans(block: Block): readonly Span[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
    case 'item':
      return block.spans
    case 'table':
      return [...block.header.flat(), ...block.rows.flat(2)]
    case 'card':
      return block.lines.flat()
    default:
      return []
  }
}

/** Every page an answer points to, once each, in the order of the answer. */
export function answerSources(blocks: readonly Block[]): Source[] {
  const seen = new Map<string, Source>()

  for (const source of blocks.flatMap(block => blockSpans(block).flatMap(spanSources))) {
    const known = seen.get(source.url)

    // A link with words of its own names the page better than a mark does.
    if (!known || (known.title === known.site && source.title !== source.site)) {
      seen.set(source.url, source)
    }
  }

  return [...seen.values()]
}

export type CardRole = 'title' | 'price' | 'label' | 'text'

export interface CardLine {
  role: CardRole
  spans: readonly Span[]
}

const PRICE = /^(from\s+)?[£$€]\s?\d[\d,.]*(\s?(pp|each|\/\w+|per \w+))?$/i
const LABEL_MAX = 32

function lineText(spans: readonly Span[]): string {
  return spans
    .map(span => span.text)
    .join('')
    .trim()
}

/**
 * What each line of a result is: its title (the first line in bold, or the
 * first line), a price, a short status in italics ("Lowest fare found"), or
 * plain words.
 */
export function cardLines(lines: readonly (readonly Span[])[]): CardLine[] {
  const strong = lines.findIndex(line => line.length > 0 && line.every(span => span.kind === 'strong' || !span.text.trim()))
  // A first line that starts with a link and goes on in words ("Name: price, shop") is a sentence, not a title: its link is the bold part.
  const sentence = strong === -1 && lines[0]?.[0]?.kind === 'link' && lines[0].some(span => span.kind !== 'link' && span.text.trim())
  const title = sentence ? -1 : strong === -1 ? 0 : strong

  return lines.map((spans, index) => {
    const words = lineText(spans)

    if (sentence && index === 0) {
      return { role: 'text', spans: spans.map(span => (span.kind === 'link' ? { ...span, bold: true } : span)) }
    }

    if (PRICE.test(words)) {
      return { role: 'price', spans }
    }

    if (index === title) {
      return { role: 'title', spans }
    }

    const only = spans.filter(span => span.text.trim())

    return { role: only.length === 1 && only[0].kind === 'em' && words.length <= LABEL_MAX ? 'label' : 'text', spans }
  })
}
