import { splitStoredPrompt } from '../attachments'
import { botRows, roomRow } from '../bots'
import {
  botChoices,
  botTag,
  chatMentionParts,
  mentionedBots,
  mentionForms,
  mentionNote,
  referencePlugins,
  roomAnswerLine,
  roomChoices,
  roomHandle,
  roomMentionParts,
  roomTargets,
  typedMention,
  withBotChoices,
  withoutMentionNote
} from '../mentions'

const bots = botRows(
  [
    { name: 'default', path: '/p', is_default: true },
    { name: 'scout', path: '/p/scout', ui_meta: { 'hermes-bots': { title: 'CoS Bot' } }, previous_names: ['finder'] },
    { name: 'qa', path: '/p/qa', display_name: 'QA' },
    { name: 'writer', path: '/p/writer' }
  ] as never,
  0
)

const names = (text: string, active?: string) => mentionedBots(text, bots, active).map(bot => bot.name)
const marked = (parts: { text: string; mention: boolean }[]) => parts.filter(part => part.mention).map(part => part.text)

it('finds the name of a bot that is still being typed', () => {
  expect(typedMention('ask @sc')).toBe('sc')
  expect(typedMention('@')).toBe('')
  expect(typedMention('mail me@example.com')).toBeNull()
  expect(typedMention('look at @src/app')).toBeNull()
  expect(typedMention('ask @scout now')).toBeNull()
})

describe('a mention in a normal chat', () => {
  it('makes the forms the desktop app makes from a name', () => {
    expect(mentionForms('CoS Bot')).toEqual(['cos-bot', 'cosbot'])
    expect(mentionForms(' Hermes ')).toEqual([])
    expect(mentionForms('¿?')).toEqual([])
  })

  it('writes the name the user gave the bot, or the name of the profile', () => {
    expect(bots.map(bot => [bot.name, botTag(bot)])).toEqual(expect.arrayContaining([['default', 'hermes'], ['scout', 'cos-bot'], ['qa', 'qa'], ['writer', 'writer']]))
  })

  it('reaches a bot by its profile, its title and a name it had before', () => {
    expect(names('@scout and @QA, look')).toEqual(['scout', 'qa'])
    expect(names('ask @cos-bot or @cosbot')).toEqual(['scout'])
    expect(names('ask @finder')).toEqual(['scout'])
    expect(names('@hermes please')).toEqual(['default'])
  })

  it('reads no mention in an address, in code, or in a name nobody has', () => {
    expect(names('mail me@qa.com')).toEqual([])
    expect(names('run `@qa` or\n```\n@writer\n```')).toEqual([])
    expect(names('ask @nobody')).toEqual([])
  })

  it('does not let the bot of the chat name itself', () => {
    expect(names('@qa and @writer', 'qa')).toEqual(['writer'])
  })

  it('marks only the mentions that reach a bot', () => {
    expect(chatMentionParts('ask @cos-bot and @nobody, then @qa.', bots)).toEqual([
      { text: 'ask ', mention: false },
      { text: '@cos-bot', mention: true, target: { kind: 'bot', name: 'scout', title: 'CoS Bot' } },
      { text: ' and @nobody, then ', mention: false },
      { text: '@qa', mention: true, target: { kind: 'bot', name: 'qa', title: 'QA' } },
      { text: '.', mention: false }
    ])
    expect(chatMentionParts('no mention', bots)).toEqual([{ text: 'no mention', mention: false }])
  })

  it('tells the agent who each mention is, and nothing for a message that names no bot', () => {
    const note = mentionNote('ask @cos-bot and @hermes', bots)

    expect(note).toContain('@scout = agent profile "scout" ("CoS Bot"); @hermes = agent profile "default" ("Default")')
    expect(note.startsWith('\n\n[@mentions resolved from the Bot Mode roster')).toBe(true)
    expect(mentionNote('ask @nobody', bots)).toBe('')
  })

  it('takes the note out of a stored message', () => {
    const sent = `ask @qa${mentionNote('ask @qa', bots)}`

    expect(withoutMentionNote(sent)).toBe('ask @qa')
    expect(splitStoredPrompt(`ask @qa\n@file:notes.txt${mentionNote('ask @qa', bots)}\n--- Attached Context ---\nwords`)).toEqual({
      text: 'ask @qa',
      attached: [{ name: 'notes.txt', kind: 'file', path: 'notes.txt' }]
    })
  })

  it('offers the bots that start with the typed word', () => {
    expect(botChoices(bots, '@', 'default').map(choice => choice.text)).toEqual(expect.arrayContaining(['@cos-bot', '@qa', '@writer']))
    expect(botChoices(bots, '@', 'default')).toHaveLength(3)
    expect(botChoices(bots, '@co')).toEqual([{ text: '@cos-bot', display: 'CoS Bot', meta: '@cos-bot', bot: 'scout' }])
    expect(botChoices(bots, '@sc').map(choice => choice.text)).toEqual(['@cos-bot'])
    expect(botChoices(bots, '@src/ap')).toEqual([])
    expect(botChoices(bots, '@file:')).toEqual([])
  })

  it('offers the profile name of two bots with one title', () => {
    const twins = botRows([{ name: 'a1', path: '/a', display_name: 'Twin' }, { name: 'a2', path: '/b', display_name: 'Twin' }] as never, 0)

    expect(botChoices(twins, '@').map(choice => choice.text).sort()).toEqual(['@a1', '@a2'])
    expect(mentionedBots('@twin', twins)).toEqual([])
  })

  it('puts the bots before the rows of the host and drops the copy the host has of a bot', () => {
    const rows = [{ text: '@scout' }, { text: '@hermes' }, { text: '@file:' }, { text: '@qa' }]

    expect(withBotChoices(botChoices(bots, '@'), rows, bots).map(row => row.text)).toEqual([...botChoices(bots, '@').map(choice => choice.text), '@file:'])
  })
})

describe('a mention in a group chat', () => {
  const room = roomRow('id:r1', { roomId: 'r1', name: 'Launch', members: [{ name: 'scout', handle: 'cos-bot' }, { name: 'qa' }, { name: 'gone', handle: 'Old Bot' }] })!
  const targets = roomTargets(room, new Map(bots.map(bot => [bot.name, bot])))

  it('knows each member by the handle of the host', () => {
    expect(roomHandle('qa')).toBe('qa')
    expect(roomHandle('x', ' Old Bot ')).toBe('Old-Bot')
    expect(targets).toEqual([
      { handle: 'cos-bot', name: 'scout', title: 'CoS Bot' },
      { handle: 'qa', name: 'qa', title: 'QA' },
      { handle: 'Old-Bot', name: 'gone', title: 'gone' }
    ])
  })

  it('offers the members that start with the typed word, then all of them', () => {
    expect(roomChoices(targets, '').map(target => target.handle)).toEqual(['cos-bot', 'qa', 'Old-Bot', 'everyone'])
    expect(roomChoices(targets, 'sc').map(target => target.handle)).toEqual(['cos-bot'])
    expect(roomChoices(targets, 'e').map(target => target.handle)).toEqual(['everyone'])
    expect(roomChoices(targets, 'zz')).toEqual([])
  })

  it('marks what the host follows, and nothing else', () => {
    expect(marked(roomMentionParts('@COS-BOT and @scout, @all then @qa', targets))).toEqual(['@COS-BOT', '@all', '@qa'])
    // The end of a clause is not a part of the name: the colour stops before it.
    expect(marked(roomMentionParts('ask @qa. Then @cos-bot: go, @everyone.', targets))).toEqual(['@qa', '@cos-bot', '@everyone'])
    expect(roomMentionParts('ask @qa.', targets)).toEqual([{ text: 'ask ', mention: false }, { text: '@qa', mention: true, target: { kind: 'bot', name: 'qa', title: 'QA' } }, { text: '.', mention: false }])
    expect(roomMentionParts('@all go', targets)[0].target).toEqual({ kind: 'everyone', title: 'All bots' })
    // Only "." and ":" at the end are taken off, never letters.
    expect(marked(roomMentionParts('ask @qa.bye and me@example.com.', targets))).toEqual([])
  })

  it('lets a handle that holds or ends in a full stop keep its name', () => {
    const dotted = [{ handle: 'qa', name: 'qa', title: 'QA' }, { handle: 'qa.', name: 'q2', title: 'QA two' }, { handle: 'qa.bot', name: 'q3', title: 'QA bot' }]

    expect(marked(roomMentionParts('@qa.bot. and @qa. and @qa', dotted))).toEqual(['@qa.bot', '@qa.', '@qa'])
    expect(roomAnswerLine('@qa. look', dotted)).toBe('Only QA two answers.')
    expect(roomAnswerLine('@qa look', dotted)).toBe('Only QA answers.')
  })

  it('says who answers', () => {
    expect(roomAnswerLine('hello all', targets)).toBeNull()
    expect(roomAnswerLine('mail me@example.com', targets)).toBeNull()
    expect(roomAnswerLine('@qa look', targets)).toBe('Only QA answers.')
    expect(roomAnswerLine('@qa and @cos-bot look', targets)).toBe('Only QA and CoS Bot answer.')
    expect(roomAnswerLine('@qa and @everyone', targets)).toBe('All bots answer.')
    expect(roomAnswerLine('@scout look', targets)).toBe('@scout is not a bot in this group. All bots answer.')
    expect(roomAnswerLine('@qa: look', targets)).toBe('Only QA answers.')
    expect(roomAnswerLine('thanks @qa.', targets)).toBe('Only QA answers.')
    expect(roomAnswerLine('thanks @scot.', targets)).toBe('@scot is not a bot in this group. All bots answer.')
    expect(roomAnswerLine('@qa and @scout and @x', targets)).toBe('Only QA answers. @scout and @x are not bots in this group.')
  })
})

describe('a reference in a message of a normal chat', () => {
  const shown = (text: string, plugins?: string[] | null) =>
    chatMentionParts(text, bots, undefined, plugins).flatMap(part => (part.target?.kind === 'reference' ? [[part.text, part.target.type, part.target.title]] : []))

  it('has the name a person reads', () => {
    expect(shown('read @file:src/core/notes.md and @folder:src/app/ now')).toEqual([
      ['@file:src/core/notes.md', 'file', 'notes.md'],
      ['@folder:src/app/', 'folder', 'app']
    ])
    expect(shown('@file:"my notes.md":3-9 and @file:a.ts:4')).toEqual([
      ['@file:"my notes.md":3-9', 'file', 'my notes.md, lines 3 to 9'],
      ['@file:a.ts:4', 'file', 'a.ts, line 4']
    ])
    expect(shown('@url:https://www.h.example/page?x=1 @git:5 @git:1 @diff @staged')).toEqual([
      ['@url:https://www.h.example/page?x=1', 'url', 'h.example'],
      ['@git:5', 'git', 'Last 5 commits'],
      ['@git:1', 'git', 'Last commit'],
      ['@diff', 'git', 'Changes'],
      ['@staged', 'git', 'Staged changes']
    ])
  })

  it('ends before the full stop of its sentence and a bracket that was open', () => {
    expect(shown('(see @file:a.ts). Then @file:b(1).ts, ok')).toEqual([
      ['@file:a.ts', 'file', 'a.ts'],
      ['@file:b(1).ts', 'file', 'b(1).ts']
    ])
  })

  it('is of a plugin only when the host has that plugin', () => {
    expect(shown('fix @issue:12 please')).toEqual([])
    expect(shown('fix @issue:12, please', ['issue'])).toEqual([['@issue:12', 'plugin', 'Issue: 12']])
    expect(referencePlugins([{ text: '@diff' }, { text: '@file:' }, { text: '@Issue:' }, { text: '@qa' }, { text: '@issue:' }])).toEqual(['issue'])
  })

  it('is not one in code, in an address, or in the answer of a bot', () => {
    expect(shown('run `@file:a.ts` or mail me@file:a.ts')).toEqual([])
    expect(shown('read @file:a.ts', null)).toEqual([])
  })

  it('stands beside a bot in one message', () => {
    expect(chatMentionParts('@qa read @file:a.ts', bots).map(part => part.target?.title)).toEqual(['QA', undefined, 'a.ts'])
  })
})
