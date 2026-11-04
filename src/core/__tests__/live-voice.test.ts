import {
  advanceTurn,
  approvalQuestion,
  bytesBase64,
  DEEPGRAM_VOICES,
  type DeepgramSettings,
  EchoMemory,
  flushWait,
  isFluxVoice,
  isStopPhrase,
  LANGUAGES,
  listenUrl,
  NovaTurns,
  NEW_TURN,
  pcmBytes,
  SentenceFeed,
  speakableLine,
  speakParts,
  voiceName,
  withLanguage,
  speakUrl,
  spokenVerdict,
  toolLine,
  wavFile
} from '../live-voice'

const SETTINGS: DeepgramSettings = {
  available: true,
  voice: 'aura-2-thalia-en',
  listen_model: 'flux-general-en',
  eot_threshold: 0.7,
  eot_timeout_ms: 3000,
  speed: 1,
  keyterms: ['Hermes', 'Rez'],
  mip_opt_out: true
}

describe('the socket addresses', () => {
  it('asks the listening model for 16 kHz PCM, with every key term', () => {
    const url = listenUrl(SETTINGS)

    expect(url).toContain('wss://api.deepgram.com/v2/listen?')
    expect(url).toContain('sample_rate=16000')
    expect(url).toContain('model=flux-general-en')
    expect(url).toContain('keyterm=Hermes&keyterm=Rez')
    expect(url).toContain('mip_opt_out=true')
  })

  it('asks for numbers as digits unless the host turns it off', () => {
    expect(listenUrl(SETTINGS)).toContain('numerals=true')
    expect(listenUrl({ ...SETTINGS, numerals: true })).toContain('numerals=true')
    expect(listenUrl({ ...SETTINGS, numerals: false })).toContain('numerals=false')
  })

  it('speaks a Flux voice on the second speak address, with its expressivity', () => {
    const flux = speakUrl({ ...SETTINGS, voice: 'flux-colin-en', expressivity: 1 })

    expect(flux).toContain('wss://api.deepgram.com/v2/speak?')
    expect(flux).toContain('model=flux-colin-en')
    expect(flux).toContain('expressivity=1')
    expect(speakUrl({ ...SETTINGS, voice: 'flux-colin-en' })).not.toContain('expressivity')
    expect(speakUrl({ ...SETTINGS, expressivity: 2 })).toContain('wss://api.deepgram.com/v1/speak?')
    expect(speakUrl({ ...SETTINGS, expressivity: 2 })).not.toContain('expressivity')
    expect(isFluxVoice({ ...SETTINGS, voice: 'flux-kit-en' })).toBe(true)
    expect(isFluxVoice(SETTINGS)).toBe(false)
  })

  it('hears the language the host or the phone chose', () => {
    expect(listenUrl({ ...SETTINGS, listen_model: 'flux-general-multi', language_hint: 'fr' })).toContain('language_hint=fr')
    expect(listenUrl(SETTINGS)).not.toContain('language_hint')

    const french = withLanguage(SETTINGS, 'fr')

    expect(french.listen_model).toBe('flux-general-multi')
    expect(french.language_hint).toBe('fr')
    expect(withLanguage(SETTINGS, 'en-US').listen_model).toBe('flux-general-en')
    expect(withLanguage(SETTINGS, 'en-US').language_hint).toBeNull()
    expect(withLanguage(SETTINGS, 'multi').language_hint).toBeNull()
    expect(withLanguage(SETTINGS, '')).toBe(SETTINGS)
  })

  it('sends a language Flux does not hear to Nova-3', () => {
    const bangla = withLanguage(SETTINGS, 'bn')

    expect(bangla.listen_engine).toBe('nova')
    expect(bangla.language_hint).toBe('bn')

    const url = listenUrl(bangla)

    expect(url).toContain('wss://api.deepgram.com/v1/listen?')
    expect(url).toContain('model=nova-3')
    expect(url).toContain('language=multi')
    expect(url).toContain('language_hint=bn')
    expect(url).toContain('utterance_end_ms=1000')
    expect(url).toContain('keyterm=Hermes')
    expect(withLanguage(SETTINGS, 'multi').listen_engine).toBe('nova')
    expect(withLanguage(SETTINGS, 'multi').language_hint).toBeNull()
    expect(withLanguage(SETTINGS, 'fr').listen_engine).toBe('flux')
    expect(LANGUAGES.some(language => language.code === 'ko')).toBe(true)
  })

  it('makes Flux turn messages from Nova-3 results', () => {
    const turns = new NovaTurns()
    const result = (transcript: string, final: boolean) => ({ type: 'Results', is_final: final, channel: { alternatives: [{ transcript }] } })
    const events = [
      ...turns.feed(result('one', false)),
      ...turns.feed(result('one two', true)),
      ...turns.feed({ type: 'UtteranceEnd' }),
      ...turns.feed({ type: 'UtteranceEnd' })
    ]

    expect(events.map(event => `${event.event}:${event.transcript}`)).toEqual(['StartOfTurn:one', 'Update:one', 'Update:one two', 'EndOfTurn:one two'])
    expect(turns.feed({ type: 'Metadata' })).toEqual([{ type: 'Metadata' }])
  })

  it('names Flux voices', () => {
    expect(voiceName('flux-colin-en')).toBe('Colin')
    expect(DEEPGRAM_VOICES.some(voice => voice.id === 'flux-colin-en')).toBe(true)
    expect(LANGUAGES.some(language => language.code === 'en-GB')).toBe(true)
  })

  it('names the speed only when it is not 1', () => {
    expect(speakUrl(SETTINGS)).not.toContain('speed')
    expect(speakUrl({ ...SETTINGS, speed: 1.2 })).toContain('speed=1.2')
  })
})

describe('SentenceFeed', () => {
  it('gives a sentence when it is complete, and keeps the rest', () => {
    const feed = new SentenceFeed()

    expect(feed.feed('The Moon moves away from ')).toEqual([])
    expect(feed.feed('Earth each year. It is slo')).toEqual(['The Moon moves away from Earth each year. '])
    expect(feed.feed('w.', true)).toEqual(['It is slow.'])
  })

  it('joins a short part to what follows', () => {
    expect(new SentenceFeed().feed('Sure. Here is the long answer you asked for. ')).toEqual(['Sure. Here is the long answer you asked for. '])
  })

  it('never reads code, and holds back text after an open code block', () => {
    const feed = new SentenceFeed()

    expect(feed.feed('Here is the script for you. ```js\nlet a = 1')).toEqual(['Here is the script for you. '])
    expect(feed.feed('\n``` That is all of it, I think. ').join('')).not.toContain('let a')
  })

  it('gives nothing for an empty end', () => {
    expect(new SentenceFeed().feed('', true)).toEqual([])
  })
})

describe('EchoMemory', () => {
  it('knows the words of the voice, and forgets them after a while', () => {
    const echo = new EchoMemory()

    echo.remember('The Moon is slowly moving away from Earth.', 1000)
    expect(echo.isEcho('moon is slowly moving away', 2000)).toBe(true)
    expect(echo.isEcho('the moon', 2000)).toBe(true)
    expect(echo.isEcho('stop that please now', 2000)).toBe(false)
    expect(echo.isEcho('the moon', 30_000)).toBe(false)
  })

  it('knows the voice when the listening model writes it another way', () => {
    const echo = new EchoMemory()

    echo.remember("I'm checking which of those driver copies are still attached to a live session, so I only stop the orphans.", 1000)
    // A word that is still in the air, a contraction written out, one wrong word in a long stretch.
    expect(echo.isEcho("I'm check", 2000)).toBe(true)
    expect(echo.isEcho('I am checking', 2000)).toBe(true)
    expect(echo.isEcho('I am checking which of those drive copies are still attached', 2000)).toBe(true)
    expect(echo.isEcho('checking which of those river copies', 2000)).toBe(true)
  })

  it('takes the words of the user as the user, with common words of the voice in them', () => {
    const echo = new EchoMemory()

    echo.remember("I'm checking which of those driver copies are still attached to a live session, so I only stop the orphans.", 1000)
    expect(echo.isEcho('no I only want to stop the session', 2000)).toBe(false)
    expect(echo.isEcho('wait', 2000)).toBe(false)
    expect(echo.isEcho('which copies do you mean', 2000)).toBe(false)
  })

  it('knows a line that sounds long after its text came', () => {
    const echo = new EchoMemory()

    // A long answer comes as text at once. Its last line sounds half a minute later.
    echo.remember('x'.repeat(420), 1000)
    echo.remember('You can turn it back on at any time.', 1100)
    expect(echo.isEcho('can you', 32_000)).toBe(true)
  })

  it('forgets after the speaker went quiet, not after the text came', () => {
    const echo = new EchoMemory()

    echo.remember('x'.repeat(420), 1000)
    echo.remember('You can turn it back on at any time.', 1100)
    // The voice was stopped: the line never sounded.
    echo.quiet(5000)
    expect(echo.isEcho('can you', 24_000)).toBe(true)
    expect(echo.isEcho('can you', 26_000)).toBe(false)
  })

  it('takes an empty transcript as an echo', () => {
    expect(new EchoMemory().isEcho(' ... ', 0)).toBe(true)
  })
})

describe('advanceTurn', () => {
  const words = (transcript: string) => transcript.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean)
  const never = { isEcho: () => false, unsaid: words }
  const always = { isEcho: () => true, unsaid: () => [] }

  it('shows the words while the user talks, then gives the utterance', () => {
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'What' }, false, never)

    expect(start).toMatchObject({ hearing: true, hush: false, partial: 'What', utterance: null })

    const end = advanceTurn(start.turn, { event: 'EndOfTurn', transcript: 'What is the time?' }, false, never)

    expect(end.utterance).toBe('What is the time?')
  })

  it('stops the voice when the user talks over it', () => {
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: '' }, true, never)
    const update = advanceTurn(start.turn, { event: 'Update', transcript: 'wait stop' }, true, never)

    expect(start.hush).toBe(false)
    expect(update).toMatchObject({ hush: true, partial: 'wait stop' })
    expect(advanceTurn(update.turn, { event: 'EndOfTurn', transcript: 'wait stop' }, false, never).utterance).toBe('wait stop')
  })

  it('does not stop the voice for one word that asks for nothing', () => {
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Caller' }, true, never)

    expect(start.hush).toBe(false)
    expect(advanceTurn(start.turn, { event: 'EndOfTurn', transcript: 'Caller,' }, true, never).utterance).toBeNull()
    expect(advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Stop' }, true, never).hush).toBe(true)
    expect(advanceTurn(start.turn, { event: 'Update', transcript: 'Call her now' }, true, never).hush).toBe(true)
  })

  it('sends a turn that began as the voice ended', () => {
    // One word under the last word of the voice does not stop it. The rest comes in the quiet.
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Go' }, true, never)
    const update = advanceTurn(start.turn, { event: 'Update', transcript: 'Go to the hardware' }, false, never)

    expect(start.hush).toBe(false)
    expect(advanceTurn(update.turn, { event: 'EndOfTurn', transcript: 'Go to the hardware pros thing.' }, false, never).utterance).toBe('Go to the hardware pros thing.')
    // A short answer given a moment after the voice ended.
    expect(advanceTurn(advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Tuesday' }, true, never).turn, { event: 'EndOfTurn', transcript: 'Tuesday.' }, false, never).utterance).toBe('Tuesday.')
  })

  it('drops a turn that is only the voice itself', () => {
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'the moon' }, true, always)

    expect(start).toMatchObject({ hush: false, partial: '' })
    expect(advanceTurn(start.turn, { event: 'EndOfTurn', transcript: 'the moon is slowly' }, false, always).utterance).toBeNull()
  })
})

describe('a turn that broke through the voice by mistake', () => {
  it('sends nothing when its last words are the words of the voice', () => {
    const echo = new EchoMemory()

    echo.remember("I'm checking which of those driver copies are still attached.", 0)

    const own = { isEcho: (transcript: string) => echo.isEcho(transcript, 1000), unsaid: (transcript: string) => echo.unsaid(transcript, 1000) }
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Hmm jacking witch' }, true, own)

    expect(start.hush).toBe(true)
    expect(advanceTurn(start.turn, { event: 'EndOfTurn', transcript: "I'm checking." }, true, own).utterance).toBeNull()
  })

  it('does not stop the voice for one new word among words of the voice', () => {
    const echo = new EchoMemory()

    echo.remember('Four. I answer in a shape you can follow by ear. Five. For emails, I say the recipients in words.', 0)

    const own = { isEcho: (transcript: string) => echo.isEcho(transcript, 1000), unsaid: (transcript: string) => echo.unsaid(transcript, 1000) }
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'Hi five' }, true, own)

    expect(start.hush).toBe(false)
    expect(advanceTurn(start.turn, { event: 'EndOfTurn', transcript: 'Hi,' }, true, own).utterance).toBeNull()
    // The user over the same sentence.
    expect(advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'no wait' }, true, own).hush).toBe(true)
    expect(advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'skip the emails' }, true, own).hush).toBe(false)
    expect(advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'skip the emails please' }, true, own).hush).toBe(true)
  })

  it('still sends the words of the user that are also words of the voice, when the voice was quiet', () => {
    const always = { isEcho: () => true, unsaid: () => [] }
    const start = advanceTurn(NEW_TURN, { event: 'StartOfTurn', transcript: 'yes' }, false, always)

    expect(advanceTurn(start.turn, { event: 'EndOfTurn', transcript: 'yes go ahead' }, false, always).utterance).toBe('yes go ahead')
  })
})

describe('a long silence while the agent works', () => {
  const { stillWorkingLine, stillWorkingWait, afterSentence } = jest.requireActual('../live-voice') as typeof import('../live-voice')

  it('waits longer for each line, up to a limit', () => {
    expect([0, 1, 2, 3, 9].map(stillWorkingWait)).toEqual([5000, 9000, 14_000, 20_000, 20_000])
  })

  it('does not say the same line twice in a row', () => {
    for (let count = 0; count < 10; count++) {
      expect(stillWorkingLine(count + 1)).not.toBe(stillWorkingLine(count))
    }
  })

  it('goes on after the end of a sentence that was cut', () => {
    expect(afterSentence('still attached to a live')).toBeNull()
    expect(afterSentence('session. All seven are detached.')).toBe('All seven are detached.')
  })
})

describe('spoken answers', () => {
  it('ends the call on a stop phrase only when it is the whole utterance', () => {
    expect(isStopPhrase('Goodbye.')).toBe(true)
    expect(isStopPhrase('stop the server')).toBe(false)
  })

  it('allows only on a clear answer given after the question', () => {
    expect(spokenVerdict('Yes, go ahead.', NEW_TURN)).toBe('once')
    expect(spokenVerdict('yes', { duringPlayback: true, barged: true })).toBe('unclear')
    expect(spokenVerdict('maybe later', NEW_TURN)).toBe('unclear')
  })

  it('blocks at any time', () => {
    expect(spokenVerdict("No, don't.", { duringPlayback: true, barged: true })).toBe('deny')
  })

  it('asks with no accepting word', () => {
    const question = approvalQuestion({ description: 'delete the build folder', command: 'rm -rf build' })

    expect(question).toBe('Hermes wants to delete the build folder. The command is: rm -rf build. Should I let it?')
    expect(spokenVerdict(question, NEW_TURN)).toBe('unclear')
  })
})

describe('lines for the voice', () => {
  it('says a stock line for a tool', () => {
    expect(toolLine('terminal')).toBe('Running a command.')
    expect(toolLine('open_preview')).toBe('Using the browser.')
    expect(toolLine('kanban_add')).toBe('Using kanban add.')
    expect(toolLine(undefined)).toBe('Working on it.')
  })

  it('takes Markdown marks out of a line', () => {
    expect(speakableLine('## **Done.** See [the log](https://x.test/a) and `run.sh` 🎉')).toBe('Done. See the log and run.sh')
  })

  it('cuts a long line for the speak socket', () => {
    expect(speakParts('a'.repeat(2500)).map(part => part.length)).toEqual([1000, 1000, 500])
  })

  it('waits between flushes', () => {
    expect(flushWait(0, 10_000)).toBe(0)
    expect(flushWait(10_000, 11_000)).toBe(2200)
  })
})

describe('PCM helpers', () => {
  it('reads base64 frames of every padding', () => {
    for (const bytes of [[1, 2, 3], [1, 2, 3, 4], [250, 251, 252, 253, 254]]) {
      expect([...pcmBytes(bytesBase64(new Uint8Array(bytes)))]).toEqual(bytes)
    }
  })

  it('wraps frames in a WAV file', () => {
    const file = wavFile([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 16_000)
    const view = new DataView(file.buffer)

    expect(String.fromCharCode(...file.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(40, true)).toBe(4)
    expect([...file.subarray(44)]).toEqual([1, 2, 3, 4])
  })
})

describe('the voice of a call', () => {
  const { DEEPGRAM_VOICES, voiceName, withVoice, speakUrl } = jest.requireActual('../live-voice') as typeof import('../live-voice')
  const settings = { available: true, voice: 'aura-2-thalia-en', listen_model: 'flux-general-en', eot_threshold: 0.7, eot_timeout_ms: 3000, speed: 1, keyterms: [], mip_opt_out: true }

  it('names a voice for a person', () => {
    expect(voiceName('aura-2-thalia-en')).toBe('Thalia')
    expect(voiceName('aura-2-cordelia-en')).toBe('Cordelia')
    expect(voiceName('aura-asteria-en')).toBe('Asteria')
  })

  it('has no voice twice', () => {
    expect(new Set(DEEPGRAM_VOICES.map(voice => voice.id)).size).toBe(DEEPGRAM_VOICES.length)
  })

  it('takes the voice of the phone in the place of the voice of the host', () => {
    expect(speakUrl(withVoice(settings, 'aura-2-orion-en'))).toContain('model=aura-2-orion-en')
    expect(withVoice(settings, '')).toBe(settings)
  })
})
