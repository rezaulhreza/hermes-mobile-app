import { parseMarkdown, parseSpans } from '../markdown'
import { answerSources, cardLines, siteIconUrl, siteName } from '../sources'

describe('links and sources in the text of an answer', () => {
  it('keeps a link with words of its own as a link', () => {
    expect(parseSpans('Read [the report](https://www.bbc.co.uk/news/1) today.')).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'link', text: 'the report', url: 'https://www.bbc.co.uk/news/1' },
      { kind: 'text', text: ' today.' }
    ])
  })

  it('takes a link with no words of its own as a source', () => {
    const marks = ['[1](https://www.bbc.co.uk/a)', '[bbc.co.uk](https://www.bbc.co.uk/a)', 'https://www.bbc.co.uk/a']

    for (const mark of marks) {
      expect(parseSpans(mark)).toEqual([{ kind: 'source', text: 'bbc.co.uk', links: [{ text: 'bbc.co.uk', url: 'https://www.bbc.co.uk/a' }] }])
    }

    // The name of the site as the answer wrote it.
    expect(parseSpans('[BBC](https://www.bbc.co.uk/a)')).toMatchObject([{ kind: 'source', text: 'BBC' }])
  })

  it('takes links alone in brackets as one source with a count, and keeps their words', () => {
    const [before, source, after] = parseSpans('Fares fell in May ([Reuters](https://reuters.com/x), [FT](https://ft.com/y)).')

    expect(before).toEqual({ kind: 'text', text: 'Fares fell in May ' })
    expect(source).toMatchObject({ kind: 'source', text: 'Reuters', links: [{ text: 'Reuters' }, { text: 'FT' }] })
    expect(after).toEqual({ kind: 'text', text: '.' })
  })

  it('leaves the full stop after a bare address in the sentence', () => {
    expect(parseSpans('See https://example.com/a.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'source', text: 'example.com', links: [{ text: 'example.com', url: 'https://example.com/a' }] },
      { kind: 'text', text: '.' }
    ])
  })

  it('leaves brackets with words and a link as they are', () => {
    expect(parseSpans('(see [the report](https://a.com/x))').map(span => span.kind)).toEqual(['text', 'link', 'text'])
  })

  it('does not read an address in code as a source', () => {
    expect(parseSpans('`curl https://a.com`')).toEqual([{ kind: 'code', text: 'curl https://a.com' }])
  })
})

describe('the sources of an answer', () => {
  it('lists each page once, in the order of the answer, with the best name it has', () => {
    const blocks = parseMarkdown('First [1](https://a.com/x).\n\n- [The A report](https://a.com/x)\n- [b.org](https://www.b.org/y)\n\n| Site |\n|---|\n| [C news](https://c.net/z) |')

    expect(answerSources(blocks)).toEqual([
      { url: 'https://a.com/x', site: 'a.com', title: 'The A report' },
      { url: 'https://www.b.org/y', site: 'b.org', title: 'b.org' },
      { url: 'https://c.net/z', site: 'c.net', title: 'C news' }
    ])
  })

  it('names a site and finds its icon at the site itself', () => {
    expect(siteName('https://www.Example.com:8080/a?b')).toBe('example.com')
    expect(siteIconUrl('https://www.example.com/a')).toBe('https://www.example.com/favicon.ico')
  })
})

describe('a result with a picture', () => {
  it('is a picture with the words of its paragraph', () => {
    const [card] = parseMarkdown('![Hotel](https://img.example.com/h.jpg)\n**Hotel Aurora**\n£129\n*Lowest fare found*\nNear the station. ([booking.com](https://booking.com/h))')

    expect(card).toMatchObject({ kind: 'card', picture: { alt: 'Hotel', url: 'https://img.example.com/h.jpg' } })
    expect(card.kind === 'card' && cardLines(card.lines).map(line => line.role)).toEqual(['title', 'price', 'label', 'text'])
  })

  it('takes the paragraph under a picture that stands alone', () => {
    const blocks = parseMarkdown('![A](https://i.com/a.png)\n\nThe first one.\n\nAnother paragraph.')

    expect(blocks.map(block => block.kind)).toEqual(['card', 'paragraph'])
  })

  it('is only a picture when no words come with it', () => {
    expect(parseMarkdown('![A](https://i.com/a.png)\n\n## Next').map(block => block.kind)).toEqual(['image', 'heading'])
  })

  it('shows a picture with no web address as the text it was', () => {
    expect(parseMarkdown('![A](file:///a.png)')).toEqual([{ kind: 'paragraph', spans: [{ kind: 'text', text: '![A](file:///a.png)' }] }])
  })
})
