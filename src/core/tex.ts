/**
 * Inline math of an answer as plain text: `$x^2 + \alpha$` reads "x² + α".
 * A line of text cannot hold typeset math, so the common TeX of an answer
 * becomes the characters it stands for. A block of math ($$ ... $$) is
 * typeset in full by the web view of the answer.
 */

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', iff: '⇔', implies: '⇒', mapsto: '↦', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', partial: '∂', nabla: '∇',
  forall: '∀', exists: '∃', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩', emptyset: '∅',
  land: '∧', lor: '∨', neg: '¬', angle: '∠', degree: '°', circ: '∘', ldots: '…', cdots: '⋯', dots: '…', prime: '′',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '', '%': '%', '$': '$', '{': '{', '}': '}', '_': '_', '&': '&', '#': '#'
}

const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', T: 'ᵀ'
}

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', x: 'ₓ'
}

/** Small raised or lowered characters when every character has one, else "^(...)" or "_(...)". */
function shifted(text: string, table: Record<string, string>, mark: string): string {
  const chars = [...text]

  if (!chars.length) {
    return mark
  }

  if (chars.every(char => table[char])) {
    return chars.map(char => table[char]).join('')
  }

  return chars.length === 1 ? `${mark}${text}` : `${mark}(${text})`
}

/** The group after a command: `{...}` with nested braces, or one character. */
function group(source: string, at: number): [string, number] {
  if (source[at] !== '{') {
    return [source[at] ?? '', at + 1]
  }

  let depth = 0

  for (let index = at; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1

      if (depth === 0) {
        return [source.slice(at + 1, index), index + 1]
      }
    }
  }

  return [source.slice(at + 1), source.length]
}

const simple = (text: string) => /^[\w.]*$/.test(text)

/** TeX as the plain characters it stands for. Unknown commands keep their name without the backslash. */
export function texToText(tex: string): string {
  let out = ''
  let index = 0
  const source = tex.trim()

  while (index < source.length) {
    const char = source[index]

    if (char === '\\') {
      const name = /^[A-Za-z]+/.exec(source.slice(index + 1))?.[0] ?? source[index + 1] ?? ''
      const next = index + 1 + name.length

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [top, afterTop] = group(source, next)
        const [bottom, afterBottom] = group(source, afterTop)
        const a = texToText(top)
        const b = texToText(bottom)

        out += `${simple(a) ? a : `(${a})`}/${simple(b) ? b : `(${b})`}`
        index = afterBottom
        continue
      }

      if (name === 'sqrt') {
        const [inner, after] = group(source, next)
        const body = texToText(inner)

        out += simple(body) ? `√${body}` : `√(${body})`
        index = after
        continue
      }

      if (['text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'textbf', 'textit', 'mbox'].includes(name)) {
        const [inner, after] = group(source, next)

        out += name.startsWith('text') || name === 'mbox' ? inner : texToText(inner)
        index = after
        continue
      }

      if (name === 'left' || name === 'right' || name === 'displaystyle' || name === 'limits') {
        index = next
        continue
      }

      out += SYMBOLS[name] ?? name
      index = next
      continue
    }

    if (char === '^' || char === '_') {
      const [inner, after] = group(source, index + 1)

      out += shifted(texToText(inner), char === '^' ? SUPER : SUB, char)
      index = after
      continue
    }

    if (char === '{' || char === '}') {
      index += 1
      continue
    }

    out += char === '~' ? ' ' : char
    index += 1
  }

  return out.replace(/\s+/g, ' ')
}
