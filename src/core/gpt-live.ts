/**
 * The gpt-live engine: one OpenAI voice model listens and speaks at the same
 * time over WebRTC. It has no tools. When the user asks for real work it
 * hands the request to Hermes (a "delegation"), and the answer of Hermes goes
 * back to it as text, which it says in its own words. Hermes stays the only
 * agent. The rules are those of the desktop (`apps/desktop/src/lib/voice-live.ts`).
 *
 * This file has no WebRTC in it, so it can be tested.
 */

/** What `GET /api/audio/voice-live/status` answers. */
export interface GptLiveStatus {
  available: boolean
  reason?: string | null
  model?: string
  voice?: string
}

export interface LiveFragment {
  speaker: 'assistant' | 'user'
  text: string
  endMs: number
}

export interface LiveHistoryMessage {
  type: 'message'
  role: 'assistant' | 'user'
  content: { type: 'input_text' | 'output_text'; text: string }[]
}

// The vendor takes 500 tokens for each append. About 4 characters a token, with room to spare.
const APPEND_CHAR_LIMIT = 1400
// How much of the spoken conversation Hermes gets with a request.
const CONTEXT_WINDOW_MS = 5 * 60_000
const CONTEXT_MAX_FRAGMENTS = 80

/** Cut an answer into parts the voice model takes, at the ends of sentences. */
export function commentaryParts(text: string, limit = APPEND_CHAR_LIMIT): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()

  if (clean.length <= limit) {
    return clean ? [clean] : []
  }

  const parts: string[] = []
  let current = ''

  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > limit) {
      if (current) {
        parts.push(current)
        current = ''
      }

      for (let index = 0; index < sentence.length; index += limit) {
        parts.push(sentence.slice(index, index + limit))
      }

      continue
    }

    const candidate = current ? `${current} ${sentence}` : sentence

    if (candidate.length > limit) {
      parts.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }

  return current ? [...parts, current] : parts
}

/** The text turns of the chat, newest kept, for the voice model to start with. */
export function liveHistory(turns: readonly { role: 'assistant' | 'user'; text: string }[], maxMessages = 24, maxChars = 6000): LiveHistoryMessage[] {
  const out: LiveHistoryMessage[] = []
  let budget = maxChars

  for (const turn of [...turns].reverse()) {
    const text = turn.text.replace(/\s+/g, ' ').trim().slice(0, 1200)

    if (!text) {
      continue
    }

    if (out.length >= maxMessages || budget - text.length < 0) {
      break
    }

    budget -= text.length
    out.unshift({ type: 'message', role: turn.role, content: [{ type: turn.role === 'assistant' ? 'output_text' : 'input_text', text }] })
  }

  return out
}

/** The recent part of the spoken conversation, oldest first. */
export function contextWindow(transcript: readonly LiveFragment[]): LiveFragment[] {
  const last = transcript.at(-1)

  if (!last) {
    return []
  }

  return transcript.filter(fragment => fragment.endMs >= last.endMs - CONTEXT_WINDOW_MS).slice(-CONTEXT_MAX_FRAGMENTS)
}

/**
 * A request for Hermes from the spoken conversation. `prompt` is what the
 * user said last: it is the message in the chat. `context` is the recent
 * exchange, which only the model reads.
 */
export function delegationPrompt(fragments: readonly LiveFragment[]): { prompt: string; context: string } {
  const turns: { speaker: 'assistant' | 'user'; text: string }[] = []

  for (const fragment of fragments) {
    const last = turns.at(-1)

    if (last && last.speaker === fragment.speaker) {
      last.text += fragment.text
    } else {
      turns.push({ speaker: fragment.speaker, text: fragment.text })
    }
  }

  const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()
  const prompt = tidy([...turns].reverse().find(turn => turn.speaker === 'user')?.text ?? '')
  const context = turns
    .filter(turn => tidy(turn.text))
    .map(turn => `${turn.speaker === 'user' ? 'User' : 'Voice assistant'}: ${tidy(turn.text)}`)
    .join('\n')

  return { prompt: prompt || context.slice(-400), context }
}
