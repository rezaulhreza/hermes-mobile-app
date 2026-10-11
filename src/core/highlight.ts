/**
 * Colour for a code block: comments, strings, numbers and the common words of
 * a language. One small scanner for every language, not a grammar for each:
 * it is right for most lines and never changes the text.
 */

export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword'

export interface CodeToken {
  kind: CodeTokenKind
  text: string
}

/** A longer block stays plain: colour is not worth a long scan on a phone. */
const MAX_CHARS = 20_000

const HASH_COMMENTS = /^(py|python|rb|ruby|sh|bash|zsh|shell|ya?ml|toml|ini|conf|dockerfile|make|makefile|r|perl|pl|ps1|powershell|env)$/
const DASH_COMMENTS = /^(sql|lua|haskell|hs|elm)$/
const NO_COLOUR = /^(text|txt|plain|log|output|console|diff|markdown|md)$/

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue def default defer del do elif else end enum export extends ' +
    'false finally fn for from func function if impl implements import in interface is lambda let match mod module new nil None ' +
    'not null of or package pass private protected pub public raise return self static struct super switch then this throw trait ' +
    'true True False try type typeof undefined use var void while with yield and select insert update delete where join on group ' +
    'by order limit create table into values set echo exit fi done esac local'
  ).split(' ')
)

function scanner(language: string): RegExp {
  const line = HASH_COMMENTS.test(language) ? '#[^\\n]*' : DASH_COMMENTS.test(language) ? '--[^\\n]*' : '\\/\\/[^\\n]*'
  const block = HASH_COMMENTS.test(language) || DASH_COMMENTS.test(language) ? '' : '|\\/\\*[\\s\\S]*?(?:\\*\\/|$)'

  return new RegExp(
    [
      `(${line}${block})`,
      '("(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?|`(?:\\\\.|[^`\\\\])*`?)',
      '(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0x[0-9a-fA-F]+\\b)',
      '([A-Za-z_$][\\w$]*)'
    ].join('|'),
    'g'
  )
}

export function highlightCode(code: string, language: string | null): CodeToken[] {
  const name = (language ?? '').toLowerCase()

  if (!code || code.length > MAX_CHARS || NO_COLOUR.test(name)) {
    return [{ kind: 'plain', text: code }]
  }

  const tokens: CodeToken[] = []
  const push = (kind: CodeTokenKind, text: string) => {
    const last = tokens[tokens.length - 1]

    // Runs of one kind are one token: fewer text nodes to draw.
    if (last?.kind === kind) {
      last.text += text
    } else if (text) {
      tokens.push({ kind, text })
    }
  }

  const scan = scanner(name)
  let at = 0

  for (let match = scan.exec(code); match; match = scan.exec(code)) {
    push('plain', code.slice(at, match.index))
    push(match[1] !== undefined ? 'comment' : match[2] !== undefined ? 'string' : match[3] !== undefined ? 'number' : KEYWORDS.has(match[4]!) ? 'keyword' : 'plain', match[0])
    at = match.index + match[0].length
  }

  push('plain', code.slice(at))

  return tokens
}
